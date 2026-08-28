from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select

from app.api.dependencies import CurrentSuperAdmin, DbSession
from app.core.roles import (
    ORGANIZATION_STATUS_ACTIVE,
    ORGANIZATION_STATUS_SUSPENDED,
    SYSTEM_ROLE_SUPER_ADMIN,
)
from app.models.common import utc_now
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.organization import OrganizationRead
from app.schemas.platform import (
    OrganizationStatusUpdate,
    PlatformOrganizationDirectoryItem,
    PlatformOrganizationDirectoryPage,
    PlatformOrganizationRead,
    PlatformSummaryRead,
    PlatformUserRead,
    SubscriptionRead,
    SubscriptionUpdate,
    UserStatusUpdate,
)
from app.services.activity_log import record_activity

router = APIRouter(prefix="/platform", tags=["Platform Administration"])


def _user_state(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "system_role": user.system_role,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
    }


def _organization_state(organization: Organization) -> dict:
    return {
        "id": organization.id,
        "name": organization.name,
        "status": organization.status,
        "suspension_reason": organization.suspension_reason,
        "suspended_at": organization.suspended_at,
    }


def _subscription_state(subscription: Subscription) -> dict:
    return {
        "id": subscription.id,
        "organization_id": subscription.organization_id,
        "plan_code": subscription.plan_code,
        "status": subscription.status,
        "billing_cycle": subscription.billing_cycle,
        "trial_ends_at": subscription.trial_ends_at,
        "current_period_start": subscription.current_period_start,
        "current_period_end": subscription.current_period_end,
        "canceled_at": subscription.canceled_at,
    }


@router.get("/summary", response_model=PlatformSummaryRead)
def platform_summary(
    db: DbSession,
    _: CurrentSuperAdmin,
) -> PlatformSummaryRead:
    now = utc_now()
    seven_days_ago = now - timedelta(days=7)
    thirty_days_ago = now - timedelta(days=30)
    seven_days_from_now = now + timedelta(days=7)

    return PlatformSummaryRead(
        total_users=db.scalar(select(func.count()).select_from(User)) or 0,
        active_users=db.scalar(
            select(func.count()).select_from(User).where(User.is_active.is_(True))
        )
        or 0,
        suspended_users=db.scalar(
            select(func.count()).select_from(User).where(User.is_active.is_(False))
        )
        or 0,
        verified_users=db.scalar(
            select(func.count()).select_from(User).where(User.is_verified.is_(True))
        )
        or 0,
        unverified_users=db.scalar(
            select(func.count()).select_from(User).where(User.is_verified.is_(False))
        )
        or 0,
        new_users_7d=db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= seven_days_ago)
        )
        or 0,
        new_users_30d=db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= thirty_days_ago)
        )
        or 0,
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
        setup_incomplete_companies=db.scalar(
            select(func.count()).select_from(Organization).where(
                Organization.status == ORGANIZATION_STATUS_ACTIVE,
                Organization.setup_completed.is_(False),
            )
        )
        or 0,
        new_companies_7d=db.scalar(
            select(func.count()).select_from(Organization).where(
                Organization.created_at >= seven_days_ago
            )
        )
        or 0,
        new_companies_30d=db.scalar(
            select(func.count()).select_from(Organization).where(
                Organization.created_at >= thirty_days_ago
            )
        )
        or 0,
        total_subscriptions=db.scalar(select(func.count()).select_from(Subscription)) or 0,
        trialing_subscriptions=db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.status == "trialing")
        )
        or 0,
        active_subscriptions=db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.status == "active")
        )
        or 0,
        past_due_subscriptions=db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.status == "past_due")
        )
        or 0,
        suspended_subscriptions=db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.status == "suspended")
        )
        or 0,
        canceled_subscriptions=db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.status == "canceled")
        )
        or 0,
        trials_ending_7d=db.scalar(
            select(func.count()).select_from(Subscription).where(
                Subscription.status == "trialing",
                Subscription.trial_ends_at.is_not(None),
                Subscription.trial_ends_at >= now,
                Subscription.trial_ends_at <= seven_days_from_now,
            )
        )
        or 0,
        periods_ending_7d=db.scalar(
            select(func.count()).select_from(Subscription).where(
                Subscription.status.in_(["active", "trialing"]),
                Subscription.current_period_end.is_not(None),
                Subscription.current_period_end >= now,
                Subscription.current_period_end <= seven_days_from_now,
            )
        )
        or 0,
        companies_without_subscription=db.scalar(
            select(func.count())
            .select_from(Organization)
            .outerjoin(Subscription, Subscription.organization_id == Organization.id)
            .where(Subscription.id.is_(None))
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
    request: Request,
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

    before = _user_state(user)
    user.is_active = payload.is_active
    db.flush()
    record_activity(
        db,
        action="platform.user.status_changed",
        scope="platform",
        actor_user_id=current_super_admin.id,
        entity_type="user",
        entity_id=user.id,
        message="Platform user status changed",
        before=before,
        after=_user_state(user),
        request=request,
    )
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


@router.get("/organization-directory", response_model=PlatformOrganizationDirectoryPage)
def platform_organization_directory(
    db: DbSession,
    _: CurrentSuperAdmin,
    q: str | None = Query(default=None, max_length=120),
    organization_status: str | None = Query(default=None),
    subscription_status: str | None = Query(default=None),
    country_code: str | None = Query(default=None, min_length=2, max_length=2),
    setup_completed: bool | None = Query(default=None),
    plan_code: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> PlatformOrganizationDirectoryPage:
    allowed_organization_statuses = {ORGANIZATION_STATUS_ACTIVE, ORGANIZATION_STATUS_SUSPENDED}
    allowed_subscription_statuses = {"trialing", "active", "past_due", "suspended", "canceled", "none"}

    if organization_status and organization_status not in allowed_organization_statuses:
        raise HTTPException(status_code=400, detail="Invalid organization status filter")
    if subscription_status and subscription_status not in allowed_subscription_statuses:
        raise HTTPException(status_code=400, detail="Invalid subscription status filter")

    normalized_query = (q or "").strip()
    normalized_country = (country_code or "").strip().upper() or None
    normalized_plan = (plan_code or "").strip() or None

    conditions = []
    if normalized_query:
        pattern = f"%{normalized_query}%"
        conditions.append(
            or_(
                Organization.name.ilike(pattern),
                Organization.slug.ilike(pattern),
                User.full_name.ilike(pattern),
                User.email.ilike(pattern),
            )
        )
    if organization_status:
        conditions.append(Organization.status == organization_status)
    if subscription_status == "none":
        conditions.append(Subscription.id.is_(None))
    elif subscription_status:
        conditions.append(Subscription.status == subscription_status)
    if normalized_country:
        conditions.append(Organization.country_code == normalized_country)
    if setup_completed is not None:
        conditions.append(Organization.setup_completed.is_(setup_completed))
    if normalized_plan:
        conditions.append(Subscription.plan_code == normalized_plan)

    member_counts = (
        select(
            Membership.organization_id.label("organization_id"),
            func.count(Membership.id).label("member_count"),
            func.count(Membership.id)
            .filter(Membership.status == "active")
            .label("active_member_count"),
        )
        .group_by(Membership.organization_id)
        .subquery()
    )

    base_statement = (
        select(Organization, Subscription, User)
        .join(User, User.id == Organization.created_by_user_id)
        .outerjoin(Subscription, Subscription.organization_id == Organization.id)
    )
    if conditions:
        base_statement = base_statement.where(*conditions)

    total = db.scalar(select(func.count()).select_from(base_statement.subquery())) or 0

    rows = db.execute(
        select(
            Organization,
            Subscription,
            User,
            func.coalesce(member_counts.c.member_count, 0),
            func.coalesce(member_counts.c.active_member_count, 0),
        )
        .join(User, User.id == Organization.created_by_user_id)
        .outerjoin(Subscription, Subscription.organization_id == Organization.id)
        .outerjoin(member_counts, member_counts.c.organization_id == Organization.id)
        .where(*conditions)
        .order_by(Organization.created_at.desc(), Organization.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    country_codes = list(
        db.scalars(select(Organization.country_code).distinct().order_by(Organization.country_code)).all()
    )
    plan_codes = list(
        db.scalars(select(Subscription.plan_code).distinct().order_by(Subscription.plan_code)).all()
    )

    return PlatformOrganizationDirectoryPage(
        items=[
            PlatformOrganizationDirectoryItem(
                organization=OrganizationRead.model_validate(organization),
                subscription=(
                    SubscriptionRead.model_validate(subscription) if subscription is not None else None
                ),
                created_by_email=creator.email,
                created_by_name=creator.full_name,
                member_count=int(member_count or 0),
                active_member_count=int(active_member_count or 0),
                created_at=organization.created_at,
            )
            for organization, subscription, creator, member_count, active_member_count in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
        country_codes=country_codes,
        plan_codes=plan_codes,
    )


@router.patch(
    "/organizations/{organization_id}/status",
    response_model=OrganizationRead,
)
def update_organization_status(
    organization_id: str,
    payload: OrganizationStatusUpdate,
    request: Request,
    db: DbSession,
    current_super_admin: CurrentSuperAdmin,
) -> OrganizationRead:
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    before = _organization_state(organization)
    organization.status = payload.status
    if payload.status == ORGANIZATION_STATUS_SUSPENDED:
        organization.suspended_at = utc_now()
        organization.suspension_reason = payload.reason
    else:
        organization.suspended_at = None
        organization.suspension_reason = None

    db.flush()
    record_activity(
        db,
        action="platform.organization.status_changed",
        scope="platform",
        actor_user_id=current_super_admin.id,
        organization_id=organization.id,
        entity_type="organization",
        entity_id=organization.id,
        message="Company status changed by super admin",
        before=before,
        after=_organization_state(organization),
        request=request,
    )
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
    request: Request,
    db: DbSession,
    current_super_admin: CurrentSuperAdmin,
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

    before = _subscription_state(subscription)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(subscription, field, value)

    if changes.get("status") == "canceled":
        subscription.canceled_at = utc_now()
    elif "status" in changes and changes["status"] != "canceled":
        subscription.canceled_at = None

    db.flush()
    record_activity(
        db,
        action="platform.subscription.updated",
        scope="platform",
        actor_user_id=current_super_admin.id,
        organization_id=organization_id,
        entity_type="subscription",
        entity_id=subscription.id,
        message="Company subscription updated by super admin",
        before=before,
        after=_subscription_state(subscription),
        request=request,
    )
    db.commit()
    db.refresh(subscription)
    return SubscriptionRead.model_validate(subscription)
