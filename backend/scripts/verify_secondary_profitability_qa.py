"""Rollback-only QA-003/004/013 coverage for Expenses and Capital report surfaces."""
from datetime import date
from decimal import Decimal as D
from pathlib import Path
from scripts.secondary_profitability_contract import verify_expense_profitability_contract
from types import SimpleNamespace
from uuid import uuid4

from app.api.v1.capital_insights import insights
from app.api.v1.finance_expenses import profitability_report
from app.api.v1.phase4_read_fast_extra import capital_insights_fast
from app.db.session import SessionLocal, engine
from app.models.capital import ProjectInvestor
from app.models.crm import Client
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice
from app.models.orders import Order
from app.models.organization import Organization
from app.models.projects import Project
from app.models.user import User

DAY = date(2026, 10, 20)


def main():
    assert engine.url.host in {"localhost", "127.0.0.1", "::1"}, "Local database only"
    with SessionLocal() as db:
        def add(cls, **values):
            row = cls(**values)
            db.add(row)
            db.flush()
            return row

        marker = uuid4().hex
        user = add(User, email=f"secondary-report-{marker}@example.invalid", full_name="Synthetic report QA")
        org = add(Organization, name="Synthetic report QA", slug=f"secondary-report-{marker}", created_by_user_id=user.id, currency="USD", timezone="UTC")
        common = dict(organization_id=org.id, created_by_user_id=user.id)
        tenant = SimpleNamespace(organization_id=org.id)
        client = add(Client, organization_id=org.id, client_code="CLI-1", display_name="Revenue client", currency="USD")
        cost_client = add(Client, organization_id=org.id, client_code="CLI-2", display_name="Cost only", currency="USD")
        account = add(FinancialAccount, **common, name="Synthetic cash", account_type="cash", currency="USD")
        order_values = dict(**common, client_id=client.id, order_date=DAY, currency="USD", seller_name_snapshot="Synthetic", client_name_snapshot=client.display_name)
        order = add(Order, **order_values, order_number="ORD-1")
        other_order = add(Order, **order_values, order_number="ORD-2")
        project_values = dict(**common, client_id=client.id, currency="USD", contract_value=200)
        project = add(Project, **project_values, project_number="PRJ-1", name="Order fallback", order_id=order.id)
        explicit = add(Project, **project_values, project_number="PRJ-2", name="Explicit override", order_id=other_order.id)
        for item in (project, explicit):
            add(ProjectInvestor, **common, project_id=item.id, investor_name="Synthetic investor", currency="USD", investment_date=DAY, invested_amount=10, committed_amount=10, funded_amount=10, share_type="profit_percent", share_value=20)
        invoice_values = dict(**common, client_id=client.id, order_id=order.id, issue_date=DAY, currency="USD", seller_name_snapshot="Synthetic", client_name_snapshot=client.display_name)
        invoice = add(Invoice, **invoice_values, invoice_number="INV-PAID", status="paid", total=200, amount_paid=200, balance_due=0)
        # An explicit draft tests both old capital code and company/client totals.
        add(Invoice, **invoice_values, invoice_number="INV-DRAFT", project_id=project.id, status="draft", total=47.25, balance_due=47.25)
        add(Invoice, **invoice_values, invoice_number="INV-CANCELLED", project_id=project.id, status="cancelled", total=24.68, balance_due=24.68)
        direct = add(ExpenseCategory, organization_id=org.id, name="Direct", slug="direct", cost_type="direct")
        operating = add(ExpenseCategory, organization_id=org.id, name="Operating", slug="operating", cost_type="operating")
        expense_values = dict(**common, account_id=account.id, description="Synthetic cost", expense_date=DAY, expense_currency="USD", account_currency="USD", exchange_rate=1, profitability_currency="USD", profitability_exchange_rate=1)
        add(Expense, **expense_values, expense_number="EXP-1", category_id=direct.id, client_id=client.id, project_id=project.id, expense_amount=25, account_amount=25, profitability_amount=25)
        add(Expense, **expense_values, expense_number="EXP-2", category_id=operating.id, client_id=cost_client.id, expense_amount=6, account_amount=6, profitability_amount=6)
        # Stripe's accounting service posts this separate ledger cash fee, not an Expense.
        add(FinancialTransaction, **common, account_id=account.id, transaction_date=DAY, direction="debit", amount=D("0.59"), currency="USD", source_type="stripe_processing_fee", source_id=str(uuid4()))

        report = profitability_report(db, tenant)
        assert len(report.profit_loss_by_currency) == 1
        pnl = report.profit_loss_by_currency[0]
        assert (pnl.invoice_revenue, pnl.operating_expenses, pnl.stripe_processing_fees, pnl.net_profit) == (200, 31, D("0.59"), D("168.41")), pnl
        rows = {r.project_id: r for r in report.projects}
        assert (rows[project.id].invoiced_revenue, rows[project.id].collected_revenue, rows[project.id].estimated_profit) == (200, 200, 175)
        assert next(r for r in report.clients if r.client_id == cost_client.id).estimated_profit == -6

        def check_capital(revenue_a, revenue_b):
            slow = insights(db, tenant, DAY, DAY)
            fast = capital_insights_fast(db, tenant, DAY, DAY)
            assert fast == slow
            rows = {r["project_id"]: r for r in fast["project_settlements"]}
            assert rows[project.id]["revenue"] == revenue_a
            assert rows[explicit.id]["revenue"] == revenue_b
            assert rows[project.id]["total_investor_profit_entitlement"] == max(D(revenue_a) - 25, 0) * D("0.2")
            assert rows[explicit.id]["total_investor_profit_entitlement"] == D(revenue_b) * D("0.2")

        check_capital(200, 0)
        invoice.project_id = explicit.id
        db.flush()
        rows = {r.project_id: r for r in profitability_report(db, tenant).projects}
        assert rows[project.id].invoiced_revenue == 0
        assert rows[explicit.id].invoiced_revenue == 200
        check_capital(0, 200)
        # Another real tenant with identical business numbers must remain invisible.
        other = add(Organization, name="Other report tenant", slug=f"other-report-{marker}", created_by_user_id=user.id, currency="USD")
        other_client = add(Client, organization_id=other.id, client_code="CLI-1", display_name="Other client", currency="USD")
        add(Invoice, organization_id=other.id, created_by_user_id=user.id, client_id=other_client.id, invoice_number="INV-PAID", issue_date=DAY, currency="USD", seller_name_snapshot="Other", client_name_snapshot="Other", status="sent", total=9999, balance_due=9999)
        assert profitability_report(db, tenant).profit_loss_by_currency[0].invoice_revenue == 200
        check_capital(0, 200)
        empty = SimpleNamespace(organization_id=str(uuid4()))
        assert profitability_report(db, empty).projects == []
        assert capital_insights_fast(db, empty, DAY, DAY)["project_settlements"] == []
        db.rollback()

    frontend = Path(__file__).resolve().parents[2] / "frontend/src"
    verify_expense_profitability_contract(frontend)
    note = (frontend / "components/dashboard/operational-reporting-note.tsx").read_text()
    assert "Stripe processing fees posted only to the ledger" in note
    print("PASS secondary profitability: issued-only, order fallback, override, cost-only, Stripe fee once, tenant isolation, capital parity/entitlements, truthful basis")


if __name__ == "__main__":
    main()
