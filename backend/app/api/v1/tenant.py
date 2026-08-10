from fastapi import APIRouter, Request

from app.api.dependencies import CurrentTenant, DbSession
from app.schemas.organization import OrganizationRead
from app.schemas.tenant import TenantContextRead
from app.services.activity_log import record_activity
from app.services.membership_relationships import (
    membership_relationships,
    membership_role,
    primary_relationship,
)

router = APIRouter(prefix="/tenant", tags=["Tenant Context"])


def _tenant_response(db: DbSession, tenant: CurrentTenant) -> TenantContextRead:
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


@router.get("/context", response_model=TenantContextRead)
def get_current_tenant(db: DbSession, tenant: CurrentTenant) -> TenantContextRead:
    return _tenant_response(db, tenant)


@router.post("/switch", response_model=TenantContextRead)
def switch_tenant(request: Request, db: DbSession, tenant: CurrentTenant) -> TenantContextRead:
    response = _tenant_response(db, tenant)
    record_activity(
        db,
        action="tenant.switched",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="membership",
        entity_id=tenant.membership_id,
        message=f"Workspace switched to {tenant.organization.name}",
        after={
            "organization_id": tenant.organization_id,
            "organization_name": tenant.organization.name,
            "membership_id": tenant.membership_id,
            "role_id": tenant.membership.role_id,
            "role": tenant.membership.role,
            "is_owner": tenant.membership.is_owner,
            "relationships": response.relationships,
            "primary_relationship": response.primary_relationship,
        },
        request=request,
    )
    db.commit()
    return response
