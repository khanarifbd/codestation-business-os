"""Direct-call verification fixture owns its new root after rejected request.

Executes the actual script's rejection/retry statements with an unbound real
SQLAlchemy Session and real root guard; no database, config, or socket is used.
"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from fastapi import HTTPException
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]

class StopAfterRootCheck(Exception):
    pass

class CompanyCurrencyFixtureTransactionTests(unittest.TestCase):
    def guard(self):
        source = ast.parse((ROOT / 'app/services/accounting_period_gate.py').read_text())
        nodes = [node for node in source.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                 and node.name in {'AccountingPeriodGateError', '_active_root'}]
        namespace = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual root guard>', 'exec'), namespace)
        return namespace

    def test_actual_rejected_request_then_retry_owns_new_root(self):
        source = ast.parse((ROOT / 'scripts/verify_company_currency_settings.py').read_text())
        main = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
        outer = next(node for node in main.body if isinstance(node, ast.Try))
        end = next(i for i,node in enumerate(outer.body) if isinstance(node, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'switched' for t in node.targets))
        start = max(i for i,node in enumerate(outer.body[:end]) if isinstance(node, ast.Try))
        statements = outer.body[start:end + 1]
        guard = self.guard()
        with Session() as db:
            original = db.begin()
            calls = []
            def endpoint(*args):
                calls.append(guard['_active_root'](db))
                if len(calls) == 1:
                    raise HTTPException(409, 'synthetic locked currency')
                self.assertIsNot(calls[-1], original)
                raise StopAfterRootCheck
            namespace = dict(db=db, tenant=object(), HTTPException=HTTPException,
                             update_company_currency_settings=endpoint,
                             CompanyCurrencySettingsUpdate=lambda **kw: SimpleNamespace(**kw), req=lambda *a: None)
            with self.assertRaises(StopAfterRootCheck):
                exec(compile(ast.Module(body=statements, type_ignores=[]), '<actual fixture retry>', 'exec'), namespace)
            self.assertEqual(len(calls), 2)

    def test_guard_still_rejects_missing_root_without_autobegin(self):
        guard = self.guard()
        with Session() as db:
            db.begin(); db.rollback()
            with self.assertRaises(guard['AccountingPeriodGateError']):
                guard['_active_root'](db)
            self.assertIsNone(db.get_transaction())
