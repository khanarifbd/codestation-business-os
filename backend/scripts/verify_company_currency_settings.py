from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.company_currencies import (
    CompanyCurrencySettingsUpdate,
    get_company_currency_settings,
    update_company_currency_settings,
)
from app.api.v1.organizations import create_organization
from app.db.session import SessionLocal, engine
from app.models.company_settings import OrganizationFinancialSettings
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import OrganizationCreate


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: Organization


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
    marker = uuid4().hex[:10]
    db = SessionLocal()
    try:
        user = db.scalar(select(User).order_by(User.created_at.asc()))
        if user is None:
            raise AssertionError("currency settings verification requires a user fixture")

        created = create_organization(
            OrganizationCreate(
                name=f"Currency Roles {marker}",
                country_code="BD",
                timezone="Asia/Dhaka",
                currency="BDT",
                business_type="Software & IT Services",
                team_size="1-5",
                financial_year_start_month=7,
            ),
            req("POST", "/organizations"),
            db,
            user,
        )
        organization = db.get(Organization, created.organization.id)
        if organization is None:
            raise AssertionError("new organization ORM row was not persisted")
        tenant = FixtureTenant(
            organization_id=organization.id,
            user_id=user.id,
            organization=organization,
        )

        initial = get_company_currency_settings(db, tenant)  # type: ignore[arg-type]
        if initial.accounting_currency != "BDT":
            raise AssertionError("new organization accounting currency is not initialized")
        if initial.reporting_currency != "BDT":
            raise AssertionError("new organization reporting currency is not initialized")
        if initial.default_client_currency != "BDT":
            raise AssertionError("new organization client currency is not initialized")
        if initial.accounting_currency_locked:
            raise AssertionError("fresh organization accounting currency should not be locked")
        if len(initial.functional_currency_periods) != 1 or initial.functional_currency_periods[0].currency != "BDT":
            raise AssertionError("new organization functional-currency history is not initialized")

        changed = update_company_currency_settings(
            CompanyCurrencySettingsUpdate(
                accounting_currency="USD",
                reporting_currency="AUD",
                default_client_currency="GBP",
            ),
            req("PATCH", "/company-settings/currencies"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if changed.accounting_currency != "USD":
            raise AssertionError("accounting currency did not change before journal posting")
        if changed.reporting_currency != "AUD":
            raise AssertionError("reporting currency did not remain independently configurable")
        if changed.default_client_currency != "GBP":
            raise AssertionError("default client currency did not remain independently configurable")
        if changed.functional_currency_periods[-1].currency != "USD":
            raise AssertionError("initial functional currency period was not corrected before posting")

        financial = db.scalar(
            select(OrganizationFinancialSettings).where(
                OrganizationFinancialSettings.organization_id == organization.id
            )
        )
        if financial is None:
            raise AssertionError("organization financial settings disappeared")
        if financial.accounting_currency != "USD" or financial.reporting_currency != "AUD":
            raise AssertionError("stored financial currency roles are not aligned with the canonical endpoint")

        organization_id = organization.id
        user_id = user.id
        db.close()

        now = datetime.now(timezone.utc)
        with engine.begin() as connection:
            connection.execute(
                text("""
                    INSERT INTO journal_entries
                        (id, organization_id, entry_number, entry_date, functional_currency,
                         status, source_type, created_by_user_id, posted_by_user_id,
                         posted_at, created_at)
                    VALUES
                        (:id, :organization_id, :entry_number, :entry_date, 'USD',
                         'posted', 'currency_roles_fixture', :user_id, :user_id, :now, :now)
                """),
                {
                    "id": str(uuid4()),
                    "organization_id": organization_id,
                    "entry_number": f"FXROLE-{marker}",
                    "entry_date": date.today(),
                    "user_id": user_id,
                    "now": now,
                },
            )
            connection.execute(
                text("""
                    UPDATE organization_financial_settings
                    SET accounting_currency='CAD'
                    WHERE organization_id=:organization_id
                """),
                {"organization_id": organization_id},
            )

        db = SessionLocal()
        user = db.get(User, user_id)
        if user is None:
            raise AssertionError("fixture user disappeared")
        organization = db.get(Organization, organization_id)
        if organization is None:
            raise AssertionError("fixture organization disappeared")
        tenant = FixtureTenant(organization_id=organization_id, user_id=user_id, organization=organization)

        locked = get_company_currency_settings(db, tenant)  # type: ignore[arg-type]
        if not locked.accounting_currency_locked:
            raise AssertionError("posted journal did not lock direct accounting currency relabel")
        if locked.accounting_currency != "USD":
            raise AssertionError("canonical accounting currency changed unexpectedly")
        if locked.reporting_currency != "AUD":
            raise AssertionError("reporting currency changed unexpectedly")
        if locked.accounting_currency_change_earliest_date != date.today().fromordinal(date.today().toordinal() + 1):
            raise AssertionError("controlled accounting currency change date is not after latest posted journal")

        try:
            update_company_currency_settings(
                CompanyCurrencySettingsUpdate(
                    accounting_currency="EUR",
                    reporting_currency="BDT",
                    default_client_currency="CAD",
                ),
                req("PATCH", "/company-settings/currencies"),
                db,
                tenant,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            if exc.status_code != 409:
                raise AssertionError(f"wrong status for locked accounting currency relabel: {exc.status_code}") from exc
            db.rollback()
        else:
            raise AssertionError("accounting currency was directly relabeled after posted journal entries")

        switched = update_company_currency_settings(
            CompanyCurrencySettingsUpdate(
                accounting_currency="USD",
                reporting_currency="BDT",
                default_client_currency="CAD",
            ),
            req("PATCH", "/company-settings/currencies"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if switched.accounting_currency != "USD":
            raise AssertionError("safe currency-role update changed accounting currency")
        if switched.reporting_currency != "BDT":
            raise AssertionError("reporting currency could not be switched after journal posting")
        if switched.default_client_currency != "CAD":
            raise AssertionError("client currency could not be switched after journal posting")
        if not switched.accounting_currency_locked:
            raise AssertionError("direct accounting relabel protection disappeared after safe role update")

        financial = db.scalar(
            select(OrganizationFinancialSettings).where(
                OrganizationFinancialSettings.organization_id == organization_id
            )
        )
        if financial is None or financial.accounting_currency != "USD":
            raise AssertionError("canonical save did not repair duplicate accounting currency metadata")
        if financial.reporting_currency != "BDT":
            raise AssertionError("reporting currency was not persisted independently")
    finally:
        db.close()

    print("company accounting, reporting and client currency role verification passed")


if __name__ == "__main__":
    main()
