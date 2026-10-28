"""Actual expense handlers with fake sessions. No database or concurrency proof."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace as NS
import socket
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy.engine import Engine
from app.api.v1 import finance_expenses as api, financial_safety as safe
from app.models.expenses import Expense
from app.models.finance import FinancialTransaction
from app.schemas.expenses import ExpenseCreate

D = Decimal


class PeriodTransaction:
    def __init__(self): self.is_active = True

class PeriodConnection:
    def __init__(self):
        self.closed = self.invalidated = False
        self.dialect = NS(name='postgresql')
        self.connection = NS(driver_connection=NS(autocommit=False))
        self.transaction = PeriodTransaction()
        self.isolation = 'READ COMMITTED'
    def get_transaction(self): return self.transaction
    def get_isolation_level(self): return self.isolation

class PeriodTransactionFake:
    """Strict active-root/connection protocol for the real period gate, not a mock."""
    def initialize_period_transaction(self):
        self.info = {}; self.is_active = True
        self.transaction = PeriodTransaction(); self.period_connection = PeriodConnection()
        self.period_events = []; self.boundary_trace = []
    def get_transaction(self): return self.transaction
    def get_nested_transaction(self): return None
    def connection(self):
        if self.transaction is None: raise AssertionError('Unexpected implicit transaction')
        return self.period_connection
    def execute(self, statement, params):
        sql = str(statement)
        if sql != 'SELECT pg_advisory_xact_lock_shared(:lock_key)':
            raise AssertionError('Unexpected financial SQL in period fake: '+sql)
        if set(params) != {'lock_key'} or type(params['lock_key']) is not int:
            raise AssertionError('Expected one bound integer gate key')
        if not self.transaction or not self.transaction.is_active:
            raise AssertionError('Gate SQL outside active transaction')
        self.period_events.append(('gate',sql,dict(params)))
        self.boundary_trace.append('gate')
    def refresh(self, item, attribute_names=None):
        # No queued domain response is consumed by ORM attribute refresh.
        self.period_events.append(('refresh', tuple(attribute_names) if attribute_names is not None else None))
        self.boundary_trace.append('refresh')
    def end_period_transaction(self):
        if self.transaction: self.transaction.is_active = False
        if self.period_connection.transaction: self.period_connection.transaction.is_active = False
        self.transaction = self.period_connection.transaction = None
    def begin_next_period_transaction(self):
        if self.transaction is not None: raise AssertionError('Root still active')
        self.transaction = PeriodTransaction(); self.period_connection.transaction = PeriodTransaction()

class FakeDB(PeriodTransactionFake):
    def __init__(self, account):
        self.initialize_period_transaction()
        self.responses = [account, NS(id='category', cost_type='operating')]
        self.added = []; self.events = []; self.info = {}; self.reservations = []

    def scalar(self, query):
        self.boundary_trace.append('read')
        self.events.append('read')
        if not self.responses:
            raise AssertionError('Unexpected read after calculation')
        return self.responses.pop(0)

    def add(self, item):
        item.id = 'synthetic-expense'; self.added.append(item); self.events.append('add')

    def flush(self): self.events.append('flush')
    def commit(self):
        if self.info.get('deferred_commit_depth',0): self.flush(); return
        self.events.append('commit'); self.end_period_transaction()
    def rollback(self):
        self.events.append('rollback'); self.reservations.clear(); self.end_period_transaction()


class ExpenseFxStorageTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(Engine, 'connect', side_effect=AssertionError('Database prohibited')).start()
        patch.object(socket.socket, 'connect', side_effect=AssertionError('Network prohibited')).start()
        self.account = NS(id='account', organization_id='org', currency='EUR', is_active=True, name='Synthetic account', account_type='bank')
        self.tenant = NS(organization_id='org', user_id='actor', organization=NS(timezone='UTC'))
        self.resolve = patch.object(api, '_resolve_expense_relationships', return_value=(None, None, None, None, None)).start()
        self.balance = patch.object(api, '_account_balance', return_value=D('9999999999999999.99')).start()
        self.sequence = patch.object(api, 'next_sequence_code', return_value='SYN-EXP').start()
        self.activity = patch.object(api, 'record_activity').start()
        self.read = patch.object(api, '_expense_detail', return_value=NS(id='synthetic-expense')).start()

    def payload(self, **overrides):
        values = dict(description='Synthetic expense', category_id='category', account_id='account',
                      expense_currency='USD', expense_amount='2000000.01', account_amount='0.01',
                      expense_date=date(2026, 10, 26))
        values.update(overrides)
        return ExpenseCreate(**values)

    def call(self, payload, *, wrapped=False):
        db = FakeDB(self.account)
        if wrapped:
            patch.object(safe, '_tenant_account', return_value=self.account).start()
            def reserve(*args, **kwargs):
                db.reservations.append('synthetic-guard'); db.events.append('reserve'); db.boundary_trace.append('reserve'); return NS(), False
            patch.object(safe, 'reserve_posting', side_effect=reserve).start()
            self.post = patch.object(safe, 'post_expense').start()
            self.complete = patch.object(safe, 'complete_posting').start()
        try:
            (safe.safe_create_expense if wrapped else api.create_expense)(payload, NS(), db, self.tenant)
        except HTTPException as error:
            return db, error
        return db, None

    def assert_rejected(self, payload, label, *, wrapped=False):
        db, error = self.call(payload, wrapped=wrapped)
        self.assertIsNotNone(error); self.assertEqual(error.status_code, 400)
        self.assertIn(label, error.detail); self.assertIn('after rounding', error.detail)
        self.assertEqual(db.added, []); self.sequence.assert_not_called(); self.activity.assert_not_called()
        self.balance.assert_not_called(); self.read.assert_not_called(); self.assertNotIn('commit', db.events)
        if wrapped:
            self.assertEqual(db.events.count('reserve'), 1); self.assertEqual(db.events.count('rollback'), 1)
            self.assertEqual(db.reservations, [])
            # Session.info survives rollback. The real helper must reject its
            # stale ownership; defer_commits metadata itself is fully removed.
            self.assertEqual(set(db.info), {'business_os.accounting_period_gate.v1'})
            self.assertIsNone(db.get_transaction())
            from app.services.accounting_period_gate import require_accounting_period_gate, AccountingPeriodGateError
            with self.assertRaises(AccountingPeriodGateError): require_accounting_period_gate(db, 'org')
            self.assertEqual(db.boundary_trace[:4], ['gate','refresh','reserve','read'])
            self.assertEqual(len([x for x in db.period_events if x[0]=='gate']),1)
            self.post.assert_not_called(); self.complete.assert_not_called()
        return db

    def persisted(self, **values):
        db, error = self.call(self.payload(**values)); self.assertIsNone(error)
        expenses = [item for item in db.added if isinstance(item, Expense)]
        self.assertEqual(len(expenses), 1); self.assertEqual(len([item for item in db.added if isinstance(item, FinancialTransaction)]), 1)
        self.assertEqual(db.events.count('commit'), 1)
        return expenses[0]

    def test_gross_rounding_zero_rejects_before_division(self):
        self.assert_rejected(self.payload(expense_amount='0.004'), 'Expense amount')

    def test_derived_account_rate_rounding_zero(self):
        self.assert_rejected(self.payload(), 'Account exchange rate')

    def test_extreme_valid_input_ratio_rejects(self):
        self.assert_rejected(self.payload(expense_amount='1000000000000'), 'Account exchange rate')

    def test_account_amount_rounding_zero_rejects(self):
        self.assert_rejected(self.payload(expense_amount='1', account_amount='0.004'), 'Account amount')

    def test_explicit_account_rate_rounding_zero_rejects(self):
        self.assert_rejected(self.payload(expense_amount='1000000', account_amount=None, exchange_rate='0.000000004999999999'), 'Account amount')

    def test_positive_rate_with_zero_rounded_product_rejects(self):
        self.assert_rejected(self.payload(expense_amount='0.01', account_amount=None, exchange_rate='0.00000001'), 'Account amount')

    def test_derived_account_rate_storage_overflow_rejects(self):
        self.assert_rejected(self.payload(expense_amount='0.01', account_amount='1000000000000'), 'Account exchange rate')

    def test_explicit_account_rate_product_storage_overflow_rejects(self):
        self.assert_rejected(self.payload(expense_amount='1000000000000', account_amount=None, exchange_rate='1000000000'), 'Account amount')

    def test_account_half_unit_rounds_up(self):
        item = self.persisted(expense_amount='2000000.00'); self.assertEqual(item.exchange_rate, D('0.00000001')); self.assertEqual(item.account_amount, D('0.01'))

    def test_account_above_half_unit_rounds_up(self):
        self.assertEqual(self.persisted(expense_amount='1999999.99').exchange_rate, D('0.00000001'))

    def test_explicit_rate_half_unit_rounds_up_before_amount(self):
        item = self.persisted(expense_amount='1000000', account_amount=None, exchange_rate='0.000000005')
        self.assertEqual(item.exchange_rate, D('0.00000001')); self.assertEqual(item.account_amount, D('0.01'))

    def test_derived_rate_above_explicit_schema_limit_remains_supported(self):
        self.assertEqual(self.persisted(expense_amount='0.01', account_amount='20000000').exchange_rate, D('2000000000.00000000'))

    def test_explicit_product_above_raw_input_limit_but_storage_representable(self):
        self.assertEqual(self.persisted(expense_amount='1000000000000', account_amount=None, exchange_rate='2').account_amount, D('2000000000000.00'))

    def test_amount_precedence_ignores_optional_underflow_rate(self):
        self.assertEqual(self.persisted(expense_amount='2000000', exchange_rate='0.0000000001').exchange_rate, D('0.00000001'))

    def test_same_currency_ignores_irrelevant_optional_conversion_values(self):
        self.account.currency = 'USD'
        item = self.persisted(expense_amount='1.005', account_amount='0.004', exchange_rate='0.0000000001', profitability_amount='0.004', profitability_exchange_rate='0.0000000001')
        self.assertEqual(item.expense_amount, D('1.01')); self.assertEqual(item.account_amount, D('1.01')); self.assertEqual(item.profitability_amount, D('1.01'))
        self.assertEqual(item.exchange_rate, D('1.00000000')); self.assertEqual(item.profitability_exchange_rate, D('1.00000000'))

    def test_storage_helper_preserves_exact_inclusive_maxima(self):
        for value, maximum in [(api.MAX_STORED_MONEY, api.MAX_STORED_MONEY), (api.MAX_STORED_RATE, api.MAX_STORED_RATE), (D('0.01'), api.MAX_STORED_MONEY), (D('0.00000001'), api.MAX_STORED_RATE)]:
            api._require_positive_stored(value, maximum, 'Synthetic')
        for value, maximum in [(D('0'), api.MAX_STORED_RATE), (api.MAX_STORED_RATE + D('0.00000001'), api.MAX_STORED_RATE), (api.MAX_STORED_MONEY + D('0.01'), api.MAX_STORED_MONEY)]:
            with self.assertRaises(HTTPException): api._require_positive_stored(value, maximum, 'Synthetic')

    def profitability(self):
        self.account.currency = 'USD'
        self.resolve.return_value = (NS(id='client', currency='GBP'), None, None, None, None)

    def test_profitability_derived_rate_zero(self):
        self.profitability(); self.assert_rejected(self.payload(profitability_amount='0.01'), 'Profitability exchange rate')

    def test_profitability_amount_rounding_zero(self):
        self.profitability(); self.assert_rejected(self.payload(expense_amount='1', profitability_amount='0.004'), 'Profitability amount')

    def test_profitability_explicit_rate_rounding_zero(self):
        self.profitability(); self.assert_rejected(self.payload(expense_amount='1000000', profitability_exchange_rate='0.000000004999999999'), 'Profitability amount')

    def test_profitability_positive_rate_zero_product(self):
        self.profitability(); self.assert_rejected(self.payload(expense_amount='0.01', profitability_exchange_rate='0.00000001'), 'Profitability amount')

    def test_profitability_derived_rate_overflow(self):
        self.profitability(); self.assert_rejected(self.payload(expense_amount='0.01', profitability_amount='1000000000000'), 'Profitability exchange rate')

    def test_profitability_explicit_product_overflow(self):
        self.profitability(); self.assert_rejected(self.payload(expense_amount='1000000000000', profitability_exchange_rate='1000000000'), 'Profitability amount')

    def test_profitability_boundary_and_amount_precedence(self):
        self.profitability(); item = self.persisted(expense_amount='2000000', profitability_amount='0.01', profitability_exchange_rate='0.0000000001')
        self.assertEqual(item.profitability_exchange_rate, D('0.00000001')); self.assertEqual(item.profitability_amount, D('0.01'))

    def test_public_wrapper_account_underflow_rolls_back_reservation(self):
        self.assert_rejected(self.payload(), 'Account exchange rate', wrapped=True)

    def test_public_wrapper_profitability_underflow_rolls_back_reservation(self):
        self.profitability(); self.assert_rejected(self.payload(profitability_amount='0.01'), 'Profitability exchange rate', wrapped=True)

    def test_public_wrapper_zero_gross_rolls_back_reservation(self):
        self.assert_rejected(self.payload(expense_amount='0.004'), 'Expense amount', wrapped=True)


if __name__ == '__main__': unittest.main()
