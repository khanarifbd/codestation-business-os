from dataclasses import dataclass
from datetime import date

from sqlalchemy import text

from app.api.v1.reports import reports_overview
from app.db.session import SessionLocal, engine


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
            expected = row.invoiced_revenue - row.expenses - row.transfer_fees
            if row.net_profit != expected:
                raise AssertionError(f"net profit mismatch for {row.currency}")
        if report.projects and any(not row.currency for row in report.projects):
            raise AssertionError("project profitability currency missing")
    finally:
        db.close()
    print("reports aggregate currency-safe verification passed")


if __name__ == "__main__":
    main()
