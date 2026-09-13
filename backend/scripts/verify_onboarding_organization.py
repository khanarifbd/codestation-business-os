from uuid import uuid4

from sqlalchemy import func, select
from starlette.requests import Request

from app.api.v1.auth import signup
from app.api.v1.organizations import create_organization, list_organizations
from app.db.session import SessionLocal
from app.models.company_settings import OrganizationDocumentSequence
from app.models.crm import LeadSource, LeadStatus
from app.models.expenses import ExpenseCategory
from app.models.membership import Membership
from app.models.subscription import Subscription
from app.models.team import Employee, OrganizationRole
from app.models.user import User
from app.schemas.auth import SignUpRequest
from app.schemas.organization import OrganizationCreate


def req(method: str, path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "headers": [],
            "query_string": b"",
            "scheme": "https",
            "server": ("testserver", 443),
            "client": ("127.0.0.1", 50000),
        }
    )


def main() -> None:
    marker = uuid4().hex[:10]
    email = f"onboarding-{marker}@example.com"
    db = SessionLocal()
    try:
        signup(
            SignUpRequest(
                email=email,
                full_name=f"Onboarding User {marker}",
                password="CI-onboarding-password-123",
            ),
            req("POST", "/auth/signup"),
            db,
        )
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            raise AssertionError("fresh signup user was not persisted")
        if db.scalar(select(func.count(Membership.id)).where(Membership.user_id == user.id)) != 0:
            raise AssertionError("fresh signup unexpectedly has a tenant membership before onboarding")

        created = create_organization(
            OrganizationCreate(
                name=f"Onboarding Company {marker}",
                country_code="BD",
                timezone="Asia/Dhaka",
                currency="BDT",
                business_type="Software & IT Services",
                team_size="6-10",
                financial_year_start_month=7,
            ),
            req("POST", "/organizations"),
            db,
            user,
        )
        organization_id = created.organization.id

        if not created.is_owner or created.role != "admin":
            raise AssertionError("onboarding owner/admin membership was not created")
        if created.organization.currency != "BDT" or created.organization.financial_year_start_month != 7:
            raise AssertionError("organization onboarding settings were not preserved")

        lead_sequence_count = db.scalar(
            select(func.count(OrganizationDocumentSequence.id)).where(
                OrganizationDocumentSequence.organization_id == organization_id,
                OrganizationDocumentSequence.document_type == "lead",
            )
        ) or 0
        if lead_sequence_count != 1:
            raise AssertionError(f"expected exactly one lead document sequence, got {lead_sequence_count}")

        if (db.scalar(select(func.count(LeadStatus.id)).where(LeadStatus.organization_id == organization_id)) or 0) < 1:
            raise AssertionError("CRM lead status defaults were not created")
        if (db.scalar(select(func.count(LeadSource.id)).where(LeadSource.organization_id == organization_id)) or 0) < 1:
            raise AssertionError("CRM lead source defaults were not created")
        expense_category_count = db.scalar(
            select(func.count(ExpenseCategory.id)).where(ExpenseCategory.organization_id == organization_id)
        ) or 0
        if expense_category_count < 12:
            raise AssertionError(f"expected fresh organization expense defaults, got {expense_category_count} categories")
        if (db.scalar(select(func.count(OrganizationRole.id)).where(OrganizationRole.organization_id == organization_id)) or 0) < 1:
            raise AssertionError("organization roles were not created")

        employee_roles = db.scalars(
            select(OrganizationRole).where(
                OrganizationRole.slug == "user",
                OrganizationRole.is_system.is_(True),
            )
        ).all()
        if not employee_roles:
            raise AssertionError("system employee role was not created")
        for role in employee_roles:
            if "projects.view" in role.permissions:
                raise AssertionError("system employee role still has broad projects.view access")
            if "projects.work" not in role.permissions:
                raise AssertionError("system employee role is missing projects.work access")

        if (db.scalar(select(func.count(Employee.id)).where(Employee.organization_id == organization_id)) or 0) != 1:
            raise AssertionError("owner employee profile was not created")
        if (db.scalar(select(func.count(Subscription.id)).where(Subscription.organization_id == organization_id)) or 0) != 1:
            raise AssertionError("default subscription was not created")

        memberships = list_organizations(db, user)
        if not any(item.organization.id == organization_id for item in memberships):
            raise AssertionError("new organization is missing from the signed-in user's organization list")
    finally:
        db.close()

    print("onboarding verification passed: fresh signup -> company workspace -> defaults -> owner membership")


if __name__ == "__main__":
    main()
