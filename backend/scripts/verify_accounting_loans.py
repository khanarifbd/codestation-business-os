from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.accounting_loans import (
    AccountingLoanCreate,
    LoanAccountingRepaymentCreate,
    LoanDisbursementCreate,
    create_accounting_loan,
    disburse_loan,
    repay_loan,
)
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine
from app.models.finance import FinancialAccount, FinancialTransaction


@dataclass(frozen=True)
class Org:
    id: str
    timezone: str
    currency: str


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


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency, m.id membership_id
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()
    tenant = Tenant(
        str(row["organization_id"]),
        str(row["user_id"]),
        str(row["membership_id"]),
        "admin",
        Org(str(row["organization_id"]), str(row["timezone"] or "UTC"), str(row["currency"] or "BDT")),
    )
    db = SessionLocal()
    marker = uuid4().hex[:8]
    try:
        account = db.scalar(
            select(FinancialAccount).where(
                FinancialAccount.organization_id == tenant.organization_id,
                FinancialAccount.is_active.is_(True),
                FinancialAccount.currency == tenant.organization.currency,
            ).order_by(FinancialAccount.created_at.asc())
        )
        if account is None:
            account = db.scalar(
                select(FinancialAccount).where(
                    FinancialAccount.organization_id == tenant.organization_id,
                    FinancialAccount.is_active.is_(True),
                ).order_by(FinancialAccount.created_at.asc())
            )
        if account is None:
            raise AssertionError("accounting loan fixture requires an active financial account")

        before_cash_count = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.reference == f"AL-{marker}",
            )
        ) or 0

        loan = create_accounting_loan(
            AccountingLoanCreate(
                lender_name=f"Accounting Bank {marker}",
                lender_type="bank",
                currency=account.currency,
                approved_amount=Decimal("100000"),
                annual_interest_rate=Decimal("10"),
                approval_date=date(2097, 1, 1),
                reference=f"AL-{marker}",
            ),
            request("POST", "/accounting/loans"), db, tenant,  # type: ignore[arg-type]
        )
        if loan["outstanding_principal"] != Decimal("0") or loan["disbursed_amount"] != Decimal("0.00"):
            raise AssertionError("loan approval must not create principal liability")
        after_approval_cash_count = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.reference == f"AL-{marker}",
            )
        ) or 0
        if after_approval_cash_count != before_cash_count:
            raise AssertionError("loan approval must not change cash ledger")

        disbursement = disburse_loan(
            loan["id"],
            LoanDisbursementCreate(
                account_id=account.id,
                disbursement_date=date(2097, 1, 2),
                principal_amount=Decimal("100000"),
                fee_withheld_amount=Decimal("1000"),
                reference=f"ALD-{marker}",
            ),
            request("POST", f"/accounting/loans/{loan['id']}/disburse"), db, tenant,  # type: ignore[arg-type]
        )
        if disbursement["net_received_amount"] != Decimal("99000.00"):
            raise AssertionError("loan disbursement net receipt calculation failed")
        if disbursement["loan"]["outstanding_principal"] != Decimal("100000.00"):
            raise AssertionError("loan disbursement must create outstanding principal")

        repayment = repay_loan(
            loan["id"],
            LoanAccountingRepaymentCreate(
                account_id=account.id,
                payment_date=date(2097, 2, 1),
                principal_amount=Decimal("10000"),
                interest_amount=Decimal("1000"),
                fee_amount=Decimal("500"),
                fee_type="processing_fee",
                reference=f"ALR-{marker}",
            ),
            request("POST", f"/accounting/loans/{loan['id']}/repay"), db, tenant,  # type: ignore[arg-type]
        )
        if repayment["cash_paid"] != Decimal("11500.00"):
            raise AssertionError("loan repayment cash total failed")
        if repayment["loan"]["outstanding_principal"] != Decimal("90000.00"):
            raise AssertionError("interest or fees incorrectly changed principal")

        journal_ids = [disbursement["journal_entry_id"], repayment["journal_entry_id"]]
        journals = db.scalars(
            select(JournalEntry).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.id.in_(journal_ids),
            )
        ).all()
        if len(journals) != 2:
            raise AssertionError("expected disbursement and repayment journal entries")
        for journal in journals:
            totals = db.execute(
                select(func.sum(JournalLine.debit), func.sum(JournalLine.credit)).where(
                    JournalLine.organization_id == tenant.organization_id,
                    JournalLine.journal_entry_id == journal.id,
                )
            ).one()
            if Decimal(totals[0] or 0) != Decimal(totals[1] or 0):
                raise AssertionError(f"journal {journal.entry_number} is not balanced")

        sources = set(db.scalars(
            select(FinancialTransaction.source_type).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.reference.in_([f"ALD-{marker}", f"ALR-{marker}"]),
            )
        ).all())
        if {"loan_disbursement", "loan_repayment_accounting"} - sources:
            raise AssertionError("operational financial-account cash postings are missing")
    finally:
        db.close()
    print("accounting loan verification passed: approval -> disbursement -> balanced journal -> repayment split")


if __name__ == "__main__":
    main()
