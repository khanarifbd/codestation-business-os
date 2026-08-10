from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialTransaction, Invoice, Payment
from app.services.activity_log import record_activity
from app.services.journal_reversal import reverse_source_journal
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/corrections", tags=["Accounting - Corrections"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
CorrectionType = Literal["payment", "expense", "transfer"]


class CorrectionRequest(BaseModel):
    source_type: CorrectionType
    source_id: str
    reason: str = Field(min_length=3, max_length=500)
    reversal_date: date | None = None


def _today(timezone_name: str) -> date:
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _opposite(direction: str) -> str:
    if direction == "credit":
        return "debit"
    if direction == "debit":
        return "credit"
    raise HTTPException(status_code=409, detail=f"Unsupported financial transaction direction: {direction}")


def _mirror_transactions(
    db: DbSession,
    *,
    tenant: TenantContext,
    source_types: list[str],
    source_id: str,
    reversal_source_type: str,
    reversal_date: date,
    reason: str,
) -> int:
    originals = db.scalars(
        select(FinancialTransaction).where(
            FinancialTransaction.organization_id == tenant.organization_id,
            FinancialTransaction.source_id == source_id,
            FinancialTransaction.source_type.in_(source_types),
        )
    ).all()
    if not originals:
        return 0

    count = 0
    for index, original in enumerate(originals):
        suffix = "" if len(originals) == 1 else f"_{index + 1}"
        mapped_type = f"{reversal_source_type}{suffix}"
        if len(mapped_type) > 40:
            mapped_type = mapped_type[:40]
        existing = db.scalar(
            select(FinancialTransaction.id).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.account_id == original.account_id,
                FinancialTransaction.source_type == mapped_type,
                FinancialTransaction.source_id == source_id,
                FinancialTransaction.direction == _opposite(original.direction),
            )
        )
        if existing:
            raise HTTPException(status_code=409, detail="This financial movement was already reversed")
        db.add(
            FinancialTransaction(
                organization_id=tenant.organization_id,
                account_id=original.account_id,
                transaction_date=reversal_date,
                direction=_opposite(original.direction),
                amount=original.amount,
                currency=original.currency,
                source_type=mapped_type,
                source_id=source_id,
                reference=original.reference,
                description=f"Correction reversal: {reason.strip()}",
                created_by_user_id=tenant.user_id,
            )
        )
        count += 1
    db.flush()
    return count


@router.get("/candidates")
def correction_candidates(db: DbSession, tenant: AccountingViewer, limit: int = 100):
    row_limit = min(max(limit, 1), 200)
    payments = db.execute(
        select(Payment, Invoice.invoice_number, Invoice.client_name_snapshot)
        .join(Invoice, Invoice.id == Payment.invoice_id)
        .where(Payment.organization_id == tenant.organization_id, Payment.status == "confirmed")
        .order_by(Payment.payment_date.desc(), Payment.created_at.desc())
        .limit(row_limit)
    ).all()
    expenses = db.scalars(
        select(Expense)
        .where(Expense.organization_id == tenant.organization_id, Expense.status == "posted")
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc())
        .limit(row_limit)
    ).all()
    transfers = db.scalars(
        select(AccountTransfer)
        .where(AccountTransfer.organization_id == tenant.organization_id, AccountTransfer.status == "confirmed")
        .order_by(AccountTransfer.transfer_date.desc(), AccountTransfer.created_at.desc())
        .limit(row_limit)
    ).all()

    items: list[dict] = []
    for payment, invoice_number, client_name in payments:
        items.append({
            "source_type": "payment",
            "source_id": payment.id,
            "number": payment.payment_number,
            "date": payment.payment_date,
            "amount": payment.invoice_amount,
            "currency": payment.invoice_currency,
            "title": f"{payment.payment_number} · {invoice_number}",
            "subtitle": f"Customer payment · {client_name}",
        })
    for expense in expenses:
        items.append({
            "source_type": "expense",
            "source_id": expense.id,
            "number": expense.expense_number,
            "date": expense.expense_date,
            "amount": expense.expense_amount,
            "currency": expense.expense_currency,
            "title": f"{expense.expense_number} · {expense.description}",
            "subtitle": "Posted business expense",
        })
    for transfer in transfers:
        items.append({
            "source_type": "transfer",
            "source_id": transfer.id,
            "number": transfer.transfer_number,
            "date": transfer.transfer_date,
            "amount": transfer.source_amount,
            "currency": transfer.source_currency,
            "title": transfer.transfer_number,
            "subtitle": f"Own-account transfer · {transfer.source_currency} → {transfer.destination_currency}",
        })
    items.sort(key=lambda item: (str(item["date"]), item["number"]), reverse=True)
    return items[:row_limit]


@router.post("/reverse", status_code=status.HTTP_201_CREATED)
def reverse_business_transaction(payload: CorrectionRequest, request: Request, db: DbSession, tenant: AccountingManager):
    reversal_date = payload.reversal_date or _today(tenant.organization.timezone)
    reason = payload.reason.strip()
    journal_source_type: str
    reversed_number: str
    journal = None

    if payload.source_type == "payment":
        payment = db.scalar(
            select(Payment).where(
                Payment.id == payload.source_id,
                Payment.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if payment is None:
            raise HTTPException(status_code=404, detail="Payment not found")
        if payment.status != "confirmed":
            raise HTTPException(status_code=409, detail="Only confirmed payments can be reversed")
        invoice = db.scalar(
            select(Invoice).where(
                Invoice.id == payment.invoice_id,
                Invoice.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if invoice is None:
            raise HTTPException(status_code=409, detail="Payment invoice is no longer available")

        journal_source_type = "invoice_payment"
        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type=journal_source_type,
            source_id=payment.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["payment"],
            source_id=payment.id,
            reversal_source_type="payment_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        payment.status = "reversed"
        invoice.amount_paid = max(Decimal("0"), Decimal(invoice.amount_paid) - Decimal(payment.invoice_amount))
        invoice.balance_due = max(Decimal("0"), Decimal(invoice.total) - Decimal(invoice.amount_paid))
        invoice.paid_at = None
        if invoice.balance_due == 0:
            invoice.status = "paid"
        elif invoice.amount_paid > 0:
            invoice.status = "partially_paid"
        else:
            invoice.status = "sent"
        reversed_number = payment.payment_number

    elif payload.source_type == "expense":
        expense = db.scalar(
            select(Expense).where(
                Expense.id == payload.source_id,
                Expense.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if expense is None:
            raise HTTPException(status_code=404, detail="Expense not found")
        if expense.status != "posted":
            raise HTTPException(status_code=409, detail="Only posted expenses can be reversed")

        journal_source_type = "expense_post"
        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type=journal_source_type,
            source_id=expense.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["expense"],
            source_id=expense.id,
            reversal_source_type="expense_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        expense.status = "voided"
        expense.voided_at = datetime.now(timezone.utc)
        reversed_number = expense.expense_number

    else:
        transfer = db.scalar(
            select(AccountTransfer).where(
                AccountTransfer.id == payload.source_id,
                AccountTransfer.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if transfer is None:
            raise HTTPException(status_code=404, detail="Transfer not found")
        if transfer.status != "confirmed":
            raise HTTPException(status_code=409, detail="Only confirmed transfers can be reversed")

        journal_source_type = "account_transfer"
        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type=journal_source_type,
            source_id=transfer.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["transfer", "transfer_fee"],
            source_id=transfer.id,
            reversal_source_type="transfer_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        transfer.status = "reversed"
        reversed_number = transfer.transfer_number

    db.flush()
    record_activity(
        db,
        action=f"finance.{payload.source_type}.reversed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type=payload.source_type,
        entity_id=payload.source_id,
        before={"status": "posted_or_confirmed"},
        after={
            "status": "reversed",
            "reversal_date": reversal_date.isoformat(),
            "reason": reason,
            "reversal_journal_id": journal.id if journal else None,
        },
        message=f"{payload.source_type.replace('_', ' ').title()} {reversed_number} reversed: {reason}",
        request=request,
    )
    db.commit()
    return {
        "ok": True,
        "source_type": payload.source_type,
        "source_id": payload.source_id,
        "number": reversed_number,
        "reversal_date": reversal_date,
        "reversal_journal_id": journal.id if journal else None,
        "accounting_note": "Accounting journal reversed" if journal else "No posted accounting journal existed; future sync will ignore the reversed source",
    }
