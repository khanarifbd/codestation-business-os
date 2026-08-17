from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select, text

from app.api.v1.accounting_reports import financial_statements
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalLine
from app.models.company_defaults import OrganizationExchangeRate
from app.models.company_settings import OrganizationFinancialSettings


RATE = Decimal("1.7500000000")
MONEY = Decimal("0.01")


@dataclass(frozen=True)
class FixtureOrganization:
    currency: str
    financial_year_start_month: int


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: FixtureOrganization


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id,
                   currency, financial_year_start_month
            FROM organizations
            WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC
            LIMIT 1
        """)).mappings().one()

    organization_id = str(fixture["organization_id"])
    accounting_currency = str(fixture["currency"] or "BDT").upper()
    reporting_currency = "JPY" if accounting_currency != "JPY" else "AUD"
    tenant = FixtureTenant(
        organization_id=organization_id,
        user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(
            currency=accounting_currency,
            financial_year_start_month=int(fixture["financial_year_start_month"] or 1),
        ),
    )

    db = SessionLocal()
    try:
        financial = db.scalar(
            select(OrganizationFinancialSettings).where(
                OrganizationFinancialSettings.organization_id == organization_id
            )
        )
        if financial is None:
            raise AssertionError("reporting currency verification requires financial settings")

        journal_before = db.execute(
            select(
                func.count(JournalLine.id),
                func.coalesce(func.sum(JournalLine.debit), 0),
                func.coalesce(func.sum(JournalLine.credit), 0),
            ).where(JournalLine.organization_id == organization_id)
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

        rate = db.scalar(
            select(OrganizationExchangeRate).where(
                OrganizationExchangeRate.organization_id == organization_id,
                OrganizationExchangeRate.base_currency == accounting_currency,
                OrganizationExchangeRate.quote_currency == reporting_currency,
            )
        )
        if rate is None:
            rate = OrganizationExchangeRate(
                organization_id=organization_id,
                base_currency=accounting_currency,
                quote_currency=reporting_currency,
                reference_rate=RATE,
                manual_rate=RATE,
                effective_rate=RATE,
                source="ci_reporting_currency",
            )
            db.add(rate)
        else:
            rate.reference_rate = RATE
            rate.manual_rate = RATE
            rate.effective_rate = RATE
            rate.source = "ci_reporting_currency"
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

        baseline_rows = baseline.income + baseline.expenses + baseline.assets + baseline.liabilities + baseline.equity
        converted_rows = converted.income + converted.expenses + converted.assets + converted.liabilities + converted.equity
        converted_by_key = {(row.code, row.name): row for row in converted_rows}
        checked = False
        for row in baseline_rows:
            if row.amount == 0:
                continue
            target = converted_by_key.get((row.code, row.name))
            if target is None:
                raise AssertionError(f"reporting conversion dropped statement row {row.code}")
            if money(target.amount) != money(Decimal(row.amount) * RATE):
                raise AssertionError(f"reporting conversion is incorrect for statement row {row.code}")
            checked = True
            break
        if not checked:
            raise AssertionError("reporting currency verification requires at least one non-zero statement row")

        journal_after = db.execute(
            select(
                func.count(JournalLine.id),
                func.coalesce(func.sum(JournalLine.debit), 0),
                func.coalesce(func.sum(JournalLine.credit), 0),
            ).where(JournalLine.organization_id == organization_id)
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
