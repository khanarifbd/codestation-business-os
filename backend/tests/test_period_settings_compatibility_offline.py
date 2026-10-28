"""Financial defaults remain compatible while ordered against currency transitions.

Actual handler AST and actual gate, explicit synthetic session/DTO collaborators.
No database, real account, settings service, provider or network is called.
"""
import ast
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

from period_entrypoint_harness import (
    DB, ROOT, GATE, HTTPException, effect_trace, gate_namespace, gate_sql,
    load_functions, tenant,
)


class FinancialDTO:
    @staticmethod
    def model_validate(item):
        snapshot = dict(vars(item))
        return NS(model_dump=lambda **kwargs: dict(snapshot))


def payload(currency="EUR"):
    return NS(
        accounting_currency=currency,
        financial_year_start_month=7,
        default_payment_terms_days=45,
        tax_calculation_mode="exclusive",
        default_tax_rate="12.50",
        prices_include_tax=False,
    )


def namespace(changes):
    return load_functions(
        "app/api/v1/company_settings.py", ["_required", "update_financial"],
        {**gate_namespace(), "FinancialRead": FinancialDTO,
         "_record_section_change": lambda *args, **kwargs: changes.append(kwargs)},
    )


class FinancialCompatibility(unittest.TestCase):
    def test_stale_old_currency_payload_rejected_after_gate_and_fresh_reads(self):
        db = DB()
        scope = tenant("USD")
        item = NS(id="settings", accounting_currency="USD", reporting_currency="GBP")
        db.on_refresh = lambda obj: setattr(obj, "currency", "EUR")

        def fresh_settings(query):
            GATE.require_accounting_period_gate(db, scope.organization_id)
            self.assertEqual(query.target, "OrganizationFinancialSettings")
            self.assertTrue(query.options["populate_existing"])
            self.assertIn(("OrganizationFinancialSettings.organization_id", "=", scope.organization_id), query.conditions)
            item.accounting_currency = "EUR"
            return item

        db.on_scalar = fresh_settings
        changes = []
        with self.assertRaises(HTTPException) as result:
            namespace(changes)["update_financial"](payload("USD"), None, db, scope)
        self.assertEqual(result.exception.status_code, 409)
        self.assertEqual(result.exception.detail, "Accounting currency is managed in Company Settings → Currencies & FX.")
        self.assertEqual(item.accounting_currency, "EUR")
        self.assertEqual(item.reporting_currency, "GBP")
        self.assertEqual(effect_trace(db), ["execute", "refresh", "query"])
        self.assertIn("pg_advisory_xact_lock_shared(", gate_sql(db)[0][1])
        self.assertEqual(changes, [])
        self.assertEqual(db.commits, 0)

    def test_current_currency_preserves_defaults_reporting_and_single_commit(self):
        db = DB()
        scope = tenant("USD")
        scope.organization.financial_year_start_month = 1
        item = NS(id="settings", accounting_currency="USD", reporting_currency="GBP", default_tax_rate="5")

        def refresh(obj):
            if obj is scope.organization:
                obj.currency = "EUR"

        db.on_refresh = refresh
        db.on_scalar = lambda query: item
        changes = []
        data = payload("eur")
        result = namespace(changes)["update_financial"](data, None, db, scope)
        self.assertEqual(item.accounting_currency, "EUR")
        self.assertEqual(item.reporting_currency, "GBP")
        self.assertEqual(scope.organization.financial_year_start_month, 7)
        for key in ("default_payment_terms_days", "tax_calculation_mode", "default_tax_rate", "prices_include_tax"):
            self.assertEqual(getattr(item, key), getattr(data, key))
        self.assertEqual(db.commits, 1)
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["before"]["settings"]["default_tax_rate"], "5")
        self.assertEqual(changes[0]["after"]["settings"]["default_tax_rate"], "12.50")
        self.assertEqual(result.model_dump()["reporting_currency"], "GBP")
        self.assertEqual(effect_trace(db), ["execute", "refresh", "query", "flush", "commit", "refresh"])

    def test_wrong_isolation_fails_before_stale_organization_or_settings_read(self):
        db = DB(isolation="REPEATABLE READ")
        changes = []
        with self.assertRaises(GATE.AccountingPeriodGateError):
            namespace(changes)["update_financial"](payload(), None, db, tenant())
        self.assertEqual(db.events, [])
        self.assertEqual(changes, [])

    def test_missing_settings_preserves_existing_500_and_no_write(self):
        db = DB()
        db.values = [None]
        with self.assertRaises(HTTPException) as result:
            namespace([])["update_financial"](payload(), None, db, tenant())
        self.assertEqual(result.exception.status_code, 500)
        self.assertEqual(result.exception.detail, "Company settings are incomplete: financial is missing")
        self.assertNotIn("flush", effect_trace(db))
        self.assertEqual(db.commits, 0)

    def test_only_financial_handler_changes_in_large_settings_module(self):
        relative = "app/api/v1/company_settings.py"
        old = ast.parse((ROOT.parent / "evidence/preimages" / relative).read_text())
        new = ast.parse((ROOT / relative).read_text())
        original = {node.name: ast.dump(node) for node in old.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
        updated = {node.name: ast.dump(node) for node in new.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
        self.assertEqual(original.keys(), updated.keys())
        self.assertEqual([key for key in original if original[key] != updated[key]], ["update_financial"])
        handler = next(node for node in new.body if isinstance(node, ast.FunctionDef) and node.name == "update_financial")
        self.assertEqual(ast.unparse(handler.decorator_list[0]), "router.patch('/financial', response_model=FinancialRead)")
        self.assertEqual(ast.unparse(handler.body[0]), "acquire_accounting_period_gate(db, tenant.organization_id)")
        self.assertEqual(ast.unparse(handler.body[1]), "db.refresh(tenant.organization)")
