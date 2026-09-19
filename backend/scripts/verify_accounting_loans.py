from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.accounting import trial_balance
from app.api.v1.accounting_loan_details import get_loan_history
from app.api.v1.accounting_loans import (
    AccountingLoanCreate,
    LoanAccountingRepaymentCreate,
    LoanDisbursementCreate,
    approve_loan,
    close_loan,
    create_accounting_loan,
    disburse_loan,
    repay_loan,
)
from app.api.v1.accounting_reports import financial_statements
from app.api.v1.finance import create_account
from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance import FinancialAccount, FinancialTransaction
from app.schemas.finance import FinancialAccountCreate
from app.services.exchange_rates import record_rate_snapshot


@dataclass(frozen=True)
class Org:
    id: str
    timezone: str
    currency: str
    name: str
    financial_year_start_month: int


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


def expect_conflict(fn, label: str) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != 409:
            raise AssertionError(f"{label}: expected 409, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"{label}: expected HTTP 409")


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency, o.name,
                   o.financial_year_start_month, m.id membership_id
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
        Org(
            str(row["organization_id"]),
            str(row["timezone"] or "UTC"),
            str(row["currency"] or "BDT"),
            str(row["name"]),
            int(row["financial_year_start_month"] or 1),
        ),
    )
    db = SessionLocal()
    marker = uuid4().hex[:8]
    try:
        account = db.scalar(
            select(FinancialAccount).where(
                FinancialAccount.organization_id == tenant.organization_id,
                FinancialAccount.is_active.is_(True),
                FinancialAccount.currency == tenant.organization.currency,
                FinancialAccount.account_type != "credit_card",
            ).order_by(FinancialAccount.created_at.asc())
        )
        if account is None:
            account = db.scalar(
                select(FinancialAccount).where(
                    FinancialAccount.organization_id == tenant.organization_id,
                    FinancialAccount.is_active.is_(True),
                    FinancialAccount.account_type != "credit_card",
                ).order_by(FinancialAccount.created_at.asc())
            )
        if account is None:
            raise AssertionError("accounting loan fixture requires an active non-card financial account")

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
        if loan["status"] != "draft":
            raise AssertionError("new accounting loan must start in draft status")
        if loan["outstanding_principal"] != Decimal("0") or loan["disbursed_amount"] != Decimal("0.00"):
            raise AssertionError("draft loan must not create principal liability")

        blocked_payload = LoanDisbursementCreate(
            account_id=account.id,
            disbursement_date=date(2097, 1, 2),
            principal_amount=Decimal("100000"),
            fee_withheld_amount=Decimal("1000"),
            reference=f"ALD-{marker}",
        )
        expect_conflict(
            lambda: disburse_loan(
                loan["id"], blocked_payload,
                request("POST", f"/accounting/loans/{loan['id']}/disburse"), db, tenant,  # type: ignore[arg-type]
            ),
            "draft loan disbursement",
        )
        db.rollback()

        approved = approve_loan(
            loan["id"],
            request("POST", f"/accounting/loans/{loan['id']}/approve"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if approved["status"] != "approved":
            raise AssertionError("loan approval transition failed")
        after_approval_cash_count = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.reference == f"AL-{marker}",
            )
        ) or 0
        if after_approval_cash_count != before_cash_count:
            raise AssertionError("loan approval must not change cash ledger")

        expect_conflict(
            lambda: disburse_loan(
                loan["id"],
                LoanDisbursementCreate(
                    account_id=account.id,
                    disbursement_date=date(2096, 12, 31),
                    principal_amount=Decimal("1000"),
                    reference=f"ALD-EARLY-{marker}",
                ),
                request("POST", f"/accounting/loans/{loan['id']}/disburse"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
            "loan disbursement before approval",
        )
        db.rollback()

        disbursement = disburse_loan(
            loan["id"], blocked_payload,
            request("POST", f"/accounting/loans/{loan['id']}/disburse"), db, tenant,  # type: ignore[arg-type]
        )
        if disbursement["net_received_amount"] != Decimal("99000.00"):
            raise AssertionError("loan disbursement net receipt calculation failed")
        if disbursement["loan"]["outstanding_principal"] != Decimal("100000.00"):
            raise AssertionError("loan disbursement must create outstanding principal")
        if disbursement["loan"]["status"] != "active":
            raise AssertionError("disbursement must activate the loan")

        expect_conflict(
            lambda: repay_loan(
                loan["id"],
                LoanAccountingRepaymentCreate(
                    account_id=account.id,
                    payment_date=date(2097, 1, 1),
                    principal_amount=Decimal("1"),
                    reference=f"ALR-EARLY-{marker}",
                ),
                request("POST", f"/accounting/loans/{loan['id']}/repay"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
            "loan repayment before first disbursement",
        )
        db.rollback()

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
        expect_conflict(
            lambda: close_loan(
                loan["id"],
                request("POST", f"/accounting/loans/{loan['id']}/close"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
            "close loan with outstanding principal",
        )
        db.rollback()

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

        fx_marker = uuid4().hex[:8]
        foreign_currency = "EUR" if tenant.organization.currency.upper() != "EUR" else "USD"
        fx_disbursement_date = date(2098, 1, 2)
        fx_first_repayment_date = date(2098, 2, 1)
        fx_reversal_date = date(2098, 2, 2)
        fx_final_repayment_date = date(2098, 3, 1)

        for effective_date, fx_rate in (
            (fx_disbursement_date, Decimal("120.00000000")),
            (fx_first_repayment_date, Decimal("125.00000000")),
            (fx_final_repayment_date, Decimal("130.00000000")),
        ):
            record_rate_snapshot(
                db,
                organization_id=tenant.organization_id,
                base_currency=foreign_currency,
                quote_currency=tenant.organization.currency,
                effective_date=effective_date,
                reference_rate=fx_rate,
                effective_rate=fx_rate,
                source="ci_foreign_loan_verification",
                user_id=tenant.user_id,
            )

        fx_account = create_account(
            FinancialAccountCreate(
                name=f"CI Foreign Loan Bank {fx_marker}",
                account_type="bank",
                currency=foreign_currency,
                opening_balance=Decimal("0"),
            ),
            request("POST", "/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        fx_loan = create_accounting_loan(
            AccountingLoanCreate(
                lender_name=f"Foreign Accounting Bank {fx_marker}",
                lender_type="bank",
                currency=foreign_currency,
                approved_amount=Decimal("1000"),
                annual_interest_rate=Decimal("6"),
                approval_date=date(2098, 1, 1),
                reference=f"FXL-{fx_marker}",
            ),
            request("POST", "/accounting/loans"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        approve_loan(
            fx_loan["id"],
            request("POST", f"/accounting/loans/{fx_loan['id']}/approve"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        fx_disbursement = disburse_loan(
            fx_loan["id"],
            LoanDisbursementCreate(
                account_id=fx_account.id,
                disbursement_date=fx_disbursement_date,
                principal_amount=Decimal("1000"),
                reference=f"FXLD-{fx_marker}",
            ),
            request("POST", f"/accounting/loans/{fx_loan['id']}/disburse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if fx_disbursement["loan"]["outstanding_principal"] != Decimal("1000.00"):
            raise AssertionError("foreign loan disbursement did not create principal liability")

        fx_repayment = repay_loan(
            fx_loan["id"],
            LoanAccountingRepaymentCreate(
                account_id=fx_account.id,
                payment_date=fx_first_repayment_date,
                principal_amount=Decimal("400"),
                interest_amount=Decimal("30"),
                fee_amount=Decimal("10"),
                fee_type="processing_fee",
                reference=f"FXLR1-{fx_marker}",
            ),
            request("POST", f"/accounting/loans/{fx_loan['id']}/repay"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if fx_repayment["cash_paid"] != Decimal("440.00"):
            raise AssertionError("foreign loan repayment cash amount is incorrect")
        if fx_repayment["loan"]["outstanding_principal"] != Decimal("600.00"):
            raise AssertionError("foreign loan repayment changed principal incorrectly")

        fx_repayment_journal = db.scalar(
            select(JournalEntry).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.id == fx_repayment["journal_entry_id"],
            )
        )
        if fx_repayment_journal is None:
            raise AssertionError("foreign loan repayment journal missing")
        fx_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == fx_repayment_journal.id,
                LedgerAccount.organization_id == tenant.organization_id,
            )
        ).all()
        principal_base = sum(
            (Decimal(line.debit) for line, key in fx_lines if key == "loans_payable"),
            Decimal("0"),
        )
        interest_base = sum(
            (Decimal(line.debit) for line, key in fx_lines if key == "interest_expense"),
            Decimal("0"),
        )
        fee_base = sum(
            (Decimal(line.debit) for line, key in fx_lines if key == "bank_fees"),
            Decimal("0"),
        )
        fx_loss = sum(
            (Decimal(line.debit) for line, key in fx_lines if key == "realized_fx_loss"),
            Decimal("0"),
        )
        if principal_base != Decimal("48000.00"):
            raise AssertionError(
                f"foreign loan principal must settle at carrying value 48000.00, got {principal_base}"
            )
        if interest_base != Decimal("3750.00") or fee_base != Decimal("1250.00"):
            raise AssertionError("foreign loan interest/fee were not translated at repayment-date FX")
        if fx_loss != Decimal("2000.00"):
            raise AssertionError(f"foreign loan realized FX loss should be 2000.00, got {fx_loss}")

        reverse_business_transaction(
            CorrectionRequest(
                source_type="loan_repayment",
                source_id=fx_repayment["id"],
                reason="CI reverse foreign loan repayment",
                reversal_date=fx_reversal_date,
            ),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        fx_loan_after_reversal = db.scalar(
            select(FinancialTransaction.id).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_type.like("loan_repayment_reversal%"),
                FinancialTransaction.source_id == fx_repayment["id"],
            )
        )
        if fx_loan_after_reversal is None:
            raise AssertionError("foreign loan repayment cash reversal is missing")

        fx_history = get_loan_history(fx_loan["id"], db, tenant)  # type: ignore[arg-type]
        reversed_history_item = next(
            (item for item in fx_history["repayments"] if item["id"] == fx_repayment["id"]),
            None,
        )
        if reversed_history_item is None or reversed_history_item["status"] != "reversed":
            raise AssertionError("loan history must expose reversed repayment status")

        final_repayment = repay_loan(
            fx_loan["id"],
            LoanAccountingRepaymentCreate(
                account_id=fx_account.id,
                payment_date=fx_final_repayment_date,
                principal_amount=Decimal("1000"),
                reference=f"FXLR2-{fx_marker}",
            ),
            request("POST", f"/accounting/loans/{fx_loan['id']}/repay"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if final_repayment["loan"]["outstanding_principal"] != Decimal("0.00"):
            raise AssertionError("foreign loan final repayment did not clear principal")
        if final_repayment["loan"]["status"] != "paid":
            raise AssertionError("foreign loan must become paid after final principal settlement")

        final_journal = db.scalar(
            select(JournalEntry).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.id == final_repayment["journal_entry_id"],
            )
        )
        if final_journal is None:
            raise AssertionError("foreign loan final repayment journal missing")
        final_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == final_journal.id,
                LedgerAccount.organization_id == tenant.organization_id,
            )
        ).all()
        final_principal_base = sum(
            (Decimal(line.debit) for line, key in final_lines if key == "loans_payable"),
            Decimal("0"),
        )
        final_fx_loss = sum(
            (Decimal(line.debit) for line, key in final_lines if key == "realized_fx_loss"),
            Decimal("0"),
        )
        if final_principal_base != Decimal("120000.00"):
            raise AssertionError(
                f"reversed repayment must not reduce remaining loan carrying value; got {final_principal_base}"
            )
        if final_fx_loss != Decimal("10000.00"):
            raise AssertionError(f"final foreign-loan FX loss should be 10000.00, got {final_fx_loss}")

        operational_balance = Decimal(fx_account.opening_balance) + sum(
            (
                Decimal(amount) if direction == "credit" else -Decimal(amount)
                for direction, amount in db.execute(
                    select(FinancialTransaction.direction, FinancialTransaction.amount).where(
                        FinancialTransaction.organization_id == tenant.organization_id,
                        FinancialTransaction.account_id == fx_account.id,
                    )
                ).all()
            ),
            Decimal("0"),
        )
        if operational_balance != Decimal("0.00"):
            raise AssertionError(
                f"foreign loan operational financial account did not reconcile to zero: {operational_balance}"
            )

        trial = trial_balance(db, tenant, as_of=fx_final_repayment_date)  # type: ignore[arg-type]
        if trial.total_debit != trial.total_credit:
            raise AssertionError("trial balance became unbalanced after foreign loan settlement")
        statements = financial_statements(
            db,
            tenant,  # type: ignore[arg-type]
            date_from=date(2098, 1, 1),
            date_to=fx_final_repayment_date,
        )
        if statements.net_profit != statements.total_income - statements.total_expenses:
            raise AssertionError("P&L does not reconcile after foreign loan settlement")
        if statements.total_assets != statements.total_liabilities_and_equity:
            raise AssertionError("balance sheet does not balance after foreign loan settlement")

        fx_closed = close_loan(
            fx_loan["id"],
            request("POST", f"/accounting/loans/{fx_loan['id']}/close"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if fx_closed["status"] != "closed":
            raise AssertionError("foreign fully repaid loan did not close")

        close_marker = uuid4().hex[:8]
        close_loan_row = create_accounting_loan(
            AccountingLoanCreate(
                lender_name=f"Close Lifecycle Bank {close_marker}",
                lender_type="bank",
                currency=account.currency,
                approved_amount=Decimal("1000"),
                annual_interest_rate=Decimal("0"),
                approval_date=date(2097, 3, 1),
                reference=f"ALC-{close_marker}",
            ),
            request("POST", "/accounting/loans"), db, tenant,  # type: ignore[arg-type]
        )
        approve_loan(
            close_loan_row["id"],
            request("POST", f"/accounting/loans/{close_loan_row['id']}/approve"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        disburse_loan(
            close_loan_row["id"],
            LoanDisbursementCreate(
                account_id=account.id,
                disbursement_date=date(2097, 3, 2),
                principal_amount=Decimal("1000"),
                reference=f"ALC-D-{close_marker}",
            ),
            request("POST", f"/accounting/loans/{close_loan_row['id']}/disburse"), db, tenant,  # type: ignore[arg-type]
        )
        paid = repay_loan(
            close_loan_row["id"],
            LoanAccountingRepaymentCreate(
                account_id=account.id,
                payment_date=date(2097, 3, 3),
                principal_amount=Decimal("1000"),
                reference=f"ALC-R-{close_marker}",
            ),
            request("POST", f"/accounting/loans/{close_loan_row['id']}/repay"), db, tenant,  # type: ignore[arg-type]
        )
        if paid["loan"]["status"] != "paid":
            raise AssertionError("fully repaid loan must become paid")
        closed = close_loan(
            close_loan_row["id"],
            request("POST", f"/accounting/loans/{close_loan_row['id']}/close"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if closed["status"] != "closed" or closed["outstanding_principal"] != Decimal("0.00"):
            raise AssertionError("paid loan did not close cleanly")
    finally:
        db.close()
    print("accounting loan verification passed: lifecycle + principal/interest/fee + foreign-currency carrying value + repayment reversal + realized FX + reports + close")


if __name__ == "__main__":
    main()
