"""Bounded owner quotation-to-order milestone regression over HTTP/PostgreSQL.

Only get_db is overridden; authentication, tenant permissions, request schemas,
registered routes and commercial services run unchanged. Only active users are
seeded directly. Every business record is created by owner HTTP requests inside
an outer rollback transaction. TestClient deliberately does not start lifespan
jobs or external providers. Run only against the isolated local QC database.

Oracle: 600 + (400 * 90% * 110%) = USD 996. A 30/40/30 payment
schedule is 298.80/398.40/298.80. The first draft invoice is 298.80;
neither scheduling nor that draft recognizes revenue or posts a journal.
"""
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.accounting import JournalEntry, JournalLine
from app.models.finance import FinancialTransaction, Invoice, Payment
from app.models.order_commercial import OrderBillingMilestoneItem
from app.models.organization import Organization
from app.models.user import User
from app.services.activity_log import record_activity


def amount(row, field):
    return Decimal(str(row[field]))


def amounts(row, **expected):
    for field, value in expected.items():
        assert amount(row, field) == Decimal(str(value)), (field, row, expected)


def main():
    assert settings.environment == "test", "Explicit test environment required"
    assert engine.url.get_backend_name() == "postgresql"
    assert engine.url.host in {"127.0.0.1", "localhost"}, "Local synthetic PostgreSQL only"
    assert engine.url.database == "codestation_business_os" or (engine.url.database or "").startswith("business_os_qc"), "Use an isolated QC or CI database"
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
        user = User(
            email=f"qc-order-milestone-{label}-{marker}@example.invalid",
            full_name="Synthetic owner milestone QC",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        db.flush()
        user_ids.append(user.id)
        record_activity(db, action="qc.order_milestone.fixture", scope="system", actor_type="system")
        db.commit()
        headers = {"Authorization": "Bearer " + create_access_token(user.id, int(user.auth_token_version or 0))}
        workspace = call("POST", "/organizations", headers, {
            "name": f"QC owner milestones {label} {marker}",
            "currency": "USD", "country_code": "US", "timezone": "UTC",
        }, 201)
        org_id = workspace["organization"]["id"]
        org_ids.append(org_id)
        headers["X-Organization-ID"] = org_id
        return headers

    def snapshot():
        # Exact rows across every registered tenant table, including audit and
        # number sequences, prove denials do not mutate more than invoice counts.
        db.expire_all()
        result = []
        for table in sorted(Base.metadata.tables.values(), key=lambda table: table.name):
            if "organization_id" in table.c:
                condition = table.c.organization_id.in_(org_ids)
            elif table.name == "organizations":
                condition = table.c.id.in_(org_ids)
            elif table.name == "users":
                condition = table.c.id.in_(user_ids)
            else:
                continue
            rows = db.execute(select(table).where(condition).order_by(*table.primary_key.columns)).all()
            result.append((table.name, tuple(tuple(row) for row in rows)))
        db.rollback()
        return tuple(result)

    def assert_unrecognized(headers):
        overview = call("GET", "/reports/overview" + period, headers)
        for row in overview["financials"]:
            amounts(row, invoiced_revenue=0, collected_revenue=0, receivables=0, expenses=0, net_profit=0)
        profitability = call("GET", "/finance/profitability", headers)
        for row in profitability["profit_loss_by_currency"]:
            amounts(row, invoice_revenue=0, operating_expenses=0, net_profit=0)
        statements = call("GET", "/accounting/reports/financial-statements" + period, headers)
        amounts(statements, total_income=0, total_expenses=0, net_profit=0, total_assets=0, total_liabilities=0)
        for model in (JournalEntry, JournalLine, FinancialTransaction, Payment):
            assert db.scalar(select(func.count()).select_from(model).where(model.organization_id == org_ids[0])) == 0, model
        db.rollback()

    try:
        print(f"RUN H-app owner order milestone fixture {marker}; local PostgreSQL; all writes roll back", flush=True)
        owner = fixture("A")
        other_owner = fixture("B")
        client = call("POST", "/crm/clients", owner, {
            "display_name": "Synthetic milestone customer", "currency": "USD",
        }, 201)
        quotation = call("POST", "/sales/quotations", owner, {
            "client_id": client["id"], "subject": "QC staged billing",
            "issue_date": today, "currency": "USD", "tax_calculation_mode": "exclusive",
            "items": [
                {"item_name": "Implementation", "description": "Synthetic implementation",
                 "item_type": "service", "unit": "project", "quantity": "1", "unit_price": "600",
                 "discount_percent": "0", "tax_rate": "0"},
                {"item_name": "Launch", "description": "Synthetic discounted and taxed launch",
                 "item_type": "service", "unit": "project", "quantity": "1", "unit_price": "400",
                 "discount_percent": "10", "tax_rate": "10"},
            ],
        }, 201)
        amounts(quotation, subtotal=1000, discount_total=40, tax_total=36, total=996)
        commercial = call("PATCH", f'/sales/quotations/{quotation["id"]}/commercial', owner, {
            "milestones": [{"title": "Prototype approval", "description": "Synthetic acceptance gate"}],
            "payment_milestones": [
                {"quotation_milestone_index": 0, "title": "Advance", "payment_type": "percentage",
                 "percentage": "30", "due_condition": "Due on acceptance"},
                {"title": "Prototype payment", "payment_type": "percentage",
                 "percentage": "40", "due_condition": "Due after prototype approval"},
                {"title": "Final payment", "payment_type": "percentage",
                 "percentage": "30", "due_condition": "Due before production handover"},
            ],
        })
        expected = [Decimal("298.80"), Decimal("398.40"), Decimal("298.80")]
        assert [amount(row, "amount") for row in commercial["payment_milestones"]] == expected
        for state in ("sent", "accepted"):
            call("PATCH", f'/sales/quotations/{quotation["id"]}/status', owner, {"status": state})
        order = call("POST", f'/sales/orders/from-quotation/{quotation["id"]}', owner, expected=201)
        assert order["quotation_id"] == quotation["id"]
        amounts(order, subtotal=1000, discount_total=40, tax_total=36, total=996)
        assert len(order["items"]) == 2
        amounts(order["items"][0], line_subtotal=600, discount_amount=0, tax_amount=0, line_total=600)
        amounts(order["items"][1], line_subtotal=400, discount_percent=10, discount_amount=40,
                taxable_amount=360, tax_rate=10, tax_amount=36, line_total=396)

        commercial_path = f'/sales/orders/{order["id"]}/commercial'
        schedule = call("GET", commercial_path, owner)
        assert schedule["staged_billing_enabled"] is True
        amounts(schedule, original_value=996, approved_change_value=0, revised_contract_value=996,
                scheduled_value=996, remaining_to_schedule=0, billed_value=0, draft_invoice_value=0,
                paid_value=0, accounts_receivable=0, remaining_to_bill=996)
        milestones = schedule["billing_milestones"]
        assert [amount(row, "amount") for row in milestones] == expected
        assert sum((amount(row, "amount") for row in milestones), Decimal("0")) == Decimal("996")
        assert [row["source_quotation_payment_milestone_id"] for row in milestones] == [
            row["id"] for row in commercial["payment_milestones"]
        ]
        assert milestones[0]["source_quotation_milestone_id"] == commercial["milestones"][0]["id"]
        for row, terms, percent in zip(milestones, commercial["payment_milestones"], (30, 40, 30), strict=True):
            assert row["status"] == "planned" and row["invoice_id"] is None
            assert row["source_payment_type"] == "percentage" and amount(row, "source_percentage") == percent
            assert row["due_condition"] == terms["due_condition"]
            assert sum((amount(item, "line_total") for item in row["items"]), Decimal("0")) == amount(row, "amount")
        # PostgreSQL independently verifies per-source-line money conservation;
        # commercial HTTP line responses intentionally omit the tax/discount amounts.
        for item in order["items"]:
            allocations = db.scalars(select(OrderBillingMilestoneItem).where(
                OrderBillingMilestoneItem.organization_id == org_ids[0],
                OrderBillingMilestoneItem.source_order_item_id == item["id"],
            )).all()
            assert len(allocations) == 3
            for field in ("line_subtotal", "discount_amount", "taxable_amount", "tax_amount", "line_total"):
                assert sum((getattr(row, field) for row in allocations), Decimal("0")) == amount(item, field), field
            assert all(row.discount_percent == amount(item, "discount_percent") and row.tax_rate == amount(item, "tax_rate") for row in allocations)
        db.rollback()
        assert_unrecognized(owner)
        print("PASS HTTP quotation 600 + (400 x 90% x 110%) = 996; accepted order preserves per-line tax/discount and payment lineage; schedule 298.80/398.40/298.80; no revenue/AR/journals", flush=True)

        milestone_path = f'/sales/orders/{order["id"]}/billing-milestones/{milestones[0]["id"]}'
        billable = call("POST", milestone_path + "/action", owner, {"action": "mark_billable"})
        assert billable["status"] == "billable"
        first = call("POST", milestone_path + "/invoice", owner, expected=201)
        assert first["status"] == "draft" and first["currency"] == "USD"
        amounts(first, total="298.80")
        invoice = call("GET", f'/finance/invoices/{first["invoice_id"]}', owner)
        assert invoice["order_id"] == order["id"] and invoice["quotation_id"] == quotation["id"]
        amounts(invoice, subtotal=300, discount_total=12, tax_total="10.80", total="298.80", amount_paid=0, balance_due="298.80")
        assert len(invoice["items"]) == 2
        amounts(invoice["items"][0], line_subtotal=180, discount_amount=0, tax_amount=0, line_total=180)
        amounts(invoice["items"][1], line_subtotal=120, discount_percent=10, discount_amount=12,
                taxable_amount=108, tax_rate=10, tax_amount="10.80", line_total="118.80")
        assert {row["source_order_item_id"] for row in invoice["items"]} == {row["id"] for row in order["items"]}
        draft_schedule = call("GET", commercial_path, owner)
        amounts(draft_schedule, scheduled_value=996, remaining_to_schedule=0, billed_value=0,
                draft_invoice_value="298.80", paid_value=0, accounts_receivable=0, remaining_to_bill=996)
        assert draft_schedule["billing_milestones"][0]["invoice_id"] == invoice["id"]
        assert draft_schedule["billing_milestones"][0]["status"] == "invoiced"
        assert [row["status"] for row in draft_schedule["billing_milestones"][1:]] == ["planned", "planned"]
        assert_unrecognized(owner)
        print("PASS HTTP first milestone -> draft invoice 298.80 (300 - 12 + 10.80), source lines preserved; scheduled total stays 996; recognized revenue, AR, cash and journals remain zero", flush=True)

        before_denials = snapshot()
        duplicate = call("POST", milestone_path + "/invoice", owner, expected=409)
        assert "active invoice" in duplicate["detail"].lower(), duplicate
        assert snapshot() == before_denials, "Duplicate invoice attempt changed exact persisted rows"
        assert call("GET", commercial_path, owner) == draft_schedule
        assert db.scalar(select(func.count()).select_from(Invoice).where(
            Invoice.organization_id == org_ids[0], Invoice.order_id == order["id"], Invoice.status != "cancelled",
        )) == 1
        db.rollback()
        print("PASS duplicate HTTP invoice -> 409 active invoice; exactly one active draft; all tenant, financial, audit and sequence rows unchanged", flush=True)

        call("GET", commercial_path, expected=401)
        call("GET", commercial_path, {"Authorization": "Bearer invalid"}, expected=401)
        call("GET", commercial_path, {"Authorization": owner["Authorization"]}, expected=400)
        call("GET", commercial_path, {**owner, "X-Organization-ID": org_ids[1]}, expected=404)
        for path in (commercial_path, f'/finance/invoices/{invoice["id"]}'):
            call("GET", path, other_owner, expected=404)
        call("POST", milestone_path + "/action", other_owner, {"action": "mark_billable"}, expected=404)
        call("POST", milestone_path + "/invoice", other_owner, expected=404)
        assert snapshot() == before_denials, "Authentication/tenant denials changed exact persisted rows"
        print("PASS HTTP real authentication/owner tenant isolation: missing/invalid token 401, missing tenant 400, foreign workspace/order/milestone/invoice 404; exact rows unchanged", flush=True)
    finally:
        http.close()
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        connection.close()
    with SessionLocal() as check:
        assert check.scalar(select(func.count()).select_from(Organization).where(Organization.id.in_(org_ids))) == 0
        assert check.scalar(select(func.count()).select_from(User).where(User.id.in_(user_ids))) == 0
    print("PASS cleanup: synthetic owners/companies and every HTTP business write rolled back; no retained test records", flush=True)


if __name__ == "__main__":
    main()
