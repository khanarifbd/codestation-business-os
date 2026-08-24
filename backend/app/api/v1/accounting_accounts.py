from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.finance import FinancialAccount, FinancialTransaction
from app.schemas.finance import FinancialAccountCreate, FinancialAccountRead
from app.services.accounting_posting import PostingLine, financial_ledger_account, post_journal, system_account
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/financial-accounts", tags=["Accounting"])
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _balance(db: DbSession, account: FinancialAccount) -> Decimal:
    net = db.scalar(
        select(func.coalesce(func.sum(case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)), 0)).where(
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
        )
    ) or Decimal("0")
    return _money(Decimal(account.opening_balance) + Decimal(net))


def _read(db: DbSession, account: FinancialAccount) -> FinancialAccountRead:
    return FinancialAccountRead(
        id=account.id,
        name=account.name,
        account_type=account.account_type,
        provider_name=account.provider_name,
        account_holder_name=account.account_holder_name,
        account_reference=account.account_reference,
        currency=account.currency,
        opening_balance=account.opening_balance,
        current_balance=_balance(db, account),
        is_active=account.is_active,
        notes=account.notes,
        payment_url=account.payment_url,
        payment_instructions=account.payment_instructions,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


@router.post("", response_model=FinancialAccountRead, status_code=status.HTTP_201_CREATED)
def create_accounting_financial_account(
    payload: FinancialAccountCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
):
    opening = _money(payload.opening_balance)
    if payload.account_type == "credit_card" and opening < 0:
        raise HTTPException(status_code=400, detail="Credit card opening balance must be zero or a positive amount currently owed")

    account = FinancialAccount(
        organization_id=tenant.organization_id,
        name=payload.name.strip(),
        account_type=payload.account_type,
        provider_name=_clean(payload.provider_name),
        account_holder_name=_clean(payload.account_holder_name),
        account_reference=_clean(payload.account_reference),
        currency=payload.currency.upper(),
        opening_balance=opening,
        notes=_clean(payload.notes),
        payment_url=payload.payment_url,
        payment_instructions=_clean(payload.payment_instructions),
        created_by_user_id=tenant.user_id,
    )
    db.add(account)
    db.flush()

    _, ledger = financial_ledger_account(db, tenant.organization_id, account.id)
    if opening != 0:
        equity = system_account(db, tenant.organization_id, "opening_balance_equity")
        if account.account_type == "credit_card":
            lines = [
                PostingLine(ledger_account_id=equity.id, debit=opening, currency=account.currency, description="Opening credit card balance"),
                PostingLine(ledger_account_id=ledger.id, credit=opening, currency=account.currency, description=account.name),
            ]
        elif opening > 0:
            lines = [
                PostingLine(ledger_account_id=ledger.id, debit=opening, currency=account.currency, description=account.name),
                PostingLine(ledger_account_id=equity.id, credit=opening, currency=account.currency, description="Opening balance equity"),
            ]
        else:
            absolute = abs(opening)
            lines = [
                PostingLine(ledger_account_id=equity.id, debit=absolute, currency=account.currency, description="Opening balance equity"),
                PostingLine(ledger_account_id=ledger.id, credit=absolute, currency=account.currency, description=account.name),
            ]
        post_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            entry_date=_today(tenant.organization.timezone),
            source_type="financial_account_opening_balance",
            source_id=account.id,
            lines=lines,
            reference=account.account_reference,
            memo=f"Opening balance for {account.name}",
        )

    record_activity(
        db,
        action="accounting.financial_account.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="financial_account",
        entity_id=account.id,
        after={
            "name": account.name,
            "account_type": account.account_type,
            "currency": account.currency,
            "opening_balance": str(account.opening_balance),
            "ledger_account_id": ledger.id,
            "payment_url_configured": bool(account.payment_url),
            "payment_instructions_configured": bool(account.payment_instructions),
        },
        message=f"Financial account created and mapped to accounting: {account.name}",
        request=request,
    )
    db.commit()
    db.refresh(account)
    return _read(db, account)
