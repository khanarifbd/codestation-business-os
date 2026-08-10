from sqlalchemy import select

from app.core.roles import MEMBERSHIP_ROLE_ADMIN, MEMBERSHIP_ROLE_CLIENT, MEMBERSHIP_ROLE_USER
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.client_access import ClientMembership
from app.models.crm import Client
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import Employee
from app.models.user import User
from app.services.membership_relationships import membership_relationships, primary_relationship
from app.services.team import ensure_system_roles


def main() -> None:
    with SessionLocal() as db:
        organization = db.scalar(
            select(Organization)
            .where(Organization.name == "Existing Tenant Fixture")
            .order_by(Organization.created_at.desc())
            .limit(1)
        )
        if organization is None:
            raise AssertionError("existing tenant fixture missing")

        roles = ensure_system_roles(db, organization)
        client_role = roles.get("client")
        if client_role is None or client_role.permissions:
            raise AssertionError("client system role must exist with no staff permissions")

        # The CI migration fixture is inserted after migration 0008 and therefore
        # intentionally has no membership/role rows at seed time. Create its owner
        # membership here to verify the new ownership relationship semantics.
        owner_membership = db.scalar(
            select(Membership).where(
                Membership.organization_id == organization.id,
                Membership.user_id == organization.created_by_user_id,
            )
        )
        if owner_membership is None:
            owner_membership = Membership(
                organization_id=organization.id,
                user_id=organization.created_by_user_id,
                role_id=roles["admin"].id,
                role=MEMBERSHIP_ROLE_ADMIN,
                status="active",
                is_owner=True,
            )
            db.add(owner_membership)
            db.flush()
        else:
            owner_membership.is_owner = True
            db.flush()

        owner_relationships = membership_relationships(db, owner_membership)
        if "owner" not in owner_relationships:
            raise AssertionError(f"owner relationship missing: {owner_relationships}")

        client = db.scalar(
            select(Client)
            .where(Client.organization_id == organization.id)
            .order_by(Client.created_at.asc())
            .limit(1)
        )
        if client is None:
            raise AssertionError("client fixture missing")

        email = "multi.relationship.fixture@codestation.example"
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                full_name="Multi Relationship Fixture",
                password_hash=hash_password("fixture-password-123"),
            )
            db.add(user)
            db.flush()

        membership = db.scalar(
            select(Membership).where(
                Membership.organization_id == organization.id,
                Membership.user_id == user.id,
            )
        )
        if membership is None:
            membership = Membership(
                organization_id=organization.id,
                user_id=user.id,
                role_id=client_role.id,
                role=MEMBERSHIP_ROLE_CLIENT,
                status="active",
                is_owner=False,
            )
            db.add(membership)
            db.flush()

        access = db.scalar(
            select(ClientMembership).where(
                ClientMembership.organization_id == organization.id,
                ClientMembership.client_id == client.id,
                ClientMembership.membership_id == membership.id,
            )
        )
        if access is None:
            access = ClientMembership(
                organization_id=organization.id,
                client_id=client.id,
                membership_id=membership.id,
                is_primary_contact=True,
                status="active",
                created_by_user_id=organization.created_by_user_id,
            )
            db.add(access)
            db.flush()

        client_relationships = membership_relationships(db, membership)
        if client_relationships != ["client"] or primary_relationship(client_relationships) != "client":
            raise AssertionError(f"client-only relationship resolution failed: {client_relationships}")

        employee = db.scalar(
            select(Employee).where(
                Employee.organization_id == organization.id,
                Employee.membership_id == membership.id,
            )
        )
        if employee is None:
            employee = Employee(
                organization_id=organization.id,
                membership_id=membership.id,
                employee_code=f"REL-{user.id[:8]}",
                work_email=user.email,
                employment_type="full_time",
                employment_status="active",
            )
            db.add(employee)
            membership.role_id = roles["user"].id
            membership.role = MEMBERSHIP_ROLE_USER
            db.flush()

        combined = membership_relationships(db, membership)
        if "employee" not in combined or "client" not in combined:
            raise AssertionError(f"employee + client coexistence failed: {combined}")
        if primary_relationship(combined) != "employee":
            raise AssertionError(f"employee should be the primary staff relationship: {combined}")

        db.rollback()

    print("multi-org relationship verification passed: ownership, client isolation, employee+client coexist")


if __name__ == "__main__":
    main()
