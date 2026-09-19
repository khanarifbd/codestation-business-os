from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine
from app.models.capital import CompanyLoan, LoanRepayment
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.loan_accounting import LoanDisbursement, LoanFee, LoanScheduleItem
from app.schemas.accounting_loans import (
    AccountingLoanRead,
    LoanDisbursementRead,
    LoanRepaymentRead,
    LoanScheduleItemRead,
)
from app.services.accounting_posting import (
    PostingLine,
    financial_ledger_account,
    money,
    post_journal,
    system_account,
    to_base_amount,
)
from app.services.activity_log import record_activity
from app.services.functional_currency import functional_currency_for_date
from app.services.loan_schedule import refresh_loan_schedule_payment_state
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/loans", tags=["Accounting - Loans"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


class AccountingLoanCreate(BaseModel):
    lender_name: str = Field(min_length=2, max_length=220)
    lender_type: Literal["bank", "person", "investor", "company", "other"] = "other"
    currency: str = Field(min_length=3, max_length=3)
    approved_amount: Decimal = Field(gt=0)
    annual_interest_rate: Decimal = Field(default=0, ge=0)
    approval_date: date
    maturity_date: date | None = None
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.maturity_date is not None and self.maturity_date < self.approval_date:
            raise ValueError("Maturity date cannot be earlier than the approval date")
        return self


class LoanDisbursementCreate(BaseModel):
    account_id: str
    disbursement_date: date
    principal_amount: Decimal = Field(gt=0)
    fee_withheld_amount: Decimal = Field(default=0, ge=0)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None

    @model_validator(mode="after")
    def validate_net(self):
        if self.fee_withheld_amount >= self.principal_amount:
            raise ValueError("Withheld fee must be less than the principal disbursement")
        return self


class LoanAccountingRepaymentCreate(BaseModel):
    account_id: str
    payment_date: date
    principal_amount: Decimal = Field(default=0, ge=0)
    interest_amount: Decimal = Field(default=0, ge=0)
    fee_amount: Decimal = Field(default=0, ge=0)
    fee_type: str = Field(default="loan_fee", max_length=40)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None

    @model_validator(mode="after")
    def validate_nonzero(self):
        if self.principal_amount + self.interest_amount + self.fee_amount <= 0:
            raise ValueError("Repayment total must be greater than zero")
        return self


class ScheduleLineCreate(BaseModel):
    installment_number: int = Field(gt=0)
    due_date: date
    principal_due: Decimal = Field(default=0, ge=0)
    interest_due: Decimal = Field(default=0, ge=0)
    fee_due: Decimal = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_total(self):
        if self.principal_due + self.interest_due + self.fee_due <= 0:
            raise ValueError("Schedule installment total must be greater than zero")
        return self


class LoanScheduleCreate(BaseModel):
    items: list[ScheduleLineCreate] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_installments(self):
        numbers = [item.installment_number for item in self.items]
        if len(numbers) != len(set(numbers)):
            raise ValueError("Installment numbers must be unique")
        return self


def _balance(db: DbSession, account: FinancialAccount, organization_id: str) -> Decimal:
    net = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (FinancialTransaction.direction == "credit", FinancialTransaction.amount),
                        else_=-FinancialTransaction.amount,
                    )
                ),
                0,
            )
        ).where(
            FinancialTransaction.organization_id == organization_id,
            FinancialTransaction.account_id == account.id,
        )
    ) or Decimal("0")
    return money(Decimal(account.opening_balance) + Decimal(net))


def _cash_transaction(
    db: DbSession,
    tenant: TenantContext,
    *,
    account_id: str,
    transaction_date: date,
    direction: str,
    amount: Decimal,
    currency: str,
    source_type: str,
    source_id: str,
    reference: str | None,
    description: str,
) -> None:
    if amount <= 0:
        return
    db.add(
        FinancialTransaction(
            organization_id=tenant.organization_id,
            account_id=account_id,
            transaction_date=transaction_date,
            direction=direction,
            amount=money(amount),
            currency=currency,
            source_type=source_type,
            source_id=source_id,
            reference=reference,
            description=description,
            created_by_user_id=tenant.user_id,
        )
    )


def _loan(db: DbSession, organization_id: str, loan_id: str, *, lock: bool = False) -> CompanyLoan:
    query = select(CompanyLoan).where(
        CompanyLoan.id == loan_id,
        CompanyLoan.organization_id == organization_id,
    )
    if lock:
        query = query.with_for_update()
    item = db.scalar(query)
    if item is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    return item


def _disbursed_total(db: DbSession, loan: CompanyLoan) -> Decimal:
    tracked = db.scalar(
        select(func.coalesce(func.sum(LoanDisbursement.principal_amount), 0)).where(
            LoanDisbursement.organization_id == loan.organization_id,
            LoanDisbursement.loan_id == loan.id,
        )
    ) or Decimal("0")
    tracked = money(tracked)
    if tracked > 0:
        return tracked
    legacy_received = db.scalar(
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0)).where(
            FinancialTransaction.organization_id == loan.organization_id,
            FinancialTransaction.source_type == "company_loan",
            FinancialTransaction.source_id == loan.id,
            FinancialTransaction.direction == "credit",
        )
    ) or Decimal("0")
    return money(loan.principal_amount if Decimal(legacy_received) > 0 else Decimal("0"))


def _loan_principal_carrying_base(
    db: DbSession,
    *,
    organization_id: str,
    loan: CompanyLoan,
    current_repayment_id: str,
    loans_payable_account_id: str,
    principal_amount: Decimal,
    repayment_date: date,
) -> Decimal:
    reversed_entry = JournalEntry.__table__.alias("reversed_entry")

    disbursements = db.execute(
        select(LoanDisbursement.principal_amount, JournalLine.credit)
        .join(
            JournalEntry,
            (JournalEntry.organization_id == LoanDisbursement.organization_id)
            & (JournalEntry.source_type == "loan_disbursement")
            & (JournalEntry.source_id == LoanDisbursement.id)
            & (JournalEntry.status == "posted"),
        )
        .join(
            JournalLine,
            (JournalLine.organization_id == LoanDisbursement.organization_id)
            & (JournalLine.journal_entry_id == JournalEntry.id)
            & (JournalLine.ledger_account_id == loans_payable_account_id),
        )
        .where(
            LoanDisbursement.organization_id == organization_id,
            LoanDisbursement.loan_id == loan.id,
            LoanDisbursement.principal_amount > 0,
            LoanDisbursement.disbursement_date <= repayment_date,
            ~select(reversed_entry.c.id)
            .where(
                reversed_entry.c.organization_id == organization_id,
                reversed_entry.c.reversed_entry_id == JournalEntry.id,
            )
            .exists(),
        )
    ).all()

    repayments = db.execute(
        select(LoanRepayment.principal_amount, JournalLine.debit)
        .join(
            JournalEntry,
            (JournalEntry.organization_id == LoanRepayment.organization_id)
            & (JournalEntry.source_type == "loan_repayment_accounting")
            & (JournalEntry.source_id == LoanRepayment.id)
            & (JournalEntry.status == "posted"),
        )
        .join(
            JournalLine,
            (JournalLine.organization_id == LoanRepayment.organization_id)
            & (JournalLine.journal_entry_id == JournalEntry.id)
            & (JournalLine.ledger_account_id == loans_payable_account_id),
        )
        .where(
            LoanRepayment.organization_id == organization_id,
            LoanRepayment.loan_id == loan.id,
            LoanRepayment.id != current_repayment_id,
            LoanRepayment.principal_amount > 0,
            LoanRepayment.payment_date <= repayment_date,
            ~select(reversed_entry.c.id)
            .where(
                reversed_entry.c.organization_id == organization_id,
                reversed_entry.c.reversed_entry_id == JournalEntry.id,
            )
            .exists(),
        )
    ).all()

    remaining_principal = money(
        sum((Decimal(amount) for amount, _ in disbursements), Decimal("0"))
        - sum((Decimal(amount) for amount, _ in repayments), Decimal("0"))
    )
    remaining_base = money(
        sum((Decimal(base) for _, base in disbursements), Decimal("0"))
        - sum((Decimal(base) for _, base in repayments), Decimal("0"))
    )
    principal_amount = money(principal_amount)
    if principal_amount <= 0:
        return Decimal("0.00")
    if remaining_principal <= 0 or remaining_base <= 0:
        raise HTTPException(status_code=409, detail="Loan principal carrying value is unavailable for repayment")
    if principal_amount > remaining_principal:
        raise HTTPException(status_code=409, detail="Principal repayment exceeds the remaining accounting carrying quantity")
    if principal_amount == remaining_principal:
        return remaining_base
    return money(remaining_base * principal_amount / remaining_principal)


def _loan_json(db: DbSession, item: CompanyLoan) -> dict:
    disbursed = _disbursed_total(db, item)
    return {
        "id": item.id,
        "lender_name": item.lender_name,
        "lender_type": item.lender_type,
        "currency": item.currency,
        "approved_amount": item.principal_amount,
        "disbursed_amount": disbursed,
        "undisbursed_amount": money(max(Decimal("0"), Decimal(item.principal_amount) - disbursed)),
        "outstanding_principal": item.outstanding_principal,
        "annual_interest_rate": item.annual_interest_rate,
        "approval_date": item.loan_date,
        "maturity_date": item.maturity_date,
        "status": item.status,
        "reference": item.reference,
        "notes": item.notes,
    }


@router.get("", response_model=list[AccountingLoanRead])
def list_accounting_loans(db: DbSession, tenant: AccountingViewer):
    items = db.scalars(
        select(CompanyLoan)
        .where(CompanyLoan.organization_id == tenant.organization_id)
        .order_by(CompanyLoan.loan_date.desc(), CompanyLoan.created_at.desc())
    ).all()
    return [_loan_json(db, item) for item in items]


@router.post("", response_model=AccountingLoanRead, status_code=status.HTTP_201_CREATED)
def create_accounting_loan(
    payload: AccountingLoanCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    item = CompanyLoan(
        organization_id=tenant.organization_id,
        lender_name=payload.lender_name.strip(),
        lender_type=payload.lender_type,
        currency=payload.currency.upper(),
        principal_amount=money(payload.approved_amount),
        outstanding_principal=Decimal("0"),
        annual_interest_rate=payload.annual_interest_rate,
        loan_date=payload.approval_date,
        maturity_date=payload.maturity_date,
        account_id=None,
        status="draft",
        reference=payload.reference.strip() if payload.reference and payload.reference.strip() else None,
        notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        created_by_user_id=tenant.user_id,
    )
    db.add(item)
    db.flush()
    record_activity(
        db,
        action="accounting.loan.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="company_loan",
        entity_id=item.id,
        after={
            "approved_amount": str(item.principal_amount),
            "currency": item.currency,
            "status": item.status,
            "outstanding_principal": "0.00",
        },
        message=f"Loan agreement created for {item.lender_name}; approval is required before disbursement",
        request=request,
    )
    db.commit()
    return _loan_json(db, item)


@router.post("/{loan_id}/approve", response_model=AccountingLoanRead)
def approve_loan(loan_id: str, request: Request, db: DbSession, tenant: AccountingManager):
    loan = _loan(db, tenant.organization_id, loan_id, lock=True)
    if loan.status == "approved":
        return _loan_json(db, loan)
    if loan.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft loan can be approved")
    loan.status = "approved"
    record_activity(
        db,
        action="accounting.loan.approved",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="company_loan",
        entity_id=loan.id,
        before={"status": "draft"},
        after={"status": "approved", "approved_amount": str(loan.principal_amount), "currency": loan.currency},
        message=f"Loan approved from {loan.lender_name}; no cash or liability posted until disbursement",
        request=request,
    )
    db.commit()
    return _loan_json(db, loan)


@router.post("/{loan_id}/disburse", response_model=LoanDisbursementRead, status_code=status.HTTP_201_CREATED)
def disburse_loan(
    loan_id: str,
    payload: LoanDisbursementCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    loan = _loan(db, tenant.organization_id, loan_id, lock=True)
    if loan.status not in {"approved", "active"}:
        raise HTTPException(status_code=409, detail="Loan must be approved and open before disbursement")
    if payload.disbursement_date < loan.loan_date:
        raise HTTPException(status_code=409, detail="Loan disbursement cannot predate the approval date")

    financial, bank_ledger = financial_ledger_account(db, tenant.organization_id, payload.account_id)
    if financial.currency != loan.currency:
        raise HTTPException(status_code=400, detail="Disbursement account currency must match loan currency")

    principal = money(payload.principal_amount)
    fee = money(payload.fee_withheld_amount)
    net = money(principal - fee)
    disbursed_before = _disbursed_total(db, loan)
    if disbursed_before + principal > money(loan.principal_amount):
        raise HTTPException(status_code=400, detail="Disbursement exceeds the approved loan amount")

    item = LoanDisbursement(
        organization_id=tenant.organization_id,
        loan_id=loan.id,
        account_id=financial.id,
        disbursement_date=payload.disbursement_date,
        principal_amount=principal,
        fee_withheld_amount=fee,
        net_received_amount=net,
        reference=payload.reference.strip() if payload.reference and payload.reference.strip() else None,
        notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        created_by_user_id=tenant.user_id,
    )
    db.add(item)
    db.flush()

    loans_payable = system_account(db, tenant.organization_id, "loans_payable")
    lines = [
        PostingLine(ledger_account_id=bank_ledger.id, debit=net, currency=loan.currency, description=f"Loan cash received from {loan.lender_name}"),
        PostingLine(ledger_account_id=loans_payable.id, credit=principal, currency=loan.currency, description=f"Loan principal liability — {loan.lender_name}"),
    ]
    if fee > 0:
        fee_account = system_account(db, tenant.organization_id, "bank_fees")
        lines.insert(1, PostingLine(ledger_account_id=fee_account.id, debit=fee, currency=loan.currency, description="Loan fee withheld at disbursement"))
        db.add(
            LoanFee(
                organization_id=tenant.organization_id,
                loan_id=loan.id,
                account_id=None,
                fee_date=item.disbursement_date,
                fee_type="disbursement_fee",
                amount=fee,
                payment_status="withheld",
                reference=item.reference,
                notes="Withheld from loan proceeds",
                created_by_user_id=tenant.user_id,
            )
        )

    journal = post_journal(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        entry_date=item.disbursement_date,
        source_type="loan_disbursement",
        source_id=item.id,
        reference=item.reference,
        memo=f"Loan disbursement from {loan.lender_name}",
        lines=lines,
    )
    _cash_transaction(
        db,
        tenant,
        account_id=financial.id,
        transaction_date=item.disbursement_date,
        direction="credit",
        amount=net,
        currency=loan.currency,
        source_type="loan_disbursement",
        source_id=item.id,
        reference=item.reference,
        description=f"Loan disbursement from {loan.lender_name}",
    )
    loan.outstanding_principal = money(Decimal(loan.outstanding_principal) + principal)
    loan.account_id = financial.id
    loan.status = "active"

    record_activity(
        db,
        action="accounting.loan.disbursed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="loan_disbursement",
        entity_id=item.id,
        after={
            "loan_id": loan.id,
            "principal": str(principal),
            "fee_withheld": str(fee),
            "net_received": str(net),
            "journal_entry_id": journal.id,
            "outstanding_principal": str(loan.outstanding_principal),
        },
        message=f"Loan disbursement posted for {loan.lender_name}",
        request=request,
    )
    db.commit()
    return {
        "id": item.id,
        "loan": _loan_json(db, loan),
        "principal_amount": principal,
        "fee_withheld_amount": fee,
        "net_received_amount": net,
        "journal_entry_id": journal.id,
    }


@router.post("/{loan_id}/repay", response_model=LoanRepaymentRead, status_code=status.HTTP_201_CREATED)
def repay_loan(
    loan_id: str,
    payload: LoanAccountingRepaymentCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    loan = _loan(db, tenant.organization_id, loan_id, lock=True)
    if loan.status != "active":
        raise HTTPException(status_code=409, detail="Only an active disbursed loan can be repaid")

    reversed_disbursement_entry = JournalEntry.__table__.alias("reversed_disbursement_entry")
    active_disbursement_as_of = db.scalar(
        select(LoanDisbursement.id)
        .join(
            JournalEntry,
            (JournalEntry.organization_id == LoanDisbursement.organization_id)
            & (JournalEntry.source_type == "loan_disbursement")
            & (JournalEntry.source_id == LoanDisbursement.id)
            & (JournalEntry.status == "posted"),
        )
        .where(
            LoanDisbursement.organization_id == tenant.organization_id,
            LoanDisbursement.loan_id == loan.id,
            LoanDisbursement.principal_amount > 0,
            LoanDisbursement.disbursement_date <= payload.payment_date,
            ~select(reversed_disbursement_entry.c.id)
            .where(
                reversed_disbursement_entry.c.organization_id == tenant.organization_id,
                reversed_disbursement_entry.c.reversed_entry_id == JournalEntry.id,
            )
            .exists(),
        )
        .limit(1)
    )
    if active_disbursement_as_of is None:
        raise HTTPException(
            status_code=409,
            detail="Loan repayment cannot predate the first active disbursement",
        )

    principal = money(payload.principal_amount)
    interest = money(payload.interest_amount)
    fee = money(payload.fee_amount)
    total = money(principal + interest + fee)
    if principal > money(loan.outstanding_principal):
        raise HTTPException(status_code=400, detail="Principal repayment exceeds outstanding principal")

    financial, bank_ledger = financial_ledger_account(db, tenant.organization_id, payload.account_id)
    if financial.currency != loan.currency:
        raise HTTPException(status_code=400, detail="Repayment account currency must match loan currency")
    if _balance(db, financial, tenant.organization_id) < total:
        raise HTTPException(status_code=409, detail="Insufficient financial account balance")

    repayment = LoanRepayment(
        organization_id=tenant.organization_id,
        loan_id=loan.id,
        account_id=financial.id,
        payment_date=payload.payment_date,
        principal_amount=principal,
        interest_amount=interest,
        reference=payload.reference.strip() if payload.reference and payload.reference.strip() else None,
        notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        created_by_user_id=tenant.user_id,
    )
    db.add(repayment)
    db.flush()

    base_currency = functional_currency_for_date(db, tenant.organization_id, repayment.payment_date)
    _, repayment_rate = to_base_amount(
        db,
        tenant.organization_id,
        base_currency,
        Decimal("1"),
        loan.currency,
        rate_date=repayment.payment_date,
    )
    principal_cash_base = money(principal * repayment_rate)
    interest_base = money(interest * repayment_rate)
    fee_base = money(fee * repayment_rate)
    cash_base = money(principal_cash_base + interest_base + fee_base)

    lines: list[PostingLine] = [
        PostingLine(
            ledger_account_id=bank_ledger.id,
            credit=cash_base,
            currency=loan.currency,
            exchange_rate_to_base=repayment_rate,
            original_amount=total,
            description=f"Loan repayment paid to {loan.lender_name}",
        )
    ]
    if principal > 0:
        loans_payable = system_account(db, tenant.organization_id, "loans_payable")
        principal_carrying_base = _loan_principal_carrying_base(
            db,
            organization_id=tenant.organization_id,
            loan=loan,
            current_repayment_id=repayment.id,
            loans_payable_account_id=loans_payable.id,
            principal_amount=principal,
            repayment_date=repayment.payment_date,
        )
        principal_carrying_rate = (principal_carrying_base / principal).quantize(Decimal("0.00000001"))
        lines.insert(
            0,
            PostingLine(
                ledger_account_id=loans_payable.id,
                debit=principal_carrying_base,
                currency=loan.currency,
                exchange_rate_to_base=principal_carrying_rate,
                original_amount=principal,
                description="Loan principal repayment",
            ),
        )
        fx_difference = money(principal_cash_base - principal_carrying_base)
        if fx_difference > 0:
            realized_fx = system_account(db, tenant.organization_id, "realized_fx_loss")
            lines.insert(
                1,
                PostingLine(
                    ledger_account_id=realized_fx.id,
                    debit=fx_difference,
                    currency=base_currency,
                    original_amount=fx_difference,
                    description=f"Realized FX loss on loan principal repayment — {loan.lender_name}",
                ),
            )
        elif fx_difference < 0:
            realized_fx = system_account(db, tenant.organization_id, "realized_fx_gain")
            lines.insert(
                1,
                PostingLine(
                    ledger_account_id=realized_fx.id,
                    credit=abs(fx_difference),
                    currency=base_currency,
                    original_amount=abs(fx_difference),
                    description=f"Realized FX gain on loan principal repayment — {loan.lender_name}",
                ),
            )
    if interest > 0:
        interest_expense = system_account(db, tenant.organization_id, "interest_expense")
        lines.insert(
            0,
            PostingLine(
                ledger_account_id=interest_expense.id,
                debit=interest_base,
                currency=loan.currency,
                exchange_rate_to_base=repayment_rate,
                original_amount=interest,
                description="Loan interest expense",
            ),
        )
    if fee > 0:
        fee_expense = system_account(db, tenant.organization_id, "bank_fees")
        lines.insert(
            0,
            PostingLine(
                ledger_account_id=fee_expense.id,
                debit=fee_base,
                currency=loan.currency,
                exchange_rate_to_base=repayment_rate,
                original_amount=fee,
                description=f"Loan fee — {payload.fee_type}",
            ),
        )
        db.add(
            LoanFee(
                organization_id=tenant.organization_id,
                loan_id=loan.id,
                account_id=financial.id,
                fee_date=payload.payment_date,
                fee_type=payload.fee_type,
                amount=fee,
                payment_status="paid",
                reference=repayment.reference,
                notes=repayment.notes,
                created_by_user_id=tenant.user_id,
            )
        )

    journal = post_journal(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        entry_date=repayment.payment_date,
        source_type="loan_repayment_accounting",
        source_id=repayment.id,
        reference=repayment.reference,
        memo=f"Loan repayment to {loan.lender_name}",
        lines=lines,
    )
    _cash_transaction(
        db,
        tenant,
        account_id=financial.id,
        transaction_date=repayment.payment_date,
        direction="debit",
        amount=total,
        currency=loan.currency,
        source_type="loan_repayment_accounting",
        source_id=repayment.id,
        reference=repayment.reference,
        description=f"Loan repayment to {loan.lender_name}",
    )
    db.flush()
    refresh_loan_schedule_payment_state(
        db,
        organization_id=tenant.organization_id,
        loan_id=loan.id,
    )

    loan.outstanding_principal = money(Decimal(loan.outstanding_principal) - principal)
    disbursed = _disbursed_total(db, loan)
    if loan.outstanding_principal == 0 and disbursed >= money(loan.principal_amount):
        loan.status = "paid"
    elif loan.outstanding_principal == 0:
        loan.status = "approved"
    else:
        loan.status = "active"

    record_activity(
        db,
        action="accounting.loan.repayment_posted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="loan_repayment",
        entity_id=repayment.id,
        after={
            "loan_id": loan.id,
            "principal": str(principal),
            "interest": str(interest),
            "fee": str(fee),
            "cash_paid": str(total),
            "outstanding_principal": str(loan.outstanding_principal),
            "journal_entry_id": journal.id,
        },
        message=f"Loan repayment posted for {loan.lender_name}",
        request=request,
    )
    db.commit()
    return {
        "id": repayment.id,
        "loan": _loan_json(db, loan),
        "principal_amount": principal,
        "interest_amount": interest,
        "fee_amount": fee,
        "cash_paid": total,
        "journal_entry_id": journal.id,
    }


@router.post("/{loan_id}/close", response_model=AccountingLoanRead)
def close_loan(loan_id: str, request: Request, db: DbSession, tenant: AccountingManager):
    loan = _loan(db, tenant.organization_id, loan_id, lock=True)
    if loan.status == "closed":
        return _loan_json(db, loan)
    disbursed = _disbursed_total(db, loan)
    if disbursed <= 0:
        raise HTTPException(status_code=409, detail="A loan cannot be closed before any disbursement")
    if money(loan.outstanding_principal) != Decimal("0.00"):
        raise HTTPException(status_code=409, detail="Outstanding principal must be zero before closing the loan")
    if loan.status not in {"approved", "paid"}:
        raise HTTPException(status_code=409, detail="Loan must be fully repaid before it can be closed")
    previous_status = loan.status
    loan.status = "closed"
    record_activity(
        db,
        action="accounting.loan.closed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="company_loan",
        entity_id=loan.id,
        before={"status": previous_status, "outstanding_principal": str(loan.outstanding_principal)},
        after={"status": "closed", "outstanding_principal": "0.00", "disbursed_amount": str(disbursed)},
        message=f"Loan closed for {loan.lender_name}",
        request=request,
    )
    db.commit()
    return _loan_json(db, loan)


@router.get("/{loan_id}/schedule", response_model=list[LoanScheduleItemRead])
def get_schedule(loan_id: str, db: DbSession, tenant: AccountingViewer):
    _loan(db, tenant.organization_id, loan_id)
    items = db.scalars(
        select(LoanScheduleItem)
        .where(
            LoanScheduleItem.organization_id == tenant.organization_id,
            LoanScheduleItem.loan_id == loan_id,
        )
        .order_by(LoanScheduleItem.installment_number.asc())
    ).all()
    return [
        {
            "id": item.id,
            "installment_number": item.installment_number,
            "due_date": item.due_date,
            "principal_due": item.principal_due,
            "interest_due": item.interest_due,
            "fee_due": item.fee_due,
            "principal_paid": item.principal_paid,
            "interest_paid": item.interest_paid,
            "fee_paid": item.fee_paid,
            "status": item.status,
        }
        for item in items
    ]


@router.put("/{loan_id}/schedule", response_model=list[LoanScheduleItemRead])
def replace_schedule(
    loan_id: str,
    payload: LoanScheduleCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    loan = _loan(db, tenant.organization_id, loan_id, lock=True)
    if loan.status in {"closed", "cancelled"}:
        raise HTTPException(status_code=409, detail="A closed or cancelled loan schedule cannot be changed")
    existing = db.scalars(
        select(LoanScheduleItem).where(
            LoanScheduleItem.organization_id == tenant.organization_id,
            LoanScheduleItem.loan_id == loan.id,
        )
    ).all()
    if any(item.status in {"partial", "paid"} for item in existing):
        raise HTTPException(status_code=409, detail="Schedule cannot be replaced after installment payments have started")
    for item in existing:
        db.delete(item)
    db.flush()
    for source in sorted(payload.items, key=lambda item: item.installment_number):
        db.add(
            LoanScheduleItem(
                organization_id=tenant.organization_id,
                loan_id=loan.id,
                installment_number=source.installment_number,
                due_date=source.due_date,
                principal_due=money(source.principal_due),
                interest_due=money(source.interest_due),
                fee_due=money(source.fee_due),
            )
        )
    db.flush()
    refresh_loan_schedule_payment_state(
        db,
        organization_id=tenant.organization_id,
        loan_id=loan.id,
    )
    record_activity(
        db,
        action="accounting.loan.schedule_replaced",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="company_loan",
        entity_id=loan.id,
        after={"installment_count": len(payload.items)},
        message=f"Repayment schedule updated for {loan.lender_name}",
        request=request,
    )
    db.commit()
    return get_schedule(loan.id, db, tenant)
