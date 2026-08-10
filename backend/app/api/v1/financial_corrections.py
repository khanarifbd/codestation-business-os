from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.capital import CompanyLoan, LoanRepayment
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialTransaction, Invoice, Payment
from app.models.loan_accounting import LoanDisbursement, LoanFee
from app.models.payables import PayableBill, PayablePayment
from app.services.activity_log import record_activity
from app.services.journal_reversal import reverse_source_journal
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/corrections", tags=["Accounting - Corrections"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
CorrectionType = Literal[
    "payment",
    "expense",
    "transfer",
    "payable_payment",
    "loan_disbursement",
    "loan_repayment",
]


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


def _already_reversed(db: DbSession, organization_id: str, source_id: str, reversal_prefix: str) -> bool:
    return db.scalar(
        select(FinancialTransaction.id).where(
            FinancialTransaction.organization_id == organization_id,
            FinancialTransaction.source_id == source_id,
            FinancialTransaction.source_type.like(f"{reversal_prefix}%"),
        )
    ) is not None


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


def _source_cash_amount(db: DbSession, organization_id: str, source_type: str, source_id: str) -> Decimal:
    transaction = db.scalar(
        select(FinancialTransaction).where(
            FinancialTransaction.organization_id == organization_id,
            FinancialTransaction.source_type == source_type,
            FinancialTransaction.source_id == source_id,
        )
    )
    return Decimal(transaction.amount) if transaction is not None else Decimal("0")


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
    payable_payments = db.execute(
        select(PayablePayment, PayableBill.bill_number, PayableBill.supplier_name)
        .join(PayableBill, PayableBill.id == PayablePayment.bill_id)
        .where(PayablePayment.organization_id == tenant.organization_id)
        .order_by(PayablePayment.payment_date.desc(), PayablePayment.created_at.desc())
        .limit(row_limit)
    ).all()
    loan_disbursements = db.execute(
        select(LoanDisbursement, CompanyLoan.lender_name, CompanyLoan.currency)
        .join(CompanyLoan, CompanyLoan.id == LoanDisbursement.loan_id)
        .where(
            LoanDisbursement.organization_id == tenant.organization_id,
            LoanDisbursement.principal_amount > 0,
        )
        .order_by(LoanDisbursement.disbursement_date.desc(), LoanDisbursement.created_at.desc())
        .limit(row_limit)
    ).all()
    repayment_cash = FinancialTransaction.__table__.alias("repayment_cash")
    loan_repayments = db.execute(
        select(LoanRepayment, CompanyLoan.lender_name, CompanyLoan.currency, repayment_cash.c.amount)
        .join(CompanyLoan, CompanyLoan.id == LoanRepayment.loan_id)
        .outerjoin(
            repayment_cash,
            and_(
                repayment_cash.c.organization_id == tenant.organization_id,
                repayment_cash.c.source_type == "loan_repayment_accounting",
                repayment_cash.c.source_id == LoanRepayment.id,
            ),
        )
        .where(LoanRepayment.organization_id == tenant.organization_id)
        .order_by(LoanRepayment.payment_date.desc(), LoanRepayment.created_at.desc())
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
    for payment, bill_number, supplier_name in payable_payments:
        if _already_reversed(db, tenant.organization_id, payment.id, "payable_payment_reversal"):
            continue
        items.append({
            "source_type": "payable_payment",
            "source_id": payment.id,
            "number": bill_number,
            "date": payment.payment_date,
            "amount": payment.amount,
            "currency": payment.currency,
            "title": f"{bill_number} · {supplier_name}",
            "subtitle": "Supplier bill payment",
        })
    for disbursement, lender_name, currency in loan_disbursements:
        if _already_reversed(db, tenant.organization_id, disbursement.id, "loan_disbursement_reversal"):
            continue
        items.append({
            "source_type": "loan_disbursement",
            "source_id": disbursement.id,
            "number": disbursement.reference or disbursement.id[:8].upper(),
            "date": disbursement.disbursement_date,
            "amount": disbursement.principal_amount,
            "currency": currency,
            "title": f"Loan received · {lender_name}",
            "subtitle": f"Principal {currency} {disbursement.principal_amount} · Net received {currency} {disbursement.net_received_amount}",
        })
    for repayment, lender_name, currency, cash_amount in loan_repayments:
        if _already_reversed(db, tenant.organization_id, repayment.id, "loan_repayment_reversal"):
            continue
        amount = Decimal(cash_amount) if cash_amount is not None else Decimal(repayment.principal_amount) + Decimal(repayment.interest_amount)
        items.append({
            "source_type": "loan_repayment",
            "source_id": repayment.id,
            "number": repayment.reference or repayment.id[:8].upper(),
            "date": repayment.payment_date,
            "amount": amount,
            "currency": currency,
            "title": f"Loan repayment · {lender_name}",
            "subtitle": f"Principal {currency} {repayment.principal_amount} · Interest {currency} {repayment.interest_amount}",
        })
    items.sort(key=lambda item: (str(item["date"]), item["number"]), reverse=True)
    return items[:row_limit]


@router.post("/reverse", status_code=status.HTTP_201_CREATED)
def reverse_business_transaction(payload: CorrectionRequest, request: Request, db: DbSession, tenant: AccountingManager):
    reversal_date = payload.reversal_date or _today(tenant.organization.timezone)
    reason = payload.reason.strip()
    reversed_number: str
    journal = None
    before_status = "posted_or_confirmed"
    after_status = "reversed"

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

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="invoice_payment",
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

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="expense_post",
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
        after_status = "voided"

    elif payload.source_type == "transfer":
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

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="account_transfer",
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

    elif payload.source_type == "payable_payment":
        payment = db.scalar(
            select(PayablePayment).where(
                PayablePayment.id == payload.source_id,
                PayablePayment.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if payment is None:
            raise HTTPException(status_code=404, detail="Payable payment not found")
        if _already_reversed(db, tenant.organization_id, payment.id, "payable_payment_reversal"):
            raise HTTPException(status_code=409, detail="This payable payment was already reversed")
        bill = db.scalar(
            select(PayableBill).where(
                PayableBill.id == payment.bill_id,
                PayableBill.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if bill is None:
            raise HTTPException(status_code=409, detail="Supplier bill is no longer available")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="payable_payment",
            source_id=payment.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["payable_payment"],
            source_id=payment.id,
            reversal_source_type="payable_payment_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        bill.amount_paid = max(Decimal("0"), Decimal(bill.amount_paid) - Decimal(payment.amount))
        bill.balance_due = max(Decimal("0"), Decimal(bill.original_amount) - Decimal(bill.amount_paid))
        bill.status = "paid" if bill.balance_due == 0 else "partially_paid" if bill.amount_paid > 0 else "open"
        reversed_number = f"Payment for {bill.bill_number}"
        before_status = "paid_or_partially_paid"
        after_status = bill.status

    elif payload.source_type == "loan_disbursement":
        disbursement = db.scalar(
            select(LoanDisbursement).where(
                LoanDisbursement.id == payload.source_id,
                LoanDisbursement.organization_id == tenant.organization_id,
                LoanDisbursement.principal_amount > 0,
            ).with_for_update()
        )
        if disbursement is None:
            raise HTTPException(status_code=404, detail="Loan disbursement not found")
        if _already_reversed(db, tenant.organization_id, disbursement.id, "loan_disbursement_reversal"):
            raise HTTPException(status_code=409, detail="This loan disbursement was already reversed")
        loan = db.scalar(
            select(CompanyLoan).where(
                CompanyLoan.id == disbursement.loan_id,
                CompanyLoan.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if loan is None:
            raise HTTPException(status_code=409, detail="Loan agreement is no longer available")
        principal = Decimal(disbursement.principal_amount)
        if principal > Decimal(loan.outstanding_principal):
            raise HTTPException(
                status_code=409,
                detail="This disbursement has principal that was already repaid. Reverse the dependent loan repayment(s) first, then reverse this disbursement.",
            )

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="loan_disbursement",
            source_id=disbursement.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["loan_disbursement"],
            source_id=disbursement.id,
            reversal_source_type="loan_disbursement_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        db.add(
            LoanDisbursement(
                organization_id=tenant.organization_id,
                loan_id=loan.id,
                account_id=disbursement.account_id,
                disbursement_date=reversal_date,
                principal_amount=-principal,
                fee_withheld_amount=-Decimal(disbursement.fee_withheld_amount),
                net_received_amount=-Decimal(disbursement.net_received_amount),
                reference=f"REV-{disbursement.id}",
                notes=f"Reversal of disbursement {disbursement.reference or disbursement.id[:8]}: {reason}",
                created_by_user_id=tenant.user_id,
            )
        )
        if Decimal(disbursement.fee_withheld_amount) > 0:
            db.add(
                LoanFee(
                    organization_id=tenant.organization_id,
                    loan_id=loan.id,
                    account_id=None,
                    fee_date=reversal_date,
                    fee_type="disbursement_fee_reversal",
                    amount=-Decimal(disbursement.fee_withheld_amount),
                    payment_status="reversed",
                    reference=f"REV-{disbursement.id}",
                    notes=f"Reversal: {reason}",
                    created_by_user_id=tenant.user_id,
                )
            )
        loan.outstanding_principal = max(Decimal("0"), Decimal(loan.outstanding_principal) - principal)
        loan.status = "active" if loan.outstanding_principal > 0 else "approved"
        reversed_number = disbursement.reference or f"Disbursement {disbursement.id[:8].upper()}"
        before_status = "active_disbursement"
        after_status = loan.status

    else:
        repayment = db.scalar(
            select(LoanRepayment).where(
                LoanRepayment.id == payload.source_id,
                LoanRepayment.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if repayment is None:
            raise HTTPException(status_code=404, detail="Loan repayment not found")
        if _already_reversed(db, tenant.organization_id, repayment.id, "loan_repayment_reversal"):
            raise HTTPException(status_code=409, detail="This loan repayment was already reversed")
        loan = db.scalar(
            select(CompanyLoan).where(
                CompanyLoan.id == repayment.loan_id,
                CompanyLoan.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if loan is None:
            raise HTTPException(status_code=409, detail="Loan agreement is no longer available")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="loan_repayment_accounting",
            source_id=repayment.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        cash_amount = _source_cash_amount(db, tenant.organization_id, "loan_repayment_accounting", repayment.id)
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["loan_repayment_accounting"],
            source_id=repayment.id,
            reversal_source_type="loan_repayment_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        loan.outstanding_principal = Decimal(loan.outstanding_principal) + Decimal(repayment.principal_amount)
        if loan.outstanding_principal > Decimal(loan.principal_amount):
            raise HTTPException(status_code=409, detail="Reversal would make outstanding principal exceed the approved loan amount")
        loan.status = "active" if loan.outstanding_principal > 0 else "approved"

        derived_fee = max(
            Decimal("0"),
            cash_amount - Decimal(repayment.principal_amount) - Decimal(repayment.interest_amount),
        )
        if derived_fee > 0:
            fee = db.scalar(
                select(LoanFee)
                .where(
                    LoanFee.organization_id == tenant.organization_id,
                    LoanFee.loan_id == loan.id,
                    LoanFee.account_id == repayment.account_id,
                    LoanFee.fee_date == repayment.payment_date,
                    LoanFee.amount == derived_fee,
                    LoanFee.payment_status == "paid",
                )
                .order_by(LoanFee.created_at.desc())
            )
            if fee is not None:
                fee.payment_status = "reversed"
                fee.notes = f"{fee.notes + ' · ' if fee.notes else ''}Reversed: {reason}"

        reversed_number = repayment.reference or f"Repayment {repayment.id[:8].upper()}"
        before_status = "posted_repayment"
        after_status = loan.status

    db.flush()
    record_activity(
        db,
        action=f"finance.{payload.source_type}.reversed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type=payload.source_type,
        entity_id=payload.source_id,
        before={"status": before_status},
        after={
            "status": after_status,
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
