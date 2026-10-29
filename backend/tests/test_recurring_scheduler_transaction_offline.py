"""Actual recurring scheduler + posting bodies with durable SQLite memory fixtures.

Period/advisory locking and journal adapter are explicit substitutes. This proves
transaction rollback/retry of expense, bank movement, schedule and audit rows,
not PostgreSQL concurrency, journal integration or external scheduler execution.
Only fixture tables exist; SQLite foreign-key enforcement is not enabled.
"""
import calendar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import socket
import unittest
import uuid

from fastapi import HTTPException
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from app.models.organization import Organization
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.finance_controls import RecurringExpense
from app.models.activity_log import ActivityLog
from test_hr_document_upload_commit_safety_offline import actual_function, actual_audit, audit_guards, FixtureCompiler

NOW = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)
DUE = NOW.date()
MODELS = (Organization, ExpenseCategory, FinancialAccount, Expense, FinancialTransaction, RecurringExpense, ActivityLog)
SOURCE = 'app/services/recurring_auto_post.py'

class FaultSession(Session):
    failure = None
    def commit(self):
        if self.failure == 'before':
            self.flush()
            raise RuntimeError('synthetic precommit failure')
        super().commit()
        if self.failure == 'after':
            raise RuntimeError('synthetic lost acknowledgement')

class RecurringSchedulerTransactionTests(unittest.TestCase):
    def setUp(self):
        def forbidden(*args, **kwargs):
            raise AssertionError('No network allowed')
        for target, name in ((socket.socket, 'connect'), (socket.socket, 'connect_ex'),
                             (socket, 'create_connection'), (socket, 'getaddrinfo')):
            guard = patch.object(target, name, forbidden)
            guard.start(); self.addCleanup(guard.stop)
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for model in MODELS:
            model.__table__.create(self.engine)
        with self.engine.begin() as conn:
            conn.execute(Organization.__table__.insert(), dict(id='org', name='Synthetic', slug='synthetic', created_by_user_id='user', timezone='UTC'))
            conn.execute(ExpenseCategory.__table__.insert(), dict(id='cat', organization_id='org', name='Synthetic', slug='synthetic'))
            conn.execute(FinancialAccount.__table__.insert(), dict(id='account', organization_id='org', name='Synthetic', currency='USD', opening_balance=100, created_by_user_id='user'))
            conn.execute(RecurringExpense.__table__.insert(), dict(id='schedule', organization_id='org', name='Synthetic', description='Fixture', category_id='cat', account_id='account', expense_currency='USD', expense_amount=10, frequency='monthly', next_due_date=DUE, auto_post=True, created_by_user_id='user'))
        for event_name, name in (('before_flush', '_remember_audit_coverage'), ('before_commit', '_require_audit_for_commit'), ('after_commit', '_clear_audit_state'), ('after_rollback', '_clear_audit_state')):
            callback = audit_guards()[name]
            event.listen(FaultSession, event_name, callback)
            self.addCleanup(event.remove, FaultSession, event_name, callback)
        self.db = FaultSession(self.engine, autoflush=False, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.audit = Mock(side_effect=actual_audit())
        self.journal = Mock()
        context = dict(calendar=calendar, date=date, datetime=datetime, timedelta=timedelta, timezone=timezone,
                       Decimal=Decimal, ROUND_HALF_UP=ROUND_HALF_UP, MONEY=Decimal('.01'), ZoneInfo=ZoneInfo,
                       ZoneInfoNotFoundError=ZoneInfoNotFoundError, select=select, func=func, HTTPException=HTTPException,
                       acquire_accounting_period_gate=lambda *a:None, require_accounting_period_gate=lambda *a:None,
                       ensure_accounting_period_open=lambda *a:None, record_activity=self.audit, post_expense=self.journal,
                       next_sequence_code=lambda *a:str(uuid.uuid4()), CREDIT_CARD_RECURRING_UNSUPPORTED='unsupported')
        context.update({model.__name__: model for model in MODELS})
        for name in ('_money', '_organization_date', '_add_months', 'next_due_date', 'account_balance', 'auto_post_eligibility', 'post_due_recurring_expense', 'process_due_auto_posts'):
            context[name] = actual_function(SOURCE, name, context)
        self.run_scheduler = context['process_due_auto_posts']

    def run_once(self):
        return self.run_scheduler(self.db, now=NOW)

    def state(self):
        with Session(self.engine) as fresh:
            schedule = fresh.get(RecurringExpense, 'schedule')
            counts = tuple(fresh.scalar(select(func.count()).select_from(model)) for model in (Expense, FinancialTransaction))
            return counts, schedule.next_due_date, schedule.auto_post_last_error

    def audit_actions(self):
        with Session(self.engine) as fresh:
            return list(fresh.scalars(select(ActivityLog.action)))

    def test_success_and_same_day_retry_do_not_duplicate(self):
        self.assertEqual(self.run_once(), (1, 0))
        self.assertEqual(self.run_once(), (0, 0))
        self.assertEqual(self.state(), ((1, 1), date(2026, 11, 29), None))
        self.assertEqual(self.journal.call_count, 1)
        self.assertEqual(self.audit_actions(), ['finance.recurring_expense.auto_posted'])
        with Session(self.engine) as fresh:
            self.assertEqual(fresh.scalar(select(FinancialTransaction.amount)), Decimal('10.00'))

    def test_journal_unknown_failure_rolls_back_then_retry_once(self):
        self.journal.side_effect = RuntimeError('journal unavailable')
        with self.assertRaisesRegex(RuntimeError, 'journal unavailable'): self.run_once()
        self.assertEqual(self.state(), ((0, 0), DUE, None))
        self.assertEqual(self.audit_actions(), [])
        self.journal.side_effect = None
        self.assertEqual(self.run_once(), (1, 0))
        self.assertEqual(self.state()[0], (1, 1))

    def test_known_rejection_after_business_flush_only_persists_failure_marker(self):
        self.journal.side_effect = ValueError('synthetic rejection')
        self.assertEqual(self.run_once(), (0, 1))
        self.assertEqual(self.state(), ((0, 0), DUE, 'synthetic rejection'))
        self.assertEqual(self.audit_actions(), ['finance.recurring_expense.auto_post_failed'])
        self.journal.side_effect = None
        self.assertEqual(self.run_once(), (1, 0))
        self.assertEqual(self.state(), ((1, 1), date(2026, 11, 29), None))

    def test_audit_failure_rolls_back_posting_and_schedule(self):
        self.audit.side_effect = RuntimeError('audit unavailable')
        with self.assertRaisesRegex(RuntimeError, 'audit unavailable'): self.run_once()
        self.assertEqual(self.state(), ((0, 0), DUE, None))
        self.assertEqual(self.audit_actions(), [])

    def test_precommit_exception_caller_rollback_allows_safe_retry(self):
        self.db.failure = 'before'
        with self.assertRaises(RuntimeError): self.run_once()
        self.db.rollback()  # actual worker owns cleanup after uncertain commit
        self.assertEqual(self.state(), ((0, 0), DUE, None))
        self.assertEqual(self.audit_actions(), [])
        self.db.failure = None
        self.assertEqual(self.run_once(), (1, 0))

    def test_lost_commit_acknowledgement_retry_preserves_one_occurrence(self):
        self.db.failure = 'after'
        with self.assertRaises(RuntimeError): self.run_once()
        self.db.rollback()
        self.assertEqual(self.state(), ((1, 1), date(2026, 11, 29), None))
        self.db.failure = None
        self.assertEqual(self.run_once(), (0, 0))
        self.assertEqual(self.journal.call_count, 1)

    def test_failure_marker_audit_exception_leaves_no_false_posting(self):
        self.journal.side_effect = ValueError('rejected')
        audit = actual_audit()
        def audit_call(db, **kwargs):
            if kwargs.get('outcome') == 'failure': raise RuntimeError('marker unavailable')
            return audit(db, **kwargs)
        self.audit.side_effect = audit_call
        with self.assertRaisesRegex(RuntimeError, 'marker unavailable'): self.run_once()
        self.db.rollback()
        self.assertEqual(self.state(), ((0, 0), DUE, None))
        self.assertEqual(self.audit_actions(), [])

    def test_insufficient_funds_durable_failure_then_corrected_retry(self):
        with self.engine.begin() as conn:
            conn.execute(FinancialAccount.__table__.update().values(opening_balance=0))
        self.assertEqual(self.run_once(), (0, 1))
        self.assertEqual(self.state()[0:2], ((0, 0), DUE))
        self.assertIn('Insufficient balance', self.state()[2])
        with self.engine.begin() as conn:
            conn.execute(FinancialAccount.__table__.update().values(opening_balance=100))
        self.assertEqual(self.run_once(), (1, 0))
        self.assertEqual(self.state()[0], (1, 1))

    def test_known_failure_does_not_undo_other_candidate_success(self):
        with self.engine.begin() as conn:
            conn.execute(RecurringExpense.__table__.insert(), dict(id='second', organization_id='org', name='Second', description='Fixture', category_id='cat', account_id='account', expense_currency='USD', expense_amount=20, frequency='monthly', next_due_date=DUE, auto_post=True, created_by_user_id='user'))
        def reject_first(db, **kwargs):
            if kwargs['expense'].expense_amount == 10:
                raise ValueError('first rejected')
        self.journal.side_effect = reject_first
        self.assertEqual(self.run_once(), (1, 1))
        self.assertEqual(self.state(), ((1, 1), DUE, 'first rejected'))
        with Session(self.engine) as fresh:
            self.assertEqual(fresh.get(RecurringExpense, 'second').next_due_date, date(2026, 11, 29))
        self.journal.side_effect = None
        self.assertEqual(self.run_once(), (1, 0))
        self.assertEqual(self.state()[0], (2, 2))

    def test_failure_marker_lost_acknowledgement_keeps_due_and_no_expense(self):
        self.journal.side_effect = ValueError('rejected')
        self.db.failure = 'after'
        with self.assertRaises(RuntimeError): self.run_once()
        self.db.rollback()
        self.assertEqual(self.state(), ((0, 0), DUE, 'rejected'))
        self.db.failure = None
        self.journal.side_effect = None
        self.assertEqual(self.run_once(), (1, 0))

    def test_end_date_last_occurrence_deactivates_only_after_success(self):
        with self.engine.begin() as conn:
            conn.execute(RecurringExpense.__table__.update().values(end_date=DUE))
        self.journal.side_effect = RuntimeError('unavailable')
        with self.assertRaises(RuntimeError): self.run_once()
        with Session(self.engine) as fresh:
            self.assertTrue(fresh.get(RecurringExpense, 'schedule').is_active)
        self.journal.side_effect = None
        self.assertEqual(self.run_once(), (1, 0))
        with Session(self.engine) as fresh:
            self.assertFalse(fresh.get(RecurringExpense, 'schedule').is_active)
        self.assertEqual(self.run_once(), (0, 0))
