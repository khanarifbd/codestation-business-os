"""Expense void wrapper/leaf and journal reversal on SQLite memory.

Real SQLAlchemy identity-map refresh and rollback, with a deterministic stored-row
change between wrapper preload and leaf lock. This models a shared-gate contender;
it is not a real PostgreSQL race, lock, FK, or HTTP/authentication certification.
"""
import ast
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine, event, func, select, update
from sqlalchemy.orm import Session

from app.models.accounting import JournalEntry, JournalLine
from app.models.activity_log import ActivityLog
from app.models.expenses import Expense
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.organization import Organization
from test_hr_document_upload_commit_safety_offline import actual_function, actual_audit, audit_guards, FixtureCompiler

ROOT = Path(__file__).resolve().parents[1]
node = next(n for n in ast.parse((ROOT / 'app/db/session.py').read_text()).body
            if isinstance(n, ast.ClassDef) and n.name == 'BusinessSession')
namespace = {'Session': Session}
exec(compile(ast.Module(body=[node], type_ignores=[]), str(ROOT / 'app/db/session.py'), 'exec'), namespace)
BusinessSession = namespace['BusinessSession']
defer_commits = contextmanager(actual_function('app/db/session.py', 'defer_commits', {}))
DAY = date(2096, 2, 1)


class InjectedFailure(RuntimeError):
    pass


class FaultSession(BusinessSession):
    failure = None

    def commit(self):
        outer = not self.info.get('deferred_commit_depth')
        if outer and self.failure == 'before-commit':
            self.flush()
            raise InjectedFailure('after flush before outer commit')
        result = super().commit()
        if outer and self.failure == 'after-commit':
            raise InjectedFailure('outer commit response lost')
        return result


class ExpenseVoidTransactionTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.socket.connect_ex',
                       'socket.create_connection', 'socket.getaddrinfo'):
            self.enterContext(patch(target, side_effect=AssertionError('network forbidden')))
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for model in (Organization, Expense, FinancialAccount, FinancialTransaction,
                      JournalEntry, JournalLine, ActivityLog):
            model.__table__.create(self.engine)
        with self.engine.begin() as conn:
            conn.execute(Organization.__table__.insert(), dict(id='org', name='Synthetic', slug='synthetic',
                         timezone='UTC', currency='USD', created_by_user_id='actor'))
            conn.execute(FinancialAccount.__table__.insert(), dict(id='bank', organization_id='org',
                         name='Synthetic bank', currency='USD', created_by_user_id='actor'))
            conn.execute(Expense.__table__.insert(), dict(id='expense', organization_id='org',
                         expense_number='EXP-SYN', category_id='category', account_id='bank',
                         description='Synthetic expense', expense_date=DAY, expense_currency='USD',
                         expense_amount=100, account_currency='USD', account_amount=100, exchange_rate=1,
                         profitability_currency='USD', profitability_amount=100,
                         profitability_exchange_rate=1, created_by_user_id='actor'))
            conn.execute(FinancialTransaction.__table__.insert(), self.movement('expense', 'debit'))
            conn.execute(JournalEntry.__table__.insert(), dict(id='original', organization_id='org',
                         entry_number='JE-SYN', entry_date=DAY, functional_currency='USD', source_type='expense_post',
                         source_id='expense', created_by_user_id='actor', posted_by_user_id='actor'))
            conn.execute(JournalLine.__table__.insert(), [dict(organization_id='org', journal_entry_id='original',
                         ledger_account_id=key, currency='USD', debit=debit, credit=credit, original_amount=100)
                         for key, debit, credit in [('cost', 100, 0), ('cash', 0, 100)]])
        self.contender = False
        self.fail_reverse = False
        self.fail_audit = False
        self.fail_detail = False
        self.closed = False
        self.trace = []

        def gate(db, org):
            self.trace.append('shared-gate')
            db.info['fixture_gate'] = org

        def require(db, org):
            self.assertEqual(db.info.get('fixture_gate'), org)

        def period(db, org, day):
            require(db, org)
            if self.closed:
                raise HTTPException(409, 'Synthetic closed period')

        context = dict(select=select, datetime=datetime, timezone=timezone, uuid4=uuid4, HTTPException=HTTPException,
                       Expense=Expense, FinancialAccount=FinancialAccount, FinancialTransaction=FinancialTransaction,
                       JournalEntry=JournalEntry, JournalLine=JournalLine,
                       defer_commits=defer_commits, acquire_accounting_period_gate=gate,
                       require_accounting_period_gate=require, ensure_open_period=period,
                       current_functional_currency_period=lambda *args: NS(currency='USD', effective_from=DAY),
                       assert_current_functional_posting_period=lambda *args: NS(currency='USD'),
                       _tenant_today=lambda *args: DAY)
        context['_posted_source'] = actual_function('app/services/operational_posting.py', '_posted_source', context)
        real_post = actual_function('app/services/operational_posting.py', 'post_expense', context)

        def post(db, **kwargs):
            result = real_post(db, **kwargs)  # Existing journal fast path is actual code.
            if self.contender:
                # Deliberately change stored state without synchronizing the preloaded ORM row.
                # The production gate is shared: another void can commit between these reads.
                # This fixture models visibility, not an independently committed PG transaction.
                self.assertEqual(kwargs['expense'].status, 'posted')
                db.execute(update(Expense).where(Expense.id == 'expense').values(status='voided')
                           .execution_options(synchronize_session=False))
                db.connection().execute(FinancialTransaction.__table__.insert(), self.movement('expense_void', 'credit'))
                self.assertEqual(kwargs['expense'].status, 'posted')
            return result

        real_reverse = actual_function('app/services/journal_reversal.py', 'reverse_source_journal', context)

        def reverse(*args, **kwargs):
            result = real_reverse(*args, **kwargs)
            if self.fail_reverse:
                raise InjectedFailure('reversal journal and lines flushed')
            return result

        real_audit = actual_audit()

        def audit(*args, **kwargs):
            result = real_audit(*args, **kwargs)
            if self.fail_audit:
                args[0].flush()
                raise InjectedFailure('audit and operational reversal flushed')
            return result

        def detail(db, org, expense):
            if self.fail_detail:
                raise InjectedFailure('inner response serialization failed')
            return db.get(Expense, expense).status

        context.update(post_expense=post, reverse_source_journal=reverse, record_activity=audit, _expense_detail=detail)
        context['void_expense'] = actual_function('app/api/v1/finance_expenses.py', 'void_expense', context)
        self.handler = actual_function('app/api/v1/financial_safety.py', 'safe_void_expense', context)

    @staticmethod
    def movement(source, direction):
        return dict(organization_id='org', account_id='bank', transaction_date=DAY,
                    direction=direction, amount=100, currency='USD', source_type=source,
                    source_id='expense', created_by_user_id='actor')

    def request(self, failure=None, organization='org'):
        db = FaultSession(self.engine, autoflush=False, expire_on_commit=False)
        db.failure = failure
        guards = audit_guards()
        for event_name, callback in [('before_flush', '_remember_audit_coverage'), ('before_commit', '_require_audit_for_commit'),
                                     ('after_commit', '_clear_audit_state'), ('after_rollback', '_clear_audit_state')]:
            event.listen(db, event_name, guards[callback])
        dependency = actual_function('app/db/session.py', 'get_db', {'SessionLocal': lambda: db})()
        next(dependency)
        try:
            tenant = NS(organization_id=organization, user_id='actor', organization=db.get(Organization, 'org'))
            return self.handler('expense', None, db, tenant)
        finally:
            dependency.close()

    def snapshot(self):
        with Session(self.engine) as db:
            return (db.get(Expense, 'expense').status,
                    *(db.scalar(select(func.count()).select_from(model)) for model in
                      (FinancialTransaction, JournalEntry, JournalLine, ActivityLog)))

    def test_stored_voided_status_overrides_wrapper_preloaded_posted_instance(self):
        self.contender = True
        with self.assertRaises(HTTPException) as raised:
            self.request()
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail, 'Only posted expenses can be voided')

    def test_success_then_retry_has_one_credit_and_one_reversal(self):
        self.assertEqual(self.request(), 'voided')
        self.assertEqual(self.snapshot(), ('voided', 2, 2, 4, 1))
        with Session(self.engine) as db:
            reversal = db.scalar(select(JournalEntry).where(JournalEntry.reversed_entry_id == 'original'))
            lines = db.scalars(select(JournalLine).where(JournalLine.journal_entry_id == reversal.id)).all()
            self.assertEqual({(line.ledger_account_id, line.debit, line.credit) for line in lines},
                             {('cost', 0, 100), ('cash', 100, 0)})
            credit = db.scalar(select(FinancialTransaction).where(FinancialTransaction.source_type == 'expense_void'))
            self.assertEqual((credit.amount, credit.currency, credit.direction), (100, 'USD', 'credit'))
        with self.assertRaises(HTTPException) as raised:
            self.request()
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), ('voided', 2, 2, 4, 1))

    def test_journal_failure_rolls_back_inner_commit_and_operational_credit(self):
        self.fail_reverse = True
        with self.assertRaises(InjectedFailure):
            self.request()
        self.assertEqual(self.snapshot(), ('posted', 1, 1, 2, 0))
        self.fail_reverse = False
        self.assertEqual(self.request(), 'voided')

    def test_audit_failure_rolls_back_status_and_credit(self):
        self.fail_audit = True
        with self.assertRaises(InjectedFailure):
            self.request()
        self.assertEqual(self.snapshot(), ('posted', 1, 1, 2, 0))

    def test_inner_response_failure_does_not_commit_operational_void(self):
        self.fail_detail = True
        with self.assertRaises(InjectedFailure):
            self.request()
        self.assertEqual(self.snapshot(), ('posted', 1, 1, 2, 0))

    def test_outer_precommit_failure_rolls_back_all_effects(self):
        with self.assertRaises(InjectedFailure):
            self.request('before-commit')
        self.assertEqual(self.snapshot(), ('posted', 1, 1, 2, 0))

    def test_lost_commit_response_retry_does_not_duplicate(self):
        with self.assertRaises(InjectedFailure):
            self.request('after-commit')
        self.assertEqual(self.snapshot(), ('voided', 2, 2, 4, 1))
        with self.assertRaises(HTTPException):
            self.request()
        self.assertEqual(self.snapshot(), ('voided', 2, 2, 4, 1))

    def test_closed_period_rolls_back_operational_void_and_audit(self):
        self.closed = True
        with self.assertRaises(HTTPException) as raised:
            self.request()
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), ('posted', 1, 1, 2, 0))

    def test_foreign_tenant_cannot_void_or_reverse(self):
        with self.assertRaises(HTTPException) as raised:
            self.request(organization='foreign')
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(self.snapshot(), ('posted', 1, 1, 2, 0))

    def test_foreign_account_cannot_receive_void_credit(self):
        with self.engine.begin() as conn:
            conn.execute(update(FinancialAccount).values(organization_id='foreign'))
        with self.assertRaises(HTTPException) as raised:
            self.request()
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), ('posted', 1, 1, 2, 0))
