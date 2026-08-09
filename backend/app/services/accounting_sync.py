from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from app.models.accounting import JournalEntry
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import AccountTransfer, FinancialAccount, Invoice, Payment
from app.services.accounting_posting import PostingLine, financial_ledger_account, money, post_journal, system_account, to_base_amount


def _already_posted(db, organization_id: str, source_type: str, source_id: str) -> bool:
    return db.scalar(
        select(JournalEntry.id).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
        )
    ) is not None


def sync_operational_accounting(db, *, organization_id: str, user_id: str, base_currency: str) -> dict:
    counts = {"opening_balances": 0, "invoices": 0, "payments": 0, "expenses": 0, "transfers": 0}
    errors: list[str] = []
    base_currency = base_currency.upper()

    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id == organization_id)).all()
    for account in accounts:
        opening = money(account.opening_balance)
        if opening == 0:
            continue
        if db.scalar(
            select(JournalEntry.id).where(
                JournalEntry.organization_id == organization_id,
                JournalEntry.source_id == account.id,
                JournalEntry.source_type.in_(["financial_account_opening_balance", "financial_account_opening_sync"]),
            )
        ) is not None:
            continue
        try:
            _, ledger = financial_ledger_account(db, organization_id, account.id)
            equity = system_account(db, organization_id, "opening_balance_equity")
            base_amount, rate = to_base_amount(db, organization_id, base_currency, abs(opening), account.currency)
            if account.account_type == "credit_card":
                lines = [
                    PostingLine(ledger_account_id=equity.id, debit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=abs(opening), description="Opening credit card balance"),
                    PostingLine(ledger_account_id=ledger.id, credit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=abs(opening), description=account.name),
                ]
            elif opening > 0:
                lines = [
                    PostingLine(ledger_account_id=ledger.id, debit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=opening, description=account.name),
                    PostingLine(ledger_account_id=equity.id, credit=base_amount, currency=base_currency, original_amount=base_amount, description="Opening balance equity"),
                ]
            else:
                lines = [
                    PostingLine(ledger_account_id=equity.id, debit=base_amount, currency=base_currency, original_amount=base_amount, description="Opening balance equity"),
                    PostingLine(ledger_account_id=ledger.id, credit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=abs(opening), description=account.name),
                ]
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=account.created_at.date(), source_type="financial_account_opening_sync", source_id=account.id, lines=lines, reference=account.account_reference, memo=f"Opening balance for {account.name}")
            counts["opening_balances"] += 1
        except HTTPException as exc:
            errors.append(f"Opening balance {account.name}: {exc.detail}")

    invoices = db.scalars(
        select(Invoice).where(
            Invoice.organization_id == organization_id,
            Invoice.status.not_in(["draft", "cancelled"]),
        )
    ).all()
    for invoice in invoices:
        if _already_posted(db, organization_id, "invoice_issue", invoice.id):
            continue
        try:
            ar = system_account(db, organization_id, "accounts_receivable")
            revenue = system_account(db, organization_id, "service_revenue")
            tax_payable = system_account(db, organization_id, "taxes_payable")
            total_base, rate = to_base_amount(db, organization_id, base_currency, Decimal(invoice.total), invoice.currency)
            tax_base, _ = to_base_amount(db, organization_id, base_currency, Decimal(invoice.tax_total), invoice.currency) if Decimal(invoice.tax_total) > 0 else (Decimal("0"), rate)
            revenue_base = money(total_base - tax_base)
            lines = [PostingLine(ledger_account_id=ar.id, debit=total_base, currency=invoice.currency, exchange_rate_to_base=rate, original_amount=invoice.total, description=f"Invoice {invoice.invoice_number}")]
            if revenue_base > 0:
                lines.append(PostingLine(ledger_account_id=revenue.id, credit=revenue_base, currency=invoice.currency, exchange_rate_to_base=rate, original_amount=money(Decimal(invoice.total) - Decimal(invoice.tax_total)), description=invoice.subject or invoice.invoice_number))
            if tax_base > 0:
                lines.append(PostingLine(ledger_account_id=tax_payable.id, credit=tax_base, currency=invoice.currency, exchange_rate_to_base=rate, original_amount=invoice.tax_total, description=f"Tax on {invoice.invoice_number}"))
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=invoice.issue_date, source_type="invoice_issue", source_id=invoice.id, lines=lines, reference=invoice.invoice_number, memo=f"Invoice issued to {invoice.client_name_snapshot}")
            counts["invoices"] += 1
        except HTTPException as exc:
            errors.append(f"Invoice {invoice.invoice_number}: {exc.detail}")

    payments = db.scalars(select(Payment).where(Payment.organization_id == organization_id, Payment.status == "confirmed")).all()
    for payment in payments:
        if _already_posted(db, organization_id, "invoice_payment", payment.id):
            continue
        try:
            _, cash_ledger = financial_ledger_account(db, organization_id, payment.account_id)
            ar = system_account(db, organization_id, "accounts_receivable")
            base_amount, cash_rate = to_base_amount(db, organization_id, base_currency, Decimal(payment.account_amount), payment.account_currency)
            settlement_rate = (base_amount / Decimal(payment.invoice_amount)) if Decimal(payment.invoice_amount) else Decimal("1")
            lines = [
                PostingLine(ledger_account_id=cash_ledger.id, debit=base_amount, currency=payment.account_currency, exchange_rate_to_base=cash_rate, original_amount=payment.account_amount, description=f"Payment {payment.payment_number}"),
                PostingLine(ledger_account_id=ar.id, credit=base_amount, currency=payment.invoice_currency, exchange_rate_to_base=settlement_rate, original_amount=payment.invoice_amount, description=f"Payment {payment.payment_number}"),
            ]
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=payment.payment_date, source_type="invoice_payment", source_id=payment.id, lines=lines, reference=payment.reference or payment.payment_number, memo=f"Customer payment {payment.payment_number}")
            counts["payments"] += 1
        except HTTPException as exc:
            errors.append(f"Payment {payment.payment_number}: {exc.detail}")

    expense_rows = db.execute(
        select(Expense, ExpenseCategory.cost_type).join(ExpenseCategory, ExpenseCategory.id == Expense.category_id).where(
            Expense.organization_id == organization_id,
            Expense.status == "posted",
        )
    ).all()
    for expense, cost_type in expense_rows:
        if _already_posted(db, organization_id, "expense_post", expense.id):
            continue
        try:
            _, cash_ledger = financial_ledger_account(db, organization_id, expense.account_id)
            expense_key = "cost_of_sales" if cost_type == "direct" else "bank_fees" if cost_type == "financial" else "operating_expenses"
            expense_ledger = system_account(db, organization_id, expense_key)
            base_amount, cash_rate = to_base_amount(db, organization_id, base_currency, Decimal(expense.account_amount), expense.account_currency)
            source_rate = (base_amount / Decimal(expense.expense_amount)) if Decimal(expense.expense_amount) else Decimal("1")
            lines = [
                PostingLine(ledger_account_id=expense_ledger.id, debit=base_amount, currency=expense.expense_currency, exchange_rate_to_base=source_rate, original_amount=expense.expense_amount, description=expense.description),
                PostingLine(ledger_account_id=cash_ledger.id, credit=base_amount, currency=expense.account_currency, exchange_rate_to_base=cash_rate, original_amount=expense.account_amount, description=expense.description),
            ]
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=expense.expense_date, source_type="expense_post", source_id=expense.id, lines=lines, reference=expense.reference or expense.expense_number, memo=f"Expense {expense.expense_number}: {expense.description}")
            counts["expenses"] += 1
        except HTTPException as exc:
            errors.append(f"Expense {expense.expense_number}: {exc.detail}")

    transfers = db.scalars(select(AccountTransfer).where(AccountTransfer.organization_id == organization_id, AccountTransfer.status == "confirmed")).all()
    for transfer in transfers:
        if _already_posted(db, organization_id, "account_transfer", transfer.id):
            continue
        try:
            _, source_ledger = financial_ledger_account(db, organization_id, transfer.from_account_id)
            _, destination_ledger = financial_ledger_account(db, organization_id, transfer.to_account_id)
            fee_ledger = system_account(db, organization_id, "bank_fees")
            source_base, source_rate = to_base_amount(db, organization_id, base_currency, Decimal(transfer.source_amount), transfer.source_currency)
            fee_base, _ = to_base_amount(db, organization_id, base_currency, Decimal(transfer.fee_amount), transfer.source_currency) if Decimal(transfer.fee_amount) > 0 else (Decimal("0"), source_rate)
            net_base = money(source_base - fee_base)
            destination_rate = (net_base / Decimal(transfer.destination_amount)) if Decimal(transfer.destination_amount) else Decimal("1")
            lines = [
                PostingLine(ledger_account_id=destination_ledger.id, debit=net_base, currency=transfer.destination_currency, exchange_rate_to_base=destination_rate, original_amount=transfer.destination_amount, description=f"Transfer {transfer.transfer_number}"),
                PostingLine(ledger_account_id=source_ledger.id, credit=source_base, currency=transfer.source_currency, exchange_rate_to_base=source_rate, original_amount=transfer.source_amount, description=f"Transfer {transfer.transfer_number}"),
            ]
            if fee_base > 0:
                lines.append(PostingLine(ledger_account_id=fee_ledger.id, debit=fee_base, currency=transfer.source_currency, exchange_rate_to_base=source_rate, original_amount=transfer.fee_amount, description=f"Fee for {transfer.transfer_number}"))
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=transfer.transfer_date, source_type="account_transfer", source_id=transfer.id, lines=lines, reference=transfer.reference or transfer.transfer_number, memo=f"Account transfer {transfer.transfer_number}")
            counts["transfers"] += 1
        except HTTPException as exc:
            errors.append(f"Transfer {transfer.transfer_number}: {exc.detail}")

    return {"counts": counts, "errors": errors}
