from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.financial_corrections import CorrectionRequest, correction_candidates, reverse_business_transaction
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry
from app.models.capital import CompanyLoan, LoanRepayment
from app.models.finance import FinancialTransaction
from app.models.loan_accounting import LoanDisbursement, LoanFee
from app.models.payables import PayableBill, PayablePayment


@dataclass(frozen=True)
class Org:
    id: str
    timezone: str
    currency: str
    name: str


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    role: str
    organization: Org


def request(method: str, path: str) -> Request:
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "headers": [],
        "query_string": b"",
        "scheme": "https",
        "server": ("testserver", 443),
        "client": ("127.0.0.1", 50000),
    })


def source_journal(db, organization_id: str, source_type: str, source_id: str) -> JournalEntry | None:
    return db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
        )
    )


def journal_reversed(db, organization_id: str, original_id: str) -> bool:
    return db.scalar(
        select(JournalEntry.id).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.reversed_entry_id == original_id,
        )
    ) is not None


def reversal_movements(db, organization_id: str, source_id: str, prefix: str) -> int:
    return int(db.scalar(
        select(func.count(FinancialTransaction.id)).where(
            FinancialTransaction.organization_id == organization_id,
            FinancialTransaction.source_id == source_id,
            FinancialTransaction.source_type.like(f"{prefix}%"),
        )
    ) or 0)


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency, o.name, m.id membership_id
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()

    tenant = Tenant(
        organization_id=str(row["organization_id"]),
        user_id=str(row["user_id"]),
        membership_id=str(row["membership_id"]),
        role="admin",
        organization=Org(
            id=str(row["organization_id"]),
            timezone=str(row["timezone"] or "UTC"),
            currency=str(row["currency"] or "BDT"),
            name=str(row["name"]),
        ),
    )

    db = SessionLocal()
    try:
        payable = db.scalar(
            select(PayablePayment)
            .where(PayablePayment.organization_id == tenant.organization_id)
            .order_by(PayablePayment.created_at.desc())
        )
        if payable is None:
            raise AssertionError("part 2 correction verification requires a payable payment fixture")
        bill = db.scalar(select(PayableBill).where(PayableBill.id == payable.bill_id))
        if bill is None:
            raise AssertionError("payable bill fixture missing")
        payable_journal = source_journal(db, tenant.organization_id, "payable_payment", payable.id)
        if payable_journal is None:
            raise AssertionError("payable payment journal fixture missing")
        paid_before = Decimal(bill.amount_paid)
        due_before = Decimal(bill.balance_due)
        payable_amount = Decimal(payable.amount)

        reverse_business_transaction(
            CorrectionRequest(
                source_type="payable_payment",
                source_id=payable.id,
                reason="CI supplier payment correction",
                reversal_date=date(2099, 12, 23),
            ),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        bill_after = db.scalar(select(PayableBill).where(PayableBill.id == bill.id))
        if bill_after is None:
            raise AssertionError("payable bill missing after reversal")
        if Decimal(bill_after.amount_paid) != max(Decimal("0"), paid_before - payable_amount):
            raise AssertionError("payable reversal did not restore amount paid")
        if Decimal(bill_after.balance_due) != due_before + payable_amount:
            raise AssertionError("payable reversal did not restore supplier balance due")
        if reversal_movements(db, tenant.organization_id, payable.id, "payable_payment_reversal") != 1:
            raise AssertionError("payable payment financial account movement was not reversed exactly once")
        if not journal_reversed(db, tenant.organization_id, payable_journal.id):
            raise AssertionError("payable payment accounting journal was not reversed")

        repayment = db.scalar(
            select(LoanRepayment)
            .join(
                FinancialTransaction,
                (FinancialTransaction.source_id == LoanRepayment.id)
                & (FinancialTransaction.organization_id == tenant.organization_id)
                & (FinancialTransaction.source_type == "loan_repayment_accounting"),
            )
            .where(LoanRepayment.organization_id == tenant.organization_id)
            .order_by(LoanRepayment.created_at.desc())
        )
        if repayment is None:
            raise AssertionError("part 2 correction verification requires an accounting loan repayment fixture")
        loan = db.scalar(select(CompanyLoan).where(CompanyLoan.id == repayment.loan_id))
        if loan is None:
            raise AssertionError("loan fixture missing")
        disbursement = db.scalar(
            select(LoanDisbursement)
            .where(
                LoanDisbursement.organization_id == tenant.organization_id,
                LoanDisbursement.loan_id == loan.id,
                LoanDisbursement.principal_amount > 0,
            )
            .order_by(LoanDisbursement.created_at.desc())
        )
        if disbursement is None:
            raise AssertionError("loan disbursement fixture missing")

        blocked = False
        try:
            reverse_business_transaction(
                CorrectionRequest(
                    source_type="loan_disbursement",
                    source_id=disbursement.id,
                    reason="CI dependency protection",
                    reversal_date=date(2099, 12, 24),
                ),
                request("POST", "/accounting/corrections/reverse"),
                db,
                tenant,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            db.rollback()
            blocked = exc.status_code == 409 and "repayment" in str(exc.detail).lower()
        if not blocked:
            raise AssertionError("loan disbursement reversal should be blocked while its principal has been repaid")

        db.expire_all()
        repayment = db.scalar(select(LoanRepayment).where(LoanRepayment.id == repayment.id))
        loan = db.scalar(select(CompanyLoan).where(CompanyLoan.id == loan.id))
        disbursement = db.scalar(select(LoanDisbursement).where(LoanDisbursement.id == disbursement.id))
        if repayment is None or loan is None or disbursement is None:
            raise AssertionError("loan fixtures missing after dependency rollback")

        repayment_journal = source_journal(db, tenant.organization_id, "loan_repayment_accounting", repayment.id)
        if repayment_journal is None:
            raise AssertionError("loan repayment journal fixture missing")
        outstanding_before_repayment_reversal = Decimal(loan.outstanding_principal)
        principal_repaid = Decimal(repayment.principal_amount)
        repayment_cash = db.scalar(
            select(FinancialTransaction).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_type == "loan_repayment_accounting",
                FinancialTransaction.source_id == repayment.id,
            )
        )
        if repayment_cash is None:
            raise AssertionError("loan repayment cash movement fixture missing")
        repayment_fee = max(
            Decimal("0"),
            Decimal(repayment_cash.amount) - Decimal(repayment.principal_amount) - Decimal(repayment.interest_amount),
        )

        reverse_business_transaction(
            CorrectionRequest(
                source_type="loan_repayment",
                source_id=repayment.id,
                reason="CI loan repayment correction",
                reversal_date=date(2099, 12, 24),
            ),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        loan_after_repayment = db.scalar(select(CompanyLoan).where(CompanyLoan.id == loan.id))
        if loan_after_repayment is None:
            raise AssertionError("loan missing after repayment reversal")
        if Decimal(loan_after_repayment.outstanding_principal) != outstanding_before_repayment_reversal + principal_repaid:
            raise AssertionError("loan repayment reversal did not restore outstanding principal")
        if reversal_movements(db, tenant.organization_id, repayment.id, "loan_repayment_reversal") != 1:
            raise AssertionError("loan repayment cash movement was not reversed exactly once")
        if not journal_reversed(db, tenant.organization_id, repayment_journal.id):
            raise AssertionError("loan repayment accounting journal was not reversed")
        if repayment_fee > 0:
            reversed_fee = db.scalar(
                select(LoanFee.id).where(
                    LoanFee.organization_id == tenant.organization_id,
                    LoanFee.loan_id == loan.id,
                    LoanFee.account_id == repayment.account_id,
                    LoanFee.fee_date == repayment.payment_date,
                    LoanFee.amount == repayment_fee,
                    LoanFee.payment_status == "reversed",
                )
            )
            if reversed_fee is None:
                raise AssertionError("loan repayment fee was not marked reversed")

        db.expire_all()
        loan = db.scalar(select(CompanyLoan).where(CompanyLoan.id == loan.id))
        disbursement = db.scalar(select(LoanDisbursement).where(LoanDisbursement.id == disbursement.id))
        if loan is None or disbursement is None:
            raise AssertionError("loan fixtures missing before disbursement reversal")
        disbursement_journal = source_journal(db, tenant.organization_id, "loan_disbursement", disbursement.id)
        if disbursement_journal is None:
            raise AssertionError("loan disbursement journal fixture missing")
        outstanding_before_disbursement_reversal = Decimal(loan.outstanding_principal)
        tracked_before = Decimal(db.scalar(
            select(func.coalesce(func.sum(LoanDisbursement.principal_amount), 0)).where(
                LoanDisbursement.organization_id == tenant.organization_id,
                LoanDisbursement.loan_id == loan.id,
            )
        ) or 0)

        reverse_business_transaction(
            CorrectionRequest(
                source_type="loan_disbursement",
                source_id=disbursement.id,
                reason="CI loan disbursement correction",
                reversal_date=date(2099, 12, 25),
            ),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        loan_after_disbursement = db.scalar(select(CompanyLoan).where(CompanyLoan.id == loan.id))
        if loan_after_disbursement is None:
            raise AssertionError("loan missing after disbursement reversal")
        expected_outstanding = outstanding_before_disbursement_reversal - Decimal(disbursement.principal_amount)
        if Decimal(loan_after_disbursement.outstanding_principal) != expected_outstanding:
            raise AssertionError("loan disbursement reversal did not remove principal liability")
        tracked_after = Decimal(db.scalar(
            select(func.coalesce(func.sum(LoanDisbursement.principal_amount), 0)).where(
                LoanDisbursement.organization_id == tenant.organization_id,
                LoanDisbursement.loan_id == loan.id,
            )
        ) or 0)
        if tracked_after != tracked_before - Decimal(disbursement.principal_amount):
            raise AssertionError("loan disbursement reversal did not preserve net disbursed amount history")
        if reversal_movements(db, tenant.organization_id, disbursement.id, "loan_disbursement_reversal") != 1:
            raise AssertionError("loan disbursement cash movement was not reversed exactly once")
        if not journal_reversed(db, tenant.organization_id, disbursement_journal.id):
            raise AssertionError("loan disbursement accounting journal was not reversed")

        candidates = correction_candidates(db, tenant, limit=200)  # type: ignore[arg-type]
        candidate_keys = {(item["source_type"], item["source_id"]) for item in candidates}
        for key in [
            ("payable_payment", payable.id),
            ("loan_repayment", repayment.id),
            ("loan_disbursement", disbursement.id),
        ]:
            if key in candidate_keys:
                raise AssertionError(f"reversed source still appears as correction candidate: {key}")

        print("financial correction part 2 verification passed: payable + loan repayment + dependency-safe loan disbursement reversal")
    finally:
        db.close()


if __name__ == "__main__":
    main()
