from fastapi import APIRouter

from app.api.dependencies import CurrentTenant
from app.schemas.organization import OrganizationRead
from app.schemas.tenant import TenantContextRead

router = APIRouter(prefix="/tenant", tags=["Tenant Context"])


@router.get("/context", response_model=TenantContextRead)
def get_current_tenant(tenant: CurrentTenant) -> TenantContextRead:
    return TenantContextRead(
        organization=OrganizationRead.model_validate(tenant.organization),
        membership_id=tenant.membership_id,
        role=tenant.membership.role,
        status=tenant.membership.status,
    )
