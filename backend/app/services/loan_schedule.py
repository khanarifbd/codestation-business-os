from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.capital import LoanRepayment
from app.models.finance import FinancialTransaction
from app.models.loan_accounting import LoanScheduleItem
from app.services.accounting_posting import money


def refresh_loan_schedule_payment_state(
    db: Session,
    *,
    organization_id: str,
    loan_id: str,
) -> None:
    """Rebuild schedule paid/status fields from unreversed canonical repayments."""

    items = db.scalars(
        select(LoanScheduleItem)
        .where(
            LoanScheduleItem.organization_id == organization_id,
            LoanScheduleItem.loan_id == loan_id,
        )
        .order_by(LoanScheduleItem.installment_number.asc())
        .with_for_update()
    ).all()
    if not items:
        return

    for item in items:
        item.principal_paid = Decimal("0.00")
        item.interest_paid = Decimal("0.00")
        item.fee_paid = Decimal("0.00")
        item.status = "pending"
        item.paid_at = None
    db.flush()

    reversed_repayment_ids = set(
        db.scalars(
            select(FinancialTransaction.source_id).where(
                FinancialTransaction.organization_id == organization_id,
                FinancialTransaction.source_type.like("loan_repayment_reversal%"),
            )
        ).all()
    )

    repayments = db.execute(
        select(LoanRepayment, FinancialTransaction.amount)
        .join(
            FinancialTransaction,
            (FinancialTransaction.organization_id == LoanRepayment.organization_id)
            & (FinancialTransaction.source_type == "loan_repayment_accounting")
            & (FinancialTransaction.source_id == LoanRepayment.id)
            & (FinancialTransaction.direction == "debit"),
        )
        .where(
            LoanRepayment.organization_id == organization_id,
            LoanRepayment.loan_id == loan_id,
        )
        .order_by(
            LoanRepayment.payment_date.asc(),
            LoanRepayment.created_at.asc(),
            LoanRepayment.id.asc(),
        )
    ).all()

    def allocate(paid_field: str, due_field: str, amount: Decimal) -> None:
        remaining = money(amount)
        if remaining <= 0:
            return
        for item in items:
            due = money(getattr(item, due_field))
            paid = money(getattr(item, paid_field))
            available = max(Decimal("0.00"), money(due - paid))
            if available <= 0:
                continue
            applied = min(remaining, available)
            setattr(item, paid_field, money(paid + applied))
            remaining = money(remaining - applied)
            if remaining <= 0:
                break

    for repayment, cash_amount in repayments:
        if repayment.id in reversed_repayment_ids:
            continue

        principal = money(repayment.principal_amount)
        interest = money(repayment.interest_amount)
        fee = money(
            max(
                Decimal("0"),
                Decimal(cash_amount) - Decimal(repayment.principal_amount) - Decimal(repayment.interest_amount),
            )
        )
        allocate("principal_paid", "principal_due", principal)
        allocate("interest_paid", "interest_due", interest)
        allocate("fee_paid", "fee_due", fee)

        for item in items:
            fully_paid = (
                money(item.principal_paid) >= money(item.principal_due)
                and money(item.interest_paid) >= money(item.interest_due)
                and money(item.fee_paid) >= money(item.fee_due)
            )
            if fully_paid and item.paid_at is None:
                item.paid_at = repayment.created_at

    for item in items:
        fully_paid = (
            money(item.principal_paid) >= money(item.principal_due)
            and money(item.interest_paid) >= money(item.interest_due)
            and money(item.fee_paid) >= money(item.fee_due)
        )
        has_payment = (
            money(item.principal_paid) > 0
            or money(item.interest_paid) > 0
            or money(item.fee_paid) > 0
        )
        if fully_paid:
            item.status = "paid"
        elif has_payment:
            item.status = "partial"
            item.paid_at = None
        else:
            item.status = "pending"
            item.paid_at = None

    db.flush()
