from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import LedgerAccount
from app.models.accounting_money import AccountingMoneyEntry
from app.models.crm import Client
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.orders import Order
from app.models.projects import Project
from app.schemas.accounting_money import (
    AccountingIncomeWithFeeCreate,
    AccountingIncomeWithFeeRead,
    AccountingMoneyEntryCreate,
    AccountingMoneyEntryRead,
)
from app.services.accounting_posting import PostingLine, financial_ledger_account, post_journal
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/money", tags=["Accounting"])
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


def _financial_balance(db: DbSession, account: FinancialAccount) -> Decimal:
    net = db.scalar(
        select(func.coalesce(func.sum(case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)), 0)).where(
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
        )
    ) or Decimal("0")
    return _money(Decimal(account.opening_balance) + Decimal(net))


def _source_label(db: DbSession, organization_id: str, item: AccountingMoneyEntry) -> str | None:
    if item.project_id:
        project = db.scalar(select(Project).where(Project.id == item.project_id, Project.organization_id == organization_id))
        if project:
            return f"{project.project_number} · {project.name}"
    if item.order_id:
        order = db.scalar(select(Order).where(Order.id == item.order_id, Order.organization_id == organization_id))
        if order:
            return f"{order.order_number} · {order.client_name_snapshot}"
    if item.client_id:
        client = db.scalar(select(Client).where(Client.id == item.client_id, Client.organization_id == organization_id))
        if client:
            return f"{client.client_code} · {client.display_name}"
    return None


def _read(db: DbSession, organization_id: str, item: AccountingMoneyEntry) -> AccountingMoneyEntryRead:
    row = db.execute(
        select(FinancialAccount.name, LedgerAccount.name)
        .select_from(FinancialAccount)
        .join(LedgerAccount, LedgerAccount.id == item.category_ledger_account_id)
        .where(
            FinancialAccount.id == item.financial_account_id,
            FinancialAccount.organization_id == organization_id,
            LedgerAccount.organization_id == organization_id,
        )
    ).first()
    return AccountingMoneyEntryRead(
        id=item.id,
        kind=item.kind,
        entry_date=item.entry_date,
        financial_account_id=item.financial_account_id,
        financial_account_name=row[0] if row else "—",
        category_ledger_account_id=item.category_ledger_account_id,
        category_ledger_account_name=row[1] if row else "—",
        source_type=item.source_type,
        source_id=item.source_id,
        client_id=item.client_id,
        order_id=item.order_id,
        project_id=item.project_id,
        source_label=_source_label(db, organization_id, item),
        currency=item.currency,
        amount=item.amount,
        description=item.description,
        reference=item.reference,
        notes=item.notes,
        created_at=item.created_at,
    )


def _resolve_source(
    db: DbSession,
    organization_id: str,
    source_type: str | None,
    source_id: str | None,
) -> tuple[str | None, str | None, str | None, str | None, str | None]:
    if source_type in {None, "other"}:
        return source_type, None, None, None, None
    if not source_id:
        raise HTTPException(status_code=400, detail="Business source is required")

    if source_type == "client":
        client = db.scalar(select(Client).where(Client.id == source_id, Client.organization_id == organization_id))
        if client is None:
            raise HTTPException(status_code=404, detail="Client not found in this organization")
        return source_type, client.id, client.id, None, None

    if source_type == "order":
        order = db.scalar(select(Order).where(Order.id == source_id, Order.organization_id == organization_id))
        if order is None:
            raise HTTPException(status_code=404, detail="Order not found in this organization")
        return source_type, order.id, order.client_id, order.id, None

    if source_type == "project":
        project = db.scalar(select(Project).where(Project.id == source_id, Project.organization_id == organization_id))
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found in this organization")
        return source_type, project.id, project.client_id, project.order_id, project.id

    raise HTTPException(status_code=400, detail="Unsupported business source")


@router.get("", response_model=list[AccountingMoneyEntryRead])
def list_money_entries(db: DbSession, tenant: AccountingViewer, kind: str | None = None, limit: int = 100):
    query = select(AccountingMoneyEntry).where(AccountingMoneyEntry.organization_id == tenant.organization_id)
    if kind in {"income", "expense"}:
        query = query.where(AccountingMoneyEntry.kind == kind)
    rows = db.scalars(query.order_by(AccountingMoneyEntry.entry_date.desc(), AccountingMoneyEntry.created_at.desc()).limit(min(max(limit, 1), 300))).all()
    return [_read(db, tenant.organization_id, item) for item in rows]


@router.post("", response_model=AccountingMoneyEntryRead, status_code=status.HTTP_201_CREATED)
def create_money_entry(payload: AccountingMoneyEntryCreate, request: Request, db: DbSession, tenant: AccountingManager):
    financial, financial_ledger = financial_ledger_account(db, tenant.organization_id, payload.financial_account_id)
    category = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.id == payload.category_ledger_account_id,
            LedgerAccount.organization_id == tenant.organization_id,
            LedgerAccount.is_active.is_(True),
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Accounting category not found")
    expected_category = "income" if payload.kind == "income" else "expense"
    if category.category != expected_category:
        raise HTTPException(status_code=400, detail=f"{payload.kind.title()} must use a {expected_category} category")
    if payload.kind == "income" and financial.account_type == "credit_card":
        raise HTTPException(status_code=400, detail="Money received cannot be deposited into a credit card account")

    source_type, source_id, client_id, order_id, project_id = _resolve_source(
        db,
        tenant.organization_id,
        payload.source_type,
        payload.source_id,
    )

    amount = _money(payload.amount)
    if payload.kind == "expense" and financial.account_type != "credit_card" and _financial_balance(db, financial) < amount:
        raise HTTPException(status_code=409, detail="Selected account does not have enough balance")

    item = AccountingMoneyEntry(
        organization_id=tenant.organization_id,
        kind=payload.kind,
        entry_date=payload.entry_date,
        financial_account_id=financial.id,
        category_ledger_account_id=category.id,
        source_type=source_type,
        source_id=source_id,
        client_id=client_id,
        order_id=order_id,
        project_id=project_id,
        currency=financial.currency,
        amount=amount,
        description=payload.description.strip(),
        reference=_clean(payload.reference),
        notes=_clean(payload.notes),
        created_by_user_id=tenant.user_id,
    )
    db.add(item)
    db.flush()

    if payload.kind == "income":
        lines = [
            PostingLine(ledger_account_id=financial_ledger.id, debit=amount, currency=financial.currency, description=item.description),
            PostingLine(ledger_account_id=category.id, credit=amount, currency=financial.currency, description=item.description),
        ]
        direction = "credit"
    elif financial.account_type == "credit_card":
        lines = [
            PostingLine(ledger_account_id=category.id, debit=amount, currency=financial.currency, description=item.description),
            PostingLine(ledger_account_id=financial_ledger.id, credit=amount, currency=financial.currency, description=item.description),
        ]
        direction = "credit"
    else:
        lines = [
            PostingLine(ledger_account_id=category.id, debit=amount, currency=financial.currency, description=item.description),
            PostingLine(ledger_account_id=financial_ledger.id, credit=amount, currency=financial.currency, description=item.description),
        ]
        direction = "debit"

    post_journal(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        entry_date=item.entry_date,
        source_type="accounting_money_entry",
        source_id=item.id,
        lines=lines,
        reference=item.reference,
        memo=item.description,
    )
    db.add(
        FinancialTransaction(
            organization_id=tenant.organization_id,
            account_id=financial.id,
            transaction_date=item.entry_date,
            direction=direction,
            amount=amount,
            currency=financial.currency,
            source_type="accounting_money_entry",
            source_id=item.id,
            reference=item.reference,
            description=item.description,
            created_by_user_id=tenant.user_id,
        )
    )
    record_activity(
        db,
        action=f"accounting.money.{payload.kind}.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="accounting_money_entry",
        entity_id=item.id,
        after={
            "kind": item.kind,
            "amount": str(item.amount),
            "currency": item.currency,
            "financial_account_id": financial.id,
            "category_ledger_account_id": category.id,
            "source_type": item.source_type,
            "source_id": item.source_id,
            "client_id": item.client_id,
            "order_id": item.order_id,
            "project_id": item.project_id,
        },
        message=f"{payload.kind.title()} recorded: {item.currency} {item.amount} — {item.description}",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return _read(db, tenant.organization_id, item)


@router.post(
    "/income-with-fee",
    response_model=AccountingIncomeWithFeeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_income_with_fee(
    payload: AccountingIncomeWithFeeCreate,
    request: Request,
    db: DbSession,
    tenant: AccountingManager,
) -> AccountingIncomeWithFeeRead:
    financial, financial_ledger = financial_ledger_account(
        db,
        tenant.organization_id,
        payload.financial_account_id,
    )
    if financial.account_type == "credit_card":
        raise HTTPException(status_code=400, detail="Money received cannot be deposited into a credit card account")

    income_category = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.id == payload.income_category_ledger_account_id,
            LedgerAccount.organization_id == tenant.organization_id,
            LedgerAccount.is_active.is_(True),
        )
    )
    if income_category is None:
        raise HTTPException(status_code=404, detail="Income category not found")
    if income_category.category != "income":
        raise HTTPException(status_code=400, detail="Income must use an income category")

    gross_amount = _money(payload.gross_amount)
    fee_amount = _money(payload.fee_amount)
    if fee_amount > gross_amount:
        raise HTTPException(status_code=400, detail="Processing fee cannot exceed gross income")

    fee_category = None
    if fee_amount > 0:
        fee_category = db.scalar(
            select(LedgerAccount).where(
                LedgerAccount.id == payload.fee_category_ledger_account_id,
                LedgerAccount.organization_id == tenant.organization_id,
                LedgerAccount.is_active.is_(True),
            )
        )
        if fee_category is None:
            raise HTTPException(status_code=404, detail="Fee expense category not found")
        if fee_category.category != "expense":
            raise HTTPException(status_code=400, detail="Processing fee must use an expense category")

    source_type, source_id, client_id, order_id, project_id = _resolve_source(
        db,
        tenant.organization_id,
        payload.source_type,
        payload.source_id,
    )

    source_currency: str | None = None
    if project_id:
        source_currency = db.scalar(
            select(Project.currency).where(
                Project.id == project_id,
                Project.organization_id == tenant.organization_id,
            )
        )
    elif order_id:
        source_currency = db.scalar(
            select(Order.currency).where(
                Order.id == order_id,
                Order.organization_id == tenant.organization_id,
            )
        )
    if source_currency and financial.currency != source_currency:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This income is denominated in {source_currency}. Select a {source_currency} financial account; "
                "cross-currency conversion is not performed silently."
            ),
        )

    if fee_amount > _money(_financial_balance(db, financial) + gross_amount):
        raise HTTPException(
            status_code=409,
            detail=f"Selected account would not have enough balance to post the {financial.currency} {fee_amount} fee",
        )

    reference = _clean(payload.reference)
    notes = _clean(payload.notes)
    income_description = payload.description.strip()
    fee_description = (
        _clean(payload.fee_description)
        or f"Processing fee · {income_description}"
    )[:500]

    income_item = AccountingMoneyEntry(
        organization_id=tenant.organization_id,
        kind="income",
        entry_date=payload.entry_date,
        financial_account_id=financial.id,
        category_ledger_account_id=income_category.id,
        source_type=source_type,
        source_id=source_id,
        client_id=client_id,
        order_id=order_id,
        project_id=project_id,
        currency=financial.currency,
        amount=gross_amount,
        description=income_description,
        reference=reference,
        notes=notes,
        created_by_user_id=tenant.user_id,
    )
    db.add(income_item)
    db.flush()

    post_journal(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        entry_date=income_item.entry_date,
        source_type="accounting_money_entry",
        source_id=income_item.id,
        lines=[
            PostingLine(
                ledger_account_id=financial_ledger.id,
                debit=gross_amount,
                currency=financial.currency,
                description=income_description,
            ),
            PostingLine(
                ledger_account_id=income_category.id,
                credit=gross_amount,
                currency=financial.currency,
                description=income_description,
            ),
        ],
        reference=reference,
        memo=income_description,
    )
    db.add(
        FinancialTransaction(
            organization_id=tenant.organization_id,
            account_id=financial.id,
            transaction_date=payload.entry_date,
            direction="credit",
            amount=gross_amount,
            currency=financial.currency,
            source_type="accounting_money_entry",
            source_id=income_item.id,
            reference=reference,
            description=income_description,
            created_by_user_id=tenant.user_id,
        )
    )

    fee_item: AccountingMoneyEntry | None = None
    if fee_amount > 0 and fee_category is not None:
        fee_item = AccountingMoneyEntry(
            organization_id=tenant.organization_id,
            kind="expense",
            entry_date=payload.entry_date,
            financial_account_id=financial.id,
            category_ledger_account_id=fee_category.id,
            source_type=source_type,
            source_id=source_id,
            client_id=client_id,
            order_id=order_id,
            project_id=project_id,
            currency=financial.currency,
            amount=fee_amount,
            description=fee_description,
            reference=reference,
            notes=notes,
            created_by_user_id=tenant.user_id,
        )
        db.add(fee_item)
        db.flush()
        post_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            entry_date=fee_item.entry_date,
            source_type="accounting_money_entry",
            source_id=fee_item.id,
            lines=[
                PostingLine(
                    ledger_account_id=fee_category.id,
                    debit=fee_amount,
                    currency=financial.currency,
                    description=fee_description,
                ),
                PostingLine(
                    ledger_account_id=financial_ledger.id,
                    credit=fee_amount,
                    currency=financial.currency,
                    description=fee_description,
                ),
            ],
            reference=reference,
            memo=fee_description,
        )
        db.add(
            FinancialTransaction(
                organization_id=tenant.organization_id,
                account_id=financial.id,
                transaction_date=payload.entry_date,
                direction="debit",
                amount=fee_amount,
                currency=financial.currency,
                source_type="accounting_money_entry",
                source_id=fee_item.id,
                reference=reference,
                description=fee_description,
                created_by_user_id=tenant.user_id,
            )
        )

    linked_metadata = {
        "source_type": source_type,
        "source_id": source_id,
        "client_id": client_id,
        "order_id": order_id,
        "project_id": project_id,
        "gross_amount": str(gross_amount),
        "fee_amount": str(fee_amount),
        "net_amount": str(_money(gross_amount - fee_amount)),
        "linked_fee_entry_id": fee_item.id if fee_item else None,
    }
    record_activity(
        db,
        action="accounting.money.income.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="accounting_money_entry",
        entity_id=income_item.id,
        after={
            "kind": "income",
            "amount": str(gross_amount),
            "currency": financial.currency,
            "financial_account_id": financial.id,
            "category_ledger_account_id": income_category.id,
            **linked_metadata,
        },
        message=f"Income recorded: {financial.currency} {gross_amount} — {income_description}",
        request=request,
    )
    if fee_item is not None and fee_category is not None:
        record_activity(
            db,
            action="accounting.money.expense.created",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="accounting_money_entry",
            entity_id=fee_item.id,
            after={
                "kind": "expense",
                "amount": str(fee_amount),
                "currency": financial.currency,
                "financial_account_id": financial.id,
                "category_ledger_account_id": fee_category.id,
                "source_type": source_type,
                "source_id": source_id,
                "client_id": client_id,
                "order_id": order_id,
                "project_id": project_id,
                "linked_income_entry_id": income_item.id,
            },
            message=f"Expense recorded: {financial.currency} {fee_amount} — {fee_description}",
            request=request,
        )

    db.commit()
    db.refresh(income_item)
    if fee_item is not None:
        db.refresh(fee_item)

    return AccountingIncomeWithFeeRead(
        income_entry=_read(db, tenant.organization_id, income_item),
        fee_entry=_read(db, tenant.organization_id, fee_item) if fee_item else None,
        currency=financial.currency,
        gross_amount=gross_amount,
        fee_amount=fee_amount,
        net_amount=_money(gross_amount - fee_amount),
    )
