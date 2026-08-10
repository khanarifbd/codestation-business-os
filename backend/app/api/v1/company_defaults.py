from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import CurrentTenantAdmin, DbSession
from app.models.company_defaults import OrganizationSystemDefaults
from app.schemas.company_settings import SystemDefaultsRead, SystemDefaultsUpdate
from app.services.activity_log import record_activity

router = APIRouter(prefix="/company-settings/system-defaults", tags=["Company Settings"])


@router.get("", response_model=SystemDefaultsRead)
def get_system_defaults(
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> SystemDefaultsRead:
    item = db.scalar(
        select(OrganizationSystemDefaults).where(
            OrganizationSystemDefaults.organization_id == tenant.organization_id
        )
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Company system defaults are missing. Run the latest database migrations.",
        )
    return SystemDefaultsRead.model_validate(item)


@router.patch("", response_model=SystemDefaultsRead)
def update_system_defaults(
    payload: SystemDefaultsUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> SystemDefaultsRead:
    item = db.scalar(
        select(OrganizationSystemDefaults).where(
            OrganizationSystemDefaults.organization_id == tenant.organization_id
        )
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Company system defaults are missing. Run the latest database migrations.",
        )

    before = SystemDefaultsRead.model_validate(item).model_dump(mode="json")
    item.default_client_country_code = (
        payload.default_client_country_code.upper()
        if payload.default_client_country_code
        else None
    )
    item.default_client_currency = (
        payload.default_client_currency.upper()
        if payload.default_client_currency
        else None
    )
    item.default_document_language = payload.default_document_language.strip()
    item.default_lead_status = payload.default_lead_status.strip()
    item.default_project_status = payload.default_project_status.strip()
    item.default_order_status = payload.default_order_status.strip()
    item.default_invoice_status = payload.default_invoice_status.strip()
    item.quotation_validity_days = payload.quotation_validity_days
    db.flush()

    after = SystemDefaultsRead.model_validate(item).model_dump(mode="json")
    record_activity(
        db,
        action="company.system_defaults.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="organization_system_defaults",
        entity_id=item.id,
        before=before,
        after=after,
        message="Company system defaults updated",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return SystemDefaultsRead.model_validate(item)
