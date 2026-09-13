from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import DbSession
from app.api.v1.accounting_loans import (
    AccountingManager,
    LoanAccountingRepaymentCreate,
    LoanDisbursementCreate,
    _loan_json,
    disburse_loan,
    repay_loan,
)
from app.api.v1.finance import FinanceManager, _payment_read, record_payment
from app.api.v1.finance_expenses import _expense_detail, create_expense
from app.api.v1.finance_transfers import _transfer_read, record_transfer
from app.api.v1.payables import pay_payable_bill
from app.models.accounting import JournalEntry
from app.models.capital import CompanyLoan, LoanRepayment
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialAccount, Payment
from app.models.loan_accounting import LoanDisbursement
from app.models.payables import PayablePayment
from app.schemas.expenses import ExpenseCreate, ExpenseDetail
from app.schemas.finance import AccountTransferCreate, AccountTransferRead, PaymentCreate, PaymentRead
from app.schemas.payables import PayablePaymentCreate, PayablePaymentRead
from app.services.accounting_posting import money
from app.services.posting_idempotency import complete_posting, completed_resource, reserve_posting

router = APIRouter(tags=["Financial Safety"])


def _journal_for_source(db: DbSession, organization_id: str, source_type: str, source_id: str) -> JournalEntry:
    journal = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
        )
    )
    if journal is None:
        raise HTTPException(status_code=409, detail="The original accounting journal is no longer available")
    return journal


@router.post("/finance/payments", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
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


@router.post("/finance/expenses", response_model=ExpenseDetail, status_code=status.HTTP_201_CREATED)
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


@router.post("/finance/transfers", response_model=AccountTransferRead, status_code=status.HTTP_201_CREATED)
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


@router.post(
    "/accounting/payables/{bill_id}/payments",
    response_model=PayablePaymentRead,
    status_code=status.HTTP_201_CREATED,
)
def safe_pay_payable_bill(
    bill_id: str,
    payload: PayablePaymentCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    guard, reused = reserve_posting(
        db,
        request,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        action="accounting.payable.payment.create",
        payload={"bill_id": bill_id, "payload": payload.model_dump(mode="json")},
    )
    if reused:
        resource_id = completed_resource(guard, "payable_payment")
        payment = db.scalar(
            select(PayablePayment).where(
                PayablePayment.id == resource_id,
                PayablePayment.organization_id == tenant.organization_id,
                PayablePayment.bill_id == bill_id,
            )
        )
        if payment is None:
            raise HTTPException(status_code=409, detail="The original payable payment result is no longer available")
        account_name = db.scalar(
            select(FinancialAccount.name).where(
                FinancialAccount.id == payment.financial_account_id,
                FinancialAccount.organization_id == tenant.organization_id,
            )
        )
        if account_name is None:
            raise HTTPException(status_code=409, detail="The original payable payment account is no longer available")
        return PayablePaymentRead(
            id=payment.id,
            bill_id=payment.bill_id,
            financial_account_id=payment.financial_account_id,
            financial_account_name=account_name,
            payment_date=payment.payment_date,
            currency=payment.currency,
            amount=payment.amount,
            reference=payment.reference,
            notes=payment.notes,
            created_at=payment.created_at,
        )

    result = pay_payable_bill(bill_id, payload, request, db, tenant)
    complete_posting(db, guard, resource_type="payable_payment", resource_id=result.id)
    return result


@router.post("/accounting/loans/{loan_id}/disburse", status_code=status.HTTP_201_CREATED)
def safe_disburse_loan(
    loan_id: str,
    payload: LoanDisbursementCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    guard, reused = reserve_posting(
        db,
        request,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        action="accounting.loan.disburse",
        payload={"loan_id": loan_id, "payload": payload.model_dump(mode="json")},
    )
    if reused:
        resource_id = completed_resource(guard, "loan_disbursement")
        item = db.scalar(
            select(LoanDisbursement).where(
                LoanDisbursement.id == resource_id,
                LoanDisbursement.organization_id == tenant.organization_id,
                LoanDisbursement.loan_id == loan_id,
            )
        )
        loan = db.scalar(
            select(CompanyLoan).where(
                CompanyLoan.id == loan_id,
                CompanyLoan.organization_id == tenant.organization_id,
            )
        )
        if item is None or loan is None:
            raise HTTPException(status_code=409, detail="The original loan disbursement result is no longer available")
        journal = _journal_for_source(db, tenant.organization_id, "loan_disbursement", item.id)
        return {
            "id": item.id,
            "loan": _loan_json(db, loan),
            "principal_amount": item.principal_amount,
            "fee_withheld_amount": item.fee_withheld_amount,
            "net_received_amount": item.net_received_amount,
            "journal_entry_id": journal.id,
        }

    result = disburse_loan(loan_id, payload, request, db, tenant)
    complete_posting(db, guard, resource_type="loan_disbursement", resource_id=result["id"])
    return result


@router.post("/accounting/loans/{loan_id}/repay", status_code=status.HTTP_201_CREATED)
def safe_repay_loan(
    loan_id: str,
    payload: LoanAccountingRepaymentCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    guard, reused = reserve_posting(
        db,
        request,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        action="accounting.loan.repay",
        payload={"loan_id": loan_id, "payload": payload.model_dump(mode="json")},
    )
    if reused:
        resource_id = completed_resource(guard, "loan_repayment")
        repayment = db.scalar(
            select(LoanRepayment).where(
                LoanRepayment.id == resource_id,
                LoanRepayment.organization_id == tenant.organization_id,
                LoanRepayment.loan_id == loan_id,
            )
        )
        loan = db.scalar(
            select(CompanyLoan).where(
                CompanyLoan.id == loan_id,
                CompanyLoan.organization_id == tenant.organization_id,
            )
        )
        if repayment is None or loan is None:
            raise HTTPException(status_code=409, detail="The original loan repayment result is no longer available")
        journal = _journal_for_source(db, tenant.organization_id, "loan_repayment_accounting", repayment.id)
        fee = money(Decimal(payload.fee_amount))
        return {
            "id": repayment.id,
            "loan": _loan_json(db, loan),
            "principal_amount": repayment.principal_amount,
            "interest_amount": repayment.interest_amount,
            "fee_amount": fee,
            "cash_paid": money(Decimal(repayment.principal_amount) + Decimal(repayment.interest_amount) + fee),
            "journal_entry_id": journal.id,
        }

    result = repay_loan(loan_id, payload, request, db, tenant)
    complete_posting(db, guard, resource_type="loan_repayment", resource_id=result["id"])
    return result
