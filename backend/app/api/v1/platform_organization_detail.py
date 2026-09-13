from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.dependencies import CurrentSuperAdmin, DbSession
from app.models.activity_log import ActivityLog
from app.models.crm import Client, Lead
from app.models.finance import Invoice
from app.models.membership import Membership
from app.models.orders import Order
from app.models.organization import Organization
from app.models.projects import Project
from app.models.sales import Quotation
from app.models.subscription import Subscription
from app.models.team import Employee, OrganizationRole
from app.models.user import User
from app.schemas.organization import OrganizationRead
from app.schemas.platform import (
    PlatformOrganizationActivityRead,
    PlatformOrganizationDetailRead,
    PlatformOrganizationMemberRead,
    PlatformOrganizationUsageRead,
    SubscriptionRead,
)

router = APIRouter(prefix="/platform", tags=["Platform Organization Detail"])


@router.get(
    "/organizations/{organization_id}/detail",
    response_model=PlatformOrganizationDetailRead,
)
def platform_organization_detail(
    organization_id: str,
    db: DbSession,
    _: CurrentSuperAdmin,
) -> PlatformOrganizationDetailRead:
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    creator = db.get(User, organization.created_by_user_id)
    if creator is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization creator account is unavailable",
        )

    subscription = db.scalar(
        select(Subscription).where(Subscription.organization_id == organization_id)
    )

    member_rows = db.execute(
        select(Membership, User, OrganizationRole)
        .join(User, User.id == Membership.user_id)
        .join(OrganizationRole, OrganizationRole.id == Membership.role_id)
        .where(Membership.organization_id == organization_id)
        .order_by(
            Membership.is_owner.desc(),
            Membership.status.asc(),
            OrganizationRole.name.asc(),
            User.full_name.asc(),
        )
    ).all()

    members = [
        PlatformOrganizationMemberRead(
            membership_id=membership.id,
            user_id=user.id,
            full_name=user.full_name,
            email=user.email,
            username=user.username,
            role_id=role.id,
            role_name=role.name,
            role_slug=role.slug,
            membership_status=membership.status,
            is_owner=membership.is_owner,
            user_is_active=user.is_active,
            user_is_verified=user.is_verified,
            joined_at=membership.created_at,
        )
        for membership, user, role in member_rows
    ]

    def count(model, *conditions) -> int:
        return int(
            db.scalar(
                select(func.count())
                .select_from(model)
                .where(model.organization_id == organization_id, *conditions)
            )
            or 0
        )

    usage = PlatformOrganizationUsageRead(
        employees=count(Employee),
        active_employees=count(Employee, Employee.employment_status == "active"),
        clients=count(Client),
        active_clients=count(Client, Client.status == "active"),
        leads=count(Lead),
        quotations=count(Quotation),
        orders=count(Order),
        open_orders=count(Order, Order.status.in_(["confirmed", "in_progress"])),
        projects=count(Project),
        active_projects=count(Project, Project.status.in_(["planned", "active", "on_hold"])),
        invoices=count(Invoice),
        open_invoices=count(Invoice, Invoice.status == "sent", Invoice.balance_due > 0),
    )

    activity_rows = db.execute(
        select(ActivityLog, User)
        .outerjoin(User, User.id == ActivityLog.actor_user_id)
        .where(ActivityLog.organization_id == organization_id)
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .limit(12)
    ).all()

    recent_activity = [
        PlatformOrganizationActivityRead(
            id=log.id,
            action=log.action,
            outcome=log.outcome,
            message=log.message,
            actor_user_id=log.actor_user_id,
            actor_name=actor.full_name if actor is not None else None,
            actor_email=actor.email if actor is not None else None,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            created_at=log.created_at,
        )
        for log, actor in activity_rows
    ]

    return PlatformOrganizationDetailRead(
        organization=OrganizationRead.model_validate(organization),
        subscription=(
            SubscriptionRead.model_validate(subscription) if subscription is not None else None
        ),
        created_at=organization.created_at,
        updated_at=organization.updated_at,
        created_by_user_id=creator.id,
        created_by_name=creator.full_name,
        created_by_email=creator.email,
        members=members,
        usage=usage,
        recent_activity=recent_activity,
    )
