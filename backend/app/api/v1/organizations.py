import re
import unicodedata

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DbSession
from app.models.common import new_uuid
from app.models.membership import Membership
from app.models.organization import Organization
from app.schemas.organization import (
    OrganizationCreate,
    OrganizationMembershipRead,
    OrganizationRead,
)

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


def _membership_response(organization: Organization, membership: Membership) -> OrganizationMembershipRead:
    return OrganizationMembershipRead(
        organization=OrganizationRead.model_validate(organization),
        role=membership.role,
        status=membership.status,
    )


@router.post("", response_model=OrganizationMembershipRead, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> OrganizationMembershipRead:
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

    membership = Membership(
        organization_id=organization.id,
        user_id=current_user.id,
        role="owner",
        status="active",
    )
    db.add(membership)
    db.commit()
    db.refresh(organization)
    db.refresh(membership)
    return _membership_response(organization, membership)


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
    return [_membership_response(organization, membership) for membership, organization in rows]


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
    return _membership_response(organization, membership)
