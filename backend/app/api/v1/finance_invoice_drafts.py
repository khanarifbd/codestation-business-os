from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.finance import Invoice, InvoiceItem
from app.services.activity_log import record_activity
from app.services.sales import calculate_line, calculate_totals
from app.services.sales_catalog import resolve_sales_line
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance", tags=["Finance"])
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


class DraftInvoiceItemInput(BaseModel):
    product_id: str | None = None
    item_name: str | None = Field(default=None, max_length=220)
    item_type: Literal["service", "non_stock_item"] = "service"
    unit: str = Field(default="unit", min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=5000)
    quantity: Decimal = Field(gt=0, le=Decimal("100000000"))
    unit_price: Decimal = Field(ge=0, le=Decimal("1000000000000"))
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=1000)


class DraftInvoiceUpdate(BaseModel):
    subject: str | None = Field(default=None, max_length=220)
    issue_date: date
    due_date: date | None = None
    currency: str = Field(min_length=3, max_length=3)
    tax_calculation_mode: Literal["exclusive", "inclusive"] = "exclusive"
    notes: str | None = None
    terms_conditions: str | None = None
    internal_notes: str | None = None
    items: list[DraftInvoiceItemInput] = Field(min_length=1, max_length=200)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


@router.patch("/invoices/{invoice_id}/draft")
def update_draft_invoice(
    invoice_id: str,
    payload: DraftInvoiceUpdate,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
):
    invoice = db.scalar(
        select(Invoice)
        .where(Invoice.id == invoice_id, Invoice.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft invoices can be edited")
    if payload.due_date and payload.due_date < payload.issue_date:
        raise HTTPException(status_code=400, detail="Invoice due date cannot be before issue date")
    next_currency = payload.currency.upper()
    if invoice.order_id and next_currency != invoice.currency:
        raise HTTPException(status_code=409, detail="Order-linked invoice currency cannot be changed")

    previous_items = db.scalars(
        select(InvoiceItem)
        .where(InvoiceItem.organization_id == tenant.organization_id, InvoiceItem.invoice_id == invoice.id)
        .order_by(InvoiceItem.sort_order.asc(), InvoiceItem.created_at.asc())
    ).all()
    if next_currency != invoice.currency and any(item.product_id for item in previous_items):
        if any(source.product_id is None for source in payload.items):
            raise HTTPException(status_code=400, detail="Changing currency on a catalog invoice requires reselecting all catalog items")

    prepared = []
    calculated = []
    for index, source in enumerate(payload.items):
        previous = previous_items[index] if index < len(previous_items) else None
        if source.product_id or source.item_name is not None or previous is None:
            snapshot = resolve_sales_line(
                db,
                organization_id=tenant.organization_id,
                currency=next_currency,
                product_id=source.product_id,
                item_name=source.item_name,
                item_type=source.item_type,
                unit=source.unit,
                description=source.description,
            )
            product_id = snapshot.product_id
            item_name = snapshot.item_name
            sku = snapshot.sku
            item_type = snapshot.item_type
            unit = snapshot.unit
            description = snapshot.description
        else:
            product_id = previous.product_id
            item_name = previous.item_name_snapshot
            sku = previous.sku_snapshot
            item_type = previous.item_type_snapshot
            unit = previous.unit_snapshot
            description = source.description.strip()
        line = calculate_line(
            quantity=source.quantity,
            unit_price=source.unit_price,
            discount_percent=source.discount_percent,
            tax_rate=source.tax_rate,
            tax_calculation_mode=payload.tax_calculation_mode,
        )
        prepared.append((source, previous, product_id, item_name, sku, item_type, unit, description, line))
        calculated.append(line)
    totals = calculate_totals(calculated)
    before = {
        "subject": invoice.subject,
        "issue_date": invoice.issue_date.isoformat(),
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        "currency": invoice.currency,
        "total": str(invoice.total),
        "items": len(previous_items),
    }

    invoice.subject = _clean(payload.subject)
    invoice.issue_date = payload.issue_date
    invoice.due_date = payload.due_date
    invoice.currency = next_currency
    invoice.tax_calculation_mode = payload.tax_calculation_mode
    invoice.subtotal = totals.subtotal
    invoice.discount_total = totals.discount_total
    invoice.tax_total = totals.tax_total
    invoice.total = totals.total
    invoice.balance_due = totals.total
    invoice.notes = _clean(payload.notes)
    invoice.terms_conditions = _clean(payload.terms_conditions)
    invoice.internal_notes = _clean(payload.internal_notes)

    db.execute(
        delete(InvoiceItem).where(
            InvoiceItem.organization_id == tenant.organization_id,
            InvoiceItem.invoice_id == invoice.id,
        )
    )
    for index, (source, previous, product_id, item_name, sku, item_type, unit, description, line) in enumerate(prepared):
        db.add(
            InvoiceItem(
                organization_id=tenant.organization_id,
                invoice_id=invoice.id,
                source_order_item_id=previous.source_order_item_id if previous else None,
                product_id=product_id,
                sort_order=index,
                item_name_snapshot=item_name,
                sku_snapshot=sku,
                item_type_snapshot=item_type,
                unit_snapshot=unit,
                description=description,
                quantity=source.quantity,
                unit_price=source.unit_price,
                discount_percent=source.discount_percent,
                tax_rate=source.tax_rate,
                line_subtotal=line.line_subtotal,
                discount_amount=line.discount_amount,
                taxable_amount=line.taxable_amount,
                tax_amount=line.tax_amount,
                line_total=line.line_total,
            )
        )
    db.flush()
    record_activity(
        db,
        action="finance.invoice.draft_updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="invoice",
        entity_id=invoice.id,
        before=before,
        after={
            "subject": invoice.subject,
            "issue_date": invoice.issue_date.isoformat(),
            "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
            "currency": invoice.currency,
            "total": str(invoice.total),
            "items": len(payload.items),
        },
        message=f"Draft invoice {invoice.invoice_number} updated",
        request=request,
    )
    db.commit()
    return {"id": invoice.id, "invoice_number": invoice.invoice_number, "status": invoice.status, "total": str(invoice.total)}
