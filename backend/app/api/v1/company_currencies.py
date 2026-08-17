from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import CurrentTenantAdmin, DbSession
from app.models.accounting import JournalEntry
from app.models.company_defaults import OrganizationSystemDefaults
from app.models.company_settings import OrganizationFinancialSettings
from app.services.activity_log import record_activity
from app.services.functional_currency import (
    change_functional_currency,
    current_functional_currency_period,
    earliest_functional_currency_change_date,
    ensure_initial_functional_currency_period,
    list_functional_currency_periods,
)

router = APIRouter(prefix="/company-settings/currencies", tags=["Company Settings"])


class CompanyFunctionalCurrencyPeriodRead(BaseModel):
    id: str
    currency: str
    effective_from: date
    effective_to: date | None
    previous_currency: str | None
    transition_rate: Decimal | None
    reason: str | None
    transition_journal_entry_id: str | None


class CompanyCurrencySettingsRead(BaseModel):
    accounting_currency: str
    reporting_currency: str
    default_client_currency: str | None
    accounting_currency_locked: bool
    accounting_currency_lock_reason: str | None
    accounting_currency_change_earliest_date: date | None
    functional_currency_periods: list[CompanyFunctionalCurrencyPeriodRead]


class CompanyCurrencySettingsUpdate(BaseModel):
    accounting_currency: str = Field(min_length=3, max_length=3)
    reporting_currency: str = Field(min_length=3, max_length=3)
    default_client_currency: str | None = Field(default=None, min_length=3, max_length=3)


class AccountingCurrencyChangeRequest(BaseModel):
    new_currency: str = Field(min_length=3, max_length=3)
    effective_date: date
    transition_rate: Decimal | None = Field(default=None, gt=0)
    reason: str = Field(min_length=3, max_length=500)


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


def _period_read(item) -> CompanyFunctionalCurrencyPeriodRead:
    return CompanyFunctionalCurrencyPeriodRead(
        id=item.id,
        currency=item.currency.upper(),
        effective_from=item.effective_from,
        effective_to=item.effective_to,
        previous_currency=item.previous_currency.upper() if item.previous_currency else None,
        transition_rate=item.transition_rate,
        reason=item.reason,
        transition_journal_entry_id=item.transition_journal_entry_id,
    )


def _read(db: DbSession, tenant: CurrentTenantAdmin) -> CompanyCurrencySettingsRead:
    financial, defaults = _settings_rows(db, tenant.organization_id)
    current_period = current_functional_currency_period(db, tenant.organization_id)
    locked = _accounting_currency_locked(db, tenant.organization_id)
    accounting_currency = current_period.currency.upper()
    periods = list_functional_currency_periods(db, tenant.organization_id)
    return CompanyCurrencySettingsRead(
        accounting_currency=accounting_currency,
        reporting_currency=financial.reporting_currency.upper(),
        default_client_currency=(defaults.default_client_currency.upper() if defaults.default_client_currency else None),
        accounting_currency_locked=locked,
        accounting_currency_lock_reason=(
            "Posted journal entries exist, so the current functional currency cannot be relabeled directly. "
            "Use Change accounting currency to start a new effective-dated functional-currency period; "
            "historical journals stay in their original currency. Reporting and client currencies remain editable."
            if locked
            else None
        ),
        accounting_currency_change_earliest_date=earliest_functional_currency_change_date(
            db, tenant.organization_id
        ) if locked else None,
        functional_currency_periods=[_period_read(item) for item in periods],
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
    period = ensure_initial_functional_currency_period(db, organization, tenant.user_id)

    requested_accounting = payload.accounting_currency.upper()
    requested_reporting = payload.reporting_currency.upper()
    requested_client = payload.default_client_currency.upper() if payload.default_client_currency else None
    current_accounting = period.currency.upper()

    if requested_accounting != current_accounting and _accounting_currency_locked(db, tenant.organization_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Accounting/functional currency cannot be directly relabeled from {current_accounting} to "
                f"{requested_accounting} after journals have been posted. Use Change accounting currency "
                "to create a new effective-dated functional-currency period."
            ),
        )

    before = {
        "accounting_currency": current_accounting,
        "stored_accounting_currency": financial.accounting_currency.upper(),
        "reporting_currency": financial.reporting_currency.upper(),
        "default_client_currency": defaults.default_client_currency,
    }

    # Before any journal exists, changing the setup currency simply corrects the
    # initial period. Once journals exist, the dedicated transition endpoint is
    # required and historical periods are never rewritten.
    if requested_accounting != current_accounting:
        period.currency = requested_accounting
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


@router.post("/change-accounting", response_model=CompanyCurrencySettingsRead)
def change_accounting_currency(
    payload: AccountingCurrencyChangeRequest,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> CompanyCurrencySettingsRead:
    organization = tenant.organization
    financial, _ = _settings_rows(db, tenant.organization_id)
    ensure_initial_functional_currency_period(db, organization, tenant.user_id)
    before_currency = current_functional_currency_period(db, tenant.organization_id).currency.upper()
    before_financial_currency = financial.accounting_currency.upper()

    result = change_functional_currency(
        db,
        organization=organization,
        user_id=tenant.user_id,
        new_currency=payload.new_currency,
        effective_date=payload.effective_date,
        transition_rate=payload.transition_rate,
        reason=payload.reason,
    )

    record_activity(
        db,
        action="company.accounting_currency.changed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="organization_functional_currency_period",
        entity_id=result.period_id,
        before={
            "accounting_currency": before_currency,
            "financial_accounting_currency": before_financial_currency,
        },
        after={
            "accounting_currency": result.new_currency,
            "effective_date": result.effective_date.isoformat(),
            "transition_rate": str(result.transition_rate) if result.transition_rate is not None else None,
            "transition_journal_entry_id": result.transition_journal_entry_id,
            "opening_debit": str(result.opening_debit),
            "opening_credit": str(result.opening_credit),
        },
        metadata={
            "previous_currency": result.previous_currency,
            "reason": payload.reason.strip(),
            "operational_sync_counts": result.synced_counts,
        },
        message=(
            f"Accounting functional currency changed from {result.previous_currency} "
            f"to {result.new_currency} effective {result.effective_date.isoformat()}"
        ),
        request=request,
    )
    db.commit()
    db.refresh(organization)
    return _read(db, tenant)
