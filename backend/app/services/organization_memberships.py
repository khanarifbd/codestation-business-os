from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.client_access import ClientMembership
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import Employee, OrganizationRole
from app.schemas.organization import OrganizationMembershipRead, OrganizationRead
from app.services.membership_relationships import (
    RELATIONSHIP_CLIENT,
    RELATIONSHIP_EMPLOYEE,
    RELATIONSHIP_MEMBER,
    RELATIONSHIP_OWNER,
    primary_relationship,
)


def _relationships(
    membership: Membership,
    *,
    employee_exists: bool,
    client_exists: bool,
) -> list[str]:
    relationships: list[str] = []
    if membership.is_owner:
        relationships.append(RELATIONSHIP_OWNER)
    if employee_exists:
        relationships.append(RELATIONSHIP_EMPLOYEE)
    if client_exists:
        relationships.append(RELATIONSHIP_CLIENT)
    return relationships or [RELATIONSHIP_MEMBER]


def list_user_organization_memberships(
    db: Session,
    user_id: str,
) -> list[OrganizationMembershipRead]:
    """Load every active membership for one user in one organization-scoped query.

    Relationship flags are correlated EXISTS expressions so adding more workspaces
    does not add per-workspace role/employee/client queries. The role join also
    provides permissions for dashboard bootstrap without weakening backend RBAC.
    """

    employee_exists = (
        select(Employee.id)
        .where(
            Employee.organization_id == Membership.organization_id,
            Employee.membership_id == Membership.id,
            Employee.employment_status == "active",
        )
        .exists()
        .correlate(Membership)
    )
    client_exists = (
        select(ClientMembership.id)
        .where(
            ClientMembership.organization_id == Membership.organization_id,
            ClientMembership.membership_id == Membership.id,
            ClientMembership.status == "active",
        )
        .exists()
        .correlate(Membership)
    )

    rows = db.execute(
        select(
            Membership,
            Organization,
            OrganizationRole,
            employee_exists.label("employee_exists"),
            client_exists.label("client_exists"),
        )
        .join(Organization, Organization.id == Membership.organization_id)
        .outerjoin(
            OrganizationRole,
            and_(
                OrganizationRole.id == Membership.role_id,
                OrganizationRole.organization_id == Membership.organization_id,
            ),
        )
        .where(Membership.user_id == user_id, Membership.status == "active")
        .order_by(Organization.name.asc())
    ).all()

    result: list[OrganizationMembershipRead] = []
    for membership, organization, role, has_employee, has_client in rows:
        relationships = _relationships(
            membership,
            employee_exists=bool(has_employee),
            client_exists=bool(has_client),
        )
        result.append(
            OrganizationMembershipRead(
                organization=OrganizationRead.model_validate(organization),
                membership_id=membership.id,
                role_id=membership.role_id,
                role=membership.role,
                role_name=role.name if role else membership.role.title(),
                role_slug=role.slug if role else membership.role,
                status=membership.status,
                is_owner=membership.is_owner,
                relationships=relationships,
                primary_relationship=primary_relationship(relationships),
                permissions=[] if role is None else sorted(set(role.permissions or [])),
            )
        )
    return result
