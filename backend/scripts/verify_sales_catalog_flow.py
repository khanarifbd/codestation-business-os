from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.accounting_sync import sync_accounting
from app.api.v1.crm_interests import replace_lead_interests
from app.api.v1.finance import change_invoice_status, create_invoice_from_order
from app.api.v1.orders import change_order_status, create_order_from_quotation
from app.api.v1.sales import change_quotation_status, create_quotation, update_quotation
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance import InvoiceItem
from app.models.inventory import StockMovement
from app.models.crm import Lead
from app.models.orders import OrderItem
from app.models.sales import QuotationItem
from app.schemas.crm import LeadInterestInput, LeadInterestReplace
from app.schemas.finance import InvoiceStatusAction
from app.schemas.orders import OrderStatusChange
from app.schemas.sales import QuotationCreate, QuotationItemInput, QuotationStatusChange, QuotationUpdate
from app.services.accounting_posting import ensure_default_chart
from app.services.activity_log import record_activity


@dataclass(frozen=True)
class Org:
    id: str
    currency: str
    timezone: str
    name: str = "Existing Tenant Fixture"
    country_code: str | None = "BD"


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    organization: Org
    role: str = "admin"


def req(method: str, path: str) -> Request:
    return Request({"type":"http","method":method,"path":path,"raw_path":path.encode(),"headers":[],"query_string":b"","scheme":"https","server":("testserver",443),"client":("127.0.0.1",50000)})


def expect(status_code: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != status_code:
            raise AssertionError(f"Expected HTTP {status_code}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {status_code}, but request succeeded")


def main() -> None:
    marker = uuid4().hex[:8].upper()
    client_id = str(uuid4())
    lead_id = str(uuid4())
    product_id = str(uuid4())
    now = datetime.now(timezone.utc)

    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT o.id organization_id,o.created_by_user_id user_id,o.currency,o.timezone,m.id membership_id
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()
        status_id = connection.execute(text("""
            SELECT id FROM lead_statuses
            WHERE organization_id=:organization_id AND is_active=true
            ORDER BY is_default DESC, sort_order ASC LIMIT 1
        """), {"organization_id": fixture["organization_id"]}).scalar_one()
        currency = str(fixture["currency"] or "BDT").upper()
        connection.execute(text("""
            INSERT INTO clients
                (id,organization_id,client_code,client_type,display_name,currency,status,created_at,updated_at)
            VALUES
                (:id,:organization_id,:code,'company',:name,:currency,'active',:now,:now)
        """), {"id":client_id,"organization_id":fixture["organization_id"],"code":f"SC-{marker}","name":f"Sales Catalog Client {marker}","currency":currency,"now":now})
        connection.execute(text("""
            INSERT INTO leads
                (id,organization_id,lead_code,lead_type,company_name,contact_name,status_id,currency,
                 probability_percent,converted_client_id,converted_at,created_at,updated_at)
            VALUES
                (:id,:organization_id,:code,'company',:company,:contact,:status_id,:currency,
                 50,:client_id,:now,:now,:now)
        """), {"id":lead_id,"organization_id":fixture["organization_id"],"code":f"LD-SC-{marker}","company":f"Sales Catalog Client {marker}","contact":"CI Sales Contact","status_id":status_id,"currency":currency,"client_id":client_id,"now":now})
        connection.execute(text("""
            INSERT INTO products
                (id,organization_id,sku,name,description,item_type,unit,currency,selling_price,
                 standard_cost,last_purchase_cost,reorder_level,track_inventory,allow_negative_stock,
                 is_active,created_by_user_id,created_at,updated_at)
            VALUES
                (:id,:organization_id,:sku,:name,'Reusable non-stock catalog item','non_stock_item','unit',:currency,100,
                 0,0,0,false,false,true,:user_id,:now,:now)
        """), {"id":product_id,"organization_id":fixture["organization_id"],"sku":f"SC-{marker}","name":f"Reusable Package {marker}","currency":currency,"user_id":fixture["user_id"],"now":now})
        alternate_currency = "USD" if currency != "USD" else "EUR"
        alt_lead_id = str(uuid4())
        alt_product_id = str(uuid4())
        connection.execute(text("""
            INSERT INTO leads
                (id,organization_id,lead_code,lead_type,company_name,contact_name,status_id,currency,probability_percent,created_at,updated_at)
            VALUES
                (:id,:organization_id,:code,'company',:company,:contact,:status_id,:currency,50,:now,:now)
        """), {"id":alt_lead_id,"organization_id":fixture["organization_id"],"code":f"LD-FX-{marker}","company":f"Foreign Opportunity {marker}","contact":"FX Sales Contact","status_id":status_id,"currency":currency,"now":now})
        connection.execute(text("""
            INSERT INTO products
                (id,organization_id,sku,name,description,item_type,unit,currency,selling_price,
                 standard_cost,last_purchase_cost,reorder_level,track_inventory,allow_negative_stock,
                 is_active,created_by_user_id,created_at,updated_at)
            VALUES
                (:id,:organization_id,:sku,:name,'Foreign currency service','service','project',:currency,750,
                 0,0,0,false,false,true,:user_id,:now,:now)
        """), {"id":alt_product_id,"organization_id":fixture["organization_id"],"sku":f"FX-{marker}","name":f"Foreign Service {marker}","currency":alternate_currency,"user_id":fixture["user_id"],"now":now})

    tenant = Tenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        membership_id=str(fixture["membership_id"]),
        organization=Org(str(fixture["organization_id"]), currency, str(fixture["timezone"] or "UTC")),
    )
    db = SessionLocal()
    try:
        fx_interests = replace_lead_interests(
            alt_lead_id,
            LeadInterestReplace(currency=alternate_currency, interests=[
                LeadInterestInput(product_id=alt_product_id, quantity=Decimal("1")),
                LeadInterestInput(item_name="Custom foreign-currency project", description="One-time custom scope", item_type="service", unit="project", quantity=Decimal("1"), estimated_unit_price=Decimal("900")),
            ]),
            req("PUT", f"/crm/leads/{alt_lead_id}/interests"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if any(item.currency != alternate_currency for item in fx_interests):
            raise AssertionError(f"lead requirements did not use opportunity currency {alternate_currency}: {fx_interests}")
        updated_lead = db.scalar(select(Lead).where(Lead.id == alt_lead_id, Lead.organization_id == tenant.organization_id))
        if updated_lead is None or updated_lead.currency != alternate_currency:
            raise AssertionError("lead opportunity currency was not updated atomically with requirements")
        expect(400, lambda: replace_lead_interests(
            alt_lead_id,
            LeadInterestReplace(currency=alternate_currency, interests=[LeadInterestInput(product_id=product_id, quantity=Decimal("1"))]),
            req("PUT", f"/crm/leads/{alt_lead_id}/interests"),
            db,
            tenant,  # type: ignore[arg-type]
        ))
        db.rollback()

        interests = replace_lead_interests(
            lead_id,
            LeadInterestReplace(interests=[
                LeadInterestInput(product_id=product_id, quantity=Decimal("2")),
                LeadInterestInput(item_name="Custom implementation project", description="One-time implementation project", item_type="service", unit="project", quantity=Decimal("1"), estimated_unit_price=Decimal("200")),
            ]),
            req("PUT", f"/crm/leads/{lead_id}/interests"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if len(interests) != 2 or interests[0].product_id != product_id or interests[1].product_id is not None:
            raise AssertionError("lead interests did not preserve catalog/custom distinction")
        if interests[0].estimated_unit_price != Decimal("100.0000"):
            raise AssertionError(f"catalog lead interest did not default selling price: {interests[0].estimated_unit_price}")

        quotation = create_quotation(
            QuotationCreate(
                client_id=client_id,
                source_lead_id=lead_id,
                subject="Catalog + custom implementation",
                issue_date=date.today(),
                currency=currency,
                items=[
                    QuotationItemInput(product_id=product_id, lead_interest_id=interests[0].id, description="Reusable package", quantity=Decimal("2"), unit_price=Decimal("100")),
                    QuotationItemInput(lead_interest_id=interests[1].id, item_name="Custom implementation project", item_type="service", unit="project", description="One-time implementation project", quantity=Decimal("1"), unit_price=Decimal("200")),
                ],
            ),
            req("POST", "/sales/quotations"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if quotation.source_lead_id != lead_id or quotation.total != Decimal("400.00"):
            raise AssertionError("quotation did not preserve explicit lead source or total")
        if quotation.items[0].product_id != product_id or quotation.items[0].item_type_snapshot != "non_stock_item":
            raise AssertionError("quotation catalog snapshot missing")
        if quotation.items[1].product_id is not None or quotation.items[1].item_type_snapshot != "service":
            raise AssertionError("quotation custom service snapshot missing")

        revision_quote = create_quotation(
            QuotationCreate(
                client_id=client_id,
                subject="Negotiation revision",
                issue_date=date.today(),
                currency=currency,
                items=[QuotationItemInput(item_name="Negotiation service", item_type="service", unit="project", description="Negotiation service", quantity=Decimal("1"), unit_price=Decimal("100"))],
            ),
            req("POST", "/sales/quotations"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        revision_sent = change_quotation_status(revision_quote.id, QuotationStatusChange(status="sent"), req("PATCH", f"/sales/quotations/{revision_quote.id}/status"), db, tenant)  # type: ignore[arg-type]
        revised = update_quotation(
            revision_sent.id,
            QuotationUpdate(
                subject="Negotiated price",
                items=[QuotationItemInput(item_name="Negotiation service", item_type="service", unit="project", description="Negotiation service", quantity=Decimal("1"), unit_price=Decimal("80"))],
            ),
            req("PATCH", f"/sales/quotations/{revision_sent.id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if revised.status != "draft" or revised.total != Decimal("80.00") or revised.sent_at is not None:
            raise AssertionError(f"sent quotation revision did not return to draft safely: {revised}")
        revision_resent = change_quotation_status(revised.id, QuotationStatusChange(status="sent"), req("PATCH", f"/sales/quotations/{revised.id}/status"), db, tenant)  # type: ignore[arg-type]
        revision_rejected = change_quotation_status(revision_resent.id, QuotationStatusChange(status="rejected"), req("PATCH", f"/sales/quotations/{revision_resent.id}/status"), db, tenant)  # type: ignore[arg-type]
        reopened = update_quotation(
            revision_rejected.id,
            QuotationUpdate(subject="Second revision"),
            req("PATCH", f"/sales/quotations/{revision_rejected.id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if reopened.status != "draft" or reopened.sent_at is not None or reopened.rejected_at is not None:
            raise AssertionError(f"rejected quotation revision did not return to draft safely: {reopened}")
        revision_final_sent = change_quotation_status(reopened.id, QuotationStatusChange(status="sent"), req("PATCH", f"/sales/quotations/{reopened.id}/status"), db, tenant)  # type: ignore[arg-type]
        revision_accepted = change_quotation_status(revision_final_sent.id, QuotationStatusChange(status="accepted"), req("PATCH", f"/sales/quotations/{revision_final_sent.id}/status"), db, tenant)  # type: ignore[arg-type]
        expect(409, lambda: update_quotation(
            revision_accepted.id,
            QuotationUpdate(subject="Accepted quotation must stay locked"),
            req("PATCH", f"/sales/quotations/{revision_accepted.id}"),
            db,
            tenant,  # type: ignore[arg-type]
        ))
        db.rollback()

        sent = change_quotation_status(quotation.id, QuotationStatusChange(status="sent"), req("PATCH", f"/sales/quotations/{quotation.id}/status"), db, tenant)  # type: ignore[arg-type]
        accepted = change_quotation_status(sent.id, QuotationStatusChange(status="accepted"), req("PATCH", f"/sales/quotations/{sent.id}/status"), db, tenant)  # type: ignore[arg-type]
        if accepted.status != "accepted":
            raise AssertionError("quotation acceptance failed")

        order = create_order_from_quotation(accepted.id, req("POST", f"/sales/orders/from-quotation/{accepted.id}"), db, tenant)  # type: ignore[arg-type]
        if order.total != Decimal("400.00") or len(order.items) != 2:
            raise AssertionError("order did not preserve quotation totals/lines")
        order_items = db.scalars(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.sort_order)).all()
        quote_items = db.scalars(select(QuotationItem).where(QuotationItem.quotation_id == quotation.id).order_by(QuotationItem.sort_order)).all()
        if order_items[0].quotation_item_id != quote_items[0].id or order_items[0].product_id != product_id:
            raise AssertionError("quotation -> order lineage missing")

        invoice = create_invoice_from_order(order.id, req("POST", f"/finance/invoices/from-order/{order.id}"), db, tenant)  # type: ignore[arg-type]
        if invoice.total != Decimal("400.00") or len(invoice.items) != 2:
            raise AssertionError("invoice did not preserve order totals/lines")
        invoice_items = db.scalars(select(InvoiceItem).where(InvoiceItem.invoice_id == invoice.id).order_by(InvoiceItem.sort_order)).all()
        if invoice_items[0].source_order_item_id != order_items[0].id or invoice_items[0].product_id != product_id:
            raise AssertionError("order -> invoice lineage missing")

        expect(409, lambda: create_invoice_from_order(order.id, req("POST", f"/finance/invoices/from-order/{order.id}"), db, tenant))  # type: ignore[arg-type]
        db.rollback()

        sent_invoice = change_invoice_status(invoice.id, InvoiceStatusAction(action="send"), req("PATCH", f"/finance/invoices/{invoice.id}/status"), db, tenant)  # type: ignore[arg-type]
        if sent_invoice.status != "sent":
            raise AssertionError("invoice send failed")

        stock_count = db.scalar(select(func.count()).select_from(StockMovement).where(StockMovement.organization_id == tenant.organization_id, StockMovement.source_id.in_([quotation.id, order.id, invoice.id]))) or 0
        if stock_count != 0:
            raise AssertionError("lead/quotation/order/invoice flow must not move inventory before fulfillment")

        ensure_default_chart(db, tenant.organization_id, tenant.user_id)
        record_activity(
            db,
            action="accounting.default_chart.verified",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="organization",
            entity_id=tenant.organization_id,
            after={"source": "verify_sales_catalog_flow"},
            message="Default chart prepared for sales catalog accounting verification",
            request=req("POST", "/accounting/chart-of-accounts/defaults"),
        )
        db.commit()
        result = sync_accounting(req("POST", "/accounting/sync"), db, tenant)  # type: ignore[arg-type]
        if result.errors:
            raise AssertionError(f"accounting sync errors: {result.errors}")
        journal = db.scalar(select(JournalEntry).where(JournalEntry.organization_id == tenant.organization_id, JournalEntry.source_type == "invoice_issue", JournalEntry.source_id == invoice.id))
        if journal is None:
            raise AssertionError("invoice issue journal missing")
        revenue_rows = db.execute(
            select(LedgerAccount.system_key, JournalLine.credit)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(JournalLine.journal_entry_id == journal.id, LedgerAccount.system_key.in_(["sales_revenue", "service_revenue"]))
        ).all()
        revenue = {key: Decimal(value) for key, value in revenue_rows}
        if revenue.get("sales_revenue") != Decimal("200.00") or revenue.get("service_revenue") != Decimal("200.00"):
            raise AssertionError(f"invoice revenue classification failed: {revenue}")
        debits = db.scalar(select(func.coalesce(func.sum(JournalLine.debit), 0)).where(JournalLine.journal_entry_id == journal.id)) or Decimal("0")
        credits = db.scalar(select(func.coalesce(func.sum(JournalLine.credit), 0)).where(JournalLine.journal_entry_id == journal.id)) or Decimal("0")
        if Decimal(debits) != Decimal(credits):
            raise AssertionError("sales catalog invoice journal is not balanced")

        expect(
            409,
            lambda: change_order_status(
                order.id,
                OrderStatusChange(status="cancelled"),
                req("PATCH", f"/sales/orders/{order.id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        cancelled_invoice = change_invoice_status(
            invoice.id,
            InvoiceStatusAction(action="cancel"),
            req("PATCH", f"/finance/invoices/{invoice.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if cancelled_invoice.status != "cancelled":
            raise AssertionError("invoice cancellation failed")
        reversal = db.scalar(
            select(JournalEntry).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.reversed_entry_id == journal.id,
                JournalEntry.status == "posted",
            )
        )
        if reversal is None:
            raise AssertionError("cancelled issued invoice did not reverse AR/revenue journal")
        reversal_rows = db.execute(
            select(LedgerAccount.system_key, JournalLine.debit, JournalLine.credit)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(JournalLine.journal_entry_id == reversal.id)
        ).all()
        by_key = {key: (Decimal(debit), Decimal(credit)) for key, debit, credit in reversal_rows}
        if by_key.get("accounts_receivable") != (Decimal("0.00"), Decimal("400.00")):
            raise AssertionError(f"invoice cancellation did not credit AR correctly: {by_key}")
        if by_key.get("sales_revenue") != (Decimal("200.00"), Decimal("0.00")):
            raise AssertionError(f"invoice cancellation did not reverse sales revenue correctly: {by_key}")
        if by_key.get("service_revenue") != (Decimal("200.00"), Decimal("0.00")):
            raise AssertionError(f"invoice cancellation did not reverse service revenue correctly: {by_key}")
        reversal_debits = sum(value[0] for value in by_key.values())
        reversal_credits = sum(value[1] for value in by_key.values())
        if reversal_debits != reversal_credits:
            raise AssertionError("invoice cancellation reversal journal is not balanced")

        cancelled_order = change_order_status(
            order.id,
            OrderStatusChange(status="cancelled"),
            req("PATCH", f"/sales/orders/{order.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if cancelled_order.status != "cancelled":
            raise AssertionError("order did not cancel after invoice reversal")
    finally:
        db.close()

    print("sales catalog verification passed: lead -> quotation -> order -> invoice -> revenue split -> invoice reversal -> order cancellation")


if __name__ == "__main__":
    main()
