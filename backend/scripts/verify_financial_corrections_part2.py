from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.accounting import trial_balance
from app.api.v1.accounting_reports import financial_statements
from app.api.v1.finance import create_account
from app.api.v1.financial_corrections import CorrectionRequest, correction_candidates, reverse_business_transaction
from app.api.v1.payables import pay_payable_bill
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.capital import CompanyLoan, LoanRepayment
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.loan_accounting import LoanDisbursement, LoanFee
from app.models.payables import PayableBill, PayablePayment
from app.schemas.finance import FinancialAccountCreate
from app.schemas.payables import PayablePaymentCreate
from app.services.accounting_posting import PostingLine, post_journal, system_account
from app.services.activity_log import record_activity
from app.services.exchange_rates import record_rate_snapshot
from app.services.functional_currency import functional_currency_for_date


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
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency, o.name,
                   o.financial_year_start_month, m.id membership_id
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
            financial_year_start_month=int(row["financial_year_start_month"] or 1),
        ),
    )

    db = SessionLocal()
    try:
        marker = uuid4().hex[:8]
        bill_date = date(2099, 11, 1)
        first_payment_date = date(2099, 11, 2)
        reversal_date = date(2099, 11, 3)
        replacement_payment_date = date(2099, 11, 4)
        base_currency = functional_currency_for_date(db, tenant.organization_id, bill_date)
        foreign_currency = "EUR" if base_currency != "EUR" else "USD"

        for effective_date, fx_rate in (
            (bill_date, Decimal("120.00000000")),
            (first_payment_date, Decimal("125.00000000")),
            (replacement_payment_date, Decimal("130.00000000")),
        ):
            record_rate_snapshot(
                db,
                organization_id=tenant.organization_id,
                base_currency=foreign_currency,
                quote_currency=base_currency,
                effective_date=effective_date,
                reference_rate=fx_rate,
                effective_rate=fx_rate,
                source="ci_payable_correction_verification",
                user_id=tenant.user_id,
            )

        card = create_account(
            FinancialAccountCreate(
                name=f"CI FX AP Card {marker}",
                account_type="credit_card",
                currency=foreign_currency,
                opening_balance=Decimal("0"),
            ),
            request("POST", "/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        expense = system_account(db, tenant.organization_id, "operating_expenses")
        payable_account = system_account(db, tenant.organization_id, "accounts_payable")
        withholding_account = system_account(db, tenant.organization_id, "taxes_payable")

        bill = PayableBill(
            organization_id=tenant.organization_id,
            bill_number=f"BILL-FX-{marker.upper()}",
            supplier_name="CI FX Supplier",
            bill_date=bill_date,
            due_date=replacement_payment_date,
            currency=foreign_currency,
            subtotal_amount=Decimal("110.00"),
            tax_code_id=None,
            tax_rate_snapshot=None,
            input_tax_amount=Decimal("0.00"),
            recoverable_tax_amount=Decimal("0.00"),
            withholding_tax_code_id=None,
            withholding_rate_snapshot=Decimal("9.0909"),
            withholding_tax_amount=Decimal("10.00"),
            original_amount=Decimal("110.00"),
            net_payable_amount=Decimal("100.00"),
            amount_paid=Decimal("0.00"),
            balance_due=Decimal("100.00"),
            expense_ledger_account_id=expense.id,
            description="CI foreign payable correction verification",
            reference=f"CI-FX-AP-{marker}",
            notes="Withholding fixture: gross 110, net payable 100",
            status="open",
            created_by_user_id=tenant.user_id,
        )
        db.add(bill)
        db.flush()
        post_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            entry_date=bill_date,
            source_type="payable_bill",
            source_id=bill.id,
            lines=[
                PostingLine(
                    ledger_account_id=expense.id,
                    debit=Decimal("110.00"),
                    currency=foreign_currency,
                    description=bill.description,
                ),
                PostingLine(
                    ledger_account_id=payable_account.id,
                    credit=Decimal("100.00"),
                    currency=foreign_currency,
                    description=f"Payable to {bill.supplier_name}",
                ),
                PostingLine(
                    ledger_account_id=withholding_account.id,
                    credit=Decimal("10.00"),
                    currency=foreign_currency,
                    description=f"Withholding on {bill.bill_number}",
                ),
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
            after={
                "supplier_name": bill.supplier_name,
                "gross": str(bill.original_amount),
                "net_payable": str(bill.net_payable_amount),
                "withholding_tax": str(bill.withholding_tax_amount),
                "currency": bill.currency,
            },
            message=f"CI payable fixture recorded: {bill.bill_number}",
            request=request("POST", "/accounting/payables"),
        )
        db.commit()
        db.refresh(bill)

        first_payment = pay_payable_bill(
            bill.id,
            PayablePaymentCreate(
                financial_account_id=card.id,
                payment_date=first_payment_date,
                amount=Decimal("40.00"),
                reference=f"CI-FX-AP-P1-{marker}",
            ),
            request("POST", f"/accounting/payables/{bill.id}/payments"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        payable_journal = source_journal(db, tenant.organization_id, "payable_payment", first_payment.id)
        if payable_journal is None:
            raise AssertionError("foreign payable payment journal fixture missing")

        first_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == payable_journal.id,
                LedgerAccount.organization_id == tenant.organization_id,
            )
        ).all()
        first_ap = sum(
            (Decimal(line.debit) for line, key in first_lines if key == "accounts_payable"),
            Decimal("0"),
        )
        first_fx_loss = sum(
            (Decimal(line.debit) for line, key in first_lines if key == "realized_fx_loss"),
            Decimal("0"),
        )
        if first_ap != Decimal("4800.00") or first_fx_loss != Decimal("200.00"):
            raise AssertionError(
                f"foreign payable settlement basis is incorrect: AP={first_ap}, FX loss={first_fx_loss}"
            )

        reverse_business_transaction(
            CorrectionRequest(
                source_type="payable_payment",
                source_id=first_payment.id,
                reason="CI supplier FX payment correction",
                reversal_date=reversal_date,
            ),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        bill_after = db.scalar(select(PayableBill).where(PayableBill.id == bill.id))
        if bill_after is None:
            raise AssertionError("payable bill missing after reversal")
        if Decimal(bill_after.amount_paid) != Decimal("0.00"):
            raise AssertionError("payable reversal did not restore amount paid")
        if Decimal(bill_after.balance_due) != Decimal(bill_after.net_payable_amount):
            raise AssertionError(
                "payable reversal restored gross original amount instead of net supplier payable after withholding"
            )
        if Decimal(bill_after.balance_due) != Decimal("100.00"):
            raise AssertionError("withholding payable reversal did not restore the expected net payable balance")
        if reversal_movements(db, tenant.organization_id, first_payment.id, "payable_payment_reversal") != 1:
            raise AssertionError("payable payment financial account movement was not reversed exactly once")
        if not journal_reversed(db, tenant.organization_id, payable_journal.id):
            raise AssertionError("payable payment accounting journal was not reversed")

        replacement_payment = pay_payable_bill(
            bill.id,
            PayablePaymentCreate(
                financial_account_id=card.id,
                payment_date=replacement_payment_date,
                amount=Decimal("100.00"),
                reference=f"CI-FX-AP-P2-{marker}",
            ),
            request("POST", f"/accounting/payables/{bill.id}/payments"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        replacement_journal = source_journal(
            db,
            tenant.organization_id,
            "payable_payment",
            replacement_payment.id,
        )
        if replacement_journal is None:
            raise AssertionError("replacement payable payment journal missing")
        replacement_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == replacement_journal.id,
                LedgerAccount.organization_id == tenant.organization_id,
            )
        ).all()
        replacement_ap = sum(
            (Decimal(line.debit) for line, key in replacement_lines if key == "accounts_payable"),
            Decimal("0"),
        )
        replacement_fx_loss = sum(
            (Decimal(line.debit) for line, key in replacement_lines if key == "realized_fx_loss"),
            Decimal("0"),
        )
        if replacement_ap != Decimal("12000.00"):
            raise AssertionError(
                f"reversed supplier payment was still counted in AP carrying value; expected 12000.00, got {replacement_ap}"
            )
        if replacement_fx_loss != Decimal("1000.00"):
            raise AssertionError(
                f"replacement supplier payment realized FX loss is incorrect; expected 1000.00, got {replacement_fx_loss}"
            )

        db.expire_all()
        bill_paid = db.scalar(select(PayableBill).where(PayableBill.id == bill.id))
        if bill_paid is None or bill_paid.status != "paid":
            raise AssertionError("replacement supplier payment did not settle the bill")
        if Decimal(bill_paid.amount_paid) != Decimal("100.00") or Decimal(bill_paid.balance_due) != Decimal("0.00"):
            raise AssertionError("replacement supplier payment did not reconcile AP subledger")

        account = db.scalar(
            select(FinancialAccount).where(
                FinancialAccount.id == card.id,
                FinancialAccount.organization_id == tenant.organization_id,
            )
        )
        if account is None:
            raise AssertionError("foreign payable financial account missing")
        account_net = db.execute(
            select(FinancialTransaction.direction, FinancialTransaction.amount).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.account_id == card.id,
            )
        ).all()
        account_balance = Decimal(account.opening_balance) + sum(
            (
                Decimal(amount) if direction == "credit" else -Decimal(amount)
                for direction, amount in account_net
            ),
            Decimal("0"),
        )
        if account_balance != Decimal("100.00"):
            raise AssertionError(
                f"payable correction did not reconcile financial account balance; expected 100.00, got {account_balance}"
            )

        card_ledger = db.scalar(
            select(LedgerAccount).where(
                LedgerAccount.organization_id == tenant.organization_id,
                LedgerAccount.system_key == f"financial_account:{card.id}",
            )
        )
        if card_ledger is None:
            raise AssertionError("foreign payable financial ledger mapping missing")
        card_base_balance = db.execute(
            select(
                func.coalesce(func.sum(JournalLine.credit), 0),
                func.coalesce(func.sum(JournalLine.debit), 0),
            )
            .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.status == "posted",
                JournalLine.ledger_account_id == card_ledger.id,
            )
        ).one()
        if Decimal(card_base_balance[0]) - Decimal(card_base_balance[1]) != Decimal("13000.00"):
            raise AssertionError("financial-account GL liability does not reconcile after payable reversal and replacement payment")

        trial = trial_balance(db, tenant, as_of=replacement_payment_date)  # type: ignore[arg-type]
        if trial.total_debit != trial.total_credit:
            raise AssertionError("trial balance became unbalanced after payable reversal and replacement payment")
        statements = financial_statements(
            db,
            tenant,  # type: ignore[arg-type]
            date_from=bill_date,
            date_to=replacement_payment_date,
        )
        if statements.net_profit != statements.total_income - statements.total_expenses:
            raise AssertionError("P&L does not reconcile after payable correction")
        if statements.total_assets != statements.total_liabilities_and_equity:
            raise AssertionError("balance sheet does not balance after payable correction")

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
            ("payable_payment", first_payment.id),
            ("loan_repayment", repayment.id),
            ("loan_disbursement", disbursement.id),
        ]:
            if key in candidate_keys:
                raise AssertionError(f"reversed source still appears as correction candidate: {key}")

        print("financial correction part 2 verification passed: withholding-aware FX payable reversal -> AP/cash/GL/reports + loan repayment + dependency-safe loan disbursement reversal")
    finally:
        db.close()


if __name__ == "__main__":
    main()
