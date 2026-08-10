from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.roles import (
    MEMBERSHIP_ROLE_ADMIN,
    ORGANIZATION_STATUS_ACTIVE,
    SYSTEM_ROLE_SUPER_ADMIN,
)
from app.core.security import decode_token
from app.db.session import get_db
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import OrganizationRole
from app.models.user import User
from app.tenancy.context import TenantContext

bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = decode_token(credentials.credentials, "access")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is inactive or no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_super_admin(current_user: CurrentUser) -> User:
    if current_user.system_role != SYSTEM_ROLE_SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required",
        )
    return current_user


CurrentSuperAdmin = Annotated[User, Depends(get_current_super_admin)]


def get_tenant_context(
    db: DbSession,
    current_user: CurrentUser,
    organization_id: Annotated[str | None, Header(alias="X-Organization-ID")] = None,
) -> TenantContext:
    if not organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Organization-ID header is required",
        )

    row = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(
            Membership.organization_id == organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active",
        )
    ).first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found or access denied",
        )

    membership, organization = row
    if organization.status != ORGANIZATION_STATUS_ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This company workspace is suspended",
        )

    return TenantContext(
        user=current_user,
        organization=organization,
        membership=membership,
    )


CurrentTenant = Annotated[TenantContext, Depends(get_tenant_context)]


def get_current_tenant_admin(tenant: CurrentTenant) -> TenantContext:
    if tenant.role != MEMBERSHIP_ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Company admin access required",
        )
    return tenant


CurrentTenantAdmin = Annotated[TenantContext, Depends(get_current_tenant_admin)]


def require_tenant_permission(permission: str):
    """Return a FastAPI dependency enforcing an organization role permission."""

    def checker(db: DbSession, tenant: CurrentTenant) -> TenantContext:
        role = db.scalar(
            select(OrganizationRole).where(
                OrganizationRole.id == tenant.membership.role_id,
                OrganizationRole.organization_id == tenant.organization_id,
                OrganizationRole.is_active.is_(True),
            )
        )
        if role is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company role is inactive")
        if "*" not in role.permissions and permission not in role.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission}",
            )
        return tenant

    return checker
