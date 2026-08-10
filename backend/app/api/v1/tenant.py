from fastapi import APIRouter

from app.api.dependencies import CurrentTenant, DbSession
from app.schemas.organization import OrganizationRead
from app.schemas.tenant import TenantContextRead
from app.services.membership_relationships import (
    membership_relationships,
    membership_role,
    primary_relationship,
)

router = APIRouter(prefix="/tenant", tags=["Tenant Context"])


@router.get("/context", response_model=TenantContextRead)
def get_current_tenant(db: DbSession, tenant: CurrentTenant) -> TenantContextRead:
    relationships = membership_relationships(db, tenant.membership)
    role = membership_role(db, tenant.membership)
    return TenantContextRead(
        organization=OrganizationRead.model_validate(tenant.organization),
        membership_id=tenant.membership_id,
        role_id=tenant.membership.role_id,
        role=tenant.membership.role,
        role_name=role.name if role else tenant.membership.role.title(),
        role_slug=role.slug if role else tenant.membership.role,
        status=tenant.membership.status,
        is_owner=tenant.membership.is_owner,
        relationships=relationships,
        primary_relationship=primary_relationship(relationships),
    )
