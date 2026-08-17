from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.accounting import JournalEntry, JournalLine
from app.models.capital import CompanyInvestment, InvestmentReturn, InvestorPayout, ProjectInvestor
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import AccountTransfer, FinancialAccount, Invoice, InvoiceItem, Payment
from app.models.payroll import PayrollPeriod, PayrollRun
from app.services.accounting_posting import PostingLine, financial_ledger_account, money, post_journal, system_account, to_base_amount


def _already_posted(db, organization_id: str, source_type: str, source_id: str) -> bool:
    return db.scalar(select(JournalEntry.id).where(JournalEntry.organization_id == organization_id, JournalEntry.source_type == source_type, JournalEntry.source_id == source_id)) is not None


def _invoice_revenue_split(db, invoice: Invoice) -> tuple[Decimal, Decimal]:
    items = db.scalars(select(InvoiceItem).where(InvoiceItem.organization_id == invoice.organization_id, InvoiceItem.invoice_id == invoice.id)).all()
    product_revenue = Decimal("0"); service_revenue = Decimal("0")
    for item in items:
        net_revenue = Decimal(item.taxable_amount)
        if invoice.tax_calculation_mode == "inclusive": net_revenue -= Decimal(item.tax_amount)
        if item.item_type_snapshot in {"stock_item", "non_stock_item"}: product_revenue += net_revenue
        else: service_revenue += net_revenue
    expected = money(Decimal(invoice.total) - Decimal(invoice.tax_total))
    product_revenue = money(product_revenue); service_revenue = money(service_revenue)
    service_revenue = money(service_revenue + (expected - product_revenue - service_revenue))
    return product_revenue, service_revenue


def _invoice_receivable_carrying_base(db, organization_id: str, invoice: Invoice, payment: Payment, ar_account_id: str) -> Decimal:
    issue = db.scalar(select(JournalEntry).where(JournalEntry.organization_id == organization_id, JournalEntry.source_type == "invoice_issue", JournalEntry.source_id == invoice.id, JournalEntry.status == "posted"))
    if issue is None:
        raise HTTPException(status_code=409, detail=f"Invoice {invoice.invoice_number} must be synchronized before its payment")
    issue_base = Decimal(db.scalar(select(func.coalesce(func.sum(JournalLine.debit), 0)).where(JournalLine.organization_id == organization_id, JournalLine.journal_entry_id == issue.id, JournalLine.ledger_account_id == ar_account_id)) or 0)

    prior = db.execute(
        select(Payment.invoice_amount, JournalLine.credit)
        .join(JournalEntry, (JournalEntry.organization_id == Payment.organization_id) & (JournalEntry.source_type == "invoice_payment") & (JournalEntry.source_id == Payment.id) & (JournalEntry.status == "posted"))
        .join(JournalLine, (JournalLine.organization_id == Payment.organization_id) & (JournalLine.journal_entry_id == JournalEntry.id) & (JournalLine.ledger_account_id == ar_account_id))
        .where(Payment.organization_id == organization_id, Payment.invoice_id == invoice.id, Payment.id != payment.id, Payment.status == "confirmed")
    ).all()
    prior_original = money(sum((Decimal(original) for original, _ in prior), Decimal("0")))
    prior_base = money(sum((Decimal(base) for _, base in prior), Decimal("0")))
    remaining_original = money(Decimal(invoice.total) - prior_original)
    remaining_base = money(issue_base - prior_base)
    settlement_original = money(Decimal(payment.invoice_amount))
    if remaining_original <= 0 or settlement_original >= remaining_original:
        return remaining_base
    return money(remaining_base * settlement_original / remaining_original)


def sync_operational_accounting(db, *, organization_id: str, user_id: str, base_currency: str, through_date: date | None = None) -> dict:
    counts = {"opening_balances": 0, "invoices": 0, "payments": 0, "expenses": 0, "transfers": 0, "payroll": 0, "investments": 0, "investment_returns": 0, "project_investor_funding": 0, "investor_payouts": 0}
    errors: list[str] = []
    base_currency = base_currency.upper()
    def after_cutoff(value: date) -> bool: return through_date is not None and value > through_date

    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id == organization_id)).all()
    for account in accounts:
        entry_date = account.created_at.date()
        if after_cutoff(entry_date): continue
        opening = money(account.opening_balance)
        if opening == 0: continue
        if db.scalar(select(JournalEntry.id).where(JournalEntry.organization_id == organization_id, JournalEntry.source_id == account.id, JournalEntry.source_type.in_(["financial_account_opening_balance", "financial_account_opening_sync"]))) is not None: continue
        try:
            _, ledger = financial_ledger_account(db, organization_id, account.id); equity = system_account(db, organization_id, "opening_balance_equity")
            base_amount, rate = to_base_amount(db, organization_id, base_currency, abs(opening), account.currency, rate_date=entry_date)
            if account.account_type == "credit_card":
                lines = [PostingLine(ledger_account_id=equity.id, debit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=abs(opening), description="Opening credit card balance"), PostingLine(ledger_account_id=ledger.id, credit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=abs(opening), description=account.name)]
            elif opening > 0:
                lines = [PostingLine(ledger_account_id=ledger.id, debit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=opening, description=account.name), PostingLine(ledger_account_id=equity.id, credit=base_amount, currency=base_currency, original_amount=base_amount, description="Opening balance equity")]
            else:
                lines = [PostingLine(ledger_account_id=equity.id, debit=base_amount, currency=base_currency, original_amount=base_amount, description="Opening balance equity"), PostingLine(ledger_account_id=ledger.id, credit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=abs(opening), description=account.name)]
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=entry_date, source_type="financial_account_opening_sync", source_id=account.id, lines=lines, reference=account.account_reference, memo=f"Opening balance for {account.name}"); counts["opening_balances"] += 1
        except HTTPException as exc: errors.append(f"Opening balance {account.name}: {exc.detail}")

    invoices = db.scalars(select(Invoice).where(Invoice.organization_id == organization_id, Invoice.status.not_in(["draft", "cancelled"])).order_by(Invoice.issue_date, Invoice.created_at)).all()
    for invoice in invoices:
        if after_cutoff(invoice.issue_date) or _already_posted(db, organization_id, "invoice_issue", invoice.id): continue
        try:
            ar = system_account(db, organization_id, "accounts_receivable"); service_ledger = system_account(db, organization_id, "service_revenue"); sales_ledger = system_account(db, organization_id, "sales_revenue"); tax_payable = system_account(db, organization_id, "taxes_payable")
            total_base, rate = to_base_amount(db, organization_id, base_currency, Decimal(invoice.total), invoice.currency, rate_date=invoice.issue_date)
            tax_base, _ = to_base_amount(db, organization_id, base_currency, Decimal(invoice.tax_total), invoice.currency, rate_date=invoice.issue_date) if Decimal(invoice.tax_total) > 0 else (Decimal("0"), rate)
            revenue_base = money(total_base - tax_base); product_original, service_original = _invoice_revenue_split(db, invoice); product_base = money(product_original * rate) if product_original > 0 else Decimal("0")
            if product_base > revenue_base: product_base = revenue_base
            service_base = money(revenue_base - product_base)
            lines = [PostingLine(ledger_account_id=ar.id, debit=total_base, currency=invoice.currency, exchange_rate_to_base=rate, original_amount=invoice.total, description=f"Invoice {invoice.invoice_number}")]
            if product_base > 0: lines.append(PostingLine(ledger_account_id=sales_ledger.id, credit=product_base, currency=invoice.currency, exchange_rate_to_base=rate, original_amount=product_original, description=invoice.subject or invoice.invoice_number))
            if service_base > 0:
                service_original = money(service_original + (money(Decimal(invoice.total) - Decimal(invoice.tax_total)) - product_original - service_original)); lines.append(PostingLine(ledger_account_id=service_ledger.id, credit=service_base, currency=invoice.currency, exchange_rate_to_base=rate, original_amount=service_original, description=invoice.subject or invoice.invoice_number))
            if tax_base > 0: lines.append(PostingLine(ledger_account_id=tax_payable.id, credit=tax_base, currency=invoice.currency, exchange_rate_to_base=rate, original_amount=invoice.tax_total, description=f"Tax on {invoice.invoice_number}"))
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=invoice.issue_date, source_type="invoice_issue", source_id=invoice.id, lines=lines, reference=invoice.invoice_number, memo=f"Invoice issued to {invoice.client_name_snapshot}"); counts["invoices"] += 1
        except HTTPException as exc: errors.append(f"Invoice {invoice.invoice_number}: {exc.detail}")

    payments = db.scalars(select(Payment).where(Payment.organization_id == organization_id, Payment.status == "confirmed").order_by(Payment.payment_date, Payment.created_at)).all()
    for payment in payments:
        if after_cutoff(payment.payment_date) or _already_posted(db, organization_id, "invoice_payment", payment.id): continue
        try:
            invoice = db.scalar(select(Invoice).where(Invoice.id == payment.invoice_id, Invoice.organization_id == organization_id))
            if invoice is None: raise HTTPException(status_code=404, detail="Invoice not found")
            _, cash_ledger = financial_ledger_account(db, organization_id, payment.account_id); ar = system_account(db, organization_id, "accounts_receivable")
            cash_base, cash_rate = to_base_amount(db, organization_id, base_currency, Decimal(payment.account_amount), payment.account_currency, rate_date=payment.payment_date)
            carrying_base = _invoice_receivable_carrying_base(db, organization_id, invoice, payment, ar.id)
            settlement_rate = (carrying_base / Decimal(payment.invoice_amount)) if Decimal(payment.invoice_amount) else Decimal("1")
            lines = [PostingLine(ledger_account_id=cash_ledger.id, debit=cash_base, currency=payment.account_currency, exchange_rate_to_base=cash_rate, original_amount=payment.account_amount, description=f"Payment {payment.payment_number}"), PostingLine(ledger_account_id=ar.id, credit=carrying_base, currency=payment.invoice_currency, exchange_rate_to_base=settlement_rate, original_amount=payment.invoice_amount, description=f"Settlement of {invoice.invoice_number}")]
            difference = money(cash_base - carrying_base)
            if difference > 0:
                gain = system_account(db, organization_id, "realized_fx_gain"); lines.append(PostingLine(ledger_account_id=gain.id, credit=difference, currency=base_currency, exchange_rate_to_base=Decimal("1"), original_amount=difference, description=f"Realized FX gain on {invoice.invoice_number}"))
            elif difference < 0:
                loss = system_account(db, organization_id, "realized_fx_loss"); lines.append(PostingLine(ledger_account_id=loss.id, debit=abs(difference), currency=base_currency, exchange_rate_to_base=Decimal("1"), original_amount=abs(difference), description=f"Realized FX loss on {invoice.invoice_number}"))
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=payment.payment_date, source_type="invoice_payment", source_id=payment.id, lines=lines, reference=payment.reference or payment.payment_number, memo=f"Customer payment {payment.payment_number}"); counts["payments"] += 1
        except HTTPException as exc: errors.append(f"Payment {payment.payment_number}: {exc.detail}")

    expense_rows = db.execute(select(Expense, ExpenseCategory.cost_type).join(ExpenseCategory, ExpenseCategory.id == Expense.category_id).where(Expense.organization_id == organization_id, Expense.status == "posted").order_by(Expense.expense_date, Expense.created_at)).all()
    for expense, cost_type in expense_rows:
        if after_cutoff(expense.expense_date) or _already_posted(db, organization_id, "expense_post", expense.id): continue
        try:
            _, cash_ledger = financial_ledger_account(db, organization_id, expense.account_id); expense_key = "cost_of_sales" if cost_type == "direct" else "bank_fees" if cost_type == "financial" else "operating_expenses"; expense_ledger = system_account(db, organization_id, expense_key)
            base_amount, cash_rate = to_base_amount(db, organization_id, base_currency, Decimal(expense.account_amount), expense.account_currency, rate_date=expense.expense_date); source_rate = (base_amount / Decimal(expense.expense_amount)) if Decimal(expense.expense_amount) else Decimal("1")
            lines = [PostingLine(ledger_account_id=expense_ledger.id, debit=base_amount, currency=expense.expense_currency, exchange_rate_to_base=source_rate, original_amount=expense.expense_amount, description=expense.description), PostingLine(ledger_account_id=cash_ledger.id, credit=base_amount, currency=expense.account_currency, exchange_rate_to_base=cash_rate, original_amount=expense.account_amount, description=expense.description)]
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=expense.expense_date, source_type="expense_post", source_id=expense.id, lines=lines, reference=expense.reference or expense.expense_number, memo=f"Expense {expense.expense_number}: {expense.description}"); counts["expenses"] += 1
        except HTTPException as exc: errors.append(f"Expense {expense.expense_number}: {exc.detail}")

    transfers = db.scalars(select(AccountTransfer).where(AccountTransfer.organization_id == organization_id, AccountTransfer.status == "confirmed").order_by(AccountTransfer.transfer_date, AccountTransfer.created_at)).all()
    for transfer in transfers:
        if after_cutoff(transfer.transfer_date) or _already_posted(db, organization_id, "account_transfer", transfer.id): continue
        try:
            _, source_ledger = financial_ledger_account(db, organization_id, transfer.from_account_id); _, destination_ledger = financial_ledger_account(db, organization_id, transfer.to_account_id); fee_ledger = system_account(db, organization_id, "bank_fees")
            source_base, source_rate = to_base_amount(db, organization_id, base_currency, Decimal(transfer.source_amount), transfer.source_currency, rate_date=transfer.transfer_date); fee_base, _ = to_base_amount(db, organization_id, base_currency, Decimal(transfer.fee_amount), transfer.source_currency, rate_date=transfer.transfer_date) if Decimal(transfer.fee_amount) > 0 else (Decimal("0"), source_rate); net_base = money(source_base - fee_base); destination_rate = (net_base / Decimal(transfer.destination_amount)) if Decimal(transfer.destination_amount) else Decimal("1")
            lines = [PostingLine(ledger_account_id=destination_ledger.id, debit=net_base, currency=transfer.destination_currency, exchange_rate_to_base=destination_rate, original_amount=transfer.destination_amount, description=f"Transfer {transfer.transfer_number}"), PostingLine(ledger_account_id=source_ledger.id, credit=source_base, currency=transfer.source_currency, exchange_rate_to_base=source_rate, original_amount=transfer.source_amount, description=f"Transfer {transfer.transfer_number}")]
            if fee_base > 0: lines.append(PostingLine(ledger_account_id=fee_ledger.id, debit=fee_base, currency=transfer.source_currency, exchange_rate_to_base=source_rate, original_amount=transfer.fee_amount, description=f"Fee for {transfer.transfer_number}"))
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=transfer.transfer_date, source_type="account_transfer", source_id=transfer.id, lines=lines, reference=transfer.reference, memo=f"Account transfer {transfer.transfer_number}"); counts["transfers"] += 1
        except HTTPException as exc: errors.append(f"Transfer {transfer.transfer_number}: {exc.detail}")

    paid_payroll = db.execute(select(PayrollRun, PayrollPeriod).join(PayrollPeriod, PayrollPeriod.id == PayrollRun.period_id).where(PayrollRun.organization_id == organization_id, PayrollRun.status == "paid", PayrollRun.paid_account_id.is_not(None))).all()
    for run, period in paid_payroll:
        if after_cutoff(period.pay_date) or _already_posted(db, organization_id, "payroll_payment", run.id): continue
        try:
            _, cash_ledger = financial_ledger_account(db, organization_id, run.paid_account_id); payroll_expense = system_account(db, organization_id, "payroll_expense"); withholdings = system_account(db, organization_id, "payroll_withholdings")
            gross_base, rate = to_base_amount(db, organization_id, base_currency, Decimal(run.gross_total), run.currency, rate_date=period.pay_date); net_base, _ = to_base_amount(db, organization_id, base_currency, Decimal(run.net_total), run.currency, rate_date=period.pay_date); withheld_original = money(Decimal(run.gross_total) - Decimal(run.net_total)); withheld_base = money(gross_base - net_base)
            lines = [PostingLine(ledger_account_id=payroll_expense.id, debit=gross_base, currency=run.currency, exchange_rate_to_base=rate, original_amount=run.gross_total, description=f"Payroll {run.run_number}"), PostingLine(ledger_account_id=cash_ledger.id, credit=net_base, currency=run.currency, exchange_rate_to_base=rate, original_amount=run.net_total, description=f"Payroll payment {run.run_number}")]
            if withheld_base > 0: lines.append(PostingLine(ledger_account_id=withholdings.id, credit=withheld_base, currency=run.currency, exchange_rate_to_base=rate, original_amount=withheld_original, description=f"Payroll deductions and taxes {run.run_number}"))
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=period.pay_date, source_type="payroll_payment", source_id=run.id, lines=lines, reference=run.run_number, memo=f"Payroll {run.run_number} · {period.name}"); counts["payroll"] += 1
        except HTTPException as exc: errors.append(f"Payroll {run.run_number}: {exc.detail}")

    investments = db.scalars(select(CompanyInvestment).where(CompanyInvestment.organization_id == organization_id, CompanyInvestment.account_id.is_not(None))).all()
    for investment in investments:
        if after_cutoff(investment.investment_date) or _already_posted(db, organization_id, "company_investment", investment.id): continue
        try:
            _, cash_ledger = financial_ledger_account(db, organization_id, investment.account_id); investment_ledger = system_account(db, organization_id, "investments"); base_amount, rate = to_base_amount(db, organization_id, base_currency, Decimal(investment.invested_amount), investment.currency, rate_date=investment.investment_date)
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=investment.investment_date, source_type="company_investment", source_id=investment.id, lines=[PostingLine(ledger_account_id=investment_ledger.id, debit=base_amount, currency=investment.currency, exchange_rate_to_base=rate, original_amount=investment.invested_amount, description=investment.investee_name), PostingLine(ledger_account_id=cash_ledger.id, credit=base_amount, currency=investment.currency, exchange_rate_to_base=rate, original_amount=investment.invested_amount, description=investment.investee_name)], reference=investment.reference, memo=f"Investment in {investment.investee_name}"); counts["investments"] += 1
        except HTTPException as exc: errors.append(f"Investment {investment.investee_name}: {exc.detail}")

    investment_returns = db.execute(select(InvestmentReturn, CompanyInvestment).join(CompanyInvestment, CompanyInvestment.id == InvestmentReturn.investment_id).where(InvestmentReturn.organization_id == organization_id)).all()
    for item, investment in investment_returns:
        if after_cutoff(item.return_date) or _already_posted(db, organization_id, "investment_return", item.id): continue
        try:
            _, cash_ledger = financial_ledger_account(db, organization_id, item.account_id); investment_ledger = system_account(db, organization_id, "investments"); income_ledger = system_account(db, organization_id, "other_income")
            cash_base, rate = to_base_amount(db, organization_id, base_currency, Decimal(item.cash_amount), investment.currency, rate_date=item.return_date); principal_base, _ = to_base_amount(db, organization_id, base_currency, Decimal(item.principal_return_amount), investment.currency, rate_date=item.return_date) if Decimal(item.principal_return_amount) > 0 else (Decimal("0"), rate); income_base = money(cash_base - principal_base)
            lines = [PostingLine(ledger_account_id=cash_ledger.id, debit=cash_base, currency=investment.currency, exchange_rate_to_base=rate, original_amount=item.cash_amount, description=investment.investee_name)]
            if principal_base > 0: lines.append(PostingLine(ledger_account_id=investment_ledger.id, credit=principal_base, currency=investment.currency, exchange_rate_to_base=rate, original_amount=item.principal_return_amount, description="Investment principal returned"))
            if income_base > 0: lines.append(PostingLine(ledger_account_id=income_ledger.id, credit=income_base, currency=investment.currency, exchange_rate_to_base=rate, original_amount=item.income_amount, description="Investment income"))
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=item.return_date, source_type="investment_return", source_id=item.id, lines=lines, reference=item.reference, memo=f"Investment return from {investment.investee_name}"); counts["investment_returns"] += 1
        except HTTPException as exc: errors.append(f"Investment return {item.id}: {exc.detail}")

    investor_funding = db.scalars(select(ProjectInvestor).where(ProjectInvestor.organization_id == organization_id, ProjectInvestor.account_id.is_not(None))).all()
    for investor in investor_funding:
        if after_cutoff(investor.investment_date) or _already_posted(db, organization_id, "project_investor_funding", investor.id): continue
        try:
            _, cash_ledger = financial_ledger_account(db, organization_id, investor.account_id); funding_ledger = system_account(db, organization_id, "investor_funds_payable"); base_amount, rate = to_base_amount(db, organization_id, base_currency, Decimal(investor.invested_amount), investor.currency, rate_date=investor.investment_date)
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=investor.investment_date, source_type="project_investor_funding", source_id=investor.id, lines=[PostingLine(ledger_account_id=cash_ledger.id, debit=base_amount, currency=investor.currency, exchange_rate_to_base=rate, original_amount=investor.invested_amount, description=investor.investor_name), PostingLine(ledger_account_id=funding_ledger.id, credit=base_amount, currency=investor.currency, exchange_rate_to_base=rate, original_amount=investor.invested_amount, description=investor.investor_name)], reference=investor.agreement_reference, memo=f"Project investor funding from {investor.investor_name}"); counts["project_investor_funding"] += 1
        except HTTPException as exc: errors.append(f"Investor funding {investor.investor_name}: {exc.detail}")

    payouts = db.execute(select(InvestorPayout, ProjectInvestor).join(ProjectInvestor, ProjectInvestor.id == InvestorPayout.investor_id).where(InvestorPayout.organization_id == organization_id)).all()
    for payout, investor in payouts:
        if after_cutoff(payout.payout_date) or _already_posted(db, organization_id, "investor_payout", payout.id): continue
        try:
            _, cash_ledger = financial_ledger_account(db, organization_id, payout.account_id); funding_ledger = system_account(db, organization_id, "investor_funds_payable"); profit_expense = system_account(db, organization_id, "investor_profit_share"); total_original = money(Decimal(payout.principal_return_amount) + Decimal(payout.profit_share_amount)); total_base, rate = to_base_amount(db, organization_id, base_currency, total_original, investor.currency, rate_date=payout.payout_date); principal_base, _ = to_base_amount(db, organization_id, base_currency, Decimal(payout.principal_return_amount), investor.currency, rate_date=payout.payout_date) if Decimal(payout.principal_return_amount) > 0 else (Decimal("0"), rate); profit_base = money(total_base - principal_base)
            lines = [PostingLine(ledger_account_id=cash_ledger.id, credit=total_base, currency=investor.currency, exchange_rate_to_base=rate, original_amount=total_original, description=investor.investor_name)]
            if principal_base > 0: lines.append(PostingLine(ledger_account_id=funding_ledger.id, debit=principal_base, currency=investor.currency, exchange_rate_to_base=rate, original_amount=payout.principal_return_amount, description="Investor principal returned"))
            if profit_base > 0: lines.append(PostingLine(ledger_account_id=profit_expense.id, debit=profit_base, currency=investor.currency, exchange_rate_to_base=rate, original_amount=payout.profit_share_amount, description="Investor profit share"))
            post_journal(db, organization_id=organization_id, user_id=user_id, entry_date=payout.payout_date, source_type="investor_payout", source_id=payout.id, lines=lines, reference=payout.reference, memo=f"Investor payout to {investor.investor_name}"); counts["investor_payouts"] += 1
        except HTTPException as exc: errors.append(f"Investor payout {payout.id}: {exc.detail}")

    return {"counts": counts, "errors": errors}
