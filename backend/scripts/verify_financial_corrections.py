from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.accounting import trial_balance
from app.api.v1.accounting_reports import financial_statements
from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialAccount, FinancialTransaction, Invoice, Payment
from app.services.accounting_sync import sync_operational_accounting
from app.services.activity_log import record_activity


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


def reversal_exists(db, organization_id: str, original_id: str) -> bool:
    return db.scalar(
        select(JournalEntry.id).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.reversed_entry_id == original_id,
        )
    ) is not None


def financial_account_balance(db, organization_id: str, account_id: str) -> Decimal:
    account = db.scalar(
        select(FinancialAccount).where(
            FinancialAccount.id == account_id,
            FinancialAccount.organization_id == organization_id,
        )
    )
    if account is None:
        raise AssertionError("payment financial account fixture missing")
    movements = db.execute(
        select(FinancialTransaction.direction, FinancialTransaction.amount).where(
            FinancialTransaction.organization_id == organization_id,
            FinancialTransaction.account_id == account_id,
        )
    ).all()
    net = sum(
        (Decimal(amount) if direction == "credit" else -Decimal(amount) for direction, amount in movements),
        Decimal("0"),
    )
    return Decimal(account.opening_balance) + net


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
        payment = db.scalar(
            select(Payment)
            .where(
                Payment.organization_id == tenant.organization_id,
                Payment.status == "confirmed",
                Payment.invoice_currency != Payment.account_currency,
            )
            .order_by(Payment.created_at.desc())
        )
        expense = db.scalar(
            select(Expense)
            .where(Expense.organization_id == tenant.organization_id, Expense.status == "posted")
            .order_by(Expense.created_at.desc())
        )
        transfer = db.scalar(
            select(AccountTransfer)
            .where(AccountTransfer.organization_id == tenant.organization_id, AccountTransfer.status == "confirmed")
            .order_by(AccountTransfer.created_at.desc())
        )
        if payment is None or expense is None or transfer is None:
            raise AssertionError("correction verification requires a cross-currency payment, expense and transfer fixtures")

        sync_result = sync_operational_accounting(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            base_currency=tenant.organization.currency,
        )
        record_activity(
            db,
            action="accounting.correction_test.synced",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="organization",
            entity_id=tenant.organization_id,
            after={"sync_counts": sync_result.get("counts", sync_result)},
            message="Prepared accounting journals for correction verification",
            request=request("POST", "/accounting/sync"),
        )
        db.commit()

        invoice = db.scalar(select(Invoice).where(Invoice.id == payment.invoice_id))
        if invoice is None:
            raise AssertionError("payment invoice missing")
        payment_id = payment.id
        invoice_id = invoice.id
        payment_account_id = payment.account_id
        payment_journal = source_journal(db, tenant.organization_id, "invoice_payment", payment_id)
        if payment_journal is None:
            raise AssertionError("cross-currency payment accounting journal fixture missing")

        # A correction must never be dated before the business event it reverses.
        # Otherwise historical trial balances and statements can show a reversal
        # before the original cash/AR movement exists.
        try:
            reverse_business_transaction(
                CorrectionRequest(
                    source_type="payment",
                    source_id=payment_id,
                    reason="CI backdated reversal protection",
                    reversal_date=payment.payment_date - timedelta(days=1),
                ),
                request("POST", "/accounting/corrections/reverse"),
                db,
                tenant,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            db.rollback()
            if exc.status_code != 409 or "cannot be earlier" not in str(exc.detail).lower():
                raise AssertionError(f"unexpected backdated reversal failure: {exc.detail}") from exc
        else:
            raise AssertionError("backdated payment reversal must be rejected")

        db.expire_all()
        payment = db.scalar(select(Payment).where(Payment.id == payment_id))
        invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id))
        payment_journal = source_journal(db, tenant.organization_id, "invoice_payment", payment_id)
        if payment is None or invoice is None or payment_journal is None:
            raise AssertionError("cross-currency payment fixtures missing after backdated reversal rollback")

        before_paid = Decimal(invoice.amount_paid)
        payment_amount = Decimal(payment.invoice_amount)
        account_amount = Decimal(payment.account_amount)
        account_balance_before = financial_account_balance(db, tenant.organization_id, payment_account_id)

        original_rows = db.execute(
            select(JournalLine, LedgerAccount.category, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == payment_journal.id,
                LedgerAccount.organization_id == tenant.organization_id,
            )
        ).all()
        if len(original_rows) < 2:
            raise AssertionError("cross-currency payment journal is not a complete double-entry posting")
        original_snapshot = sorted(
            (
                line.ledger_account_id,
                Decimal(line.debit),
                Decimal(line.credit),
                line.currency,
                Decimal(line.exchange_rate_to_base),
                Decimal(line.original_amount),
            )
            for line, _, _ in original_rows
        )
        original_profit_effect = sum(
            (
                Decimal(line.credit) - Decimal(line.debit)
                for line, category, _ in original_rows
                if category in {"income", "expense"}
            ),
            Decimal("0"),
        )
        has_realized_fx = any(
            system_key in {"realized_fx_gain", "realized_fx_loss"}
            for _, _, system_key in original_rows
        )

        reversal_date = date(2099, 12, 20)
        statements_before = financial_statements(
            db,
            tenant,  # type: ignore[arg-type]
            date_from=payment_journal.entry_date,
            date_to=reversal_date,
        )
        if statements_before.net_profit != statements_before.total_income - statements_before.total_expenses:
            raise AssertionError("pre-reversal P&L does not reconcile")
        if statements_before.total_assets != statements_before.total_liabilities_and_equity:
            raise AssertionError("pre-reversal balance sheet is not balanced")

        reverse_business_transaction(
            CorrectionRequest(
                source_type="payment",
                source_id=payment_id,
                reason="CI cross-currency correction verification",
                reversal_date=reversal_date,
            ),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        payment_after = db.scalar(select(Payment).where(Payment.id == payment_id))
        invoice_after = db.scalar(select(Invoice).where(Invoice.id == invoice_id))
        if payment_after is None or payment_after.status != "reversed":
            raise AssertionError("payment reversal did not mark payment reversed")
        if invoice_after is None or Decimal(invoice_after.amount_paid) != max(Decimal("0"), before_paid - payment_amount):
            raise AssertionError("payment reversal did not restore invoice paid amount")
        expected_due = max(Decimal("0"), Decimal(invoice_after.total) - Decimal(invoice_after.amount_paid))
        if Decimal(invoice_after.balance_due) != expected_due:
            raise AssertionError("payment reversal did not restore invoice receivable balance")

        payment_reversal = db.scalar(
            select(FinancialTransaction).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.account_id == payment_account_id,
                FinancialTransaction.source_id == payment_id,
                FinancialTransaction.source_type.like("payment_reversal%"),
            )
        )
        if payment_reversal is None:
            raise AssertionError("payment financial account movement was not reversed")
        if payment_reversal.currency != payment.account_currency or Decimal(payment_reversal.amount) != account_amount:
            raise AssertionError("cross-currency cash reversal changed the original account amount/currency")
        if payment_reversal.direction != "debit":
            raise AssertionError("customer payment reversal must debit/reduce the receiving financial account")
        account_balance_after = financial_account_balance(db, tenant.organization_id, payment_account_id)
        if account_balance_after != account_balance_before - account_amount:
            raise AssertionError(
                f"payment reversal account balance mismatch: before={account_balance_before} "
                f"after={account_balance_after} payment={account_amount}"
            )

        reversal_journal = db.scalar(
            select(JournalEntry).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.reversed_entry_id == payment_journal.id,
            )
        )
        if reversal_journal is None:
            raise AssertionError("existing payment accounting journal was not reversed")
        reversal_rows = db.execute(
            select(JournalLine, LedgerAccount.category, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == reversal_journal.id,
                LedgerAccount.organization_id == tenant.organization_id,
            )
        ).all()
        reversal_snapshot = sorted(
            (
                line.ledger_account_id,
                Decimal(line.credit),
                Decimal(line.debit),
                line.currency,
                Decimal(line.exchange_rate_to_base),
                Decimal(line.original_amount),
            )
            for line, _, _ in reversal_rows
        )
        if reversal_snapshot != original_snapshot:
            raise AssertionError("reversal journal did not exactly mirror cash, AR and FX lines from the original payment journal")
        reversal_profit_effect = sum(
            (
                Decimal(line.credit) - Decimal(line.debit)
                for line, category, _ in reversal_rows
                if category in {"income", "expense"}
            ),
            Decimal("0"),
        )
        if reversal_profit_effect != -original_profit_effect:
            raise AssertionError("payment reversal did not neutralize the original realized FX P&L effect")
        if has_realized_fx and not any(
            system_key in {"realized_fx_gain", "realized_fx_loss"}
            for _, _, system_key in reversal_rows
        ):
            raise AssertionError("realized FX gain/loss line was not carried into the reversal journal")

        trial = trial_balance(db, tenant, as_of=reversal_date)  # type: ignore[arg-type]
        if trial.total_debit != trial.total_credit:
            raise AssertionError("trial balance became unbalanced after cross-currency payment reversal")
        statements_after = financial_statements(
            db,
            tenant,  # type: ignore[arg-type]
            date_from=payment_journal.entry_date,
            date_to=reversal_date,
        )
        if statements_after.net_profit != statements_after.total_income - statements_after.total_expenses:
            raise AssertionError("post-reversal P&L does not reconcile")
        if statements_after.total_assets != statements_after.total_liabilities_and_equity:
            raise AssertionError("post-reversal balance sheet is not balanced")

        expense_id = expense.id
        expense_journal = source_journal(db, tenant.organization_id, "expense_post", expense_id)
        reverse_business_transaction(
            CorrectionRequest(source_type="expense", source_id=expense_id, reason="CI expense correction", reversal_date=date(2099, 12, 21)),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        expense_after = db.scalar(select(Expense).where(Expense.id == expense_id))
        if expense_after is None or expense_after.status != "voided" or expense_after.voided_at is None:
            raise AssertionError("expense reversal did not void the expense")
        expense_reversal_count = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_id == expense_id,
                FinancialTransaction.source_type.like("expense_reversal%"),
            )
        ) or 0
        if expense_reversal_count != 1:
            raise AssertionError(f"expected one expense financial reversal, found {expense_reversal_count}")
        if expense_journal is not None and not reversal_exists(db, tenant.organization_id, expense_journal.id):
            raise AssertionError("existing expense accounting journal was not reversed")

        transfer_id = transfer.id
        transfer_journal = source_journal(db, tenant.organization_id, "account_transfer", transfer_id)
        original_transfer_movements = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_id == transfer_id,
                FinancialTransaction.source_type.in_(["transfer", "transfer_fee"]),
            )
        ) or 0
        reverse_business_transaction(
            CorrectionRequest(source_type="transfer", source_id=transfer_id, reason="CI transfer correction", reversal_date=date(2099, 12, 22)),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        transfer_after = db.scalar(select(AccountTransfer).where(AccountTransfer.id == transfer_id))
        if transfer_after is None or transfer_after.status != "reversed":
            raise AssertionError("transfer reversal did not mark transfer reversed")
        transfer_reversal_count = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_id == transfer_id,
                FinancialTransaction.source_type.like("transfer_reversal%"),
            )
        ) or 0
        if transfer_reversal_count != original_transfer_movements:
            raise AssertionError(f"expected {original_transfer_movements} transfer reversal movements, found {transfer_reversal_count}")
        if transfer_journal is not None and not reversal_exists(db, tenant.organization_id, transfer_journal.id):
            raise AssertionError("existing transfer accounting journal was not reversed")

        print("financial correction verification passed: cross-currency payment + AR + cash + realized FX + trial balance + P&L/balance sheet, plus expense and transfer reversals")
    finally:
        db.close()


if __name__ == "__main__":
    main()
