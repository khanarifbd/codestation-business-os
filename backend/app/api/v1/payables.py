from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import LedgerAccount
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.payables import PayableBill, PayablePayment
from app.schemas.payables import PayableBillCreate, PayableBillRead, PayablePaymentCreate, PayablePaymentRead
from app.services.accounting_posting import PostingLine, financial_ledger_account, post_journal, system_account
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/payables", tags=["Accounting"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _financial_balance(db: DbSession, account: FinancialAccount) -> Decimal:
    net = db.scalar(
        select(func.coalesce(func.sum(case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)), 0)).where(
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
        )
    ) or Decimal("0")
    return _money(Decimal(account.opening_balance) + Decimal(net))


def _bill_read(db: DbSession, organization_id: str, bill: PayableBill) -> PayableBillRead:
    category_name = db.scalar(
        select(LedgerAccount.name).where(
            LedgerAccount.id == bill.expense_ledger_account_id,
            LedgerAccount.organization_id == organization_id,
        )
    ) or "—"
    return PayableBillRead(
        id=bill.id,
        bill_number=bill.bill_number,
        supplier_name=bill.supplier_name,
        bill_date=bill.bill_date,
        due_date=bill.due_date,
        currency=bill.currency,
        original_amount=bill.original_amount,
        amount_paid=bill.amount_paid,
        balance_due=bill.balance_due,
        expense_ledger_account_id=bill.expense_ledger_account_id,
        expense_ledger_account_name=category_name,
        description=bill.description,
        reference=bill.reference,
        notes=bill.notes,
        status=bill.status,
        created_at=bill.created_at,
    )


@router.get("", response_model=list[PayableBillRead])
def list_payable_bills(db: DbSession, tenant: AccountingViewer, include_paid: bool = False, limit: int = 200):
    query = select(PayableBill).where(PayableBill.organization_id == tenant.organization_id)
    if not include_paid:
        query = query.where(PayableBill.balance_due > 0)
    rows = db.scalars(query.order_by(PayableBill.due_date.asc().nulls_last(), PayableBill.bill_date.desc()).limit(min(max(limit, 1), 500))).all()
    return [_bill_read(db, tenant.organization_id, item) for item in rows]


@router.post("", response_model=PayableBillRead, status_code=status.HTTP_201_CREATED)
def create_payable_bill(payload: PayableBillCreate, request: Request, db: DbSession, tenant: AccountingManager):
    expense = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.id == payload.expense_ledger_account_id,
            LedgerAccount.organization_id == tenant.organization_id,
            LedgerAccount.category == "expense",
            LedgerAccount.is_active.is_(True),
        )
    )
    if expense is None:
        raise HTTPException(status_code=404, detail="Active expense category not found")
    if payload.due_date and payload.due_date < payload.bill_date:
        raise HTTPException(status_code=400, detail="Due date cannot be before bill date")

    amount = _money(payload.amount)
    bill = PayableBill(
        organization_id=tenant.organization_id,
        bill_number=f"BILL-{payload.bill_date.strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}",
        supplier_name=payload.supplier_name.strip(),
        bill_date=payload.bill_date,
        due_date=payload.due_date,
        currency=payload.currency.upper(),
        original_amount=amount,
        amount_paid=Decimal("0"),
        balance_due=amount,
        expense_ledger_account_id=expense.id,
        description=payload.description.strip(),
        reference=_clean(payload.reference),
        notes=_clean(payload.notes),
        status="open",
        created_by_user_id=tenant.user_id,
    )
    db.add(bill)
    db.flush()

    payable = system_account(db, tenant.organization_id, "accounts_payable")
    post_journal(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        entry_date=bill.bill_date,
        source_type="payable_bill",
        source_id=bill.id,
        lines=[
            PostingLine(ledger_account_id=expense.id, debit=amount, currency=bill.currency, description=bill.description),
            PostingLine(ledger_account_id=payable.id, credit=amount, currency=bill.currency, description=f"Payable to {bill.supplier_name}"),
        ],
        reference=bill.reference,
        memo=bill.description,
    )
    record_activity(
        db,
        action="accounting.payable.bill_created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="payable_bill",
        entity_id=bill.id,
        after={"supplier_name": bill.supplier_name, "amount": str(amount), "currency": bill.currency, "balance_due": str(amount)},
        message=f"Vendor bill recorded: {bill.bill_number} — {bill.currency} {amount}",
        request=request,
    )
    db.commit()
    db.refresh(bill)
    return _bill_read(db, tenant.organization_id, bill)


@router.get("/{bill_id}/payments", response_model=list[PayablePaymentRead])
def list_payable_payments(bill_id: str, db: DbSession, tenant: AccountingViewer):
    bill = db.scalar(select(PayableBill).where(PayableBill.id == bill_id, PayableBill.organization_id == tenant.organization_id))
    if bill is None:
        raise HTTPException(status_code=404, detail="Payable bill not found")
    rows = db.execute(
        select(PayablePayment, FinancialAccount.name)
        .join(FinancialAccount, FinancialAccount.id == PayablePayment.financial_account_id)
        .where(PayablePayment.organization_id == tenant.organization_id, PayablePayment.bill_id == bill.id)
        .order_by(PayablePayment.payment_date.desc(), PayablePayment.created_at.desc())
    ).all()
    return [
        PayablePaymentRead(
            id=item.id,
            bill_id=item.bill_id,
            financial_account_id=item.financial_account_id,
            financial_account_name=account_name,
            payment_date=item.payment_date,
            currency=item.currency,
            amount=item.amount,
            reference=item.reference,
            notes=item.notes,
            created_at=item.created_at,
        )
        for item, account_name in rows
    ]


@router.post("/{bill_id}/payments", response_model=PayablePaymentRead, status_code=status.HTTP_201_CREATED)
def pay_payable_bill(bill_id: str, payload: PayablePaymentCreate, request: Request, db: DbSession, tenant: AccountingManager):
    bill = db.scalar(
        select(PayableBill).where(
            PayableBill.id == bill_id,
            PayableBill.organization_id == tenant.organization_id,
        ).with_for_update()
    )
    if bill is None:
        raise HTTPException(status_code=404, detail="Payable bill not found")
    amount = _money(payload.amount)
    if amount > _money(bill.balance_due):
        raise HTTPException(status_code=400, detail="Payment cannot exceed the remaining payable balance")

    financial, financial_ledger = financial_ledger_account(db, tenant.organization_id, payload.financial_account_id)
    if financial.currency != bill.currency:
        raise HTTPException(status_code=400, detail="For simple payable payments, choose an account with the same currency as the bill")
    if financial.account_type != "credit_card" and _financial_balance(db, financial) < amount:
        raise HTTPException(status_code=409, detail="Selected account does not have enough balance")

    payment = PayablePayment(
        organization_id=tenant.organization_id,
        bill_id=bill.id,
        financial_account_id=financial.id,
        payment_date=payload.payment_date,
        currency=bill.currency,
        amount=amount,
        reference=_clean(payload.reference),
        notes=_clean(payload.notes),
        created_by_user_id=tenant.user_id,
    )
    db.add(payment)
    db.flush()

    payable = system_account(db, tenant.organization_id, "accounts_payable")
    post_journal(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        entry_date=payment.payment_date,
        source_type="payable_payment",
        source_id=payment.id,
        lines=[
            PostingLine(ledger_account_id=payable.id, debit=amount, currency=bill.currency, description=f"Payment to {bill.supplier_name}"),
            PostingLine(ledger_account_id=financial_ledger.id, credit=amount, currency=bill.currency, description=bill.description),
        ],
        reference=payment.reference,
        memo=f"Payment for {bill.bill_number}",
    )
    db.add(
        FinancialTransaction(
            organization_id=tenant.organization_id,
            account_id=financial.id,
            transaction_date=payment.payment_date,
            direction="credit" if financial.account_type == "credit_card" else "debit",
            amount=amount,
            currency=bill.currency,
            source_type="payable_payment",
            source_id=payment.id,
            reference=payment.reference,
            description=f"Payment to {bill.supplier_name}: {bill.description}",
            created_by_user_id=tenant.user_id,
        )
    )

    bill.amount_paid = _money(Decimal(bill.amount_paid) + amount)
    bill.balance_due = _money(Decimal(bill.original_amount) - Decimal(bill.amount_paid))
    bill.status = "paid" if bill.balance_due == 0 else "partially_paid"
    db.flush()
    record_activity(
        db,
        action="accounting.payable.payment_created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="payable_payment",
        entity_id=payment.id,
        after={"bill_id": bill.id, "amount": str(amount), "currency": bill.currency, "remaining": str(bill.balance_due), "account_id": financial.id},
        message=f"Payable payment recorded: {bill.currency} {amount} to {bill.supplier_name}",
        request=request,
    )
    db.commit()
    db.refresh(payment)
    return PayablePaymentRead(
        id=payment.id,
        bill_id=payment.bill_id,
        financial_account_id=payment.financial_account_id,
        financial_account_name=financial.name,
        payment_date=payment.payment_date,
        currency=payment.currency,
        amount=payment.amount,
        reference=payment.reference,
        notes=payment.notes,
        created_at=payment.created_at,
    )
