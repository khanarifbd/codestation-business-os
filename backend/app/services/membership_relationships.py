from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.client_access import ClientMembership
from app.models.membership import Membership
from app.models.team import Employee, OrganizationRole

RELATIONSHIP_OWNER = "owner"
RELATIONSHIP_EMPLOYEE = "employee"
RELATIONSHIP_CLIENT = "client"
RELATIONSHIP_MEMBER = "member"


def membership_relationships(db: Session, membership: Membership) -> list[str]:
    relationships: list[str] = []
    if membership.is_owner:
        relationships.append(RELATIONSHIP_OWNER)

    employee_exists = db.scalar(
        select(Employee.id)
        .where(
            Employee.organization_id == membership.organization_id,
            Employee.membership_id == membership.id,
            Employee.employment_status == "active",
        )
        .limit(1)
    )
    if employee_exists is not None:
        relationships.append(RELATIONSHIP_EMPLOYEE)

    client_exists = db.scalar(
        select(ClientMembership.id)
        .where(
            ClientMembership.organization_id == membership.organization_id,
            ClientMembership.membership_id == membership.id,
            ClientMembership.status == "active",
        )
        .limit(1)
    )
    if client_exists is not None:
        relationships.append(RELATIONSHIP_CLIENT)

    return relationships or [RELATIONSHIP_MEMBER]


def primary_relationship(relationships: list[str]) -> str:
    for relationship in (RELATIONSHIP_OWNER, RELATIONSHIP_EMPLOYEE, RELATIONSHIP_CLIENT):
        if relationship in relationships:
            return relationship
    return RELATIONSHIP_MEMBER


def membership_role(db: Session, membership: Membership) -> OrganizationRole | None:
    return db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == membership.role_id,
            OrganizationRole.organization_id == membership.organization_id,
        )
    )
