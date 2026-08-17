from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.company_defaults import OrganizationExchangeRate
from app.models.company_settings import OrganizationFinancialSettings
from app.services.functional_currency import functional_currency_period_for_date, organization_local_date
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/reports", tags=["Accounting Reports"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
MONEY = Decimal("0.01")
RATE = Decimal("0.00000001")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _rate(value) -> Decimal:
    return Decimal(value).quantize(RATE, rounding=ROUND_HALF_UP)


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
    # base_currency is kept for frontend/API compatibility and means the actual
    # display currency used for the returned amounts.
    base_currency: str
    accounting_currency: str
    reporting_currency: str
    reporting_rate: Decimal | None
    reporting_rate_applied: bool
    reporting_note: str | None
    functional_period_start: date
    functional_period_end: date | None
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


def _rows(
    db: DbSession,
    organization_id: str,
    functional_currency: str,
    start: date | None,
    end: date,
):
    query = (
        select(JournalEntry, JournalLine, LedgerAccount)
        .join(JournalLine, JournalLine.journal_entry_id == JournalEntry.id)
        .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
        .where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.status == "posted",
            JournalEntry.functional_currency == functional_currency,
            JournalEntry.entry_date <= end,
            JournalLine.organization_id == organization_id,
            LedgerAccount.organization_id == organization_id,
        )
    )
    if start is not None:
        query = query.where(JournalEntry.entry_date >= start)
    return db.execute(query).all()


def _cash_flow_bucket(source_type: str) -> str:
    """Classify by economic substance, not by incidental route/module naming."""
    source = (source_type or "").lower()
    financing_prefixes = (
        "loan_", "capital_", "owner_", "investor_", "company_investor_", "project_investor_",
    )
    investing_prefixes = (
        "fixed_asset", "asset_purchase", "asset_sale", "company_investment_", "investment_return",
    )
    if source.startswith(investing_prefixes):
        return "investing"
    if source.startswith(financing_prefixes):
        return "financing"
    return "operating"


def _reporting_context(
    db: DbSession,
    organization_id: str,
    accounting_currency: str,
) -> tuple[str, str, Decimal | None, bool, str | None]:
    financial = db.scalar(
        select(OrganizationFinancialSettings).where(
            OrganizationFinancialSettings.organization_id == organization_id
        )
    )
    reporting_currency = (
        financial.reporting_currency.upper()
        if financial is not None and financial.reporting_currency
        else accounting_currency
    )
    if reporting_currency == accounting_currency:
        return accounting_currency, reporting_currency, Decimal("1.00000000"), True, None

    direct = db.scalar(
        select(OrganizationExchangeRate).where(
            OrganizationExchangeRate.organization_id == organization_id,
            OrganizationExchangeRate.base_currency == accounting_currency,
            OrganizationExchangeRate.quote_currency == reporting_currency,
        )
    )
    if direct is not None:
        resolved_rate = _rate(direct.effective_rate)
        return (
            reporting_currency,
            reporting_currency,
            resolved_rate,
            True,
            f"Display conversion uses the current configured {accounting_currency}/{reporting_currency} FX rate. Historical journal amounts remain unchanged.",
        )

    inverse = db.scalar(
        select(OrganizationExchangeRate).where(
            OrganizationExchangeRate.organization_id == organization_id,
            OrganizationExchangeRate.base_currency == reporting_currency,
            OrganizationExchangeRate.quote_currency == accounting_currency,
        )
    )
    if inverse is not None:
        inverse_rate = Decimal(inverse.effective_rate)
        resolved_rate = _rate(Decimal("1") / inverse_rate)
        return (
            reporting_currency,
            reporting_currency,
            resolved_rate,
            True,
            f"Display conversion uses the inverse current configured {reporting_currency}/{accounting_currency} FX rate. Historical journal amounts remain unchanged.",
        )

    return (
        accounting_currency,
        reporting_currency,
        None,
        False,
        f"Reporting currency {reporting_currency} is selected, but no {accounting_currency}/{reporting_currency} FX pair is configured. Amounts are shown in accounting currency {accounting_currency} to avoid mislabeling financial data.",
    )


def _convert(value: Decimal, conversion_rate: Decimal) -> Decimal:
    return _money(Decimal(value) * conversion_rate)


def _convert_rows(rows: list[StatementRow], conversion_rate: Decimal) -> list[StatementRow]:
    return [StatementRow(code=row.code, name=row.name, amount=_convert(row.amount, conversion_rate)) for row in rows]


@router.get("/financial-statements", response_model=FinancialStatementsRead)
def financial_statements(
    db: DbSession,
    tenant: AccountingViewer,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
):
    today = organization_local_date(tenant.organization)
    end = date_to or today
    requested_start = date_from
    start = requested_start or _fiscal_start(end, tenant.organization.financial_year_start_month)
    if start > end:
        start, end = end, start
        requested_start = start if date_from is not None else None

    functional_period = functional_currency_period_for_date(db, tenant.organization_id, end)
    accounting_currency = functional_period.currency.upper()

    # A single statement may never raw-sum journals whose debit/credit values are
    # expressed in different functional currencies. The transition opening journal
    # carries balance-sheet values into the new period; P&L starts fresh there.
    if requested_start is not None and start < functional_period.effective_from:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"The requested report range crosses a functional-currency change. "
                f"{accounting_currency} accounting starts on {functional_period.effective_from.isoformat()} "
                "for this period. Run separate statements for each functional-currency period or use reporting currency for presentation."
            ),
        )
    if functional_period.effective_to is not None and end > functional_period.effective_to:
        raise HTTPException(status_code=409, detail="Report end date exceeds the selected functional-currency period")

    start = max(start, functional_period.effective_from)

    period_values: dict[str, dict[str, Decimal | str]] = {}
    for entry, line, account in _rows(db, tenant.organization_id, accounting_currency, start, end):
        item = period_values.setdefault(account.id, {"code": account.code, "name": account.name, "category": account.category, "debit": Decimal("0"), "credit": Decimal("0")})
        item["debit"] = Decimal(item["debit"]) + Decimal(line.debit)
        item["credit"] = Decimal(item["credit"]) + Decimal(line.credit)

    cumulative_values: dict[str, dict[str, Decimal | str]] = {}
    cumulative_rows = _rows(
        db,
        tenant.organization_id,
        accounting_currency,
        functional_period.effective_from,
        end,
    )
    cash_by_entry: dict[str, Decimal] = defaultdict(Decimal)
    entry_source: dict[str, str] = {}
    for entry, line, account in cumulative_rows:
        item = cumulative_values.setdefault(account.id, {"code": account.code, "name": account.name, "category": account.category, "debit": Decimal("0"), "credit": Decimal("0")})
        item["debit"] = Decimal(item["debit"]) + Decimal(line.debit)
        item["credit"] = Decimal(item["credit"]) + Decimal(line.credit)
        if (
            entry.source_type != "functional_currency_transition"
            and start <= entry.entry_date <= end
            and account.category == "asset"
            and account.subtype in {"bank", "cash", "mobile_wallet", "payment_gateway", "petty_cash", "other"}
        ):
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
    for entry_id, cash_delta in cash_by_entry.items():
        bucket = _cash_flow_bucket(entry_source.get(entry_id, ""))
        if bucket == "financing":
            financing += cash_delta
        elif bucket == "investing":
            investing += cash_delta
        else:
            operating += cash_delta
    operating = _money(operating)
    investing = _money(investing)
    financing = _money(financing)

    display_currency, reporting_currency, reporting_rate, reporting_rate_applied, reporting_note = _reporting_context(
        db,
        tenant.organization_id,
        accounting_currency,
    )

    if reporting_rate_applied and reporting_rate is not None and reporting_rate != Decimal("1.00000000"):
        income = _convert_rows(income, reporting_rate)
        expenses = _convert_rows(expenses, reporting_rate)
        assets = _convert_rows(assets, reporting_rate)
        liabilities = _convert_rows(liabilities, reporting_rate)
        equity = _convert_rows(equity, reporting_rate)

        total_income = _money(sum((row.amount for row in income), Decimal("0")))
        total_expenses = _money(sum((row.amount for row in expenses), Decimal("0")))
        net_profit = _money(total_income - total_expenses)
        total_assets = _money(sum((row.amount for row in assets), Decimal("0")))
        total_liabilities = _money(sum((row.amount for row in liabilities), Decimal("0")))
        recorded_equity = _money(sum((row.amount for row in equity), Decimal("0")))
        current_earnings = _convert(current_earnings, reporting_rate)
        total_equity = _money(recorded_equity + current_earnings)
        operating = _convert(operating, reporting_rate)
        investing = _convert(investing, reporting_rate)
        financing = _convert(financing, reporting_rate)

    period_note = None
    fiscal_start = _fiscal_start(end, tenant.organization.financial_year_start_month)
    if functional_period.effective_from > fiscal_start:
        period_note = (
            f"This statement begins at the {accounting_currency} functional-currency period on "
            f"{functional_period.effective_from.isoformat()}; earlier functional-currency journals are not raw-summed into it."
        )
    if period_note:
        reporting_note = f"{reporting_note} {period_note}" if reporting_note else period_note

    return FinancialStatementsRead(
        base_currency=display_currency,
        accounting_currency=accounting_currency,
        reporting_currency=reporting_currency,
        reporting_rate=reporting_rate,
        reporting_rate_applied=reporting_rate_applied,
        reporting_note=reporting_note,
        functional_period_start=functional_period.effective_from,
        functional_period_end=functional_period.effective_to,
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
        cash_flow=CashFlowRead(
            operating=operating,
            investing=investing,
            financing=financing,
            net_change=_money(operating + investing + financing),
        ),
    )
