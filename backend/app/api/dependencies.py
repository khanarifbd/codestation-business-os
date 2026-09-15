from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.roles import (
    MEMBERSHIP_ROLE_ADMIN,
    ORGANIZATION_STATUS_ACTIVE,
    SYSTEM_ROLE_SUPER_ADMIN,
)
from app.core.security import decode_token_claims
from app.db.session import get_db
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import OrganizationRole
from app.models.user import User
from app.models.user_session import UserSession
from app.services.auth_sessions import session_is_active, touch_user_session
from app.services.performance_metrics import (
    PERFORMANCE_PHASE_AUTHENTICATION,
    PERFORMANCE_PHASE_PERMISSION,
    PERFORMANCE_PHASE_TENANT_RESOLUTION,
    track_performance_phase,
)
from app.tenancy.context import TenantContext

bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User:
    with track_performance_phase(PERFORMANCE_PHASE_AUTHENTICATION):
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            claims = decode_token_claims(credentials.credentials, "access")
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(exc),
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

        user_session: UserSession | None = None
        if claims.session_id:
            row = db.execute(
                select(User, UserSession)
                .outerjoin(
                    UserSession,
                    and_(
                        UserSession.id == claims.session_id,
                        UserSession.user_id == User.id,
                    ),
                )
                .where(User.id == claims.user_id)
            ).first()
            if row is None:
                user = None
            else:
                user, user_session = row
        else:
            user = db.get(User, claims.user_id)

        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User is inactive or no longer exists",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if claims.token_version != int(user.auth_token_version or 0):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="This session has been revoked. Sign in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        request.state.auth_session_id = None
        if claims.session_id:
            if user_session is None or not session_is_active(user_session, user=user):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="This session has been revoked or expired. Sign in again.",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            request.state.auth_session_id = user_session.id
            touch_user_session(user_session, request)

        return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_super_admin(current_user: CurrentUser) -> User:
    with track_performance_phase(PERFORMANCE_PHASE_PERMISSION):
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
    with track_performance_phase(PERFORMANCE_PHASE_TENANT_RESOLUTION):
        if not organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Organization-ID header is required",
            )

        row = db.execute(
            select(Membership, Organization, OrganizationRole)
            .join(Organization, Organization.id == Membership.organization_id)
            .outerjoin(
                OrganizationRole,
                and_(
                    OrganizationRole.id == Membership.role_id,
                    OrganizationRole.organization_id == Membership.organization_id,
                ),
            )
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

        membership, organization, organization_role = row
        if organization.status != ORGANIZATION_STATUS_ACTIVE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This company workspace is suspended",
            )

        return TenantContext(
            user=current_user,
            organization=organization,
            membership=membership,
            organization_role=organization_role,
        )


CurrentTenant = Annotated[TenantContext, Depends(get_tenant_context)]


def get_current_tenant_admin(tenant: CurrentTenant) -> TenantContext:
    with track_performance_phase(PERFORMANCE_PHASE_PERMISSION):
        if tenant.role != MEMBERSHIP_ROLE_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Company admin access required",
            )
        return tenant


CurrentTenantAdmin = Annotated[TenantContext, Depends(get_current_tenant_admin)]


def _active_role(db: DbSession, tenant: TenantContext) -> OrganizationRole:
    role = tenant.organization_role
    if role is None:
        # Compatibility fallback for explicitly constructed TenantContext values
        # in scripts/tests. Normal authenticated requests reuse the role loaded by
        # get_tenant_context and do not issue this extra query.
        role = db.scalar(
            select(OrganizationRole).where(
                OrganizationRole.id == tenant.membership.role_id,
                OrganizationRole.organization_id == tenant.organization_id,
            )
        )
    if role is None or not role.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company role is inactive")
    return role


def require_tenant_permission(permission: str):
    """Return a FastAPI dependency enforcing an organization role permission."""

    def checker(db: DbSession, tenant: CurrentTenant) -> TenantContext:
        with track_performance_phase(PERFORMANCE_PHASE_PERMISSION):
            role = _active_role(db, tenant)
            if "*" not in role.permissions and permission not in role.permissions:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission required: {permission}",
                )
            return tenant

    return checker


def require_any_tenant_permission(*permissions: str):
    """Require at least one organization permission without weakening tenant membership checks."""
    required = tuple(dict.fromkeys(permission for permission in permissions if permission))
    if not required:
        raise ValueError("At least one permission is required")

    def checker(db: DbSession, tenant: CurrentTenant) -> TenantContext:
        with track_performance_phase(PERFORMANCE_PHASE_PERMISSION):
            role = _active_role(db, tenant)
            granted = set(role.permissions or [])
            if "*" not in granted and not any(permission in granted for permission in required):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"One of these permissions is required: {', '.join(required)}",
                )
            return tenant

    return checker
