from __future__ import annotations

import base64
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.finance import _tenant_today
from app.models.accounting import LedgerAccount
from app.models.payables import PayableBill
from app.schemas.payables import PayableBillRead
from app.tenancy.context import TenantContext

router = APIRouter(tags=["Accounting - Payables Workspace"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
PayableStatusFilter = Literal["all", "open", "overdue", "partial", "paid"]
PayableAgingBucket = Literal["current", "1-30", "31-60", "61-90", "90+"]


class CurrencyAmount(BaseModel):
    currency: str
    amount: Decimal


class PayableAgingTotal(BaseModel):
    bucket: PayableAgingBucket
    currency: str
    amount: Decimal


class PayablesWorkspacePage(BaseModel):
    items: list[PayableBillRead]
    next_cursor: str | None = None
    open_bill_count: int
    overdue_count: int
    filtered_count: int
    outstanding_by_currency: list[CurrencyAmount]
    aging: list[PayableAgingTotal]


def _encode_cursor(created_at: datetime, row_id: str) -> str:
    raw = f"{created_at.isoformat()}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        created_raw, row_id = base64.urlsafe_b64decode(padded.encode()).decode().split("|", 1)
        return datetime.fromisoformat(created_raw), row_id
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid payables cursor") from exc


def _bill_read(bill: PayableBill, expense_name: str) -> PayableBillRead:
    return PayableBillRead(
        id=bill.id,
        bill_number=bill.bill_number,
        supplier_name=bill.supplier_name,
        bill_date=bill.bill_date,
        due_date=bill.due_date,
        currency=bill.currency,
        subtotal_amount=bill.subtotal_amount,
        tax_code_id=bill.tax_code_id,
        tax_rate_snapshot=bill.tax_rate_snapshot,
        input_tax_amount=bill.input_tax_amount,
        recoverable_tax_amount=bill.recoverable_tax_amount,
        withholding_tax_code_id=bill.withholding_tax_code_id,
        withholding_rate_snapshot=bill.withholding_rate_snapshot,
        withholding_tax_amount=bill.withholding_tax_amount,
        original_amount=bill.original_amount,
        net_payable_amount=bill.net_payable_amount,
        amount_paid=bill.amount_paid,
        balance_due=bill.balance_due,
        expense_ledger_account_id=bill.expense_ledger_account_id,
        expense_ledger_account_name=expense_name,
        description=bill.description,
        reference=bill.reference,
        notes=bill.notes,
        status=bill.status,
        created_at=bill.created_at,
    )


@router.get("/workspace", response_model=PayablesWorkspacePage)
def payables_workspace(
    db: DbSession,
    tenant: AccountingViewer,
    search: str | None = None,
    status_filter: PayableStatusFilter = Query(default="open", alias="status"),
    currency: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
) -> PayablesWorkspacePage:
    org_id = tenant.organization_id
    today = _tenant_today(tenant.organization.timezone)
    open_condition = PayableBill.balance_due > 0

    counts = db.execute(
        select(
            func.count(PayableBill.id),
            func.count(PayableBill.id).filter(
                PayableBill.due_date.is_not(None),
                PayableBill.due_date < today,
            ),
        ).where(PayableBill.organization_id == org_id, open_condition)
    ).one()

    outstanding_rows = db.execute(
        select(PayableBill.currency, func.coalesce(func.sum(PayableBill.balance_due), 0))
        .where(PayableBill.organization_id == org_id, open_condition)
        .group_by(PayableBill.currency)
        .order_by(PayableBill.currency)
    ).all()

    aging_bucket = case(
        (PayableBill.due_date.is_(None), "current"),
        (PayableBill.due_date >= today, "current"),
        (PayableBill.due_date >= today - timedelta(days=30), "1-30"),
        (PayableBill.due_date >= today - timedelta(days=60), "31-60"),
        (PayableBill.due_date >= today - timedelta(days=90), "61-90"),
        else_="90+",
    ).label("aging_bucket")
    aging_rows = db.execute(
        select(
            aging_bucket,
            PayableBill.currency,
            func.coalesce(func.sum(PayableBill.balance_due), 0),
        )
        .where(PayableBill.organization_id == org_id, open_condition)
        .group_by(aging_bucket, PayableBill.currency)
        .order_by(aging_bucket, PayableBill.currency)
    ).all()

    conditions = [PayableBill.organization_id == org_id]
    if status_filter == "open":
        conditions.append(PayableBill.balance_due > 0)
    elif status_filter == "overdue":
        conditions.extend(
            [
                PayableBill.balance_due > 0,
                PayableBill.due_date.is_not(None),
                PayableBill.due_date < today,
            ]
        )
    elif status_filter == "partial":
        conditions.extend([PayableBill.amount_paid > 0, PayableBill.balance_due > 0])
    elif status_filter == "paid":
        conditions.append(PayableBill.balance_due <= 0)
    if currency:
        conditions.append(PayableBill.currency == currency.upper())
    if search and search.strip():
        needle = f"%{search.strip()}%"
        conditions.append(
            or_(
                PayableBill.bill_number.ilike(needle),
                PayableBill.supplier_name.ilike(needle),
                PayableBill.description.ilike(needle),
                PayableBill.reference.ilike(needle),
            )
        )

    filtered_count = int(db.scalar(select(func.count(PayableBill.id)).where(*conditions)) or 0)

    item_query = (
        select(PayableBill, LedgerAccount.name)
        .join(
            LedgerAccount,
            and_(
                LedgerAccount.id == PayableBill.expense_ledger_account_id,
                LedgerAccount.organization_id == org_id,
            ),
        )
        .where(*conditions)
    )
    if cursor:
        created_at, row_id = _decode_cursor(cursor)
        item_query = item_query.where(
            or_(
                PayableBill.created_at < created_at,
                and_(PayableBill.created_at == created_at, PayableBill.id < row_id),
            )
        )

    rows = list(
        db.execute(
            item_query.order_by(PayableBill.created_at.desc(), PayableBill.id.desc()).limit(limit + 1)
        ).all()
    )
    has_more = len(rows) > limit
    visible = rows[:limit]
    items = [_bill_read(bill, expense_name) for bill, expense_name in visible]
    last_bill = visible[-1][0] if visible else None

    return PayablesWorkspacePage(
        items=items,
        next_cursor=_encode_cursor(last_bill.created_at, last_bill.id) if has_more and last_bill else None,
        open_bill_count=int(counts[0] or 0),
        overdue_count=int(counts[1] or 0),
        filtered_count=filtered_count,
        outstanding_by_currency=[
            CurrencyAmount(currency=code, amount=Decimal(amount or 0))
            for code, amount in outstanding_rows
        ],
        aging=[
            PayableAgingTotal(bucket=bucket, currency=code, amount=Decimal(amount or 0))
            for bucket, code, amount in aging_rows
        ],
    )


@router.get("/{bill_id}", response_model=PayableBillRead)
def payable_detail(bill_id: str, db: DbSession, tenant: AccountingViewer) -> PayableBillRead:
    row = db.execute(
        select(PayableBill, LedgerAccount.name)
        .join(
            LedgerAccount,
            and_(
                LedgerAccount.id == PayableBill.expense_ledger_account_id,
                LedgerAccount.organization_id == tenant.organization_id,
            ),
        )
        .where(
            PayableBill.id == bill_id,
            PayableBill.organization_id == tenant.organization_id,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Payable bill not found")
    bill, expense_name = row
    return _bill_read(bill, expense_name)
