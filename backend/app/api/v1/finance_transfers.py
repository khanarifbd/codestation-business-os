from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.finance import AccountTransfer, FinancialAccount, FinancialTransaction
from app.schemas.finance import AccountTransferCreate, AccountTransferRead
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance", tags=["Finance Transfers"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")
RATE = Decimal("0.00000001")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _tenant_today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _account_balance(db: DbSession, account: FinancialAccount) -> Decimal:
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
    return _money(Decimal(account.opening_balance) + Decimal(net))


def _transfer_read(transfer: AccountTransfer, source_name: str | None, destination_name: str | None) -> AccountTransferRead:
    return AccountTransferRead(
        id=transfer.id,
        transfer_number=transfer.transfer_number,
        from_account_id=transfer.from_account_id,
        from_account_name=source_name or "—",
        to_account_id=transfer.to_account_id,
        to_account_name=destination_name or "—",
        transfer_date=transfer.transfer_date,
        source_currency=transfer.source_currency,
        destination_currency=transfer.destination_currency,
        source_amount=transfer.source_amount,
        fee_amount=transfer.fee_amount,
        net_source_amount=transfer.net_source_amount,
        destination_amount=transfer.destination_amount,
        exchange_rate=transfer.exchange_rate,
        reference=transfer.reference,
        notes=transfer.notes,
        status=transfer.status,
        created_at=transfer.created_at,
    )


@router.get("/transfers", response_model=list[AccountTransferRead])
def list_transfers(
    db: DbSession,
    tenant: FinanceViewer,
    account_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    source_account = aliased(FinancialAccount)
    destination_account = aliased(FinancialAccount)
    query = (
        select(AccountTransfer, source_account.name, destination_account.name)
        .join(source_account, source_account.id == AccountTransfer.from_account_id)
        .join(destination_account, destination_account.id == AccountTransfer.to_account_id)
        .where(AccountTransfer.organization_id == tenant.organization_id)
    )
    if account_id:
        query = query.where(
            (AccountTransfer.from_account_id == account_id) | (AccountTransfer.to_account_id == account_id)
        )
    rows = db.execute(
        query.order_by(
            AccountTransfer.transfer_date.desc(),
            AccountTransfer.created_at.desc(),
            AccountTransfer.id.desc(),
        ).limit(limit)
    ).all()
    return [_transfer_read(transfer, source_name, destination_name) for transfer, source_name, destination_name in rows]


@router.post("/transfers", response_model=AccountTransferRead, status_code=status.HTTP_201_CREATED)
def record_transfer(
    payload: AccountTransferCreate,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
):
    if payload.from_account_id == payload.to_account_id:
        raise HTTPException(status_code=400, detail="Source and destination accounts must be different")

    account_ids = sorted([payload.from_account_id, payload.to_account_id])
    locked = db.scalars(
        select(FinancialAccount)
        .where(
            FinancialAccount.organization_id == tenant.organization_id,
            FinancialAccount.id.in_(account_ids),
        )
        .order_by(FinancialAccount.id.asc())
        .with_for_update()
    ).all()
    accounts = {account.id: account for account in locked}
    source = accounts.get(payload.from_account_id)
    destination = accounts.get(payload.to_account_id)
    if source is None or destination is None:
        raise HTTPException(status_code=404, detail="Financial account not found")
    if not source.is_active or not destination.is_active:
        raise HTTPException(status_code=409, detail="Transfers require active source and destination accounts")

    source_amount = _money(payload.source_amount)
    fee_amount = _money(payload.fee_amount)
    if fee_amount >= source_amount:
        raise HTTPException(status_code=400, detail="Transfer fee must be lower than the total deducted from source")
    net_source_amount = _money(source_amount - fee_amount)
    available = _account_balance(db, source)
    if source_amount > available:
        raise HTTPException(
            status_code=409,
            detail=f"Insufficient balance in {source.name}. Available {available} {source.currency}",
        )

    if source.currency == destination.currency:
        destination_amount = net_source_amount if payload.destination_amount is None else _money(payload.destination_amount)
        if destination_amount != net_source_amount:
            raise HTTPException(
                status_code=400,
                detail=f"Same-currency transfer must receive {net_source_amount} {destination.currency} after fee",
            )
        exchange_rate = Decimal("1.00000000")
    else:
        if payload.destination_amount is None:
            raise HTTPException(
                status_code=400,
                detail=f"Actual received amount is required for {source.currency} to {destination.currency} transfer",
            )
        destination_amount = _money(payload.destination_amount)
        exchange_rate = (destination_amount / net_source_amount).quantize(RATE, rounding=ROUND_HALF_UP)

    transfer_date = payload.transfer_date or _tenant_today(tenant.organization.timezone)
    transfer = AccountTransfer(
        organization_id=tenant.organization_id,
        transfer_number=next_sequence_code(db, tenant.organization_id, "transfer"),
        from_account_id=source.id,
        to_account_id=destination.id,
        transfer_date=transfer_date,
        source_currency=source.currency,
        destination_currency=destination.currency,
        source_amount=source_amount,
        fee_amount=fee_amount,
        net_source_amount=net_source_amount,
        destination_amount=destination_amount,
        exchange_rate=exchange_rate,
        reference=_clean(payload.reference),
        notes=_clean(payload.notes),
        status="confirmed",
        created_by_user_id=tenant.user_id,
    )
    db.add(transfer)
    db.flush()

    db.add(
        FinancialTransaction(
            organization_id=tenant.organization_id,
            account_id=source.id,
            transaction_date=transfer_date,
            direction="debit",
            amount=net_source_amount,
            currency=source.currency,
            source_type="transfer",
            source_id=transfer.id,
            reference=transfer.reference or transfer.transfer_number,
            description=f"Transfer out {transfer.transfer_number} to {destination.name}",
            created_by_user_id=tenant.user_id,
        )
    )
    if fee_amount > 0:
        db.add(
            FinancialTransaction(
                organization_id=tenant.organization_id,
                account_id=source.id,
                transaction_date=transfer_date,
                direction="debit",
                amount=fee_amount,
                currency=source.currency,
                source_type="transfer_fee",
                source_id=transfer.id,
                reference=transfer.reference or transfer.transfer_number,
                description=f"Transfer fee for {transfer.transfer_number}",
                created_by_user_id=tenant.user_id,
            )
        )
    db.add(
        FinancialTransaction(
            organization_id=tenant.organization_id,
            account_id=destination.id,
            transaction_date=transfer_date,
            direction="credit",
            amount=destination_amount,
            currency=destination.currency,
            source_type="transfer",
            source_id=transfer.id,
            reference=transfer.reference or transfer.transfer_number,
            description=f"Transfer in {transfer.transfer_number} from {source.name}",
            created_by_user_id=tenant.user_id,
        )
    )
    db.flush()

    record_activity(
        db,
        action="finance.transfer.recorded",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="account_transfer",
        entity_id=transfer.id,
        after={
            "transfer_number": transfer.transfer_number,
            "from_account_id": source.id,
            "from_account": source.name,
            "to_account_id": destination.id,
            "to_account": destination.name,
            "source_amount": str(source_amount),
            "fee_amount": str(fee_amount),
            "net_source_amount": str(net_source_amount),
            "source_currency": source.currency,
            "destination_amount": str(destination_amount),
            "destination_currency": destination.currency,
            "effective_exchange_rate": str(exchange_rate),
        },
        metadata={"fee_ledger_source_type": "transfer_fee" if fee_amount > 0 else None},
        message=f"Transfer {transfer.transfer_number} recorded from {source.name} to {destination.name}",
        request=request,
    )
    db.commit()
    db.refresh(transfer)
    return _transfer_read(transfer, source.name, destination.name)
