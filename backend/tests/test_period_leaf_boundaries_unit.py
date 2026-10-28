"""Executed source-boundary traces; fake sessions, never PostgreSQL proof.

The complete cohort and real transaction/isolation behavior have independent gates.
These tests compile the actual reviewed functions without importing runtime config.
"""
import ast
import copy
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StopAtBusinessBoundary(Exception):
    pass


class GateDenied(Exception):
    pass


class FakeHTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail


def function_node(path, name):
    tree = ast.parse((ROOT / path).read_text())
    return copy.deepcopy(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name))


def load_function(path, name, context):
    node = function_node(path, name)
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    context = dict(context)
    exec(compile(ast.fix_missing_locations(module), str(ROOT / path), 'exec'), context)
    return context[name]


class BoundaryDB:
    def __init__(self, events):
        self.events = events

    def refresh(self, organization, *, attribute_names):
        self.events.append(('refresh', tuple(attribute_names)))
        organization.currency = 'BDT'
        organization.timezone = 'Asia/Dhaka'

    def scalar(self, query):
        self.events.append(('business-sql', query))
        raise StopAtBusinessBoundary


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.db = BoundaryDB(self.events)
        self.tenant = SimpleNamespace(organization_id='synthetic-tenant', organization=SimpleNamespace(currency='USD', timezone='UTC'))

    def gate(self, db, tenant):
        self.assertIs(db, self.db)
        self.assertEqual(tenant, 'synthetic-tenant')
        self.events.append(('gate', tenant))

    def reject(self, *args, **kwargs):
        self.events.append(('gate-rejected',))
        raise GateDenied

    def stop(self, *args, **kwargs):
        self.events.append(('business',))
        raise StopAtBusinessBoundary

    def account(self, gate=None):
        return load_function('app/api/v1/accounting_accounts.py', 'create_accounting_financial_account', {
            '_money': Decimal, 'HTTPException': FakeHTTPException,
            'acquire_accounting_period_gate': gate or self.gate,
            'validate_gateway_mapping': self.stop,
        })

    def account_payload(self, opening='0', kind='bank'):
        return SimpleNamespace(opening_balance=opening, account_type=kind, gateway_connection_id=None, currency='USD')

    def test_account_gate_and_targeted_freshness_precede_gateway_reads(self):
        with self.assertRaises(StopAtBusinessBoundary):
            self.account()(self.account_payload(), None, self.db, self.tenant)
        self.assertEqual(self.events, [('gate','synthetic-tenant'), ('refresh',('currency','timezone')), ('business',)])
        self.assertEqual(self.tenant.organization.currency, 'BDT')

    def test_account_gate_failure_prevents_any_refresh_or_business_read(self):
        with self.assertRaises(GateDenied):
            self.account(self.reject)(self.account_payload(), None, self.db, self.tenant)
        self.assertEqual(self.events, [('gate-rejected',)])

    def test_pure_negative_card_validation_retains_original_error_without_db(self):
        with self.assertRaises(FakeHTTPException) as caught:
            self.account()(self.account_payload('-1', 'credit_card'), None, self.db, self.tenant)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(self.events, [])

    def test_tax_gate_precedes_existing_tax_mutex(self):
        fn = load_function('app/api/v1/tax.py','create_settlement', {
            'acquire_accounting_period_gate':self.gate, 'lock_tax_settlements':self.stop,
        })
        with self.assertRaises(StopAtBusinessBoundary):
            fn(None, None, self.db, self.tenant)
        self.assertEqual(self.events, [('gate','synthetic-tenant'), ('business',)])

    def test_tax_gate_failure_prevents_domain_lock(self):
        fn = load_function('app/api/v1/tax.py','create_settlement', {
            'acquire_accounting_period_gate':self.reject, 'lock_tax_settlements':self.stop,
        })
        with self.assertRaises(GateDenied):
            fn(None, None, self.db, self.tenant)
        self.assertEqual(self.events, [('gate-rejected',)])

    def test_correction_default_date_uses_post_gate_refreshed_timezone(self):
        def today(zone):
            self.events.append(('today', zone))
            raise StopAtBusinessBoundary
        fn = load_function('app/api/v1/financial_corrections.py','reverse_business_transaction', {
            'acquire_accounting_period_gate':self.gate, '_today':today,
        })
        with self.assertRaises(StopAtBusinessBoundary):
            fn(SimpleNamespace(reversal_date=None), None, self.db, self.tenant)
        self.assertEqual(self.events, [('gate','synthetic-tenant'),('refresh',('currency','timezone')),('today','Asia/Dhaka')])

    def test_correction_gate_failure_preserves_no_source_access(self):
        fn = load_function('app/api/v1/financial_corrections.py','reverse_business_transaction', {
            'acquire_accounting_period_gate':self.reject,
        })
        with self.assertRaises(GateDenied):
            fn(SimpleNamespace(reversal_date=None), None, self.db, self.tenant)
        self.assertEqual(self.events, [('gate-rejected',)])

    def test_existing_period_helper_delegates_exact_parameters(self):
        calls=[]
        fn=load_function('app/services/accounting_posting.py','ensure_open_period', {
            'ensure_accounting_period_open':lambda *args: calls.append(args),
        })
        day=date(2026,10,1)
        self.assertIsNone(fn(self.db,'synthetic-tenant',day))
        self.assertEqual(calls,[(self.db,'synthetic-tenant',day)])

    def test_period_adapter_does_not_swallow_gate_rejection(self):
        fn=load_function('app/services/accounting_posting.py','ensure_open_period', {
            'ensure_accounting_period_open':self.reject,
        })
        with self.assertRaises(GateDenied): fn(self.db,'synthetic-tenant',date(2026,10,1))

    def test_reversal_leaf_asserts_ownership_before_reading_original(self):
        fn=load_function('app/services/journal_reversal.py','reverse_source_journal', {
            'require_accounting_period_gate':self.reject,
        })
        with self.assertRaises(GateDenied):
            fn(self.db,organization_id='synthetic-tenant',user_id='synthetic-user',source_type='payment',source_id='p',reversal_date=date(2026,10,1),reason='Synthetic correction')
        self.assertEqual(self.events,[('gate-rejected',)])

    def test_post_journal_retains_validation_before_existing_lookup(self):
        node=function_node('app/services/accounting_posting.py','post_journal')
        self.assertEqual(ast.unparse(node.body[0]),'ensure_open_period(db, organization_id, entry_date)')
        self.assertIn('existing = db.scalar',ast.unparse(node.body[1]))

    def test_low_level_modules_never_acquire_late_gate(self):
        for path in ['app/services/accounting_posting.py','app/services/journal_reversal.py']:
            self.assertNotIn('acquire_accounting_period_gate', (ROOT/path).read_text())


if __name__ == '__main__':
    unittest.main()
