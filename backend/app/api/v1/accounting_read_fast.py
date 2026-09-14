from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.accounting_money import AccountingMoneyEntry
from app.models.crm import Client
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.orders import Order
from app.models.projects import Project
from app.models.reconciliation import BankReconciliation, BankReconciliationItem
from app.schemas.accounting import JournalEntryRead, JournalLineRead
from app.schemas.accounting_money import AccountingMoneyEntryRead
from app.schemas.accounting_reconciliation import ReconciliationMetaRead, ReconciliationRead
from app.tenancy.context import TenantContext

router = APIRouter(tags=["Accounting - Fast Reads"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


@router.get("/accounting/money", response_model=list[AccountingMoneyEntryRead])
def list_money_entries_fast(
    db: DbSession,
    tenant: AccountingViewer,
    kind: str | None = None,
    limit: int = 100,
):
    org_id = tenant.organization_id
    query = (
        select(
            AccountingMoneyEntry,
            FinancialAccount.name,
            LedgerAccount.name,
            Project.project_number,
            Project.name,
            Order.order_number,
            Order.client_name_snapshot,
            Client.client_code,
            Client.display_name,
        )
        .join(
            FinancialAccount,
            and_(
                FinancialAccount.id == AccountingMoneyEntry.financial_account_id,
                FinancialAccount.organization_id == org_id,
            ),
        )
        .join(
            LedgerAccount,
            and_(
                LedgerAccount.id == AccountingMoneyEntry.category_ledger_account_id,
                LedgerAccount.organization_id == org_id,
            ),
        )
        .outerjoin(
            Project,
            and_(
                Project.id == AccountingMoneyEntry.project_id,
                Project.organization_id == org_id,
            ),
        )
        .outerjoin(
            Order,
            and_(
                Order.id == AccountingMoneyEntry.order_id,
                Order.organization_id == org_id,
            ),
        )
        .outerjoin(
            Client,
            and_(
                Client.id == AccountingMoneyEntry.client_id,
                Client.organization_id == org_id,
            ),
        )
        .where(AccountingMoneyEntry.organization_id == org_id)
    )
    if kind in {"income", "expense"}:
        query = query.where(AccountingMoneyEntry.kind == kind)

    rows = db.execute(
        query.order_by(
            AccountingMoneyEntry.entry_date.desc(),
            AccountingMoneyEntry.created_at.desc(),
        ).limit(min(max(limit, 1), 300))
    ).all()

    result: list[AccountingMoneyEntryRead] = []
    for (
        item,
        financial_name,
        category_name,
        project_number,
        project_name,
        order_number,
        order_client_name,
        client_code,
        client_name,
    ) in rows:
        source_label = None
        if item.project_id and project_number:
            source_label = f"{project_number} · {project_name}"
        elif item.order_id and order_number:
            source_label = f"{order_number} · {order_client_name}"
        elif item.client_id and client_code:
            source_label = f"{client_code} · {client_name}"

        result.append(
            AccountingMoneyEntryRead(
                id=item.id,
                kind=item.kind,
                entry_date=item.entry_date,
                financial_account_id=item.financial_account_id,
                financial_account_name=financial_name,
                category_ledger_account_id=item.category_ledger_account_id,
                category_ledger_account_name=category_name,
                source_type=item.source_type,
                source_id=item.source_id,
                client_id=item.client_id,
                order_id=item.order_id,
                project_id=item.project_id,
                expense_category_id=item.expense_category_id,
                vendor_id=item.vendor_id,
                source_label=source_label,
                currency=item.currency,
                amount=item.amount,
                description=item.description,
                reference=item.reference,
                notes=item.notes,
                created_at=item.created_at,
            )
        )
    return result


@router.get("/accounting/reconciliations/meta", response_model=ReconciliationMetaRead)
def reconciliation_meta_fast(db: DbSession, tenant: AccountingViewer):
    org_id = tenant.organization_id
    ranked = (
        select(
            BankReconciliation.account_id.label("account_id"),
            BankReconciliation.statement_end_date.label("statement_end_date"),
            BankReconciliation.statement_ending_balance.label("statement_ending_balance"),
            func.row_number()
            .over(
                partition_by=BankReconciliation.account_id,
                order_by=(
                    BankReconciliation.statement_end_date.desc(),
                    BankReconciliation.created_at.desc(),
                ),
            )
            .label("row_number"),
        )
        .where(
            BankReconciliation.organization_id == org_id,
            BankReconciliation.status == "finalized",
        )
        .subquery()
    )
    rows = db.execute(
        select(
            FinancialAccount,
            ranked.c.statement_end_date,
            ranked.c.statement_ending_balance,
        )
        .outerjoin(
            ranked,
            and_(
                ranked.c.account_id == FinancialAccount.id,
                ranked.c.row_number == 1,
            ),
        )
        .where(
            FinancialAccount.organization_id == org_id,
            FinancialAccount.is_active.is_(True),
        )
        .order_by(FinancialAccount.currency, FinancialAccount.name)
    ).all()
    return {
        "accounts": [
            {
                "id": account.id,
                "name": account.name,
                "account_type": account.account_type,
                "currency": account.currency,
                "last_reconciled_date": statement_end_date,
                "last_statement_balance": statement_ending_balance,
            }
            for account, statement_end_date, statement_ending_balance in rows
        ]
    }


@router.get("/accounting/reconciliations", response_model=list[ReconciliationRead])
def list_reconciliations_fast(db: DbSession, tenant: AccountingViewer):
    org_id = tenant.organization_id
    cleared_reconciliation = aliased(BankReconciliation)
    cleared_item = aliased(BankReconciliationItem)
    cleared_transaction = aliased(FinancialTransaction)

    matched_count = (
        select(func.count(BankReconciliationItem.id))
        .where(
            BankReconciliationItem.organization_id == org_id,
            BankReconciliationItem.reconciliation_id == BankReconciliation.id,
        )
        .correlate(BankReconciliation)
        .scalar_subquery()
    )
    cleared_effect = case(
        (cleared_transaction.direction == "credit", cleared_transaction.amount),
        else_=-cleared_transaction.amount,
    )
    cleared_net = (
        select(func.coalesce(func.sum(cleared_effect), 0))
        .select_from(cleared_transaction)
        .join(
            cleared_item,
            cleared_item.financial_transaction_id == cleared_transaction.id,
        )
        .join(
            cleared_reconciliation,
            cleared_reconciliation.id == cleared_item.reconciliation_id,
        )
        .where(
            cleared_transaction.organization_id == org_id,
            cleared_item.organization_id == org_id,
            cleared_reconciliation.organization_id == org_id,
            cleared_reconciliation.account_id == BankReconciliation.account_id,
            cleared_transaction.transaction_date <= BankReconciliation.statement_end_date,
            or_(
                cleared_reconciliation.status == "finalized",
                cleared_reconciliation.id == BankReconciliation.id,
            ),
        )
        .correlate(BankReconciliation)
        .scalar_subquery()
    )

    rows = db.execute(
        select(
            BankReconciliation,
            FinancialAccount.name,
            FinancialAccount.currency,
            FinancialAccount.opening_balance,
            matched_count.label("matched_count"),
            cleared_net.label("cleared_net"),
        )
        .join(
            FinancialAccount,
            and_(
                FinancialAccount.id == BankReconciliation.account_id,
                FinancialAccount.organization_id == org_id,
            ),
        )
        .where(BankReconciliation.organization_id == org_id)
        .order_by(
            BankReconciliation.statement_end_date.desc(),
            BankReconciliation.created_at.desc(),
        )
        .limit(200)
    ).all()

    result: list[ReconciliationRead] = []
    for row, account_name, currency, opening_balance, count, net in rows:
        cleared_balance = _money(Decimal(opening_balance or 0) + Decimal(net or 0))
        result.append(
            ReconciliationRead(
                id=row.id,
                account_id=row.account_id,
                account_name=account_name,
                currency=currency,
                statement_start_date=row.statement_start_date,
                statement_end_date=row.statement_end_date,
                statement_ending_balance=row.statement_ending_balance,
                cleared_book_balance=cleared_balance,
                difference=_money(row.statement_ending_balance - cleared_balance),
                status=row.status,
                matched_transactions=int(count or 0),
                notes=row.notes,
                finalized_at=row.finalized_at,
                created_at=row.created_at,
            )
        )
    return result


@router.get("/accounting/journals", response_model=list[JournalEntryRead])
def list_journals_fast(
    db: DbSession,
    tenant: AccountingViewer,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    org_id = tenant.organization_id
    entries = db.scalars(
        select(JournalEntry)
        .where(JournalEntry.organization_id == org_id)
        .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
        .limit(limit)
    ).all()
    if not entries:
        return []

    entry_ids = [entry.id for entry in entries]
    line_rows = db.execute(
        select(JournalLine, LedgerAccount.code, LedgerAccount.name)
        .join(
            LedgerAccount,
            and_(
                LedgerAccount.id == JournalLine.ledger_account_id,
                LedgerAccount.organization_id == org_id,
            ),
        )
        .where(
            JournalLine.organization_id == org_id,
            JournalLine.journal_entry_id.in_(entry_ids),
        )
        .order_by(JournalLine.journal_entry_id, JournalLine.created_at.asc())
    ).all()

    lines_by_entry: dict[str, list[JournalLineRead]] = defaultdict(list)
    for line, account_code, account_name in line_rows:
        lines_by_entry[line.journal_entry_id].append(
            JournalLineRead(
                id=line.id,
                ledger_account_id=line.ledger_account_id,
                account_code=account_code,
                account_name=account_name,
                description=line.description,
                currency=line.currency,
                exchange_rate_to_base=line.exchange_rate_to_base,
                debit=line.debit,
                credit=line.credit,
                original_amount=line.original_amount,
            )
        )

    result: list[JournalEntryRead] = []
    for entry in entries:
        lines = lines_by_entry.get(entry.id, [])
        result.append(
            JournalEntryRead(
                id=entry.id,
                entry_number=entry.entry_number,
                entry_date=entry.entry_date,
                functional_currency=entry.functional_currency,
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
        )
    return result
