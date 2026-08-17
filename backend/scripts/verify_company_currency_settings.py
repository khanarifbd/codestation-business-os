from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.company_currencies import get_company_currency_settings, update_company_currency_settings
from app.api.v1.organizations import create_organization
from app.db.session import SessionLocal, engine
from app.models.user import User
from app.schemas.organization import OrganizationCreate
from app.api.v1.company_currencies import CompanyCurrencySettingsUpdate


@dataclass(frozen=True)
class FixtureOrganization:
    id: str
    currency: str


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: object


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
                name=f"Currency Policy {marker}",
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
        organization = created.organization
        tenant = FixtureTenant(
            organization_id=organization.id,
            user_id=user.id,
            organization=organization,
        )

        initial = get_company_currency_settings(db, tenant)  # type: ignore[arg-type]
        if initial.base_currency != "BDT" or initial.accounting_currency != "BDT":
            raise AssertionError("new organization base/accounting currencies are not aligned")
        if initial.base_currency_locked:
            raise AssertionError("fresh organization currency should not be locked before accounting posts")

        changed = update_company_currency_settings(
            CompanyCurrencySettingsUpdate(base_currency="USD", default_client_currency="AUD"),
            req("PATCH", "/company-settings/currencies"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if changed.base_currency != "USD" or changed.accounting_currency != "USD":
            raise AssertionError("currency update did not align base and accounting currencies")
        if changed.default_client_currency != "AUD":
            raise AssertionError("default client currency should remain independently configurable")

        organization_id = organization.id
        user_id = user.id
        db.close()

        now = datetime.now(timezone.utc)
        with engine.begin() as connection:
            connection.execute(
                text("""
                    INSERT INTO journal_entries
                        (id, organization_id, entry_number, entry_date, status, source_type,
                         created_by_user_id, posted_by_user_id, posted_at, created_at)
                    VALUES
                        (:id, :organization_id, :entry_number, :entry_date, 'posted', 'currency_policy_fixture',
                         :user_id, :user_id, :now, :now)
                """),
                {
                    "id": str(uuid4()),
                    "organization_id": organization_id,
                    "entry_number": f"FXLOCK-{marker}",
                    "entry_date": date.today(),
                    "user_id": user_id,
                    "now": now,
                },
            )
            # Simulate a legacy mismatch to verify the canonical endpoint repairs it
            # without changing the already-locked reporting currency.
            connection.execute(
                text("""
                    UPDATE organization_financial_settings
                    SET accounting_currency='AUD'
                    WHERE organization_id=:organization_id
                """),
                {"organization_id": organization_id},
            )

        db = SessionLocal()
        user = db.get(User, user_id)
        if user is None:
            raise AssertionError("fixture user disappeared")
        from app.models.organization import Organization
        organization_row = db.get(Organization, organization_id)
        if organization_row is None:
            raise AssertionError("fixture organization disappeared")
        tenant = FixtureTenant(organization_id=organization_id, user_id=user_id, organization=organization_row)

        locked = get_company_currency_settings(db, tenant)  # type: ignore[arg-type]
        if not locked.base_currency_locked:
            raise AssertionError("posted journal did not lock base/reporting currency")
        if locked.accounting_currency != "AUD":
            raise AssertionError("legacy mismatch fixture was not applied")

        try:
            update_company_currency_settings(
                CompanyCurrencySettingsUpdate(base_currency="EUR", default_client_currency="AUD"),
                req("PATCH", "/company-settings/currencies"),
                db,
                tenant,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            if exc.status_code != 409:
                raise AssertionError(f"wrong status for locked base currency change: {exc.status_code}") from exc
            db.rollback()
        else:
            raise AssertionError("base/reporting currency changed after posted accounting entries")

        repaired = update_company_currency_settings(
            CompanyCurrencySettingsUpdate(base_currency="USD", default_client_currency="GBP"),
            req("PATCH", "/company-settings/currencies"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if repaired.base_currency != "USD" or repaired.accounting_currency != "USD":
            raise AssertionError("same-base save did not repair legacy accounting currency mismatch")
        if repaired.default_client_currency != "GBP":
            raise AssertionError("locked base currency prevented safe client-default update")
        if not repaired.base_currency_locked:
            raise AssertionError("currency lock disappeared after safe update")
    finally:
        db.close()

    print("company currency roles, alignment and posted-ledger lock verification passed")


if __name__ == "__main__":
    main()
