"""Actual payroll/journal bodies, SQLite memory transactions, synthetic USD policy.

Exercises request-session close rollback and sequential retries, not PostgreSQL
locks/concurrency, authentication, HTTP responses, FX or external payments. Period
mutex/date decisions are injected; existing real-gate suites cover that boundary.
"""
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import case, create_engine, event, func, select
from sqlalchemy.orm import Session

from app.models.accounting import JournalEntry, JournalLine
from app.models.activity_log import ActivityLog
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.payroll import PayrollPeriod, PayrollRun
from test_hr_document_upload_commit_safety_offline import (
    actual_function, actual_audit, audit_guards, FixtureCompiler,
)

DAY = date(2096, 1, 31)


class InjectedFailure(RuntimeError):
    pass


class FaultSession(Session):
    failure = None

    def commit(self):
        if self.failure == 'before-commit':
            self.flush()
            raise InjectedFailure('after flush, before commit')
        super().commit()
        if self.failure == 'after-commit':
            raise InjectedFailure('commit acknowledged by DB, response lost')

    def refresh(self, *args, **kwargs):
        if self.failure == 'readback':
            raise InjectedFailure('postcommit readback failed')
        return super().refresh(*args, **kwargs)


class PayrollFinalizationFailureTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.socket.connect_ex',
                       'socket.create_connection', 'socket.getaddrinfo'):
            self.enterContext(patch(target, side_effect=AssertionError('network forbidden')))
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for model in (PayrollPeriod, PayrollRun, FinancialAccount, FinancialTransaction,
                      JournalEntry, JournalLine, ActivityLog):
            model.__table__.create(self.engine)
        with self.engine.begin() as conn:
            conn.execute(PayrollPeriod.__table__.insert(), dict(
                id='period', organization_id='org', name='Synthetic', period_start=date(2096, 1, 1),
                period_end=DAY, pay_date=date(2096, 2, 5), created_by_user_id='actor'))
            conn.execute(PayrollRun.__table__.insert(), dict(
                id='run', organization_id='org', period_id='period', run_number='PAY-SYN',
                currency='USD', employee_count=1, gross_total=100, net_total=90,
                deduction_total=10, created_by_user_id='actor'))
            conn.execute(FinancialAccount.__table__.insert(), dict(
                id='bank', organization_id='org', name='Synthetic bank', currency='USD',
                opening_balance=1000, created_by_user_id='actor'))
        self.tenant = NS(organization_id='org', user_id='actor')
        self.closed_dates = set()
        self.trace = []
        self.audit_failure = False
        self.post_failure = False
        money = lambda value: Decimal(value or 0).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)

        def gate(db, organization):
            self.trace.append(('gate', organization))
            db.info['synthetic_gate'] = organization

        def period_check(db, organization, day):
            self.assertEqual(db.info.get('synthetic_gate'), organization)
            self.trace.append(('period', day))
            if day in self.closed_dates:
                raise HTTPException(409, 'Synthetic closed period')

        context = dict(select=select, func=func, case=case, Decimal=Decimal,
                       datetime=datetime, timezone=timezone, uuid4=uuid4, HTTPException=HTTPException,
                       PayrollRun=PayrollRun, PayrollPeriod=PayrollPeriod,
                       FinancialAccount=FinancialAccount, FinancialTransaction=FinancialTransaction,
                       JournalEntry=JournalEntry, JournalLine=JournalLine,
                       money=money, _money=money, acquire_accounting_period_gate=gate,
                       ensure_open_period=period_check,
                       assert_current_functional_posting_period=lambda *args: NS(currency='USD'),
                       _normalize_implicit_foreign_lines=lambda db, org, currency, day, lines: lines,
                       functional_currency_for_date=lambda *args: 'USD',
                       to_base_amount=lambda db, org, base, amount, currency, **kwargs: (amount, Decimal(1)),
                       system_account=lambda db, org, key: NS(id=key),
                       financial_ledger_account=lambda *args: (None, NS(id='cash')),
                       PostingLine=lambda **kwargs: NS(**(dict(debit=Decimal(0), credit=Decimal(0),
                                                              exchange_rate_to_base=Decimal(1)) | kwargs)),
                       _run_read=lambda db, org, run: run.status)
        real_post = actual_function('app/services/accounting_posting.py', 'post_journal', context)

        def post(*args, **kwargs):
            result = real_post(*args, **kwargs)
            if self.post_failure:
                raise InjectedFailure('journal and lines flushed')
            return result

        real_audit = actual_audit()

        def audit(*args, **kwargs):
            result = real_audit(*args, **kwargs)
            if self.audit_failure:
                args[0].flush()
                raise InjectedFailure('audit and business writes flushed')
            return result

        context.update(post_journal=post, record_activity=audit)
        for name in ('_account_balance', '_payroll_journal', '_ensure_payroll_accrual', 'approve_run', 'pay_run'):
            context[name] = actual_function('app/api/v1/payroll.py', name, context)
        self.handlers = context

    def request(self, operation, *, failure=None, tenant=None):
        db = FaultSession(self.engine)
        db.failure = failure
        event.listen(db, 'do_orm_execute',
                     lambda state: self.trace.append(('query', state.statement)))
        guards = audit_guards()
        for event_name, callback in [('before_flush', '_remember_audit_coverage'),
                                     ('before_commit', '_require_audit_for_commit'),
                                     ('after_commit', '_clear_audit_state'),
                                     ('after_rollback', '_clear_audit_state')]:
            event.listen(db, event_name, guards[callback])
        # Real request dependency cleanup, not a test-added explicit rollback.
        dependency = actual_function('app/db/session.py', 'get_db', {'SessionLocal': lambda: db})()
        next(dependency)
        try:
            args = dict(run_id='run', request=None, db=db, tenant=tenant or self.tenant)
            if operation == 'pay_run':
                args['payload'] = NS(account_id='bank')
            return self.handlers[operation](**args)
        finally:
            dependency.close()

    def snapshot(self):
        with Session(self.engine) as db:
            return (db.get(PayrollRun, 'run').status,
                    *(db.scalar(select(func.count()).select_from(model)) for model in
                      (JournalEntry, JournalLine, FinancialTransaction, ActivityLog)))

    def change(self, model, **values):
        with self.engine.begin() as conn:
            conn.execute(model.__table__.update().values(**values))

    def test_approve_then_pay_then_duplicate_has_one_operational_debit(self):
        self.assertEqual(self.request('approve_run'), 'approved')
        self.assertEqual(self.snapshot(), ('approved', 1, 3, 0, 1))
        self.assertEqual(self.request('pay_run'), 'paid')
        self.assertEqual(self.snapshot(), ('paid', 2, 5, 1, 2))
        with self.assertRaises(HTTPException) as raised:
            self.request('pay_run')
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), ('paid', 2, 5, 1, 2))

    def test_gate_precedes_locked_run_and_account_queries(self):
        for operation in ('approve_run', 'pay_run'):
            self.trace.clear()
            self.request(operation)
            self.assertEqual(self.trace[0], ('gate', 'org'))
            queries = [item[1] for item in self.trace if item[0] == 'query']
            self.assertIsNotNone(queries[0]._for_update_arg)
            self.assertEqual(queries[0].column_descriptions[0]['entity'], PayrollRun)
            if operation == 'pay_run':
                accounts = [query for query in queries
                            if query.column_descriptions[0].get('entity') is FinancialAccount]
                self.assertTrue(accounts)
                self.assertIsNotNone(accounts[0]._for_update_arg)

    def test_lost_approval_response_retry_preserves_single_accrual(self):
        with self.assertRaises(InjectedFailure):
            self.request('approve_run', failure='after-commit')
        self.assertEqual(self.snapshot(), ('approved', 1, 3, 0, 1))
        with self.assertRaises(HTTPException) as raised:
            self.request('approve_run')
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), ('approved', 1, 3, 0, 1))

    def test_approval_failure_after_journal_flush_rolls_back_on_request_close(self):
        self.post_failure = True
        with self.assertRaises(InjectedFailure):
            self.request('approve_run')
        self.assertEqual(self.snapshot(), ('draft', 0, 0, 0, 0))
        self.post_failure = False
        self.assertEqual(self.request('approve_run'), 'approved')

    def test_approval_audit_failure_rolls_back_status_and_journal(self):
        self.audit_failure = True
        with self.assertRaises(InjectedFailure):
            self.request('approve_run')
        self.assertEqual(self.snapshot(), ('draft', 0, 0, 0, 0))

    def test_approval_commit_failure_rolls_back_then_retry_succeeds(self):
        with self.assertRaises(InjectedFailure):
            self.request('approve_run', failure='before-commit')
        self.assertEqual(self.snapshot(), ('draft', 0, 0, 0, 0))
        self.assertEqual(self.request('approve_run'), 'approved')

    def test_payment_failure_points_preserve_approval_and_retry_once(self):
        for failure in ('journal', 'audit', 'before-commit'):
            with self.subTest(failure=failure):
                # Each failure is retried from the same approved durable state.
                if self.snapshot()[0] == 'draft':
                    self.request('approve_run')
                self.post_failure = failure == 'journal'
                self.audit_failure = failure == 'audit'
                with self.assertRaises(InjectedFailure):
                    self.request('pay_run', failure=failure)
                self.assertEqual(self.snapshot(), ('approved', 1, 3, 0, 1))
                self.post_failure = self.audit_failure = False
        self.assertEqual(self.request('pay_run'), 'paid')
        self.assertEqual(self.snapshot(), ('paid', 2, 5, 1, 2))

    def test_lost_payment_response_then_retry_does_not_duplicate(self):
        self.request('approve_run')
        with self.assertRaises(InjectedFailure):
            self.request('pay_run', failure='after-commit')
        self.assertEqual(self.snapshot(), ('paid', 2, 5, 1, 2))
        with self.assertRaises(HTTPException) as raised:
            self.request('pay_run')
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), ('paid', 2, 5, 1, 2))

    def test_postcommit_readback_failure_keeps_payment_durable(self):
        self.request('approve_run')
        with self.assertRaises(InjectedFailure):
            self.request('pay_run', failure='readback')
        self.assertEqual(self.snapshot(), ('paid', 2, 5, 1, 2))

    def test_closed_accrual_date_rejects_approval_without_writes(self):
        self.closed_dates.add(DAY)
        with self.assertRaises(HTTPException):
            self.request('approve_run')
        self.assertEqual(self.snapshot(), ('draft', 0, 0, 0, 0))
        decisions = [item for item in self.trace if item[0] != 'query']
        self.assertEqual(decisions[:2], [('gate', 'org'), ('period', DAY)])

    def test_closed_payment_date_keeps_approved_run_and_existing_accrual(self):
        self.request('approve_run')
        self.closed_dates.add(date(2096, 2, 5))
        with self.assertRaises(HTTPException):
            self.request('pay_run')
        self.assertEqual(self.snapshot(), ('approved', 1, 3, 0, 1))

    def test_foreign_tenant_run_not_found_before_posting(self):
        for operation in ('approve_run', 'pay_run'):
            with self.assertRaises(HTTPException) as raised:
                self.request(operation, tenant=NS(organization_id='foreign', user_id='actor'))
            self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(self.snapshot(), ('draft', 0, 0, 0, 0))

    def test_period_tenant_mismatch_cannot_approve(self):
        self.change(PayrollPeriod, organization_id='foreign')
        with self.assertRaises(HTTPException) as raised:
            self.request('approve_run')
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), ('draft', 0, 0, 0, 0))

    def test_account_tenant_mismatch_cannot_pay(self):
        self.request('approve_run')
        self.change(FinancialAccount, organization_id='foreign')
        with self.assertRaises(HTTPException) as raised:
            self.request('pay_run')
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(self.snapshot(), ('approved', 1, 3, 0, 1))

    def test_insufficient_funds_cannot_create_payment(self):
        self.request('approve_run')
        self.change(FinancialAccount, opening_balance=1)
        with self.assertRaises(HTTPException) as raised:
            self.request('pay_run')
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), ('approved', 1, 3, 0, 1))


if __name__ == '__main__':
    unittest.main()
