from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.finance import Invoice
from app.models.inventory import PurchaseReceipt
from app.models.payables import PayableBill
from app.models.tax import TaxCode
from app.services.activity_log import record_activity
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
