"""No app/config/database import; exercise actual source contract with mutations."""
import ast
from pathlib import Path
import re
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / 'frontend/src'
SCRIPT = ROOT / 'backend/scripts/verify_reporting_qa_regressions.py'

def contract():
    node = next(n for n in ast.parse(SCRIPT.read_text()).body if isinstance(n,ast.FunctionDef) and n.name == 'verify_frontend_reporting_contract')
    ns = {'re': re}
    exec(compile(ast.Module(body=[node],type_ignores=[]),str(SCRIPT),'exec'),ns)
    return ns[node.name]

class ReportingFrontendContractTests(unittest.TestCase):
    def test_current_refactored_composition_preserves_contract(self):
        contract()(FRONTEND)

    def rejects(self, relative, before, after):
        filename = FRONTEND / relative
        original = filename.read_text()
        self.assertIn(before,original)
        changed = original.replace(before,after)
        read = Path.read_text
        def mutation(path,*args,**kwargs):
            return changed if path == filename else read(path,*args,**kwargs)
        check = contract()
        with patch.object(Path,'read_text',mutation), self.assertRaises(AssertionError):
            check(FRONTEND)

    def test_dashboard_missing_note_render_rejected(self):
        self.rejects('app/dashboard/page.tsx','<OperationalReportingNote />','')
    def test_reports_missing_note_render_rejected(self):
        self.rejects('components/operational-reports/report-performance.tsx','<OperationalReportingNote />','')
    def test_route_workspace_disconnected_rejected(self):
        self.rejects('app/dashboard/reports/page.tsx','<OperationalReportsWorkspace />','<div />')
    def test_workspace_performance_disconnected_rejected(self):
        self.rejects('components/operational-reports/report-workspace.tsx','<ReportPerformance report={vm.report.value} />','<div />')
    def test_missing_import_rejected(self):
        self.rejects('components/operational-reports/report-performance.tsx','@/components/dashboard/operational-reporting-note','@/components/wrong-note')
    def test_missing_export_rejected(self):
        self.rejects('components/dashboard/operational-reporting-note.tsx','export function OperationalReportingNote','function OperationalReportingNote')
    def test_misleading_dashboard_label_rejected(self):
        self.rejects('components/dashboard/financial-insights.tsx','>Operational margin<','>Net profit<')
    def test_misleading_report_label_rejected(self):
        self.rejects('components/operational-reports/report-performance.tsx','>Operational margin<','>Net profit<')
    def test_wrong_amount_binding_rejected(self):
        self.rejects('components/dashboard/financial-insights.tsx','row.net_profit','row.collected_revenue')
    def test_accrual_warning_removed_rejected(self):
        self.rejects('components/dashboard/operational-reporting-note.tsx','not accrual net profit','accrual net profit')
    def test_tax_meaning_changed_rejected(self):
        self.rejects('components/dashboard/operational-reporting-note.tsx','including tax','excluding tax')
    def test_exclusions_changed_rejected(self):
        self.rejects('components/dashboard/operational-reporting-note.tsx','journal-only adjustments are not included','journal-only adjustments are included')
    def test_accrual_report_link_changed_rejected(self):
        self.rejects('components/dashboard/operational-reporting-note.tsx','/dashboard/accounting/reports','/dashboard/reports')
