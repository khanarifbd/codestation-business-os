from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, or_, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.reconciliation import BankReconciliation, BankReconciliationItem
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/reconciliations", tags=["Accounting - Reconciliation"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def tx_effect(direction: str, amount: Decimal) -> Decimal:
    return money(amount if direction == "credit" else -amount)


def account_or_404(db: DbSession, org: str, account_id: str) -> FinancialAccount:
    row = db.scalar(select(FinancialAccount).where(FinancialAccount.id == account_id, FinancialAccount.organization_id == org))
    if row is None:
        raise HTTPException(status_code=404, detail="Financial account not found")
    return row


def reconciliation_or_404(db: DbSession, org: str, reconciliation_id: str) -> BankReconciliation:
    row = db.scalar(select(BankReconciliation).where(BankReconciliation.id == reconciliation_id, BankReconciliation.organization_id == org))
    if row is None:
        raise HTTPException(status_code=404, detail="Reconciliation not found")
    return row


def cleared_balance(db: DbSession, row: BankReconciliation) -> Decimal:
    account = account_or_404(db, row.organization_id, row.account_id)
    selected = db.execute(
        select(FinancialTransaction.direction, FinancialTransaction.amount)
        .join(BankReconciliationItem, BankReconciliationItem.financial_transaction_id == FinancialTransaction.id)
        .join(BankReconciliation, BankReconciliation.id == BankReconciliationItem.reconciliation_id)
        .where(
            BankReconciliation.organization_id == row.organization_id,
            BankReconciliation.account_id == row.account_id,
            FinancialTransaction.transaction_date <= row.statement_end_date,
            or_(BankReconciliation.status == "finalized", BankReconciliation.id == row.id),
        )
    ).all()
    return money(account.opening_balance + sum((tx_effect(direction, amount) for direction, amount in selected), Decimal("0")))


def refresh_totals(db: DbSession, row: BankReconciliation) -> None:
    row.cleared_book_balance = cleared_balance(db, row)
    row.difference = money(row.statement_ending_balance - row.cleared_book_balance)


def row_json(db: DbSession, row: BankReconciliation) -> dict:
    refresh_totals(db, row)
    account = account_or_404(db, row.organization_id, row.account_id)
    count = db.scalar(select(func.count(BankReconciliationItem.id)).where(BankReconciliationItem.organization_id == row.organization_id, BankReconciliationItem.reconciliation_id == row.id)) or 0
    return {
        "id": row.id,
        "account_id": row.account_id,
        "account_name": account.name,
        "currency": account.currency,
        "statement_start_date": row.statement_start_date,
        "statement_end_date": row.statement_end_date,
        "statement_ending_balance": row.statement_ending_balance,
        "cleared_book_balance": row.cleared_book_balance,
        "difference": row.difference,
        "status": row.status,
        "matched_transactions": int(count),
        "notes": row.notes,
        "finalized_at": row.finalized_at,
        "created_at": row.created_at,
    }


class ReconciliationCreate(BaseModel):
    account_id: str
    statement_start_date: object | None = None
    statement_end_date: object
    statement_ending_balance: Decimal
    notes: str | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_dates(cls, data):
        from datetime import date
        if isinstance(data, dict):
            data = dict(data)
            for key in ("statement_start_date", "statement_end_date"):
                value = data.get(key)
                if isinstance(value, str) and value:
                    data[key] = date.fromisoformat(value)
        return data


@router.get("/meta")
def meta(db: DbSession, tenant: Viewer):
    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id == tenant.organization_id, FinancialAccount.is_active.is_(True)).order_by(FinancialAccount.currency, FinancialAccount.name)).all()
    result = []
    for account in accounts:
        last = db.scalar(select(BankReconciliation).where(BankReconciliation.organization_id == tenant.organization_id, BankReconciliation.account_id == account.id, BankReconciliation.status == "finalized").order_by(BankReconciliation.statement_end_date.desc()).limit(1))
        result.append({"id": account.id, "name": account.name, "account_type": account.account_type, "currency": account.currency, "last_reconciled_date": last.statement_end_date if last else None, "last_statement_balance": last.statement_ending_balance if last else None})
    return {"accounts": result}


@router.get("")
def list_reconciliations(db: DbSession, tenant: Viewer):
    rows = db.scalars(select(BankReconciliation).where(BankReconciliation.organization_id == tenant.organization_id).order_by(BankReconciliation.statement_end_date.desc(), BankReconciliation.created_at.desc()).limit(200)).all()
    return [row_json(db, row) for row in rows]


@router.post("", status_code=201)
def create_reconciliation(payload: ReconciliationCreate, request: Request, db: DbSession, tenant: Manager):
    from datetime import date
    if not isinstance(payload.statement_end_date, date):
        raise HTTPException(status_code=422, detail="Invalid statement end date")
    account = account_or_404(db, tenant.organization_id, payload.account_id)
    draft = db.scalar(select(BankReconciliation.id).where(BankReconciliation.organization_id == tenant.organization_id, BankReconciliation.account_id == account.id, BankReconciliation.status == "draft"))
    if draft:
        raise HTTPException(status_code=409, detail="This account already has an open reconciliation")
    last = db.scalar(select(BankReconciliation).where(BankReconciliation.organization_id == tenant.organization_id, BankReconciliation.account_id == account.id, BankReconciliation.status == "finalized").order_by(BankReconciliation.statement_end_date.desc()).limit(1))
    start = payload.statement_start_date if isinstance(payload.statement_start_date, date) else (last.statement_end_date + timedelta(days=1) if last else None)
    if last and payload.statement_end_date <= last.statement_end_date:
        raise HTTPException(status_code=409, detail=f"Statement end date must be after the last reconciliation ({last.statement_end_date.isoformat()})")
    if start and payload.statement_end_date < start:
        raise HTTPException(status_code=400, detail="Statement end date cannot be before statement start date")
    row = BankReconciliation(organization_id=tenant.organization_id, account_id=account.id, statement_start_date=start, statement_end_date=payload.statement_end_date, statement_ending_balance=money(payload.statement_ending_balance), cleared_book_balance=money(account.opening_balance), difference=Decimal("0"), status="draft", notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(row); db.flush(); refresh_totals(db, row)
    record_activity(db, action="accounting.reconciliation.create", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="bank_reconciliation", entity_id=row.id, after=row_json(db, row), request=request)
    db.commit(); return row_json(db, row)


@router.get("/{reconciliation_id}")
def detail(reconciliation_id: str, db: DbSession, tenant: Viewer):
    row = reconciliation_or_404(db, tenant.organization_id, reconciliation_id)
    selected_ids = set(db.scalars(select(BankReconciliationItem.financial_transaction_id).where(BankReconciliationItem.organization_id == tenant.organization_id, BankReconciliationItem.reconciliation_id == row.id)).all())
    used_subquery = select(BankReconciliationItem.financial_transaction_id).where(BankReconciliationItem.organization_id == tenant.organization_id, BankReconciliationItem.reconciliation_id != row.id)
    transactions = db.scalars(select(FinancialTransaction).where(FinancialTransaction.organization_id == tenant.organization_id, FinancialTransaction.account_id == row.account_id, FinancialTransaction.transaction_date <= row.statement_end_date, ~FinancialTransaction.id.in_(used_subquery)).order_by(FinancialTransaction.transaction_date.asc(), FinancialTransaction.created_at.asc()).limit(2000)).all()
    data = row_json(db, row)
    data["transactions"] = [{"id": tx.id, "transaction_date": tx.transaction_date, "direction": tx.direction, "amount": tx.amount, "currency": tx.currency, "source_type": tx.source_type, "reference": tx.reference, "description": tx.description, "selected": tx.id in selected_ids} for tx in transactions]
    data["unmatched_count"] = sum(1 for tx in transactions if tx.id not in selected_ids)
    return data


@router.post("/{reconciliation_id}/transactions/{transaction_id}", status_code=201)
def select_transaction(reconciliation_id: str, transaction_id: str, request: Request, db: DbSession, tenant: Manager):
    row = reconciliation_or_404(db, tenant.organization_id, reconciliation_id)
    if row.status != "draft": raise HTTPException(status_code=409, detail="Finalized reconciliation cannot be changed")
    tx = db.scalar(select(FinancialTransaction).where(FinancialTransaction.id == transaction_id, FinancialTransaction.organization_id == tenant.organization_id, FinancialTransaction.account_id == row.account_id, FinancialTransaction.transaction_date <= row.statement_end_date))
    if tx is None: raise HTTPException(status_code=404, detail="Eligible account transaction not found")
    existing = db.scalar(select(BankReconciliationItem).where(BankReconciliationItem.organization_id == tenant.organization_id, BankReconciliationItem.financial_transaction_id == tx.id))
    if existing:
        if existing.reconciliation_id == row.id: return row_json(db, row)
        raise HTTPException(status_code=409, detail="Transaction is already reconciled")
    item = BankReconciliationItem(organization_id=tenant.organization_id, reconciliation_id=row.id, financial_transaction_id=tx.id, created_by_user_id=tenant.user_id)
    db.add(item); db.flush(); refresh_totals(db, row)
    record_activity(db, action="accounting.reconciliation.match", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="bank_reconciliation", entity_id=row.id, after={"transaction_id": tx.id, "difference": row.difference}, request=request)
    db.commit(); return row_json(db, row)


@router.delete("/{reconciliation_id}/transactions/{transaction_id}", status_code=204)
def unselect_transaction(reconciliation_id: str, transaction_id: str, request: Request, db: DbSession, tenant: Manager):
    row = reconciliation_or_404(db, tenant.organization_id, reconciliation_id)
    if row.status != "draft": raise HTTPException(status_code=409, detail="Finalized reconciliation cannot be changed")
    item = db.scalar(select(BankReconciliationItem).where(BankReconciliationItem.organization_id == tenant.organization_id, BankReconciliationItem.reconciliation_id == row.id, BankReconciliationItem.financial_transaction_id == transaction_id))
    if item is None: return None
    db.delete(item); db.flush(); refresh_totals(db, row)
    record_activity(db, action="accounting.reconciliation.unmatch", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="bank_reconciliation", entity_id=row.id, after={"transaction_id": transaction_id, "difference": row.difference}, request=request)
    db.commit(); return None


@router.post("/{reconciliation_id}/finalize")
def finalize(reconciliation_id: str, request: Request, db: DbSession, tenant: Manager):
    row = reconciliation_or_404(db, tenant.organization_id, reconciliation_id)
    if row.status == "finalized": return row_json(db, row)
    refresh_totals(db, row)
    if row.difference != Decimal("0.00"):
        raise HTTPException(status_code=409, detail=f"Reconciliation difference must be 0.00 before finalizing. Current difference: {row.difference}")
    later = db.scalar(select(BankReconciliation.id).where(BankReconciliation.organization_id == tenant.organization_id, BankReconciliation.account_id == row.account_id, BankReconciliation.status == "finalized", BankReconciliation.statement_end_date >= row.statement_end_date))
    if later: raise HTTPException(status_code=409, detail="A later reconciliation already exists for this account")
    row.status = "finalized"; row.finalized_by_user_id = tenant.user_id; row.finalized_at = datetime.now(timezone.utc)
    record_activity(db, action="accounting.reconciliation.finalize", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="bank_reconciliation", entity_id=row.id, after=row_json(db, row), request=request)
    db.commit(); return row_json(db, row)
