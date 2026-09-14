from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select

from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialAccount, FinancialTransaction, Invoice, Payment
from app.services.accounting_posting import money


MAX_ISSUE_DETAILS = 200


def _append_issue(issues: list[str], message: str) -> None:
    if len(issues) < MAX_ISSUE_DETAILS:
        issues.append(message)


def _posted_source_ids(db, organization_id: str, source_type: str) -> set[str]:
    return set(
        db.scalars(
            select(JournalEntry.source_id).where(
                JournalEntry.organization_id == organization_id,
                JournalEntry.source_type == source_type,
                JournalEntry.status == "posted",
                JournalEntry.source_id.is_not(None),
            )
        ).all()
    )


def audit_financial_integrity(db, organization_id: str) -> dict:
    """Read-only integrity audit across operational finance and the General Ledger.

    Financial-account equality is checked in each account's own currency using
    JournalLine.original_amount, never by mixing source currencies with functional
    ledger amounts.
    """

    issues: list[str] = []
    counts = {
        "financial_accounts_checked": 0,
        "account_balance_mismatches": 0,
        "missing_opening_journals": 0,
        "missing_invoice_journals": 0,
        "missing_payment_journals": 0,
        "missing_expense_journals": 0,
        "missing_transfer_journals": 0,
        "unbalanced_journals": 0,
        "issue_count": 0,
    }

    accounts = db.scalars(
        select(FinancialAccount).where(FinancialAccount.organization_id == organization_id)
    ).all()
    transaction_rows = db.execute(
        select(
            FinancialTransaction.account_id,
            FinancialTransaction.direction,
            FinancialTransaction.amount,
        ).where(FinancialTransaction.organization_id == organization_id)
    ).all()
    transaction_effect: dict[str, Decimal] = {}
    for account_id, direction, amount in transaction_rows:
        effect = Decimal(amount) if direction == "credit" else -Decimal(amount)
        transaction_effect[str(account_id)] = transaction_effect.get(
            str(account_id), Decimal("0")
        ) + effect

    opening_posted = _posted_source_ids(db, organization_id, "financial_account_opening_balance")
    opening_posted.update(_posted_source_ids(db, organization_id, "financial_account_opening_sync"))

    for account in accounts:
        counts["financial_accounts_checked"] += 1
        operational_balance = money(
            Decimal(account.opening_balance)
            + transaction_effect.get(account.id, Decimal("0"))
        )
        ledger = db.scalar(
            select(LedgerAccount).where(
                LedgerAccount.organization_id == organization_id,
                LedgerAccount.system_key == f"financial_account:{account.id}",
            )
        )

        if Decimal(account.opening_balance) != 0 and account.id not in opening_posted:
            counts["missing_opening_journals"] += 1
            _append_issue(
                issues,
                f"Financial account {account.name} ({account.id}) is missing its opening-balance journal",
            )

        if ledger is None:
            if operational_balance != 0:
                counts["account_balance_mismatches"] += 1
                _append_issue(
                    issues,
                    (
                        f"Financial account {account.name} ({account.id}) has operational balance "
                        f"{operational_balance} {account.currency} but no mapped ledger account"
                    ),
                )
            continue

        source_lines = db.execute(
            select(
                JournalLine.currency,
                JournalLine.debit,
                JournalLine.credit,
                JournalLine.original_amount,
            )
            .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
            .where(
                JournalLine.organization_id == organization_id,
                JournalLine.ledger_account_id == ledger.id,
                JournalEntry.organization_id == organization_id,
                JournalEntry.status == "posted",
            )
        ).all()
        gl_source_balance = Decimal("0")
        for line_currency, debit, credit, original_amount in source_lines:
            if str(line_currency).upper() != account.currency.upper():
                continue
            original = Decimal(original_amount or 0)
            if ledger.normal_balance == "credit":
                gl_source_balance += original if Decimal(credit or 0) > 0 else -original
            else:
                gl_source_balance += original if Decimal(debit or 0) > 0 else -original
        gl_source_balance = money(gl_source_balance)

        if operational_balance != gl_source_balance:
            counts["account_balance_mismatches"] += 1
            _append_issue(
                issues,
                (
                    f"Financial account {account.name} ({account.id}) mismatch in {account.currency}: "
                    f"operational={operational_balance}, GL source balance={gl_source_balance}"
                ),
            )

    invoice_ids = set(
        db.scalars(
            select(Invoice.id).where(
                Invoice.organization_id == organization_id,
                Invoice.status.not_in(["draft", "cancelled"]),
            )
        ).all()
    )
    missing_invoice = invoice_ids - _posted_source_ids(db, organization_id, "invoice_issue")
    counts["missing_invoice_journals"] = len(missing_invoice)
    for source_id in sorted(missing_invoice):
        _append_issue(issues, f"Invoice {source_id} is missing invoice_issue journal")

    payment_ids = set(
        db.scalars(
            select(Payment.id).where(
                Payment.organization_id == organization_id,
                Payment.status == "confirmed",
            )
        ).all()
    )
    missing_payment = payment_ids - _posted_source_ids(db, organization_id, "invoice_payment")
    counts["missing_payment_journals"] = len(missing_payment)
    for source_id in sorted(missing_payment):
        _append_issue(issues, f"Payment {source_id} is missing invoice_payment journal")

    expense_ids = set(
        db.scalars(
            select(Expense.id).where(
                Expense.organization_id == organization_id,
                Expense.status == "posted",
            )
        ).all()
    )
    missing_expense = expense_ids - _posted_source_ids(db, organization_id, "expense_post")
    counts["missing_expense_journals"] = len(missing_expense)
    for source_id in sorted(missing_expense):
        _append_issue(issues, f"Expense {source_id} is missing expense_post journal")

    transfer_ids = set(
        db.scalars(
            select(AccountTransfer.id).where(
                AccountTransfer.organization_id == organization_id,
                AccountTransfer.status == "confirmed",
            )
        ).all()
    )
    missing_transfer = transfer_ids - _posted_source_ids(db, organization_id, "account_transfer")
    counts["missing_transfer_journals"] = len(missing_transfer)
    for source_id in sorted(missing_transfer):
        _append_issue(issues, f"Transfer {source_id} is missing account_transfer journal")

    journal_totals = db.execute(
        select(
            JournalEntry.id,
            JournalEntry.entry_number,
            func.coalesce(func.sum(JournalLine.debit), 0),
            func.coalesce(func.sum(JournalLine.credit), 0),
        )
        .join(JournalLine, JournalLine.journal_entry_id == JournalEntry.id)
        .where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.status == "posted",
            JournalLine.organization_id == organization_id,
        )
        .group_by(JournalEntry.id, JournalEntry.entry_number)
    ).all()
    for journal_id, entry_number, debit, credit in journal_totals:
        if money(Decimal(debit or 0)) != money(Decimal(credit or 0)):
            counts["unbalanced_journals"] += 1
            _append_issue(
                issues,
                f"Journal {entry_number} ({journal_id}) is unbalanced: debit={debit}, credit={credit}",
            )

    counts["issue_count"] = (
        counts["account_balance_mismatches"]
        + counts["missing_opening_journals"]
        + counts["missing_invoice_journals"]
        + counts["missing_payment_journals"]
        + counts["missing_expense_journals"]
        + counts["missing_transfer_journals"]
        + counts["unbalanced_journals"]
    )
    return {"counts": counts, "issues": issues}
