"""Fresh owner-only HTTP/PostgreSQL reconciliation, with every write rolled back.

Only get_db is overridden. Authentication, organization membership, permissions,
public routes, posting and reports run unchanged. The only ORM-created fixture is
an active user; all business records are created through authenticated HTTP.
TestClient is deliberately not a lifespan context, so it starts no bootstrap jobs
or external providers. Use only the isolated local QC database.

Common USD dataset: issued/collected 200, project cost 25, cost-only client cost 6,
and an unpaid supplier bill 10. Cash/operational margin = 169; AP = 10;
accrual profit = 159. Capital's 20% estimated project-profit entitlement is 35,
not a payout or a journal liability. No investor funding/payment is performed.
"""
from datetime import date
from decimal import Decimal
from pathlib import Path
from scripts.secondary_profitability_contract import verify_expense_profitability_contract
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.activity_log import ActivityLog
from app.models.capital import ProjectInvestor
from app.models.expenses import Expense
from app.models.finance import FinancialTransaction, Invoice, Payment
from app.models.organization import Organization
from app.models.payables import PayableBill
from app.models.user import User
from app.services.activity_log import record_activity


def amount(row, field):
    return Decimal(str(row[field]))


def amounts(row, **expected):
    for field, value in expected.items():
        assert amount(row, field) == Decimal(str(value)), (field, row, expected)


def only(rows):
    assert len(rows) == 1, rows
    return rows[0]


def main():
    assert settings.environment == "test", "Explicit test environment required"
    assert engine.url.get_backend_name() == "postgresql"
    assert engine.url.host in {"127.0.0.1", "localhost"}, "Local synthetic PostgreSQL only"
    assert not app.dependency_overrides, "Never inherit authentication/tenant overrides"
    marker = uuid4().hex[:12]
    today = date.today().isoformat()
    period = f"?date_from={today}&date_to={today}"
    org_ids, user_ids = [], []
    connection = engine.connect()
    outer = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")

    def local_db():
        with SessionLocal(bind=connection, join_transaction_mode="create_savepoint") as request_db:
            yield request_db

    app.dependency_overrides[get_db] = local_db
    http = TestClient(app)

    def call(method, path, headers=None, payload=None, expected=200):
        response = http.request(method, "/api/v1" + path, headers=headers or {}, json=payload)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        return response.json()

    def fixture(label):
        user = User(email=f"qc-owner-reports-{label}-{marker}@example.invalid", full_name="Synthetic owner reporting QC", is_active=True, is_verified=True)
        db.add(user)
        db.flush()
        user_ids.append(user.id)
        record_activity(db, action="qc.owner_reporting.fixture", scope="system", actor_type="system")
        db.commit()
        headers = {"Authorization": "Bearer " + create_access_token(user.id, int(user.auth_token_version or 0))}
        workspace = call("POST", "/organizations", headers, {"name": f"QC owner reporting {label} {marker}", "currency": "USD", "country_code": "US", "timezone": "UTC"}, 201)
        org_id = workspace["organization"]["id"]
        org_ids.append(org_id)
        headers["X-Organization-ID"] = org_id
        customer = call("POST", "/crm/clients", headers, {"display_name": f"Synthetic revenue client {label}", "currency": "USD"}, 201)
        return headers, customer

    def manual_invoice(headers, client_id, value):
        return call("POST", "/finance/invoices", headers, {"client_id": client_id, "issue_date": today, "currency": "USD", "items": [{"item_name": "QC service", "description": "Synthetic service", "quantity": "1", "unit_price": str(value)}]}, 201)

    def reports(headers, suffix=""):
        return call("GET", "/reports/overview" + period + suffix, headers)

    def statements(headers):
        return call("GET", "/accounting/reports/financial-statements" + period, headers)

    def profitability(headers):
        return call("GET", "/finance/profitability", headers)

    def insights(headers):
        return call("GET", "/capital/insights" + period, headers)

    def snapshot():
        # Snapshot exact rows, not just counts, around denied/read-only requests.
        db.expire_all()
        models = (Invoice, Payment, Expense, PayableBill, ProjectInvestor, FinancialTransaction, JournalEntry, JournalLine, ActivityLog)
        result = tuple(tuple(tuple(row) for row in db.execute(select(model.__table__).where(model.organization_id.in_(org_ids)).order_by(model.id)).all()) for model in models)
        db.rollback()
        return result

    def check_project(rows, project_id):
        row = only(rows)
        assert row["project_id"] == project_id
        amounts(row, invoiced_revenue=200, collected_revenue=200, direct_expenses=25, estimated_profit=175, margin_percent="87.5")

    def check_cost_client(rows, client_id):
        row = next(row for row in rows if row["client_id"] == client_id)
        assert row["currency"] == "USD", row
        amounts(row, invoiced_revenue=0, collected_revenue=0, direct_expenses=6, estimated_profit=-6)
        assert row["margin_percent"] is None, row

    try:
        a, client_a = fixture("A")
        b, client_b = fixture("B")
        other_invoice = manual_invoice(b, client_b["id"], "9999")
        call("PATCH", f'/finance/invoices/{other_invoice["id"]}/status', b, {"action": "send"})
        quotation = call("POST", "/sales/quotations", a, {"client_id": client_a["id"], "subject": "QC linked order reporting", "issue_date": today, "currency": "USD", "items": [{"item_name": "QC service", "description": "Synthetic service", "quantity": "1", "unit_price": "200"}]}, 201)
        for state in ("sent", "accepted"):
            call("PATCH", f'/sales/quotations/{quotation["id"]}/status', a, {"status": state})
        order = call("POST", f'/sales/orders/from-quotation/{quotation["id"]}', a, expected=201)
        project = call("POST", f'/projects/from-order/{order["id"]}', a, {"name": "QC order-only attribution"}, 201)
        investor = call("POST", "/capital/project-investors", a, {"project_id": project["id"], "investor_name": "Synthetic 20 percent investor", "currency": "USD", "committed_amount": "10", "investment_date": today, "share_type": "profit_percent", "share_value": "20"}, 201)
        amounts(investor, committed_amount=10, funded_amount=0)

        # The linked project already exists, but from-order MUST leave the invoice
        # project_id null. Every report must resolve its order-to-project fallback.
        cancelled = call("POST", f'/finance/invoices/from-order/{order["id"]}', a, expected=201)
        assert cancelled["project_id"] is None and cancelled["order_id"] == order["id"]
        amounts(only(insights(a)["project_settlements"]), revenue=0, project_profit=0, total_investor_profit_entitlement=0)
        cancelled = call("PATCH", f'/finance/invoices/{cancelled["id"]}/status', a, {"action": "cancel", "reason": "Synthetic cancelled-draft exclusion"})
        assert cancelled["status"] == "cancelled"
        amounts(cancelled, balance_due=0)
        invoice = call("POST", f'/finance/invoices/from-order/{order["id"]}', a, expected=201)
        assert invoice["project_id"] is None and invoice["order_id"] == order["id"] and invoice["status"] == "draft"
        draft_reports = reports(a)
        assert all(amount(row, "invoiced_revenue") == 0 for row in draft_reports["financials"])
        assert all(amount(row, "invoice_revenue") == 0 for row in profitability(a)["profit_loss_by_currency"])
        amounts(only(insights(a)["project_settlements"]), revenue=0, total_investor_profit_entitlement=0)
        amounts(statements(a), total_income=0, net_profit=0)
        call("PATCH", f'/finance/invoices/{invoice["id"]}/status', a, {"action": "send"})
        cash = call("POST", "/finance/accounts", a, {"name": "QC synthetic cash", "account_type": "cash", "currency": "USD", "opening_balance": "0"}, 201)
        call("POST", "/finance/payments", a, {"invoice_id": invoice["id"], "account_id": cash["id"], "payment_date": today, "invoice_amount": "200", "method": "cash"}, 201)
        paid = call("GET", f'/finance/invoices/{invoice["id"]}', a)
        assert paid["status"] == "paid" and paid["project_id"] is None
        amounts(paid, total=200, amount_paid=200, balance_due=0)
        print("PASS HTTP commercial chain: accepted quotation -> order -> linked project -> order-only invoice; cancelled/draft excluded; issued/collected USD 200", flush=True)

        cost_client = call("POST", "/crm/clients", a, {"display_name": "Synthetic cost-only client", "currency": "USD"}, 201)
        direct = call("POST", "/finance/expense-categories", a, {"name": "QC direct project cost", "cost_type": "direct"}, 201)
        operating = call("POST", "/finance/expense-categories", a, {"name": "QC other operating cost", "cost_type": "operating"}, 201)
        common = {"account_id": cash["id"], "expense_date": today, "expense_currency": "USD", "payment_method": "cash"}
        project_expense = call("POST", "/finance/expenses", a, {**common, "category_id": direct["id"], "project_id": project["id"], "expense_amount": "25", "description": "Synthetic project cost"}, 201)
        client_expense = call("POST", "/finance/expenses", a, {**common, "category_id": operating["id"], "client_id": cost_client["id"], "expense_amount": "6", "description": "Synthetic cost-only client cost"}, 201)
        assert project_expense["client_id"] == client_a["id"]
        assert client_expense["profitability_currency"] == "USD"
        # Changing a preference must not relabel already booked USD cost as GBP.
        call("PATCH", f'/crm/clients/{cost_client["id"]}', a, {"currency": "GBP"})
        amounts(statements(a), total_income=200, total_expenses=31, net_profit=169, total_assets=169, total_liabilities=0)
        operational_before_bill = reports(a)
        amounts(only(operational_before_bill["financials"]), invoiced_revenue=200, collected_revenue=200, receivables=0, expenses=31, net_profit=169)
        chart = call("GET", "/accounting/chart-of-accounts", a)
        expense_ledger = next(row for row in chart if row["system_key"] == "operating_expenses")
        bill = call("POST", "/accounting/payables", a, {"supplier_name": "Synthetic unpaid supplier", "bill_date": today, "currency": "USD", "amount": "10", "expense_ledger_account_id": expense_ledger["id"], "description": "Synthetic unpaid accrual-only supplier cost"}, 201)
        amounts(bill, original_amount=10, amount_paid=0, balance_due=10)
        assert call("GET", f'/accounting/payables/{bill["id"]}/payments', a) == []

        operational = reports(a)
        assert operational["reporting_basis"] == "operational"
        assert operational["financials"] == operational_before_bill["financials"], "Unpaid AP leaked into operational reporting"
        check_project(operational["projects"], project["id"])
        check_cost_client(operational["clients"], cost_client["id"])
        amounts(only(operational["accounts"]), balance=169)
        amounts(only(operational["trend"]), invoiced_revenue=200, collected_revenue=200, expenses=31, net_profit=169)
        project_report = reports(a, "&project_id=" + project["id"])
        amounts(only(project_report["financials"]), invoiced_revenue=200, collected_revenue=200, expenses=25, net_profit=175)
        client_report = reports(a, "&client_id=" + cost_client["id"])
        check_cost_client(client_report["clients"], cost_client["id"])
        assert reports(a, "&currency=GBP&client_id=" + cost_client["id"])["clients"] == []
        expense_report = profitability(a)
        amounts(only(expense_report["profit_loss_by_currency"]), invoice_revenue=200, operating_expenses=31, transfer_fees=0, stripe_processing_fees=0, net_profit=169)
        check_project(expense_report["projects"], project["id"])
        check_cost_client(expense_report["clients"], cost_client["id"])
        dashboard = call("GET", "/reports/dashboard" + period, a)
        assert dashboard["reporting_basis"] == "operational"
        assert dashboard["financials"] == operational["financials"]
        dashboard_details = call("GET", "/reports/dashboard-details" + period, a)
        check_project(dashboard_details["projects"], project["id"])
        check_cost_client(dashboard_details["clients"], cost_client["id"])
        accrual = statements(a)
        assert accrual["accounting_currency"] == accrual["reporting_currency"] == "USD"
        amounts(accrual, total_income=200, total_expenses=41, net_profit=159, total_assets=169, total_liabilities=10, recorded_equity=0, current_earnings=159, total_equity=159, total_liabilities_and_equity=169)
        amounts(accrual["cash_flow"], operating=169, financing=0, investing=0, net_change=169)
        trial = call("GET", "/accounting/trial-balance?as_of=" + today, a)
        amounts(trial, total_debit=441, total_credit=441)
        category_balances = {category: sum((amount(row, "balance") for row in trial["rows"] if row["category"] == category), Decimal(0)) for category in ["asset", "liability", "equity", "income", "expense"]}
        assert category_balances == {"asset": Decimal(169), "liability": Decimal(-10), "equity": Decimal(0), "income": Decimal(-200), "expense": Decimal(41)}, category_balances
        assert category_balances["asset"] == amount(accrual, "total_assets")
        assert -category_balances["liability"] == amount(accrual, "total_liabilities")
        assert -category_balances["income"] - category_balances["expense"] == amount(accrual, "net_profit")
        print("PASS FIN28 same-fixture statement/trial-balance bridge: gross441/441, assets169=liabilities10+earnings159; income200-expenses41", flush=True)
        amounts(only(call("GET", "/finance/accounts", a)), current_balance=169)
        amounts(only(call("GET", "/accounting/payables", a)), balance_due=10)
        print("PASS HTTP bridge: cash 169; AP 10; accrual income 200 - costs 41 = profit 159; Reports/Dashboard/Expenses operational margin 169; order-linked project profit 175; USD cost-only client -6 with null margin even after GBP preference change", flush=True)

        before_capital = snapshot()
        capital = insights(a)
        settlement = only(capital["project_settlements"])
        assert settlement["project_id"] == project["id"]
        amounts(settlement, revenue=200, direct_cost=25, project_profit=175, total_investor_profit_entitlement=35, total_investor_profit_paid=0, company_retained_profit=140)
        share = only(settlement["investors"])
        assert share["investor_id"] == investor["id"]
        amounts(share, committed_amount=10, funded_amount=0, principal_remaining=0, profit_entitlement=35, profit_paid=0, profit_remaining=35)
        statement = call("GET", f'/capital/project-investors/{investor["id"]}/statement', a)
        assert statement["fundings"] == statement["payouts"] == []
        amounts(statement, principal_returned=0, profit_paid=0, outstanding_capital=0)
        assert capital["capital_pnl"] == []
        assert snapshot() == before_capital, "Capital estimates posted financial/audit state"
        print("PASS HTTP Capital: order-only revenue 200/cost 25 -> estimated profit 175, 20% entitlement 35/retained 140; no funding, payout, cash movement, or journal liability", flush=True)

        # Cross-tenant reads and invalid credentials must never reveal A's data.
        before_denials = snapshot()
        call("GET", "/reports/overview" + period, expected=401)
        call("GET", "/finance/profitability", {"Authorization": "Bearer invalid"}, expected=401)
        call("GET", "/capital/insights", {"Authorization": a["Authorization"]}, expected=400)
        call("GET", "/accounting/reports/financial-statements", {**a, "X-Organization-ID": org_ids[1]}, expected=404)
        for path in (f'/finance/invoices/{invoice["id"]}', f'/finance/expenses/{project_expense["id"]}', f'/capital/project-investors/{investor["id"]}/statement', f'/accounting/payables/{bill["id"]}/payments', "/reports/overview" + period + "&project_id=" + project["id"], "/reports/overview" + period + "&client_id=" + cost_client["id"]):
            call("GET", path, b, expected=404)
        amounts(only(reports(b)["financials"]), invoiced_revenue=9999, collected_revenue=0, receivables=9999, expenses=0, net_profit=9999)
        assert reports(b)["projects"] == []
        assert {row["client_id"] for row in reports(b)["clients"]} == {client_b["id"]}
        amounts(only(profitability(b)["profit_loss_by_currency"]), invoice_revenue=9999, operating_expenses=0, net_profit=9999)
        assert profitability(b)["projects"] == []
        assert insights(b)["project_settlements"] == []
        assert call("GET", "/capital/project-investors", b) == []
        assert call("GET", "/accounting/payables", b) == []
        assert call("GET", "/finance/accounts", b) == []
        amounts(statements(b), total_income=9999, total_expenses=0, net_profit=9999, total_assets=9999, total_liabilities=0)
        assert snapshot() == before_denials, "Read/denied requests changed financial or audit state"
        assert statements(a) == accrual, "Tenant B contaminated tenant A statements"
        assert reports(a)["financials"] == operational["financials"]

        # The journal is independently checked through PostgreSQL as evidence of
        # the HTTP bridge, not used to seed or shortcut any business state.
        balances = db.execute(select(LedgerAccount.system_key, func.sum(JournalLine.debit - JournalLine.credit)).join(JournalLine, JournalLine.ledger_account_id == LedgerAccount.id).where(LedgerAccount.organization_id == org_ids[0]).group_by(LedgerAccount.system_key)).all()
        ledger = dict(balances)
        assert ledger["accounts_receivable"] == 0 and ledger["accounts_payable"] == -10 and ledger["service_revenue"] == -200, ledger
        journals = db.execute(select(JournalLine.journal_entry_id, func.sum(JournalLine.debit), func.sum(JournalLine.credit)).where(JournalLine.organization_id == org_ids[0]).group_by(JournalLine.journal_entry_id)).all()
        assert len(journals) == 5 and all(debit == credit for _, debit, credit in journals), journals
        db.rollback()
        frontend = Path(__file__).resolve().parents[2] / "frontend/src"
        note = (frontend / "components/dashboard/operational-reporting-note.tsx").read_text()
        assert "not accrual net profit" in note and "/dashboard/accounting/reports" in note
        verify_expense_profitability_contract(frontend)
        print("PASS auth/tenant isolation: independent B revenue/AR 9999; A IDs hidden; reports and exact financial/audit rows unchanged; five balanced A journals; operational basis documented", flush=True)
    finally:
        http.close()
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        connection.close()
    with SessionLocal() as check:
        assert check.scalar(select(func.count()).select_from(Organization).where(Organization.id.in_(org_ids))) == 0
        assert check.scalar(select(func.count()).select_from(User).where(User.id.in_(user_ids))) == 0
    print("PASS cleanup: synthetic companies/users and all HTTP commits rolled back; no existing review-company changes", flush=True)


if __name__ == "__main__":
    main()
