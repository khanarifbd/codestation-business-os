from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.roles import MEMBERSHIP_ROLE_ADMIN
from app.models.membership import Membership
from app.models.team import OrganizationRole
from app.tenancy.context import TenantContext


def _actor_role(db: Session, tenant: TenantContext) -> OrganizationRole | None:
    membership = getattr(tenant, "membership", None)
    role_id = getattr(membership, "role_id", None)
    if not role_id:
        membership_id = getattr(tenant, "membership_id", None)
        if membership_id:
            role_id = db.scalar(
                select(Membership.role_id).where(
                    Membership.id == membership_id,
                    Membership.organization_id == tenant.organization_id,
                    Membership.status == "active",
                )
            )
    if not role_id:
        return None
    return db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == role_id,
            OrganizationRole.organization_id == tenant.organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )


def delegated_role_is_grantable(
    *,
    role_slug: str,
    role_permissions: Iterable[str],
    actor_permissions: Iterable[str],
) -> bool:
    """Return whether a delegated inviter may grant a target role.

    The built-in employee/user role is safe once the actor already has
    employees.invite. Admin/wildcard roles are never delegable. A custom role is
    grantable only when it cannot add a permission the inviter does not hold.
    """

    target = set(role_permissions)
    actor = set(actor_permissions)
    if role_slug == "user":
        return True
    if role_slug == "admin" or "*" in target:
        return False
    return target.issubset(actor)


def grantable_employee_roles(db: Session, tenant: TenantContext) -> list[OrganizationRole]:
    """Roles this actor may assign through delegated employee-invite flows."""

    roles = db.scalars(
        select(OrganizationRole)
        .where(
            OrganizationRole.organization_id == tenant.organization_id,
            OrganizationRole.is_active.is_(True),
        )
        .order_by(OrganizationRole.is_system.desc(), OrganizationRole.name.asc())
    ).all()
    if tenant.role == MEMBERSHIP_ROLE_ADMIN:
        return list(roles)

    actor = _actor_role(db, tenant)
    actor_permissions = set(actor.permissions or []) if actor else set()
    if "*" in actor_permissions:
        return list(roles)

    return [
        role
        for role in roles
        if delegated_role_is_grantable(
            role_slug=role.slug,
            role_permissions=role.permissions or [],
            actor_permissions=actor_permissions,
        )
    ]


def ensure_grantable_employee_role(db: Session, tenant: TenantContext, role_id: str) -> OrganizationRole:
    role = next((item for item in grantable_employee_roles(db, tenant) if item.id == role_id), None)
    if role is None:
        raise HTTPException(status_code=403, detail="You cannot assign this employee role")
    return role
