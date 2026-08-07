from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.dependencies import CurrentSuperAdmin, DbSession
from app.core.roles import (
    ORGANIZATION_STATUS_ACTIVE,
    ORGANIZATION_STATUS_SUSPENDED,
    SYSTEM_ROLE_SUPER_ADMIN,
)
from app.models.common import utc_now
from app.models.organization import Organization
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.organization import OrganizationRead
from app.schemas.platform import (
    OrganizationStatusUpdate,
    PlatformOrganizationRead,
    PlatformSummaryRead,
    PlatformUserRead,
    SubscriptionRead,
    SubscriptionUpdate,
    UserStatusUpdate,
)

router = APIRouter(prefix="/platform", tags=["Platform Administration"])


@router.get("/summary", response_model=PlatformSummaryRead)
def platform_summary(
    db: DbSession,
    _: CurrentSuperAdmin,
) -> PlatformSummaryRead:
    return PlatformSummaryRead(
        total_users=db.scalar(select(func.count()).select_from(User)) or 0,
        total_companies=db.scalar(select(func.count()).select_from(Organization)) or 0,
        active_companies=db.scalar(
            select(func.count()).select_from(Organization).where(
                Organization.status == ORGANIZATION_STATUS_ACTIVE
            )
        )
        or 0,
        suspended_companies=db.scalar(
            select(func.count()).select_from(Organization).where(
                Organization.status == ORGANIZATION_STATUS_SUSPENDED
            )
        )
        or 0,
        trialing_subscriptions=db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.status == "trialing")
        )
        or 0,
        active_subscriptions=db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.status == "active")
        )
        or 0,
    )


@router.get("/users", response_model=list[PlatformUserRead])
def platform_users(
    db: DbSession,
    _: CurrentSuperAdmin,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[PlatformUserRead]:
    users = db.scalars(
        select(User).order_by(User.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return [PlatformUserRead.model_validate(user) for user in users]


@router.patch("/users/{user_id}/status", response_model=PlatformUserRead)
def update_user_status(
    user_id: str,
    payload: UserStatusUpdate,
    db: DbSession,
    current_super_admin: CurrentSuperAdmin,
) -> PlatformUserRead:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.id == current_super_admin.id and not payload.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot suspend your own super admin account",
        )

    if user.system_role == SYSTEM_ROLE_SUPER_ADMIN and not payload.is_active:
        active_super_admins = db.scalar(
            select(func.count()).select_from(User).where(
                User.system_role == SYSTEM_ROLE_SUPER_ADMIN,
                User.is_active.is_(True),
            )
        ) or 0
        if active_super_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one active super admin is required",
            )

    user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return PlatformUserRead.model_validate(user)


@router.get("/organizations", response_model=list[PlatformOrganizationRead])
def platform_organizations(
    db: DbSession,
    _: CurrentSuperAdmin,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[PlatformOrganizationRead]:
    rows = db.execute(
        select(Organization, Subscription, User)
        .join(User, User.id == Organization.created_by_user_id)
        .outerjoin(Subscription, Subscription.organization_id == Organization.id)
        .order_by(Organization.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    return [
        PlatformOrganizationRead(
            organization=OrganizationRead.model_validate(organization),
            subscription=(
                SubscriptionRead.model_validate(subscription) if subscription is not None else None
            ),
            admin_email=admin.email,
            admin_name=admin.full_name,
        )
        for organization, subscription, admin in rows
    ]


@router.patch(
    "/organizations/{organization_id}/status",
    response_model=OrganizationRead,
)
def update_organization_status(
    organization_id: str,
    payload: OrganizationStatusUpdate,
    db: DbSession,
    _: CurrentSuperAdmin,
) -> OrganizationRead:
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    organization.status = payload.status
    if payload.status == ORGANIZATION_STATUS_SUSPENDED:
        organization.suspended_at = utc_now()
        organization.suspension_reason = payload.reason
    else:
        organization.suspended_at = None
        organization.suspension_reason = None

    db.commit()
    db.refresh(organization)
    return OrganizationRead.model_validate(organization)


@router.patch(
    "/organizations/{organization_id}/subscription",
    response_model=SubscriptionRead,
)
def update_subscription(
    organization_id: str,
    payload: SubscriptionUpdate,
    db: DbSession,
    _: CurrentSuperAdmin,
) -> SubscriptionRead:
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    subscription = db.scalar(
        select(Subscription).where(Subscription.organization_id == organization_id)
    )
    if subscription is None:
        subscription = Subscription(organization_id=organization_id)
        db.add(subscription)
        db.flush()

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(subscription, field, value)

    if changes.get("status") == "canceled":
        subscription.canceled_at = utc_now()
    elif "status" in changes and changes["status"] != "canceled":
        subscription.canceled_at = None

    db.commit()
    db.refresh(subscription)
    return SubscriptionRead.model_validate(subscription)
