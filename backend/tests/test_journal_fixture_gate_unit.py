"""Actual fixture gate prefixes exercised against the real gate helper/fake PG.

No configured engine or provider. These are ownership/order contract regressions,
not a substitute for the real PostgreSQL verification scripts in CI.
"""
import ast
from datetime import date
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from period_entrypoint_harness import DB, GATE, gate_namespace, gate_sql

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
