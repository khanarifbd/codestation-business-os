from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/reports", tags=["Accounting Reports"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


class StatementRow(BaseModel):
    code: str
    name: str
    amount: Decimal


class CashFlowRead(BaseModel):
    operating: Decimal
    investing: Decimal
    financing: Decimal
    net_change: Decimal


class FinancialStatementsRead(BaseModel):
    base_currency: str
    date_from: date
    date_to: date
    income: list[StatementRow]
    expenses: list[StatementRow]
    total_income: Decimal
    total_expenses: Decimal
    net_profit: Decimal
    assets: list[StatementRow]
    liabilities: list[StatementRow]
    equity: list[StatementRow]
    total_assets: Decimal
    total_liabilities: Decimal
    recorded_equity: Decimal
    current_earnings: Decimal
    total_equity: Decimal
    total_liabilities_and_equity: Decimal
    cash_flow: CashFlowRead


def _fiscal_start(today: date, start_month: int) -> date:
    year = today.year if today.month >= start_month else today.year - 1
    return date(year, start_month, 1)


def _normal_amount(category: str, debit: Decimal, credit: Decimal) -> Decimal:
    if category in {"asset", "expense"}:
        return _money(debit - credit)
    return _money(credit - debit)


def _rows(db: DbSession, organization_id: str, start: date | None, end: date):
    query = (
        select(JournalEntry, JournalLine, LedgerAccount)
        .join(JournalLine, JournalLine.journal_entry_id == JournalEntry.id)
        .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
        .where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.status == "posted",
            JournalEntry.entry_date <= end,
            JournalLine.organization_id == organization_id,
            LedgerAccount.organization_id == organization_id,
        )
    )
    if start is not None:
        query = query.where(JournalEntry.entry_date >= start)
    return db.execute(query).all()


@router.get("/financial-statements", response_model=FinancialStatementsRead)
def financial_statements(
    db: DbSession,
    tenant: AccountingViewer,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
):
    today = date.today()
    end = date_to or today
    start = date_from or _fiscal_start(end, tenant.organization.financial_year_start_month)
    if start > end:
        start, end = end, start

    period_values: dict[str, dict[str, Decimal | str]] = {}
    for entry, line, account in _rows(db, tenant.organization_id, start, end):
        item = period_values.setdefault(account.id, {"code": account.code, "name": account.name, "category": account.category, "debit": Decimal("0"), "credit": Decimal("0")})
        item["debit"] = Decimal(item["debit"]) + Decimal(line.debit)
        item["credit"] = Decimal(item["credit"]) + Decimal(line.credit)

    cumulative_values: dict[str, dict[str, Decimal | str]] = {}
    cumulative_rows = _rows(db, tenant.organization_id, None, end)
    cash_by_entry: dict[str, Decimal] = defaultdict(Decimal)
    entry_source: dict[str, str] = {}
    for entry, line, account in cumulative_rows:
        item = cumulative_values.setdefault(account.id, {"code": account.code, "name": account.name, "category": account.category, "debit": Decimal("0"), "credit": Decimal("0")})
        item["debit"] = Decimal(item["debit"]) + Decimal(line.debit)
        item["credit"] = Decimal(item["credit"]) + Decimal(line.credit)
        if start <= entry.entry_date <= end and account.category == "asset" and account.subtype in {"bank", "cash", "mobile_wallet", "payment_gateway", "petty_cash", "other"}:
            cash_by_entry[entry.id] += Decimal(line.debit) - Decimal(line.credit)
            entry_source[entry.id] = entry.source_type

    def statement(category: str, source: dict[str, dict[str, Decimal | str]]) -> list[StatementRow]:
        result = []
        for item in source.values():
            if item["category"] != category:
                continue
            amount = _normal_amount(category, Decimal(item["debit"]), Decimal(item["credit"]))
            if amount != 0:
                result.append(StatementRow(code=str(item["code"]), name=str(item["name"]), amount=amount))
        return sorted(result, key=lambda row: row.code)

    income = statement("income", period_values)
    expenses = statement("expense", period_values)
    assets = statement("asset", cumulative_values)
    liabilities = statement("liability", cumulative_values)
    equity = statement("equity", cumulative_values)
    total_income = _money(sum((row.amount for row in income), Decimal("0")))
    total_expenses = _money(sum((row.amount for row in expenses), Decimal("0")))
    net_profit = _money(total_income - total_expenses)
    total_assets = _money(sum((row.amount for row in assets), Decimal("0")))
    total_liabilities = _money(sum((row.amount for row in liabilities), Decimal("0")))
    recorded_equity = _money(sum((row.amount for row in equity), Decimal("0")))

    cumulative_income = _money(sum((row.amount for row in statement("income", cumulative_values)), Decimal("0")))
    cumulative_expenses = _money(sum((row.amount for row in statement("expense", cumulative_values)), Decimal("0")))
    current_earnings = _money(cumulative_income - cumulative_expenses)
    total_equity = _money(recorded_equity + current_earnings)

    operating = Decimal("0")
    investing = Decimal("0")
    financing = Decimal("0")
    financing_prefixes = ("loan_", "capital_", "investment", "investor", "owner_")
    investing_prefixes = ("fixed_asset", "asset_purchase", "asset_sale")
    for entry_id, cash_delta in cash_by_entry.items():
        source = entry_source.get(entry_id, "")
        if source.startswith(financing_prefixes):
            financing += cash_delta
        elif source.startswith(investing_prefixes):
            investing += cash_delta
        elif source == "account_transfer":
            operating += cash_delta
        else:
            operating += cash_delta
    operating = _money(operating); investing = _money(investing); financing = _money(financing)

    return FinancialStatementsRead(
        base_currency=tenant.organization.currency,
        date_from=start,
        date_to=end,
        income=income,
        expenses=expenses,
        total_income=total_income,
        total_expenses=total_expenses,
        net_profit=net_profit,
        assets=assets,
        liabilities=liabilities,
        equity=equity,
        total_assets=total_assets,
        total_liabilities=total_liabilities,
        recorded_equity=recorded_equity,
        current_earnings=current_earnings,
        total_equity=total_equity,
        total_liabilities_and_equity=_money(total_liabilities + total_equity),
        cash_flow=CashFlowRead(operating=operating, investing=investing, financing=financing, net_change=_money(operating + investing + financing)),
    )
