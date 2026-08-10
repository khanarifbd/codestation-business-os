from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import DbSession
from app.api.v1.finance import FinanceManager, _payment_read, record_payment
from app.api.v1.finance_expenses import _expense_detail, create_expense
from app.api.v1.finance_transfers import _transfer_read, record_transfer
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialAccount, Payment
from app.schemas.expenses import ExpenseCreate, ExpenseDetail
from app.schemas.finance import AccountTransferCreate, AccountTransferRead, PaymentCreate, PaymentRead
from app.services.posting_idempotency import complete_posting, completed_resource, reserve_posting

router = APIRouter(prefix="/finance", tags=["Financial Safety"])


@router.post("/payments", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
def safe_record_payment(payload: PaymentCreate, request: Request, db: DbSession, tenant: FinanceManager):
    guard, reused = reserve_posting(
        db,
        request,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        action="finance.payment.record",
        payload=payload,
    )
    if reused:
        resource_id = completed_resource(guard, "payment")
        payment = db.scalar(
            select(Payment).where(
                Payment.id == resource_id,
                Payment.organization_id == tenant.organization_id,
            )
        )
        if payment is None:
            raise HTTPException(status_code=409, detail="The original payment result is no longer available")
        return _payment_read(db, payment)

    result = record_payment(payload, request, db, tenant)
    complete_posting(db, guard, resource_type="payment", resource_id=result.id)
    return result


@router.post("/expenses", response_model=ExpenseDetail, status_code=status.HTTP_201_CREATED)
def safe_create_expense(payload: ExpenseCreate, request: Request, db: DbSession, tenant: FinanceManager):
    guard, reused = reserve_posting(
        db,
        request,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        action="finance.expense.create",
        payload=payload,
    )
    if reused:
        resource_id = completed_resource(guard, "expense")
        expense = db.scalar(
            select(Expense).where(
                Expense.id == resource_id,
                Expense.organization_id == tenant.organization_id,
            )
        )
        if expense is None:
            raise HTTPException(status_code=409, detail="The original expense result is no longer available")
        return _expense_detail(db, tenant.organization_id, expense.id)

    result = create_expense(payload, request, db, tenant)
    complete_posting(db, guard, resource_type="expense", resource_id=result.id)
    return result


@router.post("/transfers", response_model=AccountTransferRead, status_code=status.HTTP_201_CREATED)
def safe_record_transfer(payload: AccountTransferCreate, request: Request, db: DbSession, tenant: FinanceManager):
    guard, reused = reserve_posting(
        db,
        request,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        action="finance.transfer.record",
        payload=payload,
    )
    if reused:
        resource_id = completed_resource(guard, "account_transfer")
        transfer = db.scalar(
            select(AccountTransfer).where(
                AccountTransfer.id == resource_id,
                AccountTransfer.organization_id == tenant.organization_id,
            )
        )
        if transfer is None:
            raise HTTPException(status_code=409, detail="The original transfer result is no longer available")
        source_name = db.scalar(select(FinancialAccount.name).where(FinancialAccount.id == transfer.from_account_id))
        destination_name = db.scalar(select(FinancialAccount.name).where(FinancialAccount.id == transfer.to_account_id))
        return _transfer_read(transfer, source_name, destination_name)

    result = record_transfer(payload, request, db, tenant)
    complete_posting(db, guard, resource_type="account_transfer", resource_id=result.id)
    return result
