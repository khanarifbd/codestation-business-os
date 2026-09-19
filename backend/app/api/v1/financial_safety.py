from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import DbSession
from app.api.v1.accounting_money import _read as _money_entry_read, create_money_entry
from app.api.v1.accounting_loans import (
    AccountingManager,
    LoanAccountingRepaymentCreate,
    LoanDisbursementCreate,
    _loan_json,
    disburse_loan,
    repay_loan,
)
from app.api.v1.finance import (
    FinanceManager,
    _payment_read,
    _tenant_today,
    change_invoice_status,
    create_account,
    record_payment,
)
from app.api.v1.finance_expenses import _expense_detail, create_expense, void_expense
from app.api.v1.finance_transfers import _transfer_read, record_transfer
from app.api.v1.payables import pay_payable_bill
from app.db.session import defer_commits
from app.models.accounting import JournalEntry
from app.models.accounting_money import AccountingMoneyEntry
from app.models.capital import CompanyLoan, LoanRepayment
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialAccount, Invoice, Payment
from app.models.loan_accounting import LoanDisbursement
from app.models.payables import PayablePayment
from app.schemas.accounting_loans import LoanDisbursementRead, LoanRepaymentRead
from app.schemas.accounting_money import AccountingMoneyEntryCreate, AccountingMoneyEntryRead
from app.schemas.expenses import ExpenseCreate, ExpenseDetail
from app.schemas.finance import (
    AccountTransferCreate,
    AccountTransferRead,
    FinancialAccountCreate,
    FinancialAccountRead,
    InvoiceDetail,
    InvoiceStatusAction,
    PaymentCreate,
    PaymentRead,
)
from app.schemas.payables import PayablePaymentCreate, PayablePaymentRead
from app.services.accounting_posting import money
from app.services.journal_reversal import reverse_source_journal
from app.services.operational_posting import (
    post_expense,
    post_financial_account_opening,
    post_invoice_issue,
    post_invoice_payment,
    post_transfer,
)
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


def _tenant_account(db: DbSession, organization_id: str, account_id: str) -> FinancialAccount:
    account = db.scalar(
        select(FinancialAccount).where(
            FinancialAccount.id == account_id,
            FinancialAccount.organization_id == organization_id,
        )
    )
    if account is None:
        raise HTTPException(status_code=409, detail="Financial account is no longer available")
    return account


@router.post("/accounting/money", response_model=AccountingMoneyEntryRead, status_code=status.HTTP_201_CREATED)
def safe_create_money_entry(
    payload: AccountingMoneyEntryCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    with defer_commits(db):
        guard, reused = reserve_posting(
            db,
            request,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            action=f"accounting.money.{payload.kind}.create",
            payload=payload,
        )
        if reused:
            resource_id = completed_resource(guard, "accounting_money_entry")
            item = db.scalar(
                select(AccountingMoneyEntry).where(
                    AccountingMoneyEntry.id == resource_id,
                    AccountingMoneyEntry.organization_id == tenant.organization_id,
                )
            )
            if item is None:
                raise HTTPException(status_code=409, detail="The original money entry result is no longer available")
            return _money_entry_read(db, tenant.organization_id, item)

        result = create_money_entry(payload, request, db, tenant)
        complete_posting(db, guard, resource_type="accounting_money_entry", resource_id=result.id)
    db.commit()
    return result


@router.post("/finance/accounts", response_model=FinancialAccountRead, status_code=status.HTTP_201_CREATED)
def safe_create_account(payload: FinancialAccountCreate, request: Request, db: DbSession, tenant: FinanceManager):
    with defer_commits(db):
        result = create_account(payload, request, db, tenant)
        account = _tenant_account(db, tenant.organization_id, result.id)
        if account.account_type == "credit_card" and Decimal(account.opening_balance) < 0:
            raise HTTPException(status_code=400, detail="Credit card opening balance must be zero or a positive amount currently owed")
        post_financial_account_opening(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            account=account,
            entry_date=_tenant_today(tenant.organization.timezone),
        )
    db.commit()
    return result


@router.patch("/finance/invoices/{invoice_id}/status", response_model=InvoiceDetail)
def safe_change_invoice_status(
    invoice_id: str,
    payload: InvoiceStatusAction,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
):
    with defer_commits(db):
        result = change_invoice_status(invoice_id, payload, request, db, tenant)
        invoice = db.scalar(
            select(Invoice).where(
                Invoice.id == result.id,
                Invoice.organization_id == tenant.organization_id,
            )
        )
        if invoice is None:
            raise HTTPException(status_code=409, detail="Invoice is no longer available")
        if payload.action == "send":
            post_invoice_issue(
                db,
                organization_id=tenant.organization_id,
                user_id=tenant.user_id,
                invoice=invoice,
            )
    db.commit()
    return result


@router.post("/finance/payments", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
def safe_record_payment(payload: PaymentCreate, request: Request, db: DbSession, tenant: FinanceManager):
    with defer_commits(db):
        payment_account = _tenant_account(db, tenant.organization_id, payload.account_id)
        if payment_account.account_type == "credit_card":
            raise HTTPException(status_code=400, detail="Customer payments cannot be received into a credit card account")
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
        payment = db.scalar(
            select(Payment).where(
                Payment.id == result.id,
                Payment.organization_id == tenant.organization_id,
            )
        )
        if payment is None:
            raise HTTPException(status_code=409, detail="Payment was not persisted")
        post_invoice_payment(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            payment=payment,
        )
        complete_posting(db, guard, resource_type="payment", resource_id=result.id)
    db.commit()
    return result


@router.post("/finance/expenses", response_model=ExpenseDetail, status_code=status.HTTP_201_CREATED)
def safe_create_expense(payload: ExpenseCreate, request: Request, db: DbSession, tenant: FinanceManager):
    with defer_commits(db):
        expense_account = _tenant_account(db, tenant.organization_id, payload.account_id)
        if expense_account.account_type == "credit_card":
            raise HTTPException(
                status_code=400,
                detail=(
                    "This expense workflow cannot safely post credit-card liability movements yet. "
                    "Use Money Out for credit-card spending until the dedicated card workflow is enabled."
                ),
            )
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
        expense = db.scalar(
            select(Expense).where(
                Expense.id == result.id,
                Expense.organization_id == tenant.organization_id,
            )
        )
        if expense is None:
            raise HTTPException(status_code=409, detail="Expense was not persisted")
        post_expense(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            expense=expense,
        )
        complete_posting(db, guard, resource_type="expense", resource_id=result.id)
    db.commit()
    return result


@router.post("/finance/expenses/{expense_id}/void", response_model=ExpenseDetail)
def safe_void_expense(expense_id: str, request: Request, db: DbSession, tenant: FinanceManager):
    with defer_commits(db):
        expense = db.scalar(
            select(Expense).where(
                Expense.id == expense_id,
                Expense.organization_id == tenant.organization_id,
            )
        )
        if expense is None:
            raise HTTPException(status_code=404, detail="Expense not found")
        post_expense(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            expense=expense,
        )
        result = void_expense(expense_id, request, db, tenant)
        reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="expense_post",
            source_id=expense.id,
            reversal_date=_tenant_today(tenant.organization.timezone),
            reason=f"Expense {expense.expense_number} voided",
        )
    db.commit()
    return result


@router.post("/finance/transfers", response_model=AccountTransferRead, status_code=status.HTTP_201_CREATED)
def safe_record_transfer(payload: AccountTransferCreate, request: Request, db: DbSession, tenant: FinanceManager):
    with defer_commits(db):
        source_account = _tenant_account(db, tenant.organization_id, payload.from_account_id)
        destination_account = _tenant_account(db, tenant.organization_id, payload.to_account_id)
        if source_account.account_type == "credit_card" or destination_account.account_type == "credit_card":
            raise HTTPException(
                status_code=400,
                detail=(
                    "Credit card settlement is not an account transfer. "
                    "Use a dedicated card payment/expense workflow so the liability direction remains correct."
                ),
            )
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
            source_name = db.scalar(
                select(FinancialAccount.name).where(
                    FinancialAccount.id == transfer.from_account_id,
                    FinancialAccount.organization_id == tenant.organization_id,
                )
            )
            destination_name = db.scalar(
                select(FinancialAccount.name).where(
                    FinancialAccount.id == transfer.to_account_id,
                    FinancialAccount.organization_id == tenant.organization_id,
                )
            )
            return _transfer_read(transfer, source_name, destination_name)

        result = record_transfer(payload, request, db, tenant)
        transfer = db.scalar(
            select(AccountTransfer).where(
                AccountTransfer.id == result.id,
                AccountTransfer.organization_id == tenant.organization_id,
            )
        )
        if transfer is None:
            raise HTTPException(status_code=409, detail="Transfer was not persisted")
        post_transfer(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            transfer=transfer,
        )
        complete_posting(db, guard, resource_type="account_transfer", resource_id=result.id)
    db.commit()
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
    with defer_commits(db):
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
    db.commit()
    return result


@router.post(
    "/accounting/loans/{loan_id}/disburse",
    response_model=LoanDisbursementRead,
    status_code=status.HTTP_201_CREATED,
)
def safe_disburse_loan(
    loan_id: str,
    payload: LoanDisbursementCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    with defer_commits(db):
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
    db.commit()
    return result


@router.post(
    "/accounting/loans/{loan_id}/repay",
    response_model=LoanRepaymentRead,
    status_code=status.HTTP_201_CREATED,
)
def safe_repay_loan(
    loan_id: str,
    payload: LoanAccountingRepaymentCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    with defer_commits(db):
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
    db.commit()
    return result
