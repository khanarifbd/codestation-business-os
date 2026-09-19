from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, func, select

from app.models.accounting import JournalEntry, JournalLine
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import AccountTransfer, FinancialAccount, Invoice, InvoiceItem, Payment
from app.services.accounting_posting import (
    PostingLine,
    financial_ledger_account,
    money,
    post_journal,
    system_account,
    to_base_amount,
)
from app.services.functional_currency import functional_currency_for_date


def _posted_source(db, organization_id: str, source_type: str, source_id: str) -> JournalEntry | None:
    return db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
            JournalEntry.status == "posted",
        )
    )


def _invoice_revenue_split(db, invoice: Invoice) -> tuple[Decimal, Decimal]:
    items = db.scalars(
        select(InvoiceItem).where(
            InvoiceItem.organization_id == invoice.organization_id,
            InvoiceItem.invoice_id == invoice.id,
        )
    ).all()
    product_revenue = Decimal("0")
    service_revenue = Decimal("0")
    for item in items:
        net_revenue = Decimal(item.taxable_amount)
        if invoice.tax_calculation_mode == "inclusive":
            net_revenue -= Decimal(item.tax_amount)
        if item.item_type_snapshot in {"stock_item", "non_stock_item"}:
            product_revenue += net_revenue
        else:
            service_revenue += net_revenue

    expected = money(Decimal(invoice.total) - Decimal(invoice.tax_total))
    product_revenue = money(product_revenue)
    service_revenue = money(service_revenue)
    service_revenue = money(service_revenue + (expected - product_revenue - service_revenue))
    return product_revenue, service_revenue


def post_invoice_issue(db, *, organization_id: str, user_id: str, invoice: Invoice) -> JournalEntry:
    existing = _posted_source(db, organization_id, "invoice_issue", invoice.id)
    if existing is not None:
        return existing

    base_currency = functional_currency_for_date(db, organization_id, invoice.issue_date)
    ar = system_account(db, organization_id, "accounts_receivable")
    service_ledger = system_account(db, organization_id, "service_revenue")
    sales_ledger = system_account(db, organization_id, "sales_revenue")
    tax_payable = system_account(db, organization_id, "taxes_payable")

    total_base, rate = to_base_amount(
        db,
        organization_id,
        base_currency,
        Decimal(invoice.total),
        invoice.currency,
        rate_date=invoice.issue_date,
    )
    tax_base, _ = (
        to_base_amount(
            db,
            organization_id,
            base_currency,
            Decimal(invoice.tax_total),
            invoice.currency,
            rate_date=invoice.issue_date,
        )
        if Decimal(invoice.tax_total) > 0
        else (Decimal("0"), rate)
    )
    revenue_base = money(total_base - tax_base)
    product_original, service_original = _invoice_revenue_split(db, invoice)
    product_base = money(product_original * rate) if product_original > 0 else Decimal("0")
    if product_base > revenue_base:
        product_base = revenue_base
    service_base = money(revenue_base - product_base)

    lines = [
        PostingLine(
            ledger_account_id=ar.id,
            debit=total_base,
            currency=invoice.currency,
            exchange_rate_to_base=rate,
            original_amount=invoice.total,
            description=f"Invoice {invoice.invoice_number}",
        )
    ]
    if product_base > 0:
        lines.append(
            PostingLine(
                ledger_account_id=sales_ledger.id,
                credit=product_base,
                currency=invoice.currency,
                exchange_rate_to_base=rate,
                original_amount=product_original,
                description=invoice.subject or invoice.invoice_number,
            )
        )
    if service_base > 0:
        service_original = money(
            service_original
            + (
                money(Decimal(invoice.total) - Decimal(invoice.tax_total))
                - product_original
                - service_original
            )
        )
        lines.append(
            PostingLine(
                ledger_account_id=service_ledger.id,
                credit=service_base,
                currency=invoice.currency,
                exchange_rate_to_base=rate,
                original_amount=service_original,
                description=invoice.subject or invoice.invoice_number,
            )
        )
    if tax_base > 0:
        lines.append(
            PostingLine(
                ledger_account_id=tax_payable.id,
                credit=tax_base,
                currency=invoice.currency,
                exchange_rate_to_base=rate,
                original_amount=invoice.tax_total,
                description=f"Tax on {invoice.invoice_number}",
            )
        )

    return post_journal(
        db,
        organization_id=organization_id,
        user_id=user_id,
        entry_date=invoice.issue_date,
        source_type="invoice_issue",
        source_id=invoice.id,
        lines=lines,
        reference=invoice.invoice_number,
        memo=f"Invoice issued to {invoice.client_name_snapshot}",
    )


def _invoice_receivable_carrying_base(
    db,
    organization_id: str,
    invoice: Invoice,
    payment: Payment,
    ar_account_id: str,
) -> Decimal:
    issue = _posted_source(db, organization_id, "invoice_issue", invoice.id)
    if issue is None:
        raise HTTPException(
            status_code=409,
            detail=f"Invoice {invoice.invoice_number} does not have its source accounting journal",
        )

    issue_base = Decimal(
        db.scalar(
            select(func.coalesce(func.sum(JournalLine.debit), 0)).where(
                JournalLine.organization_id == organization_id,
                JournalLine.journal_entry_id == issue.id,
                JournalLine.ledger_account_id == ar_account_id,
            )
        )
        or 0
    )
    prior = db.execute(
        select(Payment.invoice_amount, JournalLine.credit)
        .join(
            JournalEntry,
            (JournalEntry.organization_id == Payment.organization_id)
            & (JournalEntry.source_type == "invoice_payment")
            & (JournalEntry.source_id == Payment.id)
            & (JournalEntry.status == "posted"),
        )
        .join(
            JournalLine,
            (JournalLine.organization_id == Payment.organization_id)
            & (JournalLine.journal_entry_id == JournalEntry.id)
            & (JournalLine.ledger_account_id == ar_account_id),
        )
        .where(
            Payment.organization_id == organization_id,
            Payment.invoice_id == invoice.id,
            Payment.id != payment.id,
            Payment.status == "confirmed",
        )
    ).all()
    prior_original = money(sum((Decimal(original) for original, _ in prior), Decimal("0")))
    prior_base = money(sum((Decimal(base) for _, base in prior), Decimal("0")))
    remaining_original = money(Decimal(invoice.total) - prior_original)
    remaining_base = money(issue_base - prior_base)
    settlement_original = money(Decimal(payment.invoice_amount))
    if remaining_original <= 0 or settlement_original >= remaining_original:
        return remaining_base
    return money(remaining_base * settlement_original / remaining_original)


def post_invoice_payment(db, *, organization_id: str, user_id: str, payment: Payment) -> JournalEntry:
    existing = _posted_source(db, organization_id, "invoice_payment", payment.id)
    if existing is not None:
        return existing

    invoice = db.scalar(
        select(Invoice).where(
            Invoice.id == payment.invoice_id,
            Invoice.organization_id == organization_id,
        )
    )
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")

    account, cash_ledger = financial_ledger_account(db, organization_id, payment.account_id)
    if account.account_type == "credit_card":
        raise HTTPException(
            status_code=400,
            detail="Customer payments cannot be received into a credit card account",
        )

    if _posted_source(db, organization_id, "invoice_issue", invoice.id) is None:
        post_invoice_issue(db, organization_id=organization_id, user_id=user_id, invoice=invoice)

    ar = system_account(db, organization_id, "accounts_receivable")
    base_currency = functional_currency_for_date(db, organization_id, payment.payment_date)
    cash_base, cash_rate = to_base_amount(
        db,
        organization_id,
        base_currency,
        Decimal(payment.account_amount),
        payment.account_currency,
        rate_date=payment.payment_date,
    )
    carrying_base = _invoice_receivable_carrying_base(
        db,
        organization_id,
        invoice,
        payment,
        ar.id,
    )
    settlement_rate = (
        carrying_base / Decimal(payment.invoice_amount)
        if Decimal(payment.invoice_amount)
        else Decimal("1")
    )
    lines = [
        PostingLine(
            ledger_account_id=cash_ledger.id,
            debit=cash_base,
            currency=payment.account_currency,
            exchange_rate_to_base=cash_rate,
            original_amount=payment.account_amount,
            description=f"Payment {payment.payment_number}",
        ),
        PostingLine(
            ledger_account_id=ar.id,
            credit=carrying_base,
            currency=payment.invoice_currency,
            exchange_rate_to_base=settlement_rate,
            original_amount=payment.invoice_amount,
            description=f"Settlement of {invoice.invoice_number}",
        ),
    ]
    difference = money(cash_base - carrying_base)
    if difference > 0:
        gain = system_account(db, organization_id, "realized_fx_gain")
        lines.append(
            PostingLine(
                ledger_account_id=gain.id,
                credit=difference,
                currency=base_currency,
                exchange_rate_to_base=Decimal("1"),
                original_amount=difference,
                description=f"Realized FX gain on {invoice.invoice_number}",
            )
        )
    elif difference < 0:
        loss = system_account(db, organization_id, "realized_fx_loss")
        lines.append(
            PostingLine(
                ledger_account_id=loss.id,
                debit=abs(difference),
                currency=base_currency,
                exchange_rate_to_base=Decimal("1"),
                original_amount=abs(difference),
                description=f"Realized FX loss on {invoice.invoice_number}",
            )
        )

    return post_journal(
        db,
        organization_id=organization_id,
        user_id=user_id,
        entry_date=payment.payment_date,
        source_type="invoice_payment",
        source_id=payment.id,
        lines=lines,
        reference=payment.reference or payment.payment_number,
        memo=f"Customer payment {payment.payment_number}",
    )


def post_expense(db, *, organization_id: str, user_id: str, expense: Expense) -> JournalEntry:
    existing = _posted_source(db, organization_id, "expense_post", expense.id)
    if existing is not None:
        return existing

    category = db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.id == expense.category_id,
            ExpenseCategory.organization_id == organization_id,
        )
    )
    if category is None:
        raise HTTPException(status_code=409, detail="Expense category is no longer available")

    _, cash_ledger = financial_ledger_account(db, organization_id, expense.account_id)
    expense_key = (
        "cost_of_sales"
        if category.cost_type == "direct"
        else "bank_fees"
        if category.cost_type == "financial"
        else "operating_expenses"
    )
    expense_ledger = system_account(db, organization_id, expense_key)
    base_currency = functional_currency_for_date(db, organization_id, expense.expense_date)
    base_amount, cash_rate = to_base_amount(
        db,
        organization_id,
        base_currency,
        Decimal(expense.account_amount),
        expense.account_currency,
        rate_date=expense.expense_date,
    )
    source_rate = (
        base_amount / Decimal(expense.expense_amount)
        if Decimal(expense.expense_amount)
        else Decimal("1")
    )
    return post_journal(
        db,
        organization_id=organization_id,
        user_id=user_id,
        entry_date=expense.expense_date,
        source_type="expense_post",
        source_id=expense.id,
        lines=[
            PostingLine(
                ledger_account_id=expense_ledger.id,
                debit=base_amount,
                currency=expense.expense_currency,
                exchange_rate_to_base=source_rate,
                original_amount=expense.expense_amount,
                description=expense.description,
            ),
            PostingLine(
                ledger_account_id=cash_ledger.id,
                credit=base_amount,
                currency=expense.account_currency,
                exchange_rate_to_base=cash_rate,
                original_amount=expense.account_amount,
                description=expense.description,
            ),
        ],
        reference=expense.reference or expense.expense_number,
        memo=f"Expense {expense.expense_number}: {expense.description}",
    )


def _financial_account_outflow_carrying_base(
    db,
    *,
    organization_id: str,
    account: FinancialAccount,
    ledger_account_id: str,
    source_id: str,
    outflow_amount: Decimal,
) -> Decimal:
    """Return the functional-currency carrying value removed by a foreign-cash outflow.

    FinancialTransaction stores the account-currency quantity, while the mapped
    ledger stores its functional-currency carrying value.  A transfer created in
    the current unit of work already has operational movements, so exclude the
    current source id when reconstructing the quantity available immediately
    before this posting.
    """
    prior_net = Decimal(
        db.scalar(
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
                FinancialTransaction.source_id != source_id,
            )
        )
        or 0
    )
    quantity_before = money(Decimal(account.opening_balance) + prior_net)
    outflow_amount = money(outflow_amount)
    if quantity_before <= 0 or outflow_amount > quantity_before:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Financial account {account.name} does not have a usable accounting carrying value "
                "for this transfer; reconcile the account before retrying"
            ),
        )

    carrying_before = money(
        Decimal(
            db.scalar(
                select(func.coalesce(func.sum(JournalLine.debit - JournalLine.credit), 0))
                .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
                .where(
                    JournalLine.organization_id == organization_id,
                    JournalLine.ledger_account_id == ledger_account_id,
                    JournalEntry.organization_id == organization_id,
                    JournalEntry.status == "posted",
                )
            )
            or 0
        )
    )
    if carrying_before <= 0:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Financial account {account.name} has no positive GL carrying value "
                "for this transfer; reconcile the account before retrying"
            ),
        )

    if outflow_amount == quantity_before:
        return carrying_before
    return money(carrying_before * outflow_amount / quantity_before)


def post_transfer(db, *, organization_id: str, user_id: str, transfer: AccountTransfer) -> JournalEntry:
    existing = _posted_source(db, organization_id, "account_transfer", transfer.id)
    if existing is not None:
        return existing

    source, source_ledger = financial_ledger_account(db, organization_id, transfer.from_account_id)
    destination, destination_ledger = financial_ledger_account(
        db,
        organization_id,
        transfer.to_account_id,
    )
    if source.account_type == "credit_card" or destination.account_type == "credit_card":
        raise HTTPException(
            status_code=400,
            detail=(
                "Credit card settlement is not an account transfer. "
                "Use a dedicated card payment/expense workflow so the liability direction remains correct."
            ),
        )

    fee_ledger = system_account(db, organization_id, "bank_fees")
    base_currency = functional_currency_for_date(db, organization_id, transfer.transfer_date)
    source_carrying_base = _financial_account_outflow_carrying_base(
        db,
        organization_id=organization_id,
        account=source,
        ledger_account_id=source_ledger.id,
        source_id=transfer.id,
        outflow_amount=Decimal(transfer.source_amount),
    )

    _, source_rate = to_base_amount(
        db,
        organization_id,
        base_currency,
        Decimal(transfer.source_amount),
        transfer.source_currency,
        rate_date=transfer.transfer_date,
    )
    fee_base, _ = (
        to_base_amount(
            db,
            organization_id,
            base_currency,
            Decimal(transfer.fee_amount),
            transfer.source_currency,
            rate_date=transfer.transfer_date,
        )
        if Decimal(transfer.fee_amount) > 0
        else (Decimal("0"), source_rate)
    )

    if transfer.source_currency == transfer.destination_currency:
        net_source = Decimal(transfer.net_source_amount)
        source_total = Decimal(transfer.source_amount)
        destination_base = (
            money(source_carrying_base * net_source / source_total)
            if source_total > 0
            else Decimal("0.00")
        )
        destination_rate = (
            (destination_base / Decimal(transfer.destination_amount)).quantize(Decimal("0.00000001"))
            if Decimal(transfer.destination_amount) > 0
            else Decimal("1.00000000")
        )
    elif transfer.source_currency == base_currency:
        destination_base = money(Decimal(transfer.net_source_amount))
        destination_rate = (
            (destination_base / Decimal(transfer.destination_amount)).quantize(Decimal("0.00000001"))
            if Decimal(transfer.destination_amount) > 0
            else Decimal("1.00000000")
        )
    else:
        destination_base, destination_rate = to_base_amount(
            db,
            organization_id,
            base_currency,
            Decimal(transfer.destination_amount),
            transfer.destination_currency,
            rate_date=transfer.transfer_date,
        )

    lines = [
        PostingLine(
            ledger_account_id=destination_ledger.id,
            debit=destination_base,
            currency=transfer.destination_currency,
            exchange_rate_to_base=destination_rate,
            original_amount=transfer.destination_amount,
            description=f"Transfer {transfer.transfer_number}",
        ),
        PostingLine(
            ledger_account_id=source_ledger.id,
            credit=source_carrying_base,
            currency=transfer.source_currency,
            exchange_rate_to_base=(
                source_carrying_base / Decimal(transfer.source_amount)
            ).quantize(Decimal("0.00000001")),
            original_amount=transfer.source_amount,
            description=f"Transfer {transfer.transfer_number}",
        ),
    ]
    if fee_base > 0:
        lines.append(
            PostingLine(
                ledger_account_id=fee_ledger.id,
                debit=fee_base,
                currency=transfer.source_currency,
                exchange_rate_to_base=source_rate,
                original_amount=transfer.fee_amount,
                description=f"Fee for {transfer.transfer_number}",
            )
        )

    difference = money(destination_base + fee_base - source_carrying_base)
    if difference > 0:
        gain = system_account(db, organization_id, "realized_fx_gain")
        lines.append(
            PostingLine(
                ledger_account_id=gain.id,
                credit=difference,
                currency=base_currency,
                exchange_rate_to_base=Decimal("1"),
                original_amount=difference,
                description=f"Realized FX gain on transfer {transfer.transfer_number}",
            )
        )
    elif difference < 0:
        loss = system_account(db, organization_id, "realized_fx_loss")
        lines.append(
            PostingLine(
                ledger_account_id=loss.id,
                debit=abs(difference),
                currency=base_currency,
                exchange_rate_to_base=Decimal("1"),
                original_amount=abs(difference),
                description=f"Realized FX loss on transfer {transfer.transfer_number}",
            )
        )

    return post_journal(
        db,
        organization_id=organization_id,
        user_id=user_id,
        entry_date=transfer.transfer_date,
        source_type="account_transfer",
        source_id=transfer.id,
        lines=lines,
        reference=transfer.reference,
        memo=f"Account transfer {transfer.transfer_number}",
    )

def post_financial_account_opening(
    db,
    *,
    organization_id: str,
    user_id: str,
    account: FinancialAccount,
    entry_date: date,
) -> JournalEntry | None:
    opening = money(account.opening_balance)
    if opening == 0:
        return None

    existing = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_id == account.id,
            JournalEntry.source_type.in_(
                ["financial_account_opening_balance", "financial_account_opening_sync"]
            ),
            JournalEntry.status == "posted",
        )
    )
    if existing is not None:
        return existing

    _, ledger = financial_ledger_account(db, organization_id, account.id)
    equity = system_account(db, organization_id, "opening_balance_equity")
    base_currency = functional_currency_for_date(db, organization_id, entry_date)
    base_amount, rate = to_base_amount(
        db,
        organization_id,
        base_currency,
        abs(opening),
        account.currency,
        rate_date=entry_date,
    )

    if account.account_type == "credit_card":
        if opening < 0:
            raise HTTPException(
                status_code=400,
                detail="Credit card opening balance must be zero or a positive amount currently owed",
            )
        lines = [
            PostingLine(
                ledger_account_id=equity.id,
                debit=base_amount,
                currency=base_currency,
                original_amount=base_amount,
                description="Opening balance equity",
            ),
            PostingLine(
                ledger_account_id=ledger.id,
                credit=base_amount,
                currency=account.currency,
                exchange_rate_to_base=rate,
                original_amount=opening,
                description=account.name,
            ),
        ]
    elif opening > 0:
        lines = [
            PostingLine(
                ledger_account_id=ledger.id,
                debit=base_amount,
                currency=account.currency,
                exchange_rate_to_base=rate,
                original_amount=opening,
                description=account.name,
            ),
            PostingLine(
                ledger_account_id=equity.id,
                credit=base_amount,
                currency=base_currency,
                original_amount=base_amount,
                description="Opening balance equity",
            ),
        ]
    else:
        lines = [
            PostingLine(
                ledger_account_id=equity.id,
                debit=base_amount,
                currency=base_currency,
                original_amount=base_amount,
                description="Opening balance equity",
            ),
            PostingLine(
                ledger_account_id=ledger.id,
                credit=base_amount,
                currency=account.currency,
                exchange_rate_to_base=rate,
                original_amount=abs(opening),
                description=account.name,
            ),
        ]

    return post_journal(
        db,
        organization_id=organization_id,
        user_id=user_id,
        entry_date=entry_date,
        source_type="financial_account_opening_balance",
        source_id=account.id,
        lines=lines,
        reference=account.account_reference,
        memo=f"Opening balance for {account.name}",
    )
