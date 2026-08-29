import re
import unicodedata

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DbSession
from app.core.roles import (
    MEMBERSHIP_ROLE_ADMIN,
    SUBSCRIPTION_STATUS_ACTIVE,
    SYSTEM_ROLE_SUPER_ADMIN,
)
from app.models.common import new_uuid, utc_now
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.subscription import Subscription
from app.models.team import Employee
from app.schemas.organization import (
    OrganizationCreate,
    OrganizationMembershipRead,
    OrganizationRead,
)
from app.services.activity_log import record_activity
from app.services.company_settings import ensure_company_settings_defaults
from app.services.crm import ensure_crm_defaults
from app.services.expense_defaults import ensure_expense_defaults
from app.services.functional_currency import ensure_initial_functional_currency_period
from app.services.membership_relationships import (
    membership_relationships,
    membership_role,
    primary_relationship,
)
from app.services.team import ensure_system_roles, next_employee_code

router = APIRouter(prefix="/organizations", tags=["Organizations"])


def _slug_base(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return (slug or "company")[:100]


def _unique_slug(db: DbSession, name: str) -> str:
    base = _slug_base(name)
    candidate = base
    if db.scalar(select(Organization.id).where(Organization.slug == candidate)) is None:
        return candidate

    while True:
        candidate = f"{base}-{new_uuid()[:8]}"
        if db.scalar(select(Organization.id).where(Organization.slug == candidate)) is None:
            return candidate


def _membership_response(
    db: DbSession,
    organization: Organization,
    membership: Membership,
) -> OrganizationMembershipRead:
    role = membership_role(db, membership)
    relationships = membership_relationships(db, membership)
    return OrganizationMembershipRead(
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
    )


@router.post("", response_model=OrganizationMembershipRead, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreate,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> OrganizationMembershipRead:
    if current_user.system_role == SYSTEM_ROLE_SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform super admin accounts cannot create tenant workspaces through onboarding",
        )

    organization = Organization(
        name=payload.name.strip(),
        slug=_unique_slug(db, payload.name),
        country_code=payload.country_code.upper(),
        timezone=payload.timezone,
        currency=payload.currency.upper(),
        business_type=payload.business_type.strip() if payload.business_type else None,
        team_size=payload.team_size.strip() if payload.team_size else None,
        financial_year_start_month=payload.financial_year_start_month,
        setup_completed=True,
        created_by_user_id=current_user.id,
    )
    db.add(organization)
    db.flush()

    # The initial period intentionally starts before any normal imported/backdated
    # business history. Future functional-currency changes create new effective-
    # dated periods instead of relabeling this one.
    ensure_initial_functional_currency_period(db, organization, current_user.id)

    roles = ensure_system_roles(db, organization)
    membership = Membership(
        organization_id=organization.id,
        user_id=current_user.id,
        role_id=roles["admin"].id,
        role=MEMBERSHIP_ROLE_ADMIN,
        status="active",
        is_owner=True,
    )
    db.add(membership)
    db.flush()

    subscription = Subscription(
        organization_id=organization.id,
        plan_code="default",
        status=SUBSCRIPTION_STATUS_ACTIVE,
        billing_cycle="monthly",
        current_period_start=utc_now(),
    )
    db.add(subscription)

    # The session intentionally uses autoflush=False. Company defaults create the
    # document sequences (including `lead`), while CRM defaults verify those rows
    # before adding CRM-specific defaults. Flush here so CRM setup can see the
    # pending company defaults and does not enqueue a duplicate lead sequence.
    ensure_company_settings_defaults(db, organization)
    db.flush()
    ensure_crm_defaults(db, organization)
    db.flush()
    expense_defaults_created = ensure_expense_defaults(db, organization)
    db.flush()

    employee = Employee(
        organization_id=organization.id,
        membership_id=membership.id,
        employee_code=next_employee_code(db, organization.id),
        work_email=current_user.email,
        employment_type="full_time",
        employment_status="active",
    )
    db.add(employee)
    db.flush()

    record_activity(
        db,
        action="organization.created",
        scope="tenant",
        actor_user_id=current_user.id,
        organization_id=organization.id,
        entity_type="organization",
        entity_id=organization.id,
        message="Company workspace, roles, settings, CRM defaults, expense defaults and owner employee profile created",
        after={
            "id": organization.id,
            "name": organization.name,
            "slug": organization.slug,
            "country_code": organization.country_code,
            "timezone": organization.timezone,
            "currency": organization.currency,
            "business_type": organization.business_type,
            "team_size": organization.team_size,
            "status": organization.status,
            "membership_role": membership.role,
            "organization_role_id": membership.role_id,
            "is_owner": membership.is_owner,
            "relationships": ["owner", "employee"],
            "employee_code": employee.employee_code,
            "subscription_plan": subscription.plan_code,
            "subscription_status": subscription.status,
            "company_master_settings": "initialized",
            "crm_defaults": "initialized",
            "expense_defaults": "initialized",
            "expense_categories_created": expense_defaults_created,
            "functional_currency_history": "initialized",
        },
        request=request,
    )

    db.commit()
    db.refresh(organization)
    db.refresh(membership)
    return _membership_response(db, organization, membership)


@router.get("", response_model=list[OrganizationMembershipRead])
def list_organizations(
    db: DbSession,
    current_user: CurrentUser,
) -> list[OrganizationMembershipRead]:
    rows = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(Membership.user_id == current_user.id, Membership.status == "active")
        .order_by(Organization.name.asc())
    ).all()
    return [_membership_response(db, organization, membership) for membership, organization in rows]


@router.get("/{organization_id}", response_model=OrganizationMembershipRead)
def get_organization(
    organization_id: str,
    db: DbSession,
    current_user: CurrentUser,
) -> OrganizationMembershipRead:
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    membership, organization = row
    return _membership_response(db, organization, membership)
