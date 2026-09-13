from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.fixed_assets import AssetDepreciationEntry, FixedAsset
from app.services.accounting_posting import PostingLine, financial_ledger_account, post_journal, system_account, to_base_amount
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/assets", tags=["Accounting - Fixed Assets"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def account_balance(db: DbSession, account: FinancialAccount, org: str) -> Decimal:
    net = db.scalar(select(func.coalesce(func.sum(case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)), 0)).where(FinancialTransaction.organization_id == org, FinancialTransaction.account_id == account.id))
    return money(account.opening_balance + Decimal(net or 0))


def asset_json(row: FixedAsset) -> dict:
    depreciable = money(row.acquisition_cost - row.salvage_value)
    book = money(row.acquisition_cost - row.accumulated_depreciation)
    return {"id":row.id,"asset_code":row.asset_code,"name":row.name,"category":row.category,"currency":row.currency,"acquisition_cost":row.acquisition_cost,"salvage_value":row.salvage_value,"accumulated_depreciation":row.accumulated_depreciation,"book_value":book,"depreciable_amount":depreciable,"acquisition_date":row.acquisition_date,"in_service_date":row.in_service_date,"useful_life_months":row.useful_life_months,"depreciation_method":row.depreciation_method,"purchase_account_id":row.purchase_account_id,"reference":row.reference,"status":row.status,"notes":row.notes}


class AssetCreate(BaseModel):
    asset_code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=2, max_length=220)
    category: str = Field(default="equipment", min_length=2, max_length=80)
    currency: str = Field(min_length=3, max_length=3)
    acquisition_cost: Decimal = Field(gt=0)
    salvage_value: Decimal = Field(default=0, ge=0)
    acquisition_date: date
    in_service_date: date
    useful_life_months: int = Field(gt=0, le=1200)
    depreciation_method: Literal["straight_line"] = "straight_line"
    record_mode: Literal["purchase","opening"] = "purchase"
    purchase_account_id: str | None = None
    reference: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_asset(self):
        if self.salvage_value >= self.acquisition_cost: raise ValueError("Salvage value must be lower than acquisition cost")
        if self.in_service_date < self.acquisition_date: raise ValueError("In-service date cannot be before acquisition date")
        if self.record_mode == "purchase" and not self.purchase_account_id: raise ValueError("Purchase account is required for a new asset purchase")
        return self


class DepreciationRun(BaseModel):
    period_date: date


@router.get("/meta")
def meta(db: DbSession, tenant: Viewer):
    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id==tenant.organization_id, FinancialAccount.is_active.is_(True)).order_by(FinancialAccount.currency,FinancialAccount.name)).all()
    return {"accounts":[{"id":a.id,"name":a.name,"currency":a.currency,"account_type":a.account_type,"balance":account_balance(db,a,tenant.organization_id)} for a in accounts],"base_currency":tenant.organization.currency}


@router.get("")
def list_assets(db: DbSession, tenant: Viewer):
    rows = db.scalars(select(FixedAsset).where(FixedAsset.organization_id==tenant.organization_id).order_by(FixedAsset.acquisition_date.desc(),FixedAsset.created_at.desc())).all()
    return [asset_json(row) for row in rows]


@router.get("/summary")
def summary(db: DbSession, tenant: Viewer):
    rows=db.scalars(select(FixedAsset).where(FixedAsset.organization_id==tenant.organization_id)).all()
    currencies=sorted({r.currency for r in rows})
    return {"rows":[{"currency":c,"cost":money(sum((r.acquisition_cost for r in rows if r.currency==c),Decimal("0"))),"accumulated_depreciation":money(sum((r.accumulated_depreciation for r in rows if r.currency==c),Decimal("0"))),"book_value":money(sum((r.acquisition_cost-r.accumulated_depreciation for r in rows if r.currency==c),Decimal("0")))} for c in currencies],"active_assets":sum(1 for r in rows if r.status=="active")}


@router.post("",status_code=201)
def create_asset(payload:AssetCreate,request:Request,db:DbSession,tenant:Manager):
    existing=db.scalar(select(FixedAsset.id).where(FixedAsset.organization_id==tenant.organization_id,func.lower(FixedAsset.asset_code)==payload.asset_code.strip().lower()))
    if existing: raise HTTPException(status_code=409,detail="Asset code already exists")
    currency=payload.currency.upper(); cost=money(payload.acquisition_cost); salvage=money(payload.salvage_value)
    account=None; cash_ledger=None
    if payload.record_mode=="purchase":
        account,cash_ledger=financial_ledger_account(db,tenant.organization_id,payload.purchase_account_id or "")
        if account.currency!=currency: raise HTTPException(status_code=400,detail="Purchase account currency must match asset currency")
        if account.account_type!="credit_card" and account_balance(db,account,tenant.organization_id)<cost: raise HTTPException(status_code=409,detail="Insufficient account balance")
    row=FixedAsset(organization_id=tenant.organization_id,asset_code=payload.asset_code.strip().upper(),name=payload.name.strip(),category=payload.category.strip().lower().replace(" ","_"),currency=currency,acquisition_cost=cost,salvage_value=salvage,accumulated_depreciation=Decimal("0"),acquisition_date=payload.acquisition_date,in_service_date=payload.in_service_date,useful_life_months=payload.useful_life_months,depreciation_method=payload.depreciation_method,purchase_account_id=payload.purchase_account_id if payload.record_mode=="purchase" else None,reference=payload.reference,status="active",notes=payload.notes,created_by_user_id=tenant.user_id)
    db.add(row); db.flush(); description=f"Fixed asset acquisition: {row.asset_code} {row.name}"; fixed=system_account(db,tenant.organization_id,"fixed_assets")
    base,rate=to_base_amount(db,tenant.organization_id,tenant.organization.currency,cost,currency,rate_date=row.acquisition_date)
    if payload.record_mode=="purchase":
        db.add(FinancialTransaction(organization_id=tenant.organization_id,account_id=account.id,transaction_date=row.acquisition_date,direction="debit",amount=cost,currency=currency,source_type="fixed_asset_acquisition",source_id=row.id,reference=row.reference,description=description,created_by_user_id=tenant.user_id))
        credit_ledger=cash_ledger
    else:
        credit_ledger=system_account(db,tenant.organization_id,"opening_balance_equity")
    post_journal(db,organization_id=tenant.organization_id,user_id=tenant.user_id,entry_date=row.acquisition_date,source_type="fixed_asset_acquisition",source_id=row.id,reference=row.reference,memo=description,lines=[PostingLine(ledger_account_id=fixed.id,debit=base,description=description,currency=currency,exchange_rate_to_base=rate,original_amount=cost),PostingLine(ledger_account_id=credit_ledger.id,credit=base,description=description,currency=currency,exchange_rate_to_base=rate,original_amount=cost)])
    record_activity(db,action="accounting.asset.create",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="fixed_asset",entity_id=row.id,after={**asset_json(row),"record_mode":payload.record_mode},request=request); db.commit(); return asset_json(row)


@router.post("/depreciation",status_code=201)
def run_depreciation(payload:DepreciationRun,request:Request,db:DbSession,tenant:Manager):
    period=date(payload.period_date.year,payload.period_date.month,1)
    rows=db.scalars(select(FixedAsset).where(FixedAsset.organization_id==tenant.organization_id,FixedAsset.status=="active",FixedAsset.in_service_date<=payload.period_date).order_by(FixedAsset.asset_code)).all()
    expense=system_account(db,tenant.organization_id,"depreciation_expense"); accumulated=system_account(db,tenant.organization_id,"accumulated_depreciation")
    posted=[]; skipped=[]
    for row in rows:
        exists=db.scalar(select(AssetDepreciationEntry.id).where(AssetDepreciationEntry.organization_id==tenant.organization_id,AssetDepreciationEntry.asset_id==row.id,AssetDepreciationEntry.period_date==period))
        if exists: skipped.append({"asset_id":row.id,"reason":"already_posted_this_month"}); continue
        maximum=money(row.acquisition_cost-row.salvage_value); remaining=money(max(maximum-row.accumulated_depreciation,Decimal("0")))
        if remaining<=0: row.status="fully_depreciated"; skipped.append({"asset_id":row.id,"reason":"fully_depreciated"}); continue
        monthly=money(maximum/Decimal(row.useful_life_months)); amount=money(min(monthly,remaining)); base,rate=to_base_amount(db,tenant.organization_id,tenant.organization.currency,amount,row.currency,rate_date=payload.period_date)
        source_id=str(uuid4()); description=f"Depreciation {row.asset_code} {row.name} for {period.strftime('%Y-%m')}"
        journal=post_journal(db,organization_id=tenant.organization_id,user_id=tenant.user_id,entry_date=payload.period_date,source_type="asset_depreciation",source_id=source_id,reference=row.asset_code,memo=description,lines=[PostingLine(ledger_account_id=expense.id,debit=base,description=description,currency=row.currency,exchange_rate_to_base=rate,original_amount=amount),PostingLine(ledger_account_id=accumulated.id,credit=base,description=description,currency=row.currency,exchange_rate_to_base=rate,original_amount=amount)])
        entry=AssetDepreciationEntry(id=source_id,organization_id=tenant.organization_id,asset_id=row.id,period_date=period,amount=amount,journal_entry_id=journal.id,created_by_user_id=tenant.user_id); db.add(entry); row.accumulated_depreciation=money(row.accumulated_depreciation+amount)
        if row.accumulated_depreciation>=maximum: row.status="fully_depreciated"
        posted.append({"asset_id":row.id,"asset_code":row.asset_code,"amount":amount,"currency":row.currency,"book_value":money(row.acquisition_cost-row.accumulated_depreciation)})
    record_activity(db,action="accounting.asset.depreciation_run",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="asset_depreciation_run",entity_id=period.isoformat(),after={"period_date":period,"posting_date":payload.period_date,"posted":posted,"skipped":skipped},request=request); db.commit(); return {"period_date":period,"posting_date":payload.period_date,"posted":posted,"skipped":skipped}


@router.get("/{asset_id}/depreciation")
def depreciation_history(asset_id:str,db:DbSession,tenant:Viewer):
    asset=db.scalar(select(FixedAsset).where(FixedAsset.id==asset_id,FixedAsset.organization_id==tenant.organization_id))
    if asset is None: raise HTTPException(status_code=404,detail="Fixed asset not found")
    rows=db.scalars(select(AssetDepreciationEntry).where(AssetDepreciationEntry.organization_id==tenant.organization_id,AssetDepreciationEntry.asset_id==asset.id).order_by(AssetDepreciationEntry.period_date.desc())).all()
    return {"asset":asset_json(asset),"entries":[{"id":r.id,"period_date":r.period_date,"amount":r.amount,"journal_entry_id":r.journal_entry_id} for r in rows]}
