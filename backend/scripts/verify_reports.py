from dataclasses import dataclass
from datetime import date
from uuid import uuid4

from sqlalchemy import text
from starlette.requests import Request

from app.api.v1.accounting_money import create_money_entry
from app.api.v1.finance import create_account
from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.api.v1.reports import reports_overview
from app.db.session import SessionLocal, engine
from app.schemas.accounting_money import AccountingMoneyEntryCreate
from app.schemas.finance import FinancialAccountCreate
from app.services.accounting_posting import system_account


@dataclass(frozen=True)
class FixtureOrganization:
    timezone: str
    currency: str
    name: str


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: FixtureOrganization


def make_request(method: str, path: str) -> Request:
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "headers": [],
        "query_string": b"",
        "scheme": "https",
        "server": ("testserver", 443),
        "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id, timezone, currency, name
            FROM organizations
            WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(
            timezone=str(fixture["timezone"] or "UTC"),
            currency=str(fixture["currency"] or "USD"),
            name=str(fixture["name"]),
        ),
    )
    db = SessionLocal()
    try:
        report = reports_overview(
            db=db,
            tenant=tenant,  # type: ignore[arg-type]
            date_from=date(2020, 1, 1),
            date_to=date(2030, 12, 31),
            currency=None,
            client_id=None,
            project_id=None,
        )
        if report.date_from != date(2020, 1, 1) or report.date_to != date(2030, 12, 31):
            raise AssertionError("report period was not preserved")
        if not report.accounts:
            raise AssertionError("report account balances are missing")
        if report.operations.active_clients < 1:
            raise AssertionError("operational client metric is missing")
        currencies = [row.currency for row in report.financials]
        if len(currencies) != len(set(currencies)):
            raise AssertionError("financial rows must stay separated by currency")
        for row in report.financials:
            expected = row.invoiced_revenue + row.direct_income - row.expenses - row.transfer_fees
            if row.net_profit != expected:
                raise AssertionError(f"net profit mismatch for {row.currency}")
        if report.projects and any(not row.currency for row in report.projects):
            raise AssertionError("project profitability currency missing")

        marker = uuid4().hex[:8]
        test_date = date(2029, 6, 15)
        baseline = reports_overview(
            db=db,
            tenant=tenant,  # type: ignore[arg-type]
            date_from=date(2029, 6, 1),
            date_to=date(2029, 6, 30),
            currency=tenant.organization.currency,
            client_id=None,
            project_id=None,
        )
        baseline_row = next(
            (row for row in baseline.financials if row.currency == tenant.organization.currency),
            None,
        )
        baseline_direct_income = baseline_row.direct_income if baseline_row else 0
        baseline_expenses = baseline_row.expenses if baseline_row else 0

        account = create_account(
            FinancialAccountCreate(
                name=f"CI Report Money {marker}",
                account_type="bank",
                currency=tenant.organization.currency,
                opening_balance=0,
            ),
            make_request("POST", "/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        income_ledger = system_account(db, tenant.organization_id, "other_income")
        expense_ledger = system_account(db, tenant.organization_id, "operating_expenses")

        create_money_entry(
            AccountingMoneyEntryCreate(
                kind="income",
                entry_date=test_date,
                financial_account_id=account.id,
                category_ledger_account_id=income_ledger.id,
                amount=123,
                description="CI direct report income",
                reference=f"RPT-IN-{marker}",
            ),
            make_request("POST", "/accounting/money"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        create_money_entry(
            AccountingMoneyEntryCreate(
                kind="expense",
                entry_date=test_date,
                financial_account_id=account.id,
                category_ledger_account_id=expense_ledger.id,
                amount=23,
                description="CI direct report expense",
                reference=f"RPT-OUT-{marker}",
            ),
            make_request("POST", "/accounting/money"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        reversed_income = create_money_entry(
            AccountingMoneyEntryCreate(
                kind="income",
                entry_date=test_date,
                financial_account_id=account.id,
                category_ledger_account_id=income_ledger.id,
                amount=50,
                description="CI reversed report income",
                reference=f"RPT-REV-IN-{marker}",
            ),
            make_request("POST", "/accounting/money"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        reverse_business_transaction(
            CorrectionRequest(
                source_type="money_entry",
                source_id=reversed_income.id,
                reason="CI report reversal exclusion",
                reversal_date=test_date,
            ),
            make_request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )

        after = reports_overview(
            db=db,
            tenant=tenant,  # type: ignore[arg-type]
            date_from=date(2029, 6, 1),
            date_to=date(2029, 6, 30),
            currency=tenant.organization.currency,
            client_id=None,
            project_id=None,
        )
        after_row = next(
            (row for row in after.financials if row.currency == tenant.organization.currency),
            None,
        )
        if after_row is None:
            raise AssertionError("direct Money In/Out did not produce a report financial row")
        if after_row.direct_income - baseline_direct_income != 123:
            raise AssertionError("direct Money In was missing from reports or a reversed entry was still counted")
        if after_row.expenses - baseline_expenses != 23:
            raise AssertionError("direct Money Out was missing from report expenses")
        expected_after = (
            after_row.invoiced_revenue
            + after_row.direct_income
            - after_row.expenses
            - after_row.transfer_fees
        )
        if after_row.net_profit != expected_after:
            raise AssertionError("report net profit does not include direct Money In/Out correctly")

        june_trend = next(
            (
                row
                for row in after.trend
                if row.currency == tenant.organization.currency and row.period == "2029-06"
            ),
            None,
        )
        if june_trend is None or june_trend.direct_income < 123:
            raise AssertionError("monthly trend omitted direct Money In")
    finally:
        db.close()
    print("reports aggregate currency-safe verification passed: Money In/Out included, reversed money excluded, and net profit reconciles")


if __name__ == "__main__":
    main()
