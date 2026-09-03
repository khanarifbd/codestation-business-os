from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.membership import Membership
from app.models.projects import Project, ProjectMember
from app.models.team import Employee, OrganizationRole
from app.tenancy.context import TenantContext

PROJECT_TABS = (
    "overview",
    "milestones",
    "tasks",
    "work",
    "documents",
    "credentials",
    "team",
    "review_tips",
)
ALL_PROJECT_TABS = frozenset(PROJECT_TABS)
DEFAULT_MEMBER_TABS = ("overview", "milestones", "tasks", "work", "documents", "team")
DEFAULT_MEMBER_TAB_SET = frozenset(DEFAULT_MEMBER_TABS)


@dataclass(frozen=True)
class ProjectAccess:
    current_employee_id: str | None
    member: ProjectMember | None
    allowed_tabs: frozenset[str]
    can_manage_project: bool
    is_project_manager: bool
    has_broad_view: bool


def role_permissions(db: Session, tenant: TenantContext) -> set[str]:
    role = db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == tenant.membership.role_id,
            OrganizationRole.organization_id == tenant.organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )
    return set(role.permissions or []) if role else set()


def employee_for_user(db: Session, tenant: TenantContext) -> Employee | None:
    return db.scalar(
        select(Employee)
        .join(Membership, Membership.id == Employee.membership_id)
        .where(
            Employee.organization_id == tenant.organization_id,
            Membership.organization_id == tenant.organization_id,
            Membership.user_id == tenant.user_id,
            Membership.status == "active",
            Employee.employment_status == "active",
        )
    )


def member_for_employee(db: Session, project: Project, employee_id: str | None) -> ProjectMember | None:
    if not employee_id:
        return None
    return db.scalar(
        select(ProjectMember).where(
            ProjectMember.organization_id == project.organization_id,
            ProjectMember.project_id == project.id,
            ProjectMember.employee_id == employee_id,
            ProjectMember.is_active.is_(True),
        )
    )


def normalize_tabs(values: list[str] | tuple[str, ...] | set[str] | None) -> frozenset[str]:
    return frozenset(value for value in (values or []) if value in ALL_PROJECT_TABS)


def ordered_tabs(values: list[str] | tuple[str, ...] | set[str] | frozenset[str] | None) -> list[str]:
    normalized = normalize_tabs(values)
    return [tab for tab in PROJECT_TABS if tab in normalized]


def project_access(db: Session, tenant: TenantContext, project: Project) -> ProjectAccess:
    permissions = role_permissions(db, tenant)
    can_manage = "*" in permissions or "projects.manage" in permissions
    broad_view = can_manage or "projects.view" in permissions
    employee = employee_for_user(db, tenant)
    member = member_for_employee(db, project, employee.id if employee else None)
    is_manager = bool(employee and project.project_manager_employee_id == employee.id)

    if broad_view or is_manager:
        allowed = ALL_PROJECT_TABS
    elif "projects.work" in permissions and member is not None:
        allowed = normalize_tabs(member.tab_permissions)
    else:
        allowed = frozenset()

    return ProjectAccess(
        current_employee_id=employee.id if employee else None,
        member=member,
        allowed_tabs=allowed,
        can_manage_project=can_manage,
        is_project_manager=is_manager,
        has_broad_view=broad_view,
    )


def require_project_access(db: Session, tenant: TenantContext, project: Project) -> ProjectAccess:
    access = project_access(db, tenant, project)
    if not access.allowed_tabs:
        # Keep worker-scoped projects non-enumerable outside the assigned team.
        raise HTTPException(status_code=404, detail="Project not found")
    return access


def require_project_tab(
    db: Session,
    tenant: TenantContext,
    project: Project,
    tab: str,
) -> ProjectAccess:
    if tab not in ALL_PROJECT_TABS:
        raise ValueError(f"Unknown project tab: {tab}")
    access = require_project_access(db, tenant, project)
    if tab not in access.allowed_tabs:
        raise HTTPException(status_code=403, detail=f"Project tab access required: {tab}")
    return access
