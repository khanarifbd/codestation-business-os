from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice
from app.models.inventory import PurchaseReceipt
from app.models.payables import PayableBill
from app.models.tax import TaxCode, TaxSettlement
from app.services.accounting_posting import PostingLine, financial_ledger_account, post_journal, system_account
from app.services.activity_log import record_activity
from app.services.functional_currency import functional_currency_for_date
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/tax", tags=["Accounting - Tax"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


class TaxCodeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=160)
    tax_kind: Literal["sales", "purchase", "withholding"]
    rate: Decimal = Field(ge=0, le=1000)
    recoverable_percent: Decimal = Field(default=100, ge=0, le=100)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    jurisdiction: str | None = Field(default=None, max_length=120)
    effective_from: date | None = None
    effective_to: date | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.effective_from and self.effective_to and self.effective_to < self.effective_from:
            raise ValueError("Effective-to date cannot be before effective-from date")
        if self.tax_kind != "purchase" and self.recoverable_percent != Decimal("100"):
            self.recoverable_percent = Decimal("100")
        return self


class TaxCodeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    rate: Decimal | None = Field(default=None, ge=0, le=1000)
    recoverable_percent: Decimal | None = Field(default=None, ge=0, le=100)
    jurisdiction: str | None = Field(default=None, max_length=120)
    effective_from: date | None = None
    effective_to: date | None = None
    notes: str | None = None
    is_active: bool | None = None


def read_code(row: TaxCode) -> dict:
    return {"id": row.id, "code": row.code, "name": row.name, "tax_kind": row.tax_kind, "rate": row.rate, "recoverable_percent": row.recoverable_percent, "country_code": row.country_code, "jurisdiction": row.jurisdiction, "effective_from": row.effective_from, "effective_to": row.effective_to, "is_active": row.is_active, "notes": row.notes}


@router.get("/codes")
def list_codes(db: DbSession, tenant: Viewer, include_inactive: bool = False):
    query = select(TaxCode).where(TaxCode.organization_id == tenant.organization_id)
    if not include_inactive:
        query = query.where(TaxCode.is_active.is_(True))
    return [read_code(row) for row in db.scalars(query.order_by(TaxCode.tax_kind, TaxCode.code)).all()]


@router.post("/codes", status_code=201)
def create_code(payload: TaxCodeCreate, request: Request, db: DbSession, tenant: Manager):
    code = payload.code.strip().upper()
    if db.scalar(select(TaxCode.id).where(TaxCode.organization_id == tenant.organization_id, func.lower(TaxCode.code) == code.lower())):
        raise HTTPException(status_code=409, detail="Tax code already exists")
    row = TaxCode(organization_id=tenant.organization_id, code=code, name=payload.name.strip(), tax_kind=payload.tax_kind, rate=payload.rate, recoverable_percent=payload.recoverable_percent, country_code=payload.country_code.upper() if payload.country_code else None, jurisdiction=payload.jurisdiction.strip() if payload.jurisdiction else None, effective_from=payload.effective_from, effective_to=payload.effective_to, notes=payload.notes, is_active=True, created_by_user_id=tenant.user_id)
    db.add(row); db.flush()
    record_activity(db, action="accounting.tax_code.create", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="tax_code", entity_id=row.id, after=read_code(row), request=request)
    db.commit(); return read_code(row)


@router.patch("/codes/{tax_code_id}")
def update_code(tax_code_id: str, payload: TaxCodeUpdate, request: Request, db: DbSession, tenant: Manager):
    row = db.scalar(select(TaxCode).where(TaxCode.id == tax_code_id, TaxCode.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(status_code=404, detail="Tax code not found")
    before = read_code(row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "recoverable_percent" and row.tax_kind != "purchase": continue
        setattr(row, field, value.strip() if isinstance(value, str) else value)
    if row.effective_from and row.effective_to and row.effective_to < row.effective_from:
        raise HTTPException(status_code=400, detail="Effective-to date cannot be before effective-from date")
    record_activity(db, action="accounting.tax_code.update", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="tax_code", entity_id=row.id, before=before, after=read_code(row), request=request)
    db.commit(); return read_code(row)


@router.get("/report")
def tax_report(db: DbSession, tenant: Viewer, date_from: date, date_to: date):
    if date_from > date_to: date_from, date_to = date_to, date_from
    currencies = set(db.scalars(select(Invoice.currency).where(Invoice.organization_id == tenant.organization_id, Invoice.issue_date >= date_from, Invoice.issue_date <= date_to)).all())
    currencies.update(db.scalars(select(PayableBill.currency).where(PayableBill.organization_id == tenant.organization_id, PayableBill.bill_date >= date_from, PayableBill.bill_date <= date_to)).all())
    currencies.update(db.scalars(select(PurchaseReceipt.currency).where(PurchaseReceipt.organization_id == tenant.organization_id, PurchaseReceipt.receipt_date >= date_from, PurchaseReceipt.receipt_date <= date_to)).all())
    rows = []
    for currency in sorted(currencies):
        output_tax = money(db.scalar(select(func.coalesce(func.sum(Invoice.tax_total), 0)).where(Invoice.organization_id == tenant.organization_id, Invoice.currency == currency, Invoice.issue_date >= date_from, Invoice.issue_date <= date_to, Invoice.status.not_in(["draft", "cancelled"]))))
        payable_input = money(db.scalar(select(func.coalesce(func.sum(PayableBill.input_tax_amount), 0)).where(PayableBill.organization_id == tenant.organization_id, PayableBill.currency == currency, PayableBill.bill_date >= date_from, PayableBill.bill_date <= date_to)))
        payable_recoverable = money(db.scalar(select(func.coalesce(func.sum(PayableBill.recoverable_tax_amount), 0)).where(PayableBill.organization_id == tenant.organization_id, PayableBill.currency == currency, PayableBill.bill_date >= date_from, PayableBill.bill_date <= date_to)))
        inventory_input = money(db.scalar(select(func.coalesce(func.sum(PurchaseReceipt.tax_total), 0)).where(PurchaseReceipt.organization_id == tenant.organization_id, PurchaseReceipt.currency == currency, PurchaseReceipt.receipt_date >= date_from, PurchaseReceipt.receipt_date <= date_to, PurchaseReceipt.status != "cancelled")))
        inventory_recoverable = money(db.scalar(select(func.coalesce(func.sum(PurchaseReceipt.recoverable_tax_total), 0)).where(PurchaseReceipt.organization_id == tenant.organization_id, PurchaseReceipt.currency == currency, PurchaseReceipt.receipt_date >= date_from, PurchaseReceipt.receipt_date <= date_to, PurchaseReceipt.status != "cancelled")))
        input_tax = money(payable_input + inventory_input)
        recoverable = money(payable_recoverable + inventory_recoverable)
        withholding = money(db.scalar(select(func.coalesce(func.sum(PayableBill.withholding_tax_amount), 0)).where(PayableBill.organization_id == tenant.organization_id, PayableBill.currency == currency, PayableBill.bill_date >= date_from, PayableBill.bill_date <= date_to)))
        rows.append({"currency": currency, "output_tax": output_tax, "input_tax": input_tax, "recoverable_input_tax": recoverable, "withholding_tax": withholding, "net_indirect_tax_payable": money(output_tax - recoverable)})
    return {"date_from": date_from, "date_to": date_to, "rows": rows}


class TaxSettlementCreate(BaseModel):
    settlement_type: Literal["indirect_tax_payment", "withholding_tax_payment", "input_tax_refund", "input_tax_offset"]
    settlement_date: date
    amount: Decimal = Field(gt=0)
    account_id: str | None = None
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None

    @model_validator(mode="after")
    def validate_account(self):
        if self.settlement_type == "input_tax_offset":
            if self.account_id is not None:
                raise ValueError("Input-tax offset is non-cash and must not use a financial account")
        elif not self.account_id:
            raise ValueError("A financial account is required for this tax settlement")
        return self


def _tax_ledger_existing(db: DbSession, organization_id: str, system_key: str) -> LedgerAccount:
    row = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == organization_id,
            LedgerAccount.system_key == system_key,
            LedgerAccount.is_active.is_(True),
        )
    )
    if row is None:
        raise HTTPException(status_code=409, detail=f"No posted tax balance exists for {system_key.replace('_', ' ')}")
    return row


def _ledger_balance_as_of(
    db: DbSession,
    organization_id: str,
    ledger_account_id: str,
    as_of: date,
    *,
    normal_balance: Literal["debit", "credit"],
) -> Decimal:
    debit, credit = db.execute(
        select(
            func.coalesce(func.sum(JournalLine.debit), 0),
            func.coalesce(func.sum(JournalLine.credit), 0),
        )
        .join(
            JournalEntry,
            (JournalEntry.id == JournalLine.journal_entry_id)
            & (JournalEntry.organization_id == JournalLine.organization_id),
        )
        .where(
            JournalLine.organization_id == organization_id,
            JournalLine.ledger_account_id == ledger_account_id,
            JournalEntry.status == "posted",
            JournalEntry.entry_date <= as_of,
        )
    ).one()
    return money((Decimal(debit) - Decimal(credit)) if normal_balance == "debit" else (Decimal(credit) - Decimal(debit)))


def _financial_balance(db: DbSession, account: FinancialAccount) -> Decimal:
    net = db.scalar(
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
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
        )
    ) or Decimal("0")
    return money(Decimal(account.opening_balance) + Decimal(net))


def _settlement_read(item: TaxSettlement) -> dict:
    return {
        "id": item.id,
        "settlement_type": item.settlement_type,
        "settlement_date": item.settlement_date,
        "currency": item.currency,
        "amount": item.amount,
        "account_id": item.account_id,
        "reference": item.reference,
        "notes": item.notes,
        "created_at": item.created_at,
    }


@router.get("/settlement-meta")
def settlement_meta(db: DbSession, tenant: Viewer, settlement_date: date | None = None):
    target_date = settlement_date or date.today()
    base_currency = functional_currency_for_date(db, tenant.organization_id, target_date)
    accounts = db.scalars(
        select(FinancialAccount)
        .where(
            FinancialAccount.organization_id == tenant.organization_id,
            FinancialAccount.is_active.is_(True),
            FinancialAccount.currency == base_currency,
            FinancialAccount.account_type != "credit_card",
        )
        .order_by(FinancialAccount.name)
    ).all()
    return {
        "currency": base_currency,
        "accounts": [
            {"id": item.id, "name": item.name, "balance": _financial_balance(db, item)}
            for item in accounts
        ],
    }


@router.get("/settlements")
def list_settlements(db: DbSession, tenant: Viewer, limit: int = 100):
    rows = db.scalars(
        select(TaxSettlement)
        .where(TaxSettlement.organization_id == tenant.organization_id)
        .order_by(TaxSettlement.settlement_date.desc(), TaxSettlement.created_at.desc())
        .limit(min(max(limit, 1), 500))
    ).all()
    return [_settlement_read(item) for item in rows]


@router.post("/settlements", status_code=201)
def create_settlement(payload: TaxSettlementCreate, request: Request, db: DbSession, tenant: Manager):
    amount = money(payload.amount)
    base_currency = functional_currency_for_date(db, tenant.organization_id, payload.settlement_date)
    account: FinancialAccount | None = None
    cash_ledger: LedgerAccount | None = None
    direction: str | None = None

    if payload.account_id:
        account = db.scalar(
            select(FinancialAccount)
            .where(
                FinancialAccount.id == payload.account_id,
                FinancialAccount.organization_id == tenant.organization_id,
                FinancialAccount.is_active.is_(True),
            )
            .with_for_update()
        )
        if account is None:
            raise HTTPException(status_code=404, detail="Active financial account not found")
        if account.currency != base_currency:
            raise HTTPException(status_code=400, detail=f"Tax settlements must use a {base_currency} financial account")
        if account.account_type == "credit_card":
            raise HTTPException(status_code=400, detail="Tax settlement cannot use a credit-card liability account")
        account, cash_ledger = financial_ledger_account(db, tenant.organization_id, account.id)

    lines: list[PostingLine] = []
    if payload.settlement_type == "indirect_tax_payment":
        tax_payable = system_account(db, tenant.organization_id, "taxes_payable")
        available = _ledger_balance_as_of(db, tenant.organization_id, tax_payable.id, payload.settlement_date, normal_balance="credit")
        if amount > available:
            raise HTTPException(status_code=409, detail=f"Settlement exceeds indirect tax payable balance {available} {base_currency}")
        assert account is not None and cash_ledger is not None
        if _financial_balance(db, account) < amount:
            raise HTTPException(status_code=409, detail="Insufficient financial account balance")
        lines = [
            PostingLine(ledger_account_id=tax_payable.id, debit=amount, currency=base_currency, original_amount=amount, description="Indirect tax liability settlement"),
            PostingLine(ledger_account_id=cash_ledger.id, credit=amount, currency=base_currency, original_amount=amount, description="Indirect tax payment"),
        ]
        direction = "debit"
    elif payload.settlement_type == "withholding_tax_payment":
        withholding = _tax_ledger_existing(db, tenant.organization_id, "withholding_tax_payable")
        available = _ledger_balance_as_of(db, tenant.organization_id, withholding.id, payload.settlement_date, normal_balance="credit")
        if amount > available:
            raise HTTPException(status_code=409, detail=f"Settlement exceeds withholding tax payable balance {available} {base_currency}")
        assert account is not None and cash_ledger is not None
        if _financial_balance(db, account) < amount:
            raise HTTPException(status_code=409, detail="Insufficient financial account balance")
        lines = [
            PostingLine(ledger_account_id=withholding.id, debit=amount, currency=base_currency, original_amount=amount, description="Withholding tax liability settlement"),
            PostingLine(ledger_account_id=cash_ledger.id, credit=amount, currency=base_currency, original_amount=amount, description="Withholding tax payment"),
        ]
        direction = "debit"
    elif payload.settlement_type == "input_tax_refund":
        input_tax = _tax_ledger_existing(db, tenant.organization_id, "input_tax_receivable")
        available = _ledger_balance_as_of(db, tenant.organization_id, input_tax.id, payload.settlement_date, normal_balance="debit")
        if amount > available:
            raise HTTPException(status_code=409, detail=f"Refund exceeds input tax receivable balance {available} {base_currency}")
        assert account is not None and cash_ledger is not None
        lines = [
            PostingLine(ledger_account_id=cash_ledger.id, debit=amount, currency=base_currency, original_amount=amount, description="Input tax refund received"),
            PostingLine(ledger_account_id=input_tax.id, credit=amount, currency=base_currency, original_amount=amount, description="Input tax receivable refunded"),
        ]
        direction = "credit"
    else:
        tax_payable = system_account(db, tenant.organization_id, "taxes_payable")
        input_tax = _tax_ledger_existing(db, tenant.organization_id, "input_tax_receivable")
        payable_available = _ledger_balance_as_of(db, tenant.organization_id, tax_payable.id, payload.settlement_date, normal_balance="credit")
        input_available = _ledger_balance_as_of(db, tenant.organization_id, input_tax.id, payload.settlement_date, normal_balance="debit")
        if amount > payable_available or amount > input_available:
            raise HTTPException(
                status_code=409,
                detail=f"Offset exceeds available balances (tax payable {payable_available}, input tax {input_available}) {base_currency}",
            )
        lines = [
            PostingLine(ledger_account_id=tax_payable.id, debit=amount, currency=base_currency, original_amount=amount, description="Input tax offset against indirect tax payable"),
            PostingLine(ledger_account_id=input_tax.id, credit=amount, currency=base_currency, original_amount=amount, description="Input tax receivable applied"),
        ]

    item = TaxSettlement(
        organization_id=tenant.organization_id,
        settlement_type=payload.settlement_type,
        settlement_date=payload.settlement_date,
        currency=base_currency,
        amount=amount,
        account_id=account.id if account is not None else None,
        reference=payload.reference.strip() if payload.reference and payload.reference.strip() else None,
        notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        created_by_user_id=tenant.user_id,
    )
    db.add(item)
    db.flush()
    journal = post_journal(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        entry_date=item.settlement_date,
        source_type="tax_settlement",
        source_id=item.id,
        reference=item.reference,
        memo=f"Tax settlement · {item.settlement_type.replace('_', ' ')}",
        lines=lines,
    )
    if account is not None and direction is not None:
        db.add(
            FinancialTransaction(
                organization_id=tenant.organization_id,
                account_id=account.id,
                transaction_date=item.settlement_date,
                direction=direction,
                amount=amount,
                currency=base_currency,
                source_type="tax_settlement",
                source_id=item.id,
                reference=item.reference,
                description=f"Tax settlement · {item.settlement_type.replace('_', ' ')}",
                created_by_user_id=tenant.user_id,
            )
        )
    record_activity(
        db,
        action="accounting.tax_settlement.create",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="tax_settlement",
        entity_id=item.id,
        after={**_settlement_read(item), "journal_entry_id": journal.id},
        message=f"Tax settlement posted: {item.currency} {item.amount}",
        request=request,
    )
    db.commit()
    return _settlement_read(item)
