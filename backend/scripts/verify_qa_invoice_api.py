"""QA-012/013/014/015: real authenticated HTTP + local PostgreSQL, all rolled back.

Only get_db is rebound to a real PostgreSQL transaction. No auth/tenant/finance
endpoint or accounting service is mocked. TestClient does not start application
lifespan (and therefore does not bootstrap an administrator or external service).
"""
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, func

from app.core.security import create_access_token
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.activity_log import ActivityLog
from app.models.company_settings import OrganizationIdentifier
from app.models.crm import Client
from app.models.finance import Invoice, InvoiceItem, Payment, FinancialTransaction
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import OrganizationRole
from app.models.user import User
from app.services.activity_log import record_activity


def main():
    assert engine.url.get_backend_name() == "postgresql"
    assert engine.url.host in {"127.0.0.1", "localhost"}, "Local synthetic PostgreSQL only"
    assert not app.dependency_overrides, "Do not inherit authentication overrides"
    marker = uuid4().hex[:12]
    organization_ids = []
    connection = engine.connect()
    outer = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")
    # Every request receives a new real session/savepoint, just as production gets
    # its own session. Endpoint commits remain inside our outer rollback boundary.
    def local_db():
        with SessionLocal(bind=connection, join_transaction_mode="create_savepoint") as request_db:
            yield request_db
    app.dependency_overrides[get_db] = local_db
    http = TestClient(app)
    def call(method, path, headers=None, payload=None, expected=200):
        response = http.request(method, "/api/v1" + path, headers=headers or {}, json=payload)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        return response.json()
    def audit():
        record_activity(db, action="qa.invoice_api.fixture", scope="system", actor_type="system")
        db.commit()
    def fixture(label):
        user = User(email=f"qa-invoice-{label}-{marker}@example.invalid", full_name="Synthetic invoice QA", is_active=True, is_verified=True)
        db.add(user); db.flush(); audit()
        headers = {"Authorization": "Bearer " + create_access_token(user.id, int(user.auth_token_version or 0))}
        workspace = call("POST", "/organizations", headers, {"name": f"QA invoice {label} {marker}", "currency": "USD", "country_code": "US", "timezone": "UTC"}, 201)
        org = workspace["organization"]["id"]
        organization_ids.append(org)
        headers["X-Organization-ID"] = org
        customer = Client(organization_id=org, client_code="QA-CLIENT", display_name="Synthetic invoice customer", currency="USD")
        db.add(customer); db.flush(); audit()
        return user, headers, customer.id
    def invoice(headers, customer, amount):
        return call("POST", "/finance/invoices", headers, {"client_id": customer, "issue_date": date.today().isoformat(), "currency": "USD", "subject": "Synthetic QA", "items": [{"item_name": "QA service", "description": "Synthetic service", "quantity": "1", "unit_price": amount}]}, 201)
    def draft_payload(amount):
        return {"issue_date": date.today().isoformat(), "currency": "USD", "items": [{"item_name": "QA service", "description": "Edited service", "quantity": "1", "unit_price": amount}]}
    def snapshot():
        # Exact financial and audit rows, not merely counts, detect denied updates.
        db.expire_all()
        tables = (Invoice, InvoiceItem, Payment, FinancialTransaction, JournalEntry, JournalLine, ActivityLog)
        return tuple(tuple(tuple(row) for row in db.execute(select(model.__table__).where(model.organization_id.in_(organization_ids)).order_by(model.id)).all()) for model in tables)
    def report(headers):
        return call("GET", "/accounting/reports/financial-statements", headers)
    try:
        _, a, customer_a = fixture("A")
        _, b, customer_b = fixture("B")
        org_a, org_b = organization_ids
        # Real CRM queries complement the browser's controlled network tests.
        absent = "impossible-query-" + marker
        inactive = call("POST", "/crm/clients", a, {"display_name": "Inactive search sentinel " + marker}, 201)
        call("PATCH", f'/crm/clients/{inactive["id"]}', a, {"status": "inactive"})
        assert call("GET", "/crm/clients?search=" + absent, a)["items"] == []
        assert {x["id"] for x in call("GET", "/crm/clients?status=active", a)["items"]} == {customer_a}
        assert {x["id"] for x in call("GET", "/crm/clients?status=inactive&search=" + marker, a)["items"]} == {inactive["id"]}
        assert call("GET", "/crm/clients?status=active&search=" + marker, a)["items"] == []
        assert {x["id"] for x in call("GET", "/crm/clients", b)["items"]} == {customer_b}
        statuses = call("GET", "/crm/meta", a)["statuses"]
        assert len(statuses) >= 2
        lead = call("POST", "/crm/leads", a, {"contact_name": "Search sentinel " + marker, "status_id": statuses[0]["id"]}, 201)
        assert call("GET", "/crm/leads?search=" + absent, a)["items"] == []
        assert {x["id"] for x in call("GET", "/crm/leads?search=" + marker + "&status_id=" + statuses[0]["id"], a)["items"]} == {lead["id"]}
        assert call("GET", "/crm/leads?search=" + marker + "&status_id=" + statuses[1]["id"], a)["items"] == []
        assert call("GET", "/crm/leads?search=" + marker, b)["items"] == []
        print("PASS real CRM/client HTTP: impossible-query empty results, matching/nonmatching status+search intersections, independent tenant results")
        db.add_all([
            OrganizationIdentifier(organization_id=org_a, identifier_type="other", label="Custom reference", value="NOT-TAX", is_primary=True),
            OrganizationIdentifier(organization_id=org_b, identifier_type="vat", label="Foreign VAT", value="FOREIGN-VAT", is_primary=True),
        ]); audit()
        draft = invoice(a, customer_a, "12.34")
        assert draft["seller_tax_identifier_snapshot"] is None
        edited = call("PATCH", f'/finance/invoices/{draft["id"]}/draft', a, draft_payload("24.68"))
        assert Decimal(edited["total"]) == Decimal("24.68")
        detail = call("GET", f'/finance/invoices/{draft["id"]}', a)
        assert Decimal(detail["total"]) == Decimal("24.68") and Decimal(detail["items"][0]["unit_price"]) == Decimal("24.68")
        cancelled = invoice(a, customer_a, "73.21")
        cancelled = call("PATCH", f'/finance/invoices/{cancelled["id"]}/status', a, {"action": "cancel", "reason": "Synthetic cancellation"})
        assert cancelled["status"] == "cancelled" and Decimal(cancelled["balance_due"]) == 0
        listed = call("GET", "/finance/invoices", a)
        assert next(x for x in listed["items"] if x["id"] == cancelled["id"])["balance_due"] in ("0.00", "0", 0)
        assert Decimal(report(a)["total_income"]) == 0
        assert db.scalar(select(func.count()).select_from(JournalEntry).where(JournalEntry.organization_id == org_a)) == 0
        db.rollback()
        db.add(OrganizationIdentifier(organization_id=org_a, identifier_type="vat", label="VAT", value="SYNTHETIC-VAT", is_primary=False)); audit()
        issued = invoice(a, customer_a, "200.00")
        assert issued["seller_tax_identifier_snapshot"] == "SYNTHETIC-VAT"
        assert call("GET", f'/finance/invoices/{draft["id"]}', a)["seller_tax_identifier_snapshot"] is None, "Historical snapshot changed"
        issued = call("PATCH", f'/finance/invoices/{issued["id"]}/status', a, {"action": "send"})
        account = call("POST", "/finance/accounts", a, {"name": "Synthetic QA cash", "account_type": "cash", "currency": "USD", "opening_balance": "0"}, 201)
        payments = [call("POST", "/finance/payments", a, {"invoice_id": issued["id"], "account_id": account["id"], "invoice_amount": amount, "method": "cash"}, 201) for amount in ("80", "120")]
        paid = call("GET", f'/finance/invoices/{issued["id"]}', a)
        assert paid["status"] == "paid" and Decimal(paid["amount_paid"]) == 200 and Decimal(paid["balance_due"]) == 0
        reverse = {"source_type": "payment", "source_id": payments[1]["id"], "reason": "Synthetic reversal QA"}
        before = snapshot(); db.rollback()
        call("GET", f'/finance/invoices/{issued["id"]}', expected=401)
        call("GET", f'/finance/invoices/{issued["id"]}', {"Authorization": "Bearer invalid"}, expected=401)
        call("GET", f'/finance/invoices/{issued["id"]}', {"Authorization": a["Authorization"]}, expected=400)
        call("GET", f'/finance/invoices/{issued["id"]}', {**a, "X-Organization-ID": org_b}, expected=404)
        call("GET", f'/finance/invoices/{issued["id"]}', b, expected=404)
        call("PATCH", f'/finance/invoices/{draft["id"]}/draft', b, draft_payload("999"), 404)
        call("PATCH", f'/finance/invoices/{issued["id"]}/status', b, {"action": "cancel", "reason": "Denied mutation"}, 404)
        call("POST", "/accounting/corrections/reverse", b, reverse, 404)
        call("PATCH", f'/finance/invoices/{issued["id"]}/draft', a, draft_payload("999"), 409)
        assert call("GET", "/finance/payments?invoice_id=" + issued["id"], b) == []
        assert call("GET", "/accounting/corrections/candidates", b) == []
        assert snapshot() == before, "Denied requests changed financial/audit state"
        db.rollback()
        # Read-only authenticated membership must not acquire manager authority.
        viewer = User(email=f"qa-viewer-{marker}@example.invalid", full_name="QA Viewer", is_active=True, is_verified=True)
        db.add(viewer); db.flush()
        role = OrganizationRole(organization_id=org_a, name="QA viewer", slug="qa-viewer", permissions=["finance.view"])
        db.add(role); db.flush()
        db.add(Membership(organization_id=org_a, user_id=viewer.id, role="member", role_id=role.id, status="active")); audit()
        vh = {"Authorization": "Bearer " + create_access_token(viewer.id, int(viewer.auth_token_version or 0)), "X-Organization-ID": org_a}
        call("GET", f'/finance/invoices/{issued["id"]}', vh)
        before = snapshot(); db.rollback()
        call("POST", "/accounting/corrections/reverse", vh, reverse, 403)
        call("PATCH", f'/finance/invoices/{draft["id"]}/draft', vh, draft_payload("999"), 403)
        assert snapshot() == before
        db.rollback()
        call("POST", "/accounting/corrections/reverse", a, reverse, 201)
        partial = call("GET", f'/finance/invoices/{issued["id"]}', a)
        assert partial["status"] == "partially_paid" and Decimal(partial["amount_paid"]) == 80 and Decimal(partial["balance_due"]) == 120
        rows = call("GET", "/finance/payments?invoice_id=" + issued["id"], a)
        assert {x["id"]: x["status"] for x in rows} == {payments[0]["id"]: "confirmed", payments[1]["id"]: "reversed"}
        history = call("GET", "/accounting/corrections/history", a)
        assert len(history) == 1 and history[0]["source_id"] == payments[1]["id"]
        assert call("GET", "/accounting/corrections/history", b) == []
        before = snapshot(); db.rollback()
        call("POST", "/accounting/corrections/reverse", a, reverse, 409)
        assert snapshot() == before, "Duplicate reversal mutated financial state"
        db.rollback()
        accounts = call("GET", "/finance/accounts", a)
        assert Decimal(next(x for x in accounts if x["id"] == account["id"])["current_balance"]) == 80
        statements = report(a)
        assert Decimal(statements["total_income"]) == 200 and Decimal(statements["total_assets"]) == 200
        assert Decimal(statements["cash_flow"]["net_change"]) == 80
        ledger = db.execute(select(LedgerAccount.system_key, func.sum(JournalLine.debit - JournalLine.credit)).join(JournalLine, JournalLine.ledger_account_id == LedgerAccount.id).where(LedgerAccount.organization_id == org_a).group_by(LedgerAccount.system_key)).all()
        assert dict(ledger)["accounts_receivable"] == Decimal("120")
        assert dict(ledger)["service_revenue"] == Decimal("-200")
        totals = db.execute(select(JournalLine.journal_entry_id, func.sum(JournalLine.debit), func.sum(JournalLine.credit)).where(JournalLine.organization_id == org_a).group_by(JournalLine.journal_entry_id)).all()
        assert len(totals) == 4 and all(debit == credit for _, debit, credit in totals)
        db.rollback()
        # Cancellation of an already recognized, unpaid invoice must offset its
        # issue journal, unlike cancellation of a never-issued draft above.
        voided = invoice(a, customer_a, "40.00")
        call("PATCH", f'/finance/invoices/{voided["id"]}/status', a, {"action": "send"})
        assert Decimal(report(a)["total_income"]) == 240
        voided = call("PATCH", f'/finance/invoices/{voided["id"]}/status', a, {"action": "cancel", "reason": "Synthetic issued cancellation"})
        assert Decimal(voided["balance_due"]) == 0
        assert Decimal(report(a)["total_income"]) == 200
        assert Decimal(report(a)["total_assets"]) == 200
        entries = db.scalars(select(JournalEntry).where(JournalEntry.organization_id == org_a)).all()
        assert len(entries) == 6 and len([entry for entry in entries if entry.reversed_entry_id]) == 2
        totals = db.execute(select(JournalLine.journal_entry_id, func.sum(JournalLine.debit), func.sum(JournalLine.credit)).where(JournalLine.organization_id == org_a).group_by(JournalLine.journal_entry_id)).all()
        assert len(totals) == 6 and all(debit == credit for _, debit, credit in totals)
        print("PASS issued cancellation: 40 recognized then fully offset; revenue/assets restored to 200; six balanced immutable issue/payment/reversal journals")
        print("PASS QA-012/013/014/015 real PostgreSQL HTTP: draft 12.34→24.68; Other omitted/new VAT retained; draft/cancel excluded from recognized statements; cancelled due 0; issue 200/pay 80+120/reverse 120 → paid 80/due 120; cash 80/AR 120/revenue 200; four balanced main-invoice journals (six including issued cancellation); authentication, tenant isolation, read-only permissions and duplicate reversal denial with exact financial/audit snapshots unchanged.")
    finally:
        http.close()
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        connection.close()
    with SessionLocal() as check:
        assert check.scalar(select(func.count()).select_from(Organization).where(Organization.id.in_(organization_ids))) == 0
    print("PASS cleanup: all synthetic organizations and request commits rolled back; review company untouched")


if __name__ == "__main__":
    main()
