"""Actual fixture gate prefixes exercised against the real gate helper/fake PG.

No configured engine or provider. These are ownership/order contract regressions,
not a substitute for the real PostgreSQL verification scripts in CI.
"""
import ast
from datetime import date
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from sqlalchemy.orm import Session
from period_entrypoint_harness import DB, GATE, gate_namespace, gate_sql, load_functions

ROOT = Path(__file__).resolve().parents[1]
# Each anchor is the first accounting fixture effect/read in a new transaction.
CASES = (
    ('verify_reporting_currency.py', 'financial', 0),
    ('verify_functional_currency_change.py', 'ensure_default_chart', 0),
    ('verify_functional_currency_change.py', 'post_journal', 0),
    ('verify_functional_currency_change.py', 'cash', 1),
    ('verify_accounting_multicurrency.py', 'exchange_rate', 0),
    ('verify_financial_corrections_part2.py', 'expense', 0),
    ('verify_inventory_payables_migration.py', 'ensure_default_chart', 0),
    ('verify_v1_accounting_integrity.py', 'sync_result', 0),
    ('verify_financial_corrections.py', 'sync_result', 0),
    ('verify_finance.py', 'cancelled_direct', 0),
    ('verify_sales_catalog_flow.py', 'cancelled_invoice', 0),
)

def prefixes(filename, anchor):
    tree = ast.parse((ROOT / 'scripts' / filename).read_text())
    matches = []
    for parent in ast.walk(tree):
        for _, value in ast.iter_fields(parent):
            if not isinstance(value, list): continue
            for i, node in enumerate(value):
                is_assign = isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == anchor for t in node.targets)
                is_call = isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == anchor
                if is_assign or is_call:
                    previous = value[i-1] if i else None
                    matches.append((node.lineno, previous))
    return [previous for _,previous in sorted(matches)]

class JournalFixtureGateTests(unittest.TestCase):
    def test_fixture_prefixes_acquire_actual_ownership_before_accounting(self):
        for filename, anchor, index in CASES:
            with self.subTest(script=filename, anchor=anchor, index=index):
                previous = prefixes(filename, anchor)[index]
                self.assertIsInstance(previous, ast.Expr)
                self.assertIsInstance(previous.value, ast.Call)
                self.assertEqual(getattr(previous.value.func, 'id', None), 'acquire_accounting_period_gate')
                db = DB()
                ns = dict(gate_namespace(), db=db, organization=NS(id='synthetic-org'),
                          tenant=NS(organization_id='synthetic-org'), organization_id='synthetic-org', o=NS(id='synthetic-org'))
                exec(compile(ast.Module(body=[previous], type_ignores=[]), '<actual fixture gate>', 'exec'), ns)
                GATE.require_accounting_period_gate(db, 'synthetic-org')
                self.assertEqual(len(gate_sql(db)), 1)

    def test_direct_sync_fixture_prefix_reaches_real_journal_date_guard(self):
        for filename in ('verify_v1_accounting_integrity.py', 'verify_financial_corrections.py'):
            with self.subTest(script=filename):
                tree = ast.parse((ROOT / 'scripts' / filename).read_text())
                call = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign)
                            and any(isinstance(target, ast.Name) and target.id == 'sync_result' for target in node.targets))
                previous = prefixes(filename, 'sync_result')[0]
                # Run the actual adjacent acquisition if present; otherwise the actual
                # call reaches the real leaf guard unowned, reproducing the CI failure.
                owned_prefix = (isinstance(previous, ast.Expr) and isinstance(previous.value, ast.Call)
                                and getattr(previous.value.func, 'id', None) == 'acquire_accounting_period_gate')
                db = DB()
                today = date(2026, 10, 29)
                def sync(db, *, organization_id, **kwargs):
                    GATE.ensure_accounting_period_open(db, organization_id, today)
                    return {'counts': {}, 'errors': []}
                ns = dict(gate_namespace(), db=db, business_today=today,
                          organization=NS(id='synthetic-org'), user=NS(id='synthetic-user'),
                          tenant=NS(organization_id='synthetic-org', user_id='synthetic-user',
                                    organization=NS(currency='BDT')), sync_operational_accounting=sync)
                body = ([previous] if owned_prefix else []) + [call]
                exec(compile(ast.Module(body=body, type_ignores=[]), '<actual direct sync boundary>', 'exec'), ns)
                self.assertEqual(len(gate_sql(db)), 1)
                self.assertTrue(any(item[0] == 'period_read' for item in db.events))

    def test_direct_cancellation_prefix_reaches_real_reversal_guard(self):
        # Compile the actual reversal, stopping at its first DB read: the missing
        # transaction ownership must be rejected before that read, not waived.
        class ReachedOriginalLookup(Exception):
            pass
        class ReversalDB(DB):
            def scalar(self, statement):
                raise ReachedOriginalLookup
        reverse = load_functions('app/services/journal_reversal.py', ['reverse_source_journal'],
                                 gate_namespace())['reverse_source_journal']
        for filename, anchor in (('verify_finance.py', 'cancelled_direct'),
                                 ('verify_sales_catalog_flow.py', 'cancelled_invoice')):
            with self.subTest(script=filename):
                db = ReversalDB()
                kwargs = dict(organization_id='synthetic-org', user_id='synthetic-user',
                              source_type='invoice_issue', source_id='synthetic-invoice',
                              reversal_date=date(2026, 10, 29), reason='Synthetic cancellation')
                with self.assertRaises(GATE.AccountingPeriodGateError):
                    reverse(db, **kwargs)
                self.assertEqual(db.events, [])
                previous = prefixes(filename, anchor)[0]
                owned = (isinstance(previous, ast.Expr) and isinstance(previous.value, ast.Call)
                         and getattr(previous.value.func, 'id', None) == 'acquire_accounting_period_gate')
                if owned:
                    ns = dict(gate_namespace(), db=db, tenant=NS(organization_id='synthetic-org'))
                    exec(compile(ast.Module(body=[previous], type_ignores=[]), '<actual cancel fixture gate>', 'exec'), ns)
                with self.assertRaises(ReachedOriginalLookup):
                    reverse(db, **kwargs)
                self.assertEqual(len(gate_sql(db)), 1)

    def test_catalog_cancel_after_rollback_starts_real_session_root(self):
        source = ast.parse((ROOT / 'scripts/verify_sales_catalog_flow.py').read_text())
        guard_source = ast.parse((ROOT / 'app/services/accounting_period_gate.py').read_text())
        nodes = [node for node in guard_source.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                 and node.name in {'AccountingPeriodGateError', '_active_root'}]
        guard = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual root guard>', 'exec'), guard)
        for parent in ast.walk(source):
            for _, body in ast.iter_fields(parent):
                if not isinstance(body, list):
                    continue
                end = next((i for i, node in enumerate(body) if isinstance(node, ast.Assign)
                            and any(isinstance(t, ast.Name) and t.id == 'cancelled_invoice' for t in node.targets)), None)
                if end is None:
                    continue
                start = max(i for i, node in enumerate(body[:end])
                            if ast.unparse(node) == 'db.rollback()')
                with Session() as db:
                    old_root = db.begin()
                    checked = []
                    def acquire(db, organization_id):
                        checked.append(guard['_active_root'](db))
                        self.assertEqual(organization_id, 'synthetic-org')
                    ns = dict(db=db, tenant=NS(organization_id='synthetic-org'),
                              acquire_accounting_period_gate=acquire)
                    exec(compile(ast.Module(body=body[start:end], type_ignores=[]), '<actual catalog rollback prefix>', 'exec'), ns)
                    self.assertEqual(len(checked), 1)
                    self.assertIsNot(checked[0], old_root)
                return
        self.fail('Cancellation fixture boundary not found')

    def test_missing_acquisition_still_rejected(self):
        with self.assertRaises(GATE.AccountingPeriodGateError):
            GATE.require_accounting_period_gate(DB(), 'synthetic-org')

    def test_actual_journal_validation_rejects_missing_gate_before_any_read(self):
        tree = ast.parse((ROOT / 'app/services/accounting_posting.py').read_text())
        adapter = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'ensure_open_period')
        posting = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'post_journal')
        db = DB()
        ns = dict(gate_namespace(), db=db, organization_id='synthetic-org', entry_date=date(2026, 10, 29), date=date)
        exec(compile(ast.Module(body=[adapter], type_ignores=[]), '<actual period adapter>', 'exec'), ns)
        validation = compile(ast.Module(body=[posting.body[0]], type_ignores=[]), '<actual journal validation>', 'exec')
        with self.assertRaisesRegex(GATE.AccountingPeriodGateError, 'must be acquired'):
            exec(validation, ns)
        self.assertEqual(db.events, [])
        GATE.acquire_accounting_period_gate(db, 'synthetic-org')
        exec(validation, ns)
        self.assertTrue(any(event[0] == 'period_read' for event in db.events))
