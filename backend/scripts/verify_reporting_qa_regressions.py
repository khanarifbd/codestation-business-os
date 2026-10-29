"""Rollback-only PostgreSQL regressions for QA-003/004/007/013.

Run from backend with PYTHONPATH=. No email, payment provider or fixture commits.
"""
from datetime import date
from pathlib import Path
import re
from uuid import uuid4

from app.api.v1.reports import _client_rows, _financials, _project_rows, _trend
from app.api.v1.reports_fast import _client_rows_fast, _financials_and_trend_fast, _project_rows_fast
from app.db.session import SessionLocal
from app.models.crm import Client
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import FinancialAccount, Invoice, Payment
from app.models.orders import Order
from app.models.organization import Organization
from app.models.projects import Project
from app.models.user import User
from app.schemas.reports import ReportsOverview

DAY = date(2026, 10, 20)


def verify_frontend_reporting_contract(frontend):
    """Static import/render contract across the actual refactored composition.

    Rendering/browser behavior is verified separately by frontend tests. Keep the
    operational-vs-accrual semantics and both route wiring checks here; do not
    require the shared disclaimer to live inside a financial card's source file.
    """
    sources = {}
    def read(relative):
        if relative not in sources:
            sources[relative] = (frontend / relative).read_text()
        return sources[relative]

    def wired(parent, child, name, module):
        source = read(parent)
        imported = re.search(r'import\s*\{[^}]*\b' + re.escape(name) + r'\b[^}]*\}\s*from\s*["\']' + re.escape(module) + r'["\']', source)
        assert imported, f"Missing import for {name} in {parent}"
        assert re.search(r'<' + re.escape(name) + r'(?:\s|/|>)', source), f"Missing rendered {name} in {parent}"
        assert re.search(r'export\s+function\s+' + re.escape(name) + r'\s*\(', read(child)), f"Missing export {name}"

    note_path = "components/dashboard/operational-reporting-note.tsx"
    dashboard = "app/dashboard/page.tsx"
    insights = "components/dashboard/financial-insights.tsx"
    reports = "app/dashboard/reports/page.tsx"
    workspace = "components/operational-reports/report-workspace.tsx"
    performance = "components/operational-reports/report-performance.tsx"
    wired(dashboard, insights, "FinancialPerformanceCard", "@/components/dashboard/financial-insights")
    wired(dashboard, note_path, "OperationalReportingNote", "@/components/dashboard/operational-reporting-note")
    wired(reports, workspace, "OperationalReportsWorkspace", "@/components/operational-reports/report-workspace")
    wired(workspace, performance, "ReportPerformance", "./report-performance")
    wired(performance, note_path, "OperationalReportingNote", "@/components/dashboard/operational-reporting-note")
    assert '<CurrencySummary ' in read(performance), "Report performance must render its currency summary"
    assert 'function CurrencySummary(' in read(performance)
    for relative, function in ((insights, "FinancialPerformanceCard"), (performance, "CurrencySummary")):
        body = read(relative).split("function " + function + "(", 1)[1].split("function ", 1)[0]
        assert re.search(r'>\s*Operational margin\s*</', body), f"Missing operational margin label: {relative}"
        assert "row.net_profit" in body, f"Operational margin is not bound to reported amount: {relative}"
    for relative in (dashboard, insights, reports, workspace, performance):
        source = read(relative)
        assert not re.search(r'(?:label\s*=\s*["\']Net profit["\']|>\s*Net profit\s*<)', source), f"Misleading accrual label: {relative}"
    note = read(note_path)
    for meaning in ("not accrual net profit", "including tax", "direct income", "approved payroll",
                    "transfer fees", "Supplier bills", "inventory cost of sales", "journal-only adjustments are not included",
                    "excluding sales tax"):
        assert meaning in note, f"Operational basis explanation lost: {meaning}"
    assert '<Link href="/dashboard/accounting/reports"' in note and "accrual Profit &amp; Loss" in note


def main():
    with SessionLocal() as db:
        def add(cls, **values):
            row = cls(**values)
            db.add(row)
            db.flush()
            return row

        marker = uuid4().hex
        user = add(User, email=f"report-{marker}@example.invalid", full_name="Synthetic reporting regression")
        org = add(Organization, name="Synthetic reporting regression", slug=f"reports-{marker}", created_by_user_id=user.id, currency="USD", timezone="UTC")
        common = dict(organization_id=org.id, created_by_user_id=user.id)
        client = add(Client, organization_id=org.id, client_code="CLI-1", display_name="Revenue client", currency="USD")
        cost_client = add(Client, organization_id=org.id, client_code="CLI-2", display_name="Cost-only client", currency="GBP")
        account = add(FinancialAccount, **common, name="Synthetic cash", account_type="cash", currency="USD")
        order = add(Order, **common, order_number="ORD-1", client_id=client.id, order_date=DAY, currency="USD", seller_name_snapshot="Synthetic", client_name_snapshot="Revenue client", total=200)
        project = add(Project, **common, project_number="PRJ-1", name="Order-linked project", client_id=client.id, order_id=order.id, currency="USD", contract_value=200)
        invoice_values = dict(**common, client_id=client.id, order_id=order.id, issue_date=DAY, currency="USD", seller_name_snapshot="Synthetic", client_name_snapshot="Revenue client")
        paid = add(Invoice, **invoice_values, invoice_number="INV-1", status="paid", total=200, amount_paid=200, balance_due=0)
        add(Invoice, **invoice_values, invoice_number="INV-DRAFT", status="draft", total=47.25, balance_due=47.25)
        add(Invoice, **invoice_values, invoice_number="INV-CANCELLED", status="cancelled", total=24.68, balance_due=24.68)
        payment_values = dict(**common, invoice_id=paid.id, account_id=account.id, payment_date=DAY, invoice_currency="USD", account_currency="USD", invoice_amount=200, account_amount=200)
        add(Payment, **payment_values, payment_number="PAY-1", status="confirmed")
        add(Payment, **payment_values, payment_number="PAY-REVERSED", status="reversed")
        direct = add(ExpenseCategory, organization_id=org.id, name="Direct", slug="direct", cost_type="direct")
        operating = add(ExpenseCategory, organization_id=org.id, name="Operating", slug="operating", cost_type="operating")
        expense_values = dict(**common, account_id=account.id, description="Synthetic cost", expense_date=DAY, expense_currency="USD", account_currency="USD", exchange_rate=1, profitability_currency="USD", profitability_exchange_rate=1)
        add(Expense, **expense_values, expense_number="EXP-PROJECT", category_id=direct.id, client_id=client.id, project_id=project.id, expense_amount=25, account_amount=25, profitability_amount=25)
        add(Expense, **expense_values, expense_number="EXP-COST-ONLY", category_id=operating.id, client_id=cost_client.id, expense_amount=6, account_amount=6, profitability_amount=6)
        add(Expense, **expense_values, expense_number="EXP-VOID", category_id=operating.id, client_id=cost_client.id, expense_amount=99, account_amount=99, profitability_amount=99, status="voided")

        for fn in (_project_rows, _project_rows_fast):
            rows = fn(db, org.id, DAY, DAY, None, None, None)
            assert len(rows) == 1
            row = rows[0]
            assert (row.invoiced_revenue, row.collected_revenue, row.direct_expenses, row.estimated_profit) == (200, 200, 25, 175), row
        for fn in (_client_rows, _client_rows_fast):
            for cid in (None, cost_client.id):
                rows = fn(db, org.id, DAY, DAY, None, cid)
                row = next(r for r in rows if r.client_id == cost_client.id)
                assert (row.currency, row.invoiced_revenue, row.direct_expenses, row.estimated_profit) == ("USD", 0, 6, -6), row
                assert row.margin_percent is None
        for pid in (None, project.id):
            slow = _financials(db, org.id, DAY, DAY, None, None, pid)
            fast, trend = _financials_and_trend_fast(db, org.id, DAY, DAY, None, None, pid)
            assert slow == fast
            assert trend == _trend(db, org.id, DAY, DAY, None, None, pid)
            assert len(fast) == 1
            assert (fast[0].invoiced_revenue, fast[0].collected_revenue, fast[0].receivables) == (200, 200, 0)
            assert fast[0].net_profit == (175 if pid else 169)
        assert _client_rows_fast(db, org.id, DAY, DAY, "GBP", cost_client.id) == []
        assert _project_rows_fast(db, org.id, date(2026, 11, 1), date(2026, 11, 30), None, None, None)[0].invoiced_revenue == 0
        paid.project_id = project.id
        db.flush()
        assert _project_rows_fast(db, org.id, DAY, DAY, None, None, None)[0].invoiced_revenue == 200
        other_order = add(Order, **common, order_number="ORD-2", client_id=client.id, order_date=DAY, currency="USD", seller_name_snapshot="Synthetic", client_name_snapshot="Revenue client")
        other_project = add(Project, **common, project_number="PRJ-2", name="Explicit project", client_id=client.id, order_id=other_order.id, currency="USD")
        paid.project_id = other_project.id
        db.flush()
        for fn in (_project_rows, _project_rows_fast):
            rows = {r.project_id: r for r in fn(db, org.id, DAY, DAY, None, None, None)}
            assert rows[project.id].invoiced_revenue == 0
            assert rows[other_project.id].invoiced_revenue == 200
            assert rows[other_project.id].collected_revenue == 200
        assert _project_rows_fast(db, str(uuid4()), DAY, DAY, None, None, None) == []
        assert _client_rows_fast(db, str(uuid4()), DAY, DAY, None, None) == []
        db.rollback()

    assert ReportsOverview.model_fields["reporting_basis"].default == "operational"
    frontend = Path(__file__).resolve().parents[2] / "frontend/src"
    verify_frontend_reporting_contract(frontend)
    print("PASS QA-003 basis, QA-004 order attribution, QA-007 cost-only currencies, QA-013 draft exclusion; rollback-only")


if __name__ == "__main__":
    main()
