from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.payables import PayableBill, PayablePayment
from app.models.tax import TaxCode
from app.schemas.payables import PayableBillCreate, PayableBillRead, PayablePaymentCreate, PayablePaymentRead
from app.services.accounting_posting import PostingLine, financial_ledger_account, money, post_journal, system_account, to_base_amount
from app.services.activity_log import record_activity
from app.services.functional_currency import functional_currency_for_date
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/payables", tags=["Accounting"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _clean(value: str | None) -> str | None:
    if value is None: return None
    value = value.strip(); return value or None


def _financial_balance(db: DbSession, account: FinancialAccount) -> Decimal:
    net = db.scalar(select(func.coalesce(func.sum(case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)), 0)).where(FinancialTransaction.organization_id == account.organization_id, FinancialTransaction.account_id == account.id)) or Decimal("0")
    return _money(Decimal(account.opening_balance) + Decimal(net))


def _tax_code(db: DbSession, organization_id: str, tax_code_id: str | None, kind: str, bill_date) -> TaxCode | None:
    if not tax_code_id: return None
    row = db.scalar(select(TaxCode).where(TaxCode.id == tax_code_id, TaxCode.organization_id == organization_id, TaxCode.tax_kind == kind, TaxCode.is_active.is_(True)))
    if row is None: raise HTTPException(status_code=404, detail=f"Active {kind} tax code not found")
    if row.effective_from and bill_date < row.effective_from: raise HTTPException(status_code=400, detail=f"Tax code {row.code} is not effective yet")
    if row.effective_to and bill_date > row.effective_to: raise HTTPException(status_code=400, detail=f"Tax code {row.code} has expired")
    return row


def _tax_ledger(db: DbSession, organization_id: str, user_id: str, *, system_key: str, code: str, name: str, category: str, normal_balance: str) -> LedgerAccount:
    row = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == organization_id, LedgerAccount.system_key == system_key, LedgerAccount.is_active.is_(True)))
    if row is not None: return row
    row = LedgerAccount(organization_id=organization_id, code=code, name=name, category=category, subtype=system_key, normal_balance=normal_balance, system_key=system_key, is_system=True, is_active=True, allow_manual_posting=False, notes="Tax Center system account", created_by_user_id=user_id)
    db.add(row); db.flush(); return row


def _bill_read(db: DbSession, organization_id: str, bill: PayableBill) -> PayableBillRead:
    category_name = db.scalar(select(LedgerAccount.name).where(LedgerAccount.id == bill.expense_ledger_account_id, LedgerAccount.organization_id == organization_id)) or "—"
    return PayableBillRead(id=bill.id, bill_number=bill.bill_number, supplier_name=bill.supplier_name, bill_date=bill.bill_date, due_date=bill.due_date, currency=bill.currency, subtotal_amount=bill.subtotal_amount, tax_code_id=bill.tax_code_id, tax_rate_snapshot=bill.tax_rate_snapshot, input_tax_amount=bill.input_tax_amount, recoverable_tax_amount=bill.recoverable_tax_amount, withholding_tax_code_id=bill.withholding_tax_code_id, withholding_rate_snapshot=bill.withholding_rate_snapshot, withholding_tax_amount=bill.withholding_tax_amount, original_amount=bill.original_amount, net_payable_amount=bill.net_payable_amount, amount_paid=bill.amount_paid, balance_due=bill.balance_due, expense_ledger_account_id=bill.expense_ledger_account_id, expense_ledger_account_name=category_name, description=bill.description, reference=bill.reference, notes=bill.notes, status=bill.status, created_at=bill.created_at)


def _payable_carrying_base(db: DbSession, organization_id: str, bill: PayableBill, current_payment_id: str, payable_account_id: str, settlement_amount: Decimal) -> Decimal:
    issue = db.scalar(select(JournalEntry).where(JournalEntry.organization_id == organization_id, JournalEntry.source_type == "payable_bill", JournalEntry.source_id == bill.id, JournalEntry.status == "posted"))
    if issue is None: raise HTTPException(status_code=409, detail=f"Payable bill {bill.bill_number} does not have its source journal")
    issue_base = Decimal(db.scalar(select(func.coalesce(func.sum(JournalLine.credit), 0)).where(JournalLine.organization_id == organization_id, JournalLine.journal_entry_id == issue.id, JournalLine.ledger_account_id == payable_account_id)) or 0)
    prior = db.execute(
        select(PayablePayment.amount, JournalLine.debit)
        .join(JournalEntry, (JournalEntry.organization_id == PayablePayment.organization_id) & (JournalEntry.source_type == "payable_payment") & (JournalEntry.source_id == PayablePayment.id) & (JournalEntry.status == "posted"))
        .join(JournalLine, (JournalLine.organization_id == PayablePayment.organization_id) & (JournalLine.journal_entry_id == JournalEntry.id) & (JournalLine.ledger_account_id == payable_account_id))
        .where(PayablePayment.organization_id == organization_id, PayablePayment.bill_id == bill.id, PayablePayment.id != current_payment_id)
    ).all()
    prior_original = _money(sum((Decimal(original) for original, _ in prior), Decimal("0")))
    prior_base = _money(sum((Decimal(base) for _, base in prior), Decimal("0")))
    remaining_original = _money(Decimal(bill.net_payable_amount) - prior_original)
    remaining_base = _money(issue_base - prior_base)
    settlement_amount = _money(settlement_amount)
    if remaining_original <= 0 or settlement_amount >= remaining_original: return remaining_base
    return _money(remaining_base * settlement_amount / remaining_original)


@router.get("", response_model=list[PayableBillRead])
def list_payable_bills(db: DbSession, tenant: AccountingViewer, include_paid: bool = False, limit: int = 200):
    query = select(PayableBill).where(PayableBill.organization_id == tenant.organization_id)
    if not include_paid: query = query.where(PayableBill.balance_due > 0)
    rows = db.scalars(query.order_by(PayableBill.due_date.asc().nulls_last(), PayableBill.bill_date.desc()).limit(min(max(limit, 1), 500))).all()
    return [_bill_read(db, tenant.organization_id, item) for item in rows]


@router.post("", response_model=PayableBillRead, status_code=status.HTTP_201_CREATED)
def create_payable_bill(payload: PayableBillCreate, request: Request, db: DbSession, tenant: AccountingManager):
    expense = db.scalar(select(LedgerAccount).where(LedgerAccount.id == payload.expense_ledger_account_id, LedgerAccount.organization_id == tenant.organization_id, LedgerAccount.category == "expense", LedgerAccount.is_active.is_(True)))
    if expense is None: raise HTTPException(status_code=404, detail="Active expense category not found")
    if payload.due_date and payload.due_date < payload.bill_date: raise HTTPException(status_code=400, detail="Due date cannot be before bill date")
    subtotal = _money(payload.amount); purchase_tax = _tax_code(db, tenant.organization_id, payload.tax_code_id, "purchase", payload.bill_date); withholding_tax = _tax_code(db, tenant.organization_id, payload.withholding_tax_code_id, "withholding", payload.bill_date)
    input_tax = _money(subtotal * Decimal(purchase_tax.rate) / Decimal("100")) if purchase_tax else Decimal("0.00"); recoverable = _money(input_tax * Decimal(purchase_tax.recoverable_percent) / Decimal("100")) if purchase_tax else Decimal("0.00"); nonrecoverable = _money(input_tax - recoverable); gross = _money(subtotal + input_tax); withholding = _money(subtotal * Decimal(withholding_tax.rate) / Decimal("100")) if withholding_tax else Decimal("0.00")
    if withholding > gross: raise HTTPException(status_code=400, detail="Withholding tax cannot exceed gross vendor bill")
    net_payable = _money(gross - withholding)
    bill = PayableBill(organization_id=tenant.organization_id, bill_number=f"BILL-{payload.bill_date.strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}", supplier_name=payload.supplier_name.strip(), bill_date=payload.bill_date, due_date=payload.due_date, currency=payload.currency.upper(), subtotal_amount=subtotal, tax_code_id=purchase_tax.id if purchase_tax else None, tax_rate_snapshot=purchase_tax.rate if purchase_tax else None, input_tax_amount=input_tax, recoverable_tax_amount=recoverable, withholding_tax_code_id=withholding_tax.id if withholding_tax else None, withholding_rate_snapshot=withholding_tax.rate if withholding_tax else None, withholding_tax_amount=withholding, original_amount=gross, net_payable_amount=net_payable, amount_paid=Decimal("0"), balance_due=net_payable, expense_ledger_account_id=expense.id, description=payload.description.strip(), reference=_clean(payload.reference), notes=_clean(payload.notes), status="open", created_by_user_id=tenant.user_id)
    db.add(bill); db.flush(); payable = system_account(db, tenant.organization_id, "accounts_payable")
    lines = [PostingLine(ledger_account_id=expense.id, debit=subtotal + nonrecoverable, currency=bill.currency, description=bill.description)]
    if recoverable > 0:
        input_tax_ledger = _tax_ledger(db, tenant.organization_id, tenant.user_id, system_key="input_tax_receivable", code="1210", name="Input Tax Receivable", category="asset", normal_balance="debit"); lines.append(PostingLine(ledger_account_id=input_tax_ledger.id, debit=recoverable, currency=bill.currency, description=f"Recoverable input tax: {bill.bill_number}"))
    lines.append(PostingLine(ledger_account_id=payable.id, credit=net_payable, currency=bill.currency, description=f"Payable to {bill.supplier_name}"))
    if withholding > 0:
        withholding_ledger = _tax_ledger(db, tenant.organization_id, tenant.user_id, system_key="withholding_tax_payable", code="2210", name="Withholding Tax Payable", category="liability", normal_balance="credit"); lines.append(PostingLine(ledger_account_id=withholding_ledger.id, credit=withholding, currency=bill.currency, description=f"Withholding tax: {bill.bill_number}"))
    post_journal(db, organization_id=tenant.organization_id, user_id=tenant.user_id, entry_date=bill.bill_date, source_type="payable_bill", source_id=bill.id, lines=lines, reference=bill.reference, memo=bill.description)
    record_activity(db, action="accounting.payable.bill_created", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="payable_bill", entity_id=bill.id, after={"supplier_name": bill.supplier_name, "subtotal": str(subtotal), "input_tax": str(input_tax), "recoverable_tax": str(recoverable), "withholding_tax": str(withholding), "gross": str(gross), "net_payable": str(net_payable), "currency": bill.currency}, message=f"Vendor bill recorded: {bill.bill_number} — {bill.currency} {gross}", request=request)
    db.commit(); db.refresh(bill); return _bill_read(db, tenant.organization_id, bill)


@router.get("/{bill_id}/payments", response_model=list[PayablePaymentRead])
def list_payable_payments(bill_id: str, db: DbSession, tenant: AccountingViewer):
    bill = db.scalar(select(PayableBill).where(PayableBill.id == bill_id, PayableBill.organization_id == tenant.organization_id))
    if bill is None: raise HTTPException(status_code=404, detail="Payable bill not found")
    rows = db.execute(select(PayablePayment, FinancialAccount.name).join(FinancialAccount, FinancialAccount.id == PayablePayment.financial_account_id).where(PayablePayment.organization_id == tenant.organization_id, PayablePayment.bill_id == bill.id).order_by(PayablePayment.payment_date.desc(), PayablePayment.created_at.desc())).all()
    return [PayablePaymentRead(id=item.id, bill_id=item.bill_id, financial_account_id=item.financial_account_id, financial_account_name=account_name, payment_date=item.payment_date, currency=item.currency, amount=item.amount, reference=item.reference, notes=item.notes, created_at=item.created_at) for item, account_name in rows]


@router.post("/{bill_id}/payments", response_model=PayablePaymentRead, status_code=status.HTTP_201_CREATED)
def pay_payable_bill(bill_id: str, payload: PayablePaymentCreate, request: Request, db: DbSession, tenant: AccountingManager):
    bill = db.scalar(select(PayableBill).where(PayableBill.id == bill_id, PayableBill.organization_id == tenant.organization_id).with_for_update())
    if bill is None: raise HTTPException(status_code=404, detail="Payable bill not found")
    amount = _money(payload.amount)
    if amount > _money(bill.balance_due): raise HTTPException(status_code=400, detail="Payment cannot exceed the remaining payable balance")
    financial, financial_ledger = financial_ledger_account(db, tenant.organization_id, payload.financial_account_id)
    if financial.currency != bill.currency: raise HTTPException(status_code=400, detail="For simple payable payments, choose an account with the same currency as the bill")
    if financial.account_type != "credit_card" and _financial_balance(db, financial) < amount: raise HTTPException(status_code=409, detail="Selected account does not have enough balance")
    payment = PayablePayment(organization_id=tenant.organization_id, bill_id=bill.id, financial_account_id=financial.id, payment_date=payload.payment_date, currency=bill.currency, amount=amount, reference=_clean(payload.reference), notes=_clean(payload.notes), created_by_user_id=tenant.user_id)
    db.add(payment); db.flush(); payable = system_account(db, tenant.organization_id, "accounts_payable")
    base_currency = functional_currency_for_date(db, tenant.organization_id, payment.payment_date)
    cash_base, cash_rate = to_base_amount(db, tenant.organization_id, base_currency, amount, bill.currency, rate_date=payment.payment_date)
    carrying_base = _payable_carrying_base(db, tenant.organization_id, bill, payment.id, payable.id, amount)
    payable_rate = (carrying_base / amount) if amount else Decimal("1")
    lines = [PostingLine(ledger_account_id=payable.id, debit=carrying_base, currency=bill.currency, exchange_rate_to_base=payable_rate, original_amount=amount, description=f"Settlement of {bill.bill_number}"), PostingLine(ledger_account_id=financial_ledger.id, credit=cash_base, currency=bill.currency, exchange_rate_to_base=cash_rate, original_amount=amount, description=bill.description)]
    difference = _money(cash_base - carrying_base)
    if difference > 0:
        loss = system_account(db, tenant.organization_id, "realized_fx_loss"); lines.append(PostingLine(ledger_account_id=loss.id, debit=difference, currency=base_currency, original_amount=difference, description=f"Realized FX loss on {bill.bill_number}"))
    elif difference < 0:
        gain = system_account(db, tenant.organization_id, "realized_fx_gain"); lines.append(PostingLine(ledger_account_id=gain.id, credit=abs(difference), currency=base_currency, original_amount=abs(difference), description=f"Realized FX gain on {bill.bill_number}"))
    post_journal(db, organization_id=tenant.organization_id, user_id=tenant.user_id, entry_date=payment.payment_date, source_type="payable_payment", source_id=payment.id, lines=lines, reference=payment.reference, memo=f"Payment for {bill.bill_number}")
    db.add(FinancialTransaction(organization_id=tenant.organization_id, account_id=financial.id, transaction_date=payment.payment_date, direction="credit" if financial.account_type == "credit_card" else "debit", amount=amount, currency=bill.currency, source_type="payable_payment", source_id=payment.id, reference=payment.reference, description=f"Payment to {bill.supplier_name}: {bill.description}", created_by_user_id=tenant.user_id))
    bill.amount_paid = _money(Decimal(bill.amount_paid) + amount); bill.balance_due = _money(Decimal(bill.net_payable_amount) - Decimal(bill.amount_paid)); bill.status = "paid" if bill.balance_due == 0 else "partially_paid"; db.flush()
    record_activity(db, action="accounting.payable.payment_created", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="payable_payment", entity_id=payment.id, after={"bill_id": bill.id, "amount": str(amount), "currency": bill.currency, "remaining": str(bill.balance_due), "account_id": financial.id, "cash_base": str(cash_base), "carrying_base": str(carrying_base), "realized_fx": str(difference)}, message=f"Payable payment recorded: {bill.currency} {amount} to {bill.supplier_name}", request=request)
    db.commit(); db.refresh(payment)
    return PayablePaymentRead(id=payment.id, bill_id=payment.bill_id, financial_account_id=payment.financial_account_id, financial_account_name=financial.name, payment_date=payment.payment_date, currency=payment.currency, amount=payment.amount, reference=payment.reference, notes=payment.notes, created_at=payment.created_at)
