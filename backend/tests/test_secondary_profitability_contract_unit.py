"""Pure source-contract mutations; no app configuration or database is imported."""
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / 'frontend/src'
CHECK = runpy.run_path(str(ROOT / 'backend/scripts/secondary_profitability_contract.py'))['verify_expense_profitability_contract']
REGISTER = 'components/expenses/expense-register.tsx'
WORKSPACE = 'components/expenses/expense-workspace.tsx'

class SecondaryProfitabilityContractTests(unittest.TestCase):
    def test_actual_refactored_view_passes(self): CHECK(FRONTEND)

    def rejects(self, relative, before, after):
        filename = FRONTEND / relative
        original = filename.read_text()
        self.assertIn(before, original)
        changed = original.replace(before, after)
        read = Path.read_text
        def mutated(path, *a, **kw): return changed if path == filename else read(path, *a, **kw)
        with patch.object(Path, 'read_text', mutated), self.assertRaises(AssertionError): CHECK(FRONTEND)

    def test_route_disconnected(self): self.rejects('app/dashboard/expenses/page.tsx', '<ExpenseWorkspace/>', '<div/>')
    def test_missing_import(self): self.rejects(WORKSPACE, './expense-register', './wrong-register')
    def test_missing_export(self): self.rejects(REGISTER, 'export function ExpenseRegister', 'function ExpenseRegister')
    def test_workspace_content_disconnected(self): self.rejects(WORKSPACE, '<ExpenseContent ', '<OtherContent ')
    def test_register_disconnected(self): self.rejects(WORKSPACE, '<ExpenseRegister/>', '<div/>')
    def test_profitability_not_rendered(self): self.rejects(REGISTER, '<ExpenseProfitability vm={vm}/>', '<div/>')
    def test_tab_removed(self): self.rejects(REGISTER, '{ value: "profitability", label: "Profitability" }', '{ value: "other", label: "Other" }')
    def test_margin_relabelled_net_profit(self): self.rejects(REGISTER, 'Operational margin by currency', 'Net profit')
    def test_warning_changed(self): self.rejects(REGISTER, 'not accrual net profit', 'accrual net profit')
    def test_all_time_basis_changed(self): self.rejects(REGISTER, 'All-time issued invoice totals', 'Current period collected invoice totals')
    def test_tax_basis_changed(self): self.rejects(REGISTER, 'include tax', 'exclude tax')
    def test_excluded_costs_changed(self): self.rejects(REGISTER, 'journal-only adjustments are excluded', 'journal-only adjustments are included')
    def test_stripe_fee_semantics_changed(self): self.rejects(REGISTER, 'transfer fees and Stripe processing fees', 'transfer fees')
    def test_link_changed(self): self.rejects(REGISTER, '/dashboard/accounting/reports', '/dashboard/reports')
    def test_currency_binding_changed(self): self.rejects(REGISTER, 'expenseMoney(row.net_profit, row.currency)', 'expenseMoney(row.net_profit, "USD")')
    def test_amount_binding_changed(self): self.rejects(REGISTER, 'expenseMoney(row.net_profit, row.currency)', 'expenseMoney(row.invoice_revenue, row.currency)')
    def test_both_ci_scripts_invoke_shared_contract(self):
        import ast
        for name in ('verify_secondary_profitability_qa.py','verify_qc_owner_reporting.py'):
            tree = ast.parse((ROOT / 'backend/scripts' / name).read_text())
            self.assertTrue(any(isinstance(n, ast.ImportFrom) and n.module == 'scripts.secondary_profitability_contract' and any(a.name == 'verify_expense_profitability_contract' for a in n.names) for n in tree.body))
            self.assertEqual(sum(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'verify_expense_profitability_contract' for n in ast.walk(tree)), 1)
