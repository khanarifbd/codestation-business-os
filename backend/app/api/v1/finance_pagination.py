from __future__ import annotations

import base64
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.finance import _invoice_list_item, _tenant_today
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, Payment
from app.schemas.finance import InvoiceListItem, LedgerTransactionRead, PaymentRead
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance", tags=["Finance Pagination"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]


class InvoiceCursorPage(BaseModel):
    items: list[InvoiceListItem]
    next_cursor: str | None = None


class PaymentCursorPage(BaseModel):
    items: list[PaymentRead]
    next_cursor: str | None = None


class LedgerCursorPage(BaseModel):
    items: list[LedgerTransactionRead]
    next_cursor: str | None = None


def _encode(parts: list[str]) -> str:
    raw = "|".join(parts).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode(cursor: str, expected: int) -> list[str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        parts = base64.urlsafe_b64decode(padded.encode()).decode().split("|")
        if len(parts) != expected:
            raise ValueError
        return parts
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid finance cursor") from exc


@router.get("/invoice-page", response_model=InvoiceCursorPage)
def invoice_page(
    db: DbSession,
    tenant: FinanceViewer,
    search: str | None = None,
    invoice_status: str | None = Query(default=None, alias="status"),
    client_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
) -> InvoiceCursorPage:
    query = select(Invoice).where(Invoice.organization_id == tenant.organization_id)
    if invoice_status and invoice_status != "overdue":
        query = query.where(Invoice.status == invoice_status)
    if client_id:
        query = query.where(Invoice.client_id == client_id)
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(
            Invoice.invoice_number.ilike(needle)
            | Invoice.subject.ilike(needle)
            | Invoice.client_name_snapshot.ilike(needle)
        )
    if invoice_status == "overdue":
        today = _tenant_today(tenant.organization.timezone)
        query = query.where(
            Invoice.status.not_in(["draft", "cancelled", "paid"]),
            Invoice.balance_due > 0,
            Invoice.due_date.is_not(None),
            Invoice.due_date < today,
        )
    if cursor:
        created_raw, row_id = _decode(cursor, 2)
        created_at = datetime.fromisoformat(created_raw)
        query = query.where(
            or_(
                Invoice.created_at < created_at,
                and_(Invoice.created_at == created_at, Invoice.id < row_id),
            )
        )
    rows = list(db.scalars(query.order_by(Invoice.created_at.desc(), Invoice.id.desc()).limit(limit + 1)).all())
    has_more = len(rows) > limit
    items = rows[:limit]
    return InvoiceCursorPage(
        items=[_invoice_list_item(item, tenant.organization.timezone) for item in items],
        next_cursor=_encode([items[-1].created_at.isoformat(), items[-1].id]) if has_more and items else None,
    )


@router.get("/payment-page", response_model=PaymentCursorPage)
def payment_page(
    db: DbSession,
    tenant: FinanceViewer,
    invoice_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
) -> PaymentCursorPage:
    query = (
        select(Payment, Invoice.invoice_number, Invoice.client_name_snapshot, FinancialAccount.name)
        .join(Invoice, Invoice.id == Payment.invoice_id)
        .join(FinancialAccount, FinancialAccount.id == Payment.account_id)
        .where(Payment.organization_id == tenant.organization_id)
    )
    if invoice_id:
        query = query.where(Payment.invoice_id == invoice_id)
    if cursor:
        created_raw, row_id = _decode(cursor, 2)
        created_at = datetime.fromisoformat(created_raw)
        query = query.where(
            or_(
                Payment.created_at < created_at,
                and_(Payment.created_at == created_at, Payment.id < row_id),
            )
        )
    rows = list(db.execute(query.order_by(Payment.created_at.desc(), Payment.id.desc()).limit(limit + 1)).all())
    has_more = len(rows) > limit
    visible = rows[:limit]
    items = [
        PaymentRead(
            id=payment.id,
            payment_number=payment.payment_number,
            invoice_id=payment.invoice_id,
            invoice_number=invoice_number,
            client_name=client_name,
            account_id=payment.account_id,
            account_name=account_name,
            payment_date=payment.payment_date,
            invoice_currency=payment.invoice_currency,
            account_currency=payment.account_currency,
            invoice_amount=payment.invoice_amount,
            account_amount=payment.account_amount,
            exchange_rate=payment.exchange_rate,
            method=payment.method,
            reference=payment.reference,
            notes=payment.notes,
            status=payment.status,
            created_at=payment.created_at,
        )
        for payment, invoice_number, client_name, account_name in visible
    ]
    last_payment = visible[-1][0] if visible else None
    return PaymentCursorPage(
        items=items,
        next_cursor=_encode([last_payment.created_at.isoformat(), last_payment.id]) if has_more and last_payment else None,
    )


@router.get("/accounts/{account_id}/ledger-page", response_model=LedgerCursorPage)
def ledger_page(
    account_id: str,
    db: DbSession,
    tenant: FinanceViewer,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
) -> LedgerCursorPage:
    account = db.scalar(
        select(FinancialAccount).where(
            FinancialAccount.id == account_id,
            FinancialAccount.organization_id == tenant.organization_id,
        )
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Financial account not found")
    query = select(FinancialTransaction).where(
        FinancialTransaction.organization_id == tenant.organization_id,
        FinancialTransaction.account_id == account.id,
    )
    if cursor:
        date_raw, created_raw, row_id = _decode(cursor, 3)
        transaction_date = date.fromisoformat(date_raw)
        created_at = datetime.fromisoformat(created_raw)
        query = query.where(
            or_(
                FinancialTransaction.transaction_date < transaction_date,
                and_(
                    FinancialTransaction.transaction_date == transaction_date,
                    FinancialTransaction.created_at < created_at,
                ),
                and_(
                    FinancialTransaction.transaction_date == transaction_date,
                    FinancialTransaction.created_at == created_at,
                    FinancialTransaction.id < row_id,
                ),
            )
        )
    rows = list(db.scalars(
        query.order_by(
            FinancialTransaction.transaction_date.desc(),
            FinancialTransaction.created_at.desc(),
            FinancialTransaction.id.desc(),
        ).limit(limit + 1)
    ).all())
    has_more = len(rows) > limit
    items = rows[:limit]
    return LedgerCursorPage(
        items=[LedgerTransactionRead.model_validate(item, from_attributes=True) for item in items],
        next_cursor=_encode([items[-1].transaction_date.isoformat(), items[-1].created_at.isoformat(), items[-1].id]) if has_more and items else None,
    )
