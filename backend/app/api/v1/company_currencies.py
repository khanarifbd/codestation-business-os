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
    base_currency: str
    accounting_currency: str
    default_client_currency: str | None
    base_currency_locked: bool
    base_currency_lock_reason: str | None


class CompanyCurrencySettingsUpdate(BaseModel):
    base_currency: str = Field(min_length=3, max_length=3)
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


def _base_currency_locked(db: DbSession, organization_id: str) -> bool:
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
    locked = _base_currency_locked(db, tenant.organization_id)
    return CompanyCurrencySettingsRead(
        base_currency=tenant.organization.currency.upper(),
        accounting_currency=financial.accounting_currency.upper(),
        default_client_currency=(defaults.default_client_currency.upper() if defaults.default_client_currency else None),
        base_currency_locked=locked,
        base_currency_lock_reason=(
            "Base/reporting currency is locked because posted accounting journal entries already exist. "
            "Changing it would relabel historical ledger amounts without a proper currency migration."
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

    requested_base = payload.base_currency.upper()
    requested_client = payload.default_client_currency.upper() if payload.default_client_currency else None
    current_base = organization.currency.upper()

    if requested_base != current_base and _base_currency_locked(db, tenant.organization_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Base/reporting currency cannot be changed from {current_base} to {requested_base} after posted "
                "accounting entries exist. Historical journals are stored in the current base currency."
            ),
        )

    before = {
        "base_currency": current_base,
        "accounting_currency": financial.accounting_currency.upper(),
        "default_client_currency": defaults.default_client_currency,
    }

    organization.currency = requested_base
    # V1 uses one functional/reporting currency for the double-entry ledger.
    # Original source currencies remain preserved on financial transactions and journal lines.
    financial.accounting_currency = requested_base
    defaults.default_client_currency = requested_client
    db.flush()

    after = {
        "base_currency": organization.currency,
        "accounting_currency": financial.accounting_currency,
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
        message="Company currency roles updated",
        request=request,
    )
    db.commit()
    db.refresh(organization)
    db.refresh(financial)
    db.refresh(defaults)
    return _read(db, tenant)
