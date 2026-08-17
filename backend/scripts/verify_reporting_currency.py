from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from sqlalchemy import func, select
from starlette.requests import Request

from app.api.v1.accounting_reports import financial_statements
from app.api.v1.organizations import create_organization
from app.db.session import SessionLocal
from app.models.accounting import JournalLine
from app.models.company_defaults import OrganizationExchangeRate
from app.models.company_settings import OrganizationFinancialSettings
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import OrganizationCreate
from app.services.accounting_posting import PostingLine, post_journal, system_account


RATE = Decimal("1.7500000000")
MONEY = Decimal("0.01")


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: Organization


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def req(method: str, path: str) -> Request:
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
    db = SessionLocal()
    try:
        user = db.scalar(select(User).order_by(User.created_at.asc()))
        if user is None:
            raise AssertionError("reporting currency verification requires a user fixture")

        marker = uuid4().hex[:10]
        created = create_organization(
            OrganizationCreate(
                name=f"Reporting Currency {marker}",
                country_code="BD",
                timezone="Asia/Dhaka",
                currency="BDT",
                business_type="Software & IT Services",
                team_size="1-5",
                financial_year_start_month=1,
            ),
            req("POST", "/organizations"),
            db,
            user,
        )
        organization = db.get(Organization, created.organization.id)
        if organization is None:
            raise AssertionError("reporting currency fixture organization was not persisted")

        tenant = FixtureTenant(
            organization_id=organization.id,
            user_id=user.id,
            organization=organization,
        )
        accounting_currency = organization.currency.upper()
        reporting_currency = "JPY" if accounting_currency != "JPY" else "AUD"

        financial = db.scalar(
            select(OrganizationFinancialSettings).where(
                OrganizationFinancialSettings.organization_id == organization.id
            )
        )
        if financial is None:
            raise AssertionError("reporting currency verification requires financial settings")

        cash = system_account(db, organization.id, "cash_equivalents")
        revenue = system_account(db, organization.id, "service_revenue")
        amount = Decimal("100.00")
        post_journal(
            db,
            organization_id=organization.id,
            user_id=user.id,
            entry_date=date.today(),
            source_type="reporting_currency_verification",
            source_id=marker,
            lines=[
                PostingLine(ledger_account_id=cash.id, debit=amount, currency=accounting_currency),
                PostingLine(ledger_account_id=revenue.id, credit=amount, currency=accounting_currency),
            ],
            reference=f"REPORT-FX-{marker}",
        )
        db.flush()

        journal_before = db.execute(
            select(
                func.count(JournalLine.id),
                func.coalesce(func.sum(JournalLine.debit), 0),
                func.coalesce(func.sum(JournalLine.credit), 0),
            ).where(JournalLine.organization_id == organization.id)
        ).one()

        financial.reporting_currency = accounting_currency
        db.flush()
        baseline = financial_statements(
            db=db,
            tenant=tenant,  # type: ignore[arg-type]
            date_from=date(2020, 1, 1),
            date_to=date(2099, 12, 31),
        )
        if baseline.base_currency != accounting_currency:
            raise AssertionError("baseline report is not displayed in accounting currency")
        if money(baseline.total_income) != amount:
            raise AssertionError("baseline report did not include the verification journal")

        rate = OrganizationExchangeRate(
            organization_id=organization.id,
            base_currency=accounting_currency,
            quote_currency=reporting_currency,
            reference_rate=RATE,
            manual_rate=RATE,
            effective_rate=RATE,
            source="ci_reporting_currency",
        )
        db.add(rate)
        financial.reporting_currency = reporting_currency
        db.flush()

        converted = financial_statements(
            db=db,
            tenant=tenant,  # type: ignore[arg-type]
            date_from=date(2020, 1, 1),
            date_to=date(2099, 12, 31),
        )
        if converted.accounting_currency != accounting_currency:
            raise AssertionError("reporting switch changed accounting currency")
        if converted.reporting_currency != reporting_currency:
            raise AssertionError("reporting currency preference was not applied")
        if converted.base_currency != reporting_currency:
            raise AssertionError("financial statement display currency did not switch")
        if not converted.reporting_rate_applied:
            raise AssertionError("configured reporting FX rate was not applied")
        if Decimal(converted.reporting_rate or 0) != RATE.quantize(Decimal("0.00000001")):
            raise AssertionError("financial statement used the wrong reporting FX rate")
        if money(converted.total_income) != money(amount * RATE):
            raise AssertionError("reporting currency conversion produced the wrong income amount")

        journal_after = db.execute(
            select(
                func.count(JournalLine.id),
                func.coalesce(func.sum(JournalLine.debit), 0),
                func.coalesce(func.sum(JournalLine.credit), 0),
            ).where(JournalLine.organization_id == organization.id)
        ).one()
        if journal_after != journal_before:
            raise AssertionError("reporting currency presentation modified journal data")

        print(
            "reporting currency verification passed: "
            "accounting ledger unchanged -> independent reporting currency -> FX presentation conversion"
        )
    finally:
        db.rollback()
        db.close()


if __name__ == "__main__":
    main()
