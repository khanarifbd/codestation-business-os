from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import CurrentTenantAdmin, DbSession
from app.models.accounting import JournalEntry
from app.models.company_defaults import OrganizationSystemDefaults
from app.models.company_settings import OrganizationFinancialSettings
from app.services.activity_log import record_activity

router = APIRouter(prefix="/company-settings/currencies", tags=["Company Settings"])


class CompanyCurrencySettingsRead(BaseModel):
    accounting_currency: str
    reporting_currency: str
    default_client_currency: str | None
    accounting_currency_locked: bool
    accounting_currency_lock_reason: str | None


class CompanyCurrencySettingsUpdate(BaseModel):
    accounting_currency: str = Field(min_length=3, max_length=3)
    reporting_currency: str = Field(min_length=3, max_length=3)
    default_client_currency: str | None = Field(default=None, min_length=3, max_length=3)


def _settings_rows(db: DbSession, organization_id: str):
    financial = db.scalar(
        select(OrganizationFinancialSettings).where(
            OrganizationFinancialSettings.organization_id == organization_id
        )
    )
    defaults = db.scalar(
        select(OrganizationSystemDefaults).where(
            OrganizationSystemDefaults.organization_id == organization_id
        )
    )
    if financial is None or defaults is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Company currency settings are incomplete. Run the latest database migrations.",
        )
    return financial, defaults


def _accounting_currency_locked(db: DbSession, organization_id: str) -> bool:
    return db.scalar(
        select(JournalEntry.id)
        .where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.status == "posted",
        )
        .limit(1)
    ) is not None


def _read(db: DbSession, tenant: CurrentTenantAdmin) -> CompanyCurrencySettingsRead:
    financial, defaults = _settings_rows(db, tenant.organization_id)
    locked = _accounting_currency_locked(db, tenant.organization_id)
    accounting_currency = tenant.organization.currency.upper()
    return CompanyCurrencySettingsRead(
        accounting_currency=accounting_currency,
        reporting_currency=financial.reporting_currency.upper(),
        default_client_currency=(defaults.default_client_currency.upper() if defaults.default_client_currency else None),
        accounting_currency_locked=locked,
        accounting_currency_lock_reason=(
            "Accounting/functional currency is locked because posted journal entries already exist. "
            "Changing the ledger currency requires a controlled accounting-currency migration; "
            "reporting and client currencies can still be changed at any time."
            if locked
            else None
        ),
    )


@router.get("", response_model=CompanyCurrencySettingsRead)
def get_company_currency_settings(
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> CompanyCurrencySettingsRead:
    return _read(db, tenant)


@router.patch("", response_model=CompanyCurrencySettingsRead)
def update_company_currency_settings(
    payload: CompanyCurrencySettingsUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> CompanyCurrencySettingsRead:
    organization = tenant.organization
    financial, defaults = _settings_rows(db, tenant.organization_id)

    requested_accounting = payload.accounting_currency.upper()
    requested_reporting = payload.reporting_currency.upper()
    requested_client = payload.default_client_currency.upper() if payload.default_client_currency else None
    current_accounting = organization.currency.upper()

    if requested_accounting != current_accounting and _accounting_currency_locked(db, tenant.organization_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Accounting/functional currency cannot be changed from {current_accounting} to "
                f"{requested_accounting} after posted journal entries exist. Change Reporting currency "
                "for presentation, or run a controlled accounting-currency migration."
            ),
        )

    before = {
        "accounting_currency": current_accounting,
        "stored_accounting_currency": financial.accounting_currency.upper(),
        "reporting_currency": financial.reporting_currency.upper(),
        "default_client_currency": defaults.default_client_currency,
    }

    # Organization.currency remains the canonical functional/accounting base used
    # by journal posting. Keep the duplicate financial setting aligned for existing
    # contracts, but reporting currency is intentionally independent.
    organization.currency = requested_accounting
    financial.accounting_currency = requested_accounting
    financial.reporting_currency = requested_reporting
    defaults.default_client_currency = requested_client
    db.flush()

    after = {
        "accounting_currency": organization.currency,
        "reporting_currency": financial.reporting_currency,
        "default_client_currency": defaults.default_client_currency,
    }
    record_activity(
        db,
        action="company.currencies.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="organization",
        entity_id=tenant.organization_id,
        before=before,
        after=after,
        message="Company accounting, reporting and client currency roles updated",
        request=request,
    )
    db.commit()
    db.refresh(organization)
    db.refresh(financial)
    db.refresh(defaults)
    return _read(db, tenant)
