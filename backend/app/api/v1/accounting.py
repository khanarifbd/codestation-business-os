from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance_controls import AccountingPeriod
from app.schemas.accounting import (
    JournalEntryCreate,
    JournalEntryRead,
    JournalLineRead,
    LedgerAccountCreate,
    LedgerAccountRead,
    LedgerAccountUpdate,
    TrialBalanceRead,
    TrialBalanceRow,
)
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting", tags=["Accounting"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _ensure_open_period(db: DbSession, organization_id: str, entry_date) -> None:
    closed = db.scalar(
        select(AccountingPeriod.id).where(
            AccountingPeriod.organization_id == organization_id,
            AccountingPeriod.status == "closed",
            AccountingPeriod.start_date <= entry_date,
            AccountingPeriod.end_date >= entry_date,
        )
    )
    if closed:
        raise HTTPException(status_code=409, detail=f"Accounting period is closed for {entry_date.isoformat()}")


def _validate_parent(db: DbSession, organization_id: str, parent_id: str | None, category: str, account_id: str | None = None) -> None:
    if parent_id is None:
        return
    if account_id and parent_id == account_id:
        raise HTTPException(status_code=400, detail="An account cannot be its own parent")
    parent = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.id == parent_id,
            LedgerAccount.organization_id == organization_id,
        )
    )
    if parent is None:
        raise HTTPException(status_code=404, detail="Parent ledger account not found")
    if parent.category != category:
        raise HTTPException(status_code=400, detail="Parent account must use the same accounting category")


def _journal_read(db: DbSession, organization_id: str, entry: JournalEntry) -> JournalEntryRead:
    rows = db.execute(
        select(JournalLine, LedgerAccount.code, LedgerAccount.name)
        .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
        .where(
            JournalLine.organization_id == organization_id,
            JournalLine.journal_entry_id == entry.id,
        )
        .order_by(JournalLine.created_at.asc())
    ).all()
    lines = [
        JournalLineRead(
            id=line.id,
            ledger_account_id=line.ledger_account_id,
            account_code=code,
            account_name=name,
            description=line.description,
            currency=line.currency,
            exchange_rate_to_base=line.exchange_rate_to_base,
            debit=line.debit,
            credit=line.credit,
            original_amount=line.original_amount,
        )
        for line, code, name in rows
    ]
    return JournalEntryRead(
        id=entry.id,
        entry_number=entry.entry_number,
        entry_date=entry.entry_date,
        status=entry.status,
        source_type=entry.source_type,
        source_id=entry.source_id,
        reference=entry.reference,
        memo=entry.memo,
        total_debit=_money(sum((line.debit for line in lines), Decimal("0"))),
        total_credit=_money(sum((line.credit for line in lines), Decimal("0"))),
        created_at=entry.created_at,
        posted_at=entry.posted_at,
        lines=lines,
    )


@router.get("/chart-of-accounts", response_model=list[LedgerAccountRead])
def list_chart_of_accounts(
    db: DbSession,
    tenant: AccountingViewer,
    include_inactive: bool = False,
):
    query = select(LedgerAccount).where(LedgerAccount.organization_id == tenant.organization_id)
    if not include_inactive:
        query = query.where(LedgerAccount.is_active.is_(True))
    items = db.scalars(query.order_by(LedgerAccount.code.asc(), LedgerAccount.name.asc())).all()
    return [LedgerAccountRead.model_validate(item) for item in items]


@router.post("/chart-of-accounts", response_model=LedgerAccountRead, status_code=status.HTTP_201_CREATED)
def create_ledger_account(
    payload: LedgerAccountCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    _validate_parent(db, tenant.organization_id, payload.parent_id, payload.category)
    item = LedgerAccount(
        organization_id=tenant.organization_id,
        code=payload.code.strip().upper(),
        name=payload.name.strip(),
        category=payload.category,
        subtype=_clean(payload.subtype),
        normal_balance=payload.normal_balance,
        parent_id=payload.parent_id,
        allow_manual_posting=payload.allow_manual_posting,
        notes=_clean(payload.notes),
        created_by_user_id=tenant.user_id,
    )
    db.add(item)
    db.flush()
    record_activity(
        db,
        action="accounting.ledger_account.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="ledger_account",
        entity_id=item.id,
        after={"code": item.code, "name": item.name, "category": item.category},
        message=f"Ledger account created: {item.code} {item.name}",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return LedgerAccountRead.model_validate(item)


@router.patch("/chart-of-accounts/{account_id}", response_model=LedgerAccountRead)
def update_ledger_account(
    account_id: str,
    payload: LedgerAccountUpdate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    item = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.id == account_id,
            LedgerAccount.organization_id == tenant.organization_id,
        ).with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Ledger account not found")
    before = {"code": item.code, "name": item.name, "is_active": item.is_active, "parent_id": item.parent_id}
    changes = payload.model_dump(exclude_unset=True)
    next_parent = changes.get("parent_id", item.parent_id)
    _validate_parent(db, tenant.organization_id, next_parent, item.category, item.id)
    if item.is_system and "code" in changes and changes["code"] != item.code:
        raise HTTPException(status_code=409, detail="System ledger account code cannot be changed")
    for field, value in changes.items():
        if field == "code" and value:
            value = value.strip().upper()
        elif field == "name" and value:
            value = value.strip()
        elif isinstance(value, str):
            value = _clean(value)
        setattr(item, field, value)
    db.flush()
    record_activity(
        db,
        action="accounting.ledger_account.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="ledger_account",
        entity_id=item.id,
        before=before,
        after={"code": item.code, "name": item.name, "is_active": item.is_active, "parent_id": item.parent_id},
        message=f"Ledger account updated: {item.code} {item.name}",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return LedgerAccountRead.model_validate(item)


@router.get("/journals", response_model=list[JournalEntryRead])
def list_journals(
    db: DbSession,
    tenant: AccountingViewer,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    entries = db.scalars(
        select(JournalEntry)
        .where(JournalEntry.organization_id == tenant.organization_id)
        .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
        .limit(limit)
    ).all()
    return [_journal_read(db, tenant.organization_id, item) for item in entries]


@router.get("/journals/{entry_id}", response_model=JournalEntryRead)
def get_journal(entry_id: str, db: DbSession, tenant: AccountingViewer):
    entry = db.scalar(
        select(JournalEntry).where(
            JournalEntry.id == entry_id,
            JournalEntry.organization_id == tenant.organization_id,
        )
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return _journal_read(db, tenant.organization_id, entry)


@router.post("/journals", response_model=JournalEntryRead, status_code=status.HTTP_201_CREATED)
def create_manual_journal(
    payload: JournalEntryCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    _ensure_open_period(db, tenant.organization_id, payload.entry_date)
    requested_ids = {line.ledger_account_id for line in payload.lines}
    accounts = db.scalars(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == tenant.organization_id,
            LedgerAccount.id.in_(requested_ids),
        )
    ).all()
    by_id = {item.id: item for item in accounts}
    if len(by_id) != len(requested_ids):
        raise HTTPException(status_code=404, detail="One or more ledger accounts were not found")
    for account_id in requested_ids:
        account = by_id[account_id]
        if not account.is_active:
            raise HTTPException(status_code=409, detail=f"Ledger account {account.code} is inactive")
        if not account.allow_manual_posting:
            raise HTTPException(status_code=409, detail=f"Manual posting is disabled for ledger account {account.code}")

    debit_total = _money(sum((_money(line.debit) for line in payload.lines), Decimal("0")))
    credit_total = _money(sum((_money(line.credit) for line in payload.lines), Decimal("0")))
    if debit_total <= 0 or debit_total != credit_total:
        raise HTTPException(status_code=400, detail="Journal entry must have equal non-zero debit and credit totals")

    entry = JournalEntry(
        organization_id=tenant.organization_id,
        entry_number=f"JE-{payload.entry_date.strftime('%Y%m%d')}-{uuid4().hex[:8].upper()}",
        entry_date=payload.entry_date,
        status="posted",
        source_type="manual",
        reference=_clean(payload.reference),
        memo=_clean(payload.memo),
        created_by_user_id=tenant.user_id,
        posted_by_user_id=tenant.user_id,
    )
    db.add(entry)
    db.flush()
    for line in payload.lines:
        db.add(
            JournalLine(
                organization_id=tenant.organization_id,
                journal_entry_id=entry.id,
                ledger_account_id=line.ledger_account_id,
                description=_clean(line.description),
                currency=line.currency.upper(),
                exchange_rate_to_base=line.exchange_rate_to_base,
                debit=_money(line.debit),
                credit=_money(line.credit),
                original_amount=_money(line.original_amount),
            )
        )
    db.flush()
    record_activity(
        db,
        action="accounting.journal.posted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="journal_entry",
        entity_id=entry.id,
        after={
            "entry_number": entry.entry_number,
            "entry_date": entry.entry_date.isoformat(),
            "debit": str(debit_total),
            "credit": str(credit_total),
            "source_type": entry.source_type,
        },
        message=f"Journal entry posted: {entry.entry_number}",
        request=request,
    )
    db.commit()
    db.refresh(entry)
    return _journal_read(db, tenant.organization_id, entry)


@router.get("/trial-balance", response_model=TrialBalanceRead)
def trial_balance(
    db: DbSession,
    tenant: AccountingViewer,
    as_of=None,
):
    debit_expr = func.coalesce(func.sum(JournalLine.debit), 0)
    credit_expr = func.coalesce(func.sum(JournalLine.credit), 0)
    query = (
        select(
            LedgerAccount.id,
            LedgerAccount.code,
            LedgerAccount.name,
            LedgerAccount.category,
            debit_expr.label("debit"),
            credit_expr.label("credit"),
        )
        .outerjoin(
            JournalLine,
            (JournalLine.ledger_account_id == LedgerAccount.id)
            & (JournalLine.organization_id == tenant.organization_id),
        )
        .outerjoin(
            JournalEntry,
            (JournalEntry.id == JournalLine.journal_entry_id)
            & (JournalEntry.organization_id == tenant.organization_id)
            & (JournalEntry.status == "posted"),
        )
        .where(LedgerAccount.organization_id == tenant.organization_id)
    )
    if as_of is not None:
        query = query.where((JournalEntry.entry_date.is_(None)) | (JournalEntry.entry_date <= as_of))
    rows = db.execute(
        query.group_by(LedgerAccount.id, LedgerAccount.code, LedgerAccount.name, LedgerAccount.category)
        .order_by(LedgerAccount.code.asc())
    ).all()
    result = []
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    for account_id, code, name, category, debit, credit in rows:
        debit_value = _money(Decimal(debit or 0))
        credit_value = _money(Decimal(credit or 0))
        total_debit += debit_value
        total_credit += credit_value
        result.append(
            TrialBalanceRow(
                ledger_account_id=account_id,
                code=code,
                name=name,
                category=category,
                debit=debit_value,
                credit=credit_value,
                balance=_money(debit_value - credit_value),
            )
        )
    return TrialBalanceRead(
        as_of=as_of,
        total_debit=_money(total_debit),
        total_credit=_money(total_credit),
        rows=result,
    )
