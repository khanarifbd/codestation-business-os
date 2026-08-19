from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.core.roles import (
    MEMBERSHIP_ROLE_CLIENT,
    MEMBERSHIP_STATUS_ACTIVE,
    MEMBERSHIP_STATUS_LEFT,
    MEMBERSHIP_STATUS_SUSPENDED,
)
from app.models.client_access import ClientMembership
from app.models.client_invitations import ClientInvitation
from app.models.common import utc_now
from app.models.crm import Client
from app.models.membership import Membership
from app.models.team import Employee, OrganizationRole
from app.models.user import User
from app.services.activity_log import record_activity
from app.services.team import ensure_system_roles
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm/client-access", tags=["Client Access"])
ClientAccessViewer = Annotated[TenantContext, Depends(require_tenant_permission("clients.view"))]
ClientAccessManager = Annotated[TenantContext, Depends(require_tenant_permission("clients.manage"))]


class ClientAccessUser(BaseModel):
    access_id: str
    membership_id: str
    user_id: str
    full_name: str
    email: str
    is_primary_contact: bool
    membership_role: str
    membership_status: str


class ClientAccessRecord(BaseModel):
    client_id: str
    client_code: str
    display_name: str
    client_type: str
    email: str | None
    status: str
    users: list[ClientAccessUser]


class ClientAccessCreate(BaseModel):
    client_id: str
    email: EmailStr | None = None
    is_primary_contact: bool = True


class ClientAccessStatusItem(BaseModel):
    client_id: str
    enabled: bool
    active_access_count: int
    pending_invitation_count: int
    has_email: bool


class ClientAccessStatusResponse(BaseModel):
    can_manage: bool
    items: list[ClientAccessStatusItem]


def _client(db: DbSession, organization_id: str, client_id: str) -> Client:
    client = db.scalar(
        select(Client).where(
            Client.id == client_id,
            Client.organization_id == organization_id,
        )
    )
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


def _can_manage(db: DbSession, tenant: TenantContext) -> bool:
    role = db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == tenant.membership.role_id,
            OrganizationRole.organization_id == tenant.organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )
    return bool(role and ("*" in role.permissions or "clients.manage" in role.permissions))


def _access_users(db: DbSession, organization_id: str, client_id: str) -> list[ClientAccessUser]:
    rows = db.execute(
        select(ClientMembership, Membership, User)
        .join(Membership, Membership.id == ClientMembership.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            ClientMembership.organization_id == organization_id,
            ClientMembership.client_id == client_id,
            ClientMembership.status == "active",
        )
        .order_by(ClientMembership.is_primary_contact.desc(), User.full_name.asc())
    ).all()
    return [
        ClientAccessUser(
            access_id=access.id,
            membership_id=membership.id,
            user_id=user.id,
            full_name=user.full_name,
            email=user.email,
            is_primary_contact=access.is_primary_contact,
            membership_role=membership.role,
            membership_status=membership.status,
        )
        for access, membership, user in rows
    ]


def _record(db: DbSession, client: Client) -> ClientAccessRecord:
    return ClientAccessRecord(
        client_id=client.id,
        client_code=client.client_code,
        display_name=client.display_name,
        client_type=client.client_type,
        email=client.email,
        status=client.status,
        users=_access_users(db, client.organization_id, client.id),
    )


def _deactivate_membership_if_orphaned(db: DbSession, organization_id: str, membership_id: str) -> None:
    membership = db.get(Membership, membership_id)
    if membership is None or membership.is_owner:
        return

    has_employee = db.scalar(
        select(Employee.id)
        .where(
            Employee.organization_id == organization_id,
            Employee.membership_id == membership.id,
            Employee.employment_status == "active",
        )
        .limit(1)
    )
    has_client_access = db.scalar(
        select(ClientMembership.id)
        .where(
            ClientMembership.organization_id == organization_id,
            ClientMembership.membership_id == membership.id,
            ClientMembership.status == "active",
        )
        .limit(1)
    )
    if has_employee is None and has_client_access is None:
        membership.status = MEMBERSHIP_STATUS_LEFT


@router.get("/status", response_model=ClientAccessStatusResponse)
def get_client_access_status(
    db: DbSession,
    tenant: ClientAccessViewer,
    client_ids: str = Query(..., min_length=1),
) -> ClientAccessStatusResponse:
    requested_ids = list(dict.fromkeys(item.strip() for item in client_ids.split(",") if item.strip()))[:100]
    if not requested_ids:
        return ClientAccessStatusResponse(can_manage=_can_manage(db, tenant), items=[])

    clients = db.scalars(
        select(Client).where(
            Client.organization_id == tenant.organization_id,
            Client.id.in_(requested_ids),
        )
    ).all()
    client_map = {client.id: client for client in clients}

    access_counts = dict(
        db.execute(
            select(ClientMembership.client_id, func.count(ClientMembership.id))
            .where(
                ClientMembership.organization_id == tenant.organization_id,
                ClientMembership.client_id.in_(requested_ids),
                ClientMembership.status == "active",
            )
            .group_by(ClientMembership.client_id)
        ).all()
    )
    pending_counts = dict(
        db.execute(
            select(ClientInvitation.client_id, func.count(ClientInvitation.id))
            .where(
                ClientInvitation.organization_id == tenant.organization_id,
                ClientInvitation.client_id.in_(requested_ids),
                ClientInvitation.status == "pending",
                ClientInvitation.expires_at > utc_now(),
            )
            .group_by(ClientInvitation.client_id)
        ).all()
    )

    items = []
    for client_id in requested_ids:
        client = client_map.get(client_id)
        if client is None:
            continue
        count = int(access_counts.get(client_id, 0))
        items.append(
            ClientAccessStatusItem(
                client_id=client.id,
                enabled=count > 0,
                active_access_count=count,
                pending_invitation_count=int(pending_counts.get(client_id, 0)),
                has_email=bool(client.email or client.billing_email),
            )
        )
    return ClientAccessStatusResponse(can_manage=_can_manage(db, tenant), items=items)


@router.get("", response_model=list[ClientAccessRecord])
def list_client_access(db: DbSession, tenant: ClientAccessViewer) -> list[ClientAccessRecord]:
    clients = db.scalars(
        select(Client)
        .where(Client.organization_id == tenant.organization_id)
        .order_by(Client.status.desc(), Client.display_name.asc())
        .limit(500)
    ).all()
    return [_record(db, client) for client in clients]


@router.post("", response_model=ClientAccessRecord, status_code=status.HTTP_201_CREATED)
def grant_client_access(
    payload: ClientAccessCreate,
    request: Request,
    db: DbSession,
    tenant: ClientAccessManager,
) -> ClientAccessRecord:
    client = _client(db, tenant.organization_id, payload.client_id)
    email = str(payload.email or client.email or client.billing_email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Client email is required before portal access can be granted")

    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        raise HTTPException(
            status_code=409,
            detail="No Business OS account exists for this email yet. Invite the client from the Client Access section.",
        )
    if not user.is_active:
        raise HTTPException(status_code=409, detail="The user account is inactive")

    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == tenant.organization_id,
            Membership.user_id == user.id,
        )
    )
    created_membership = False
    if membership is None:
        roles = ensure_system_roles(db, tenant.organization)
        membership = Membership(
            organization_id=tenant.organization_id,
            user_id=user.id,
            role_id=roles["client"].id,
            role=MEMBERSHIP_ROLE_CLIENT,
            status=MEMBERSHIP_STATUS_ACTIVE,
            is_owner=False,
        )
        db.add(membership)
        db.flush()
        created_membership = True
    elif membership.status == MEMBERSHIP_STATUS_SUSPENDED:
        raise HTTPException(status_code=409, detail="This user is suspended in the company workspace")
    elif membership.status == MEMBERSHIP_STATUS_LEFT:
        membership.status = MEMBERSHIP_STATUS_ACTIVE

    existing = db.scalar(
        select(ClientMembership).where(
            ClientMembership.organization_id == tenant.organization_id,
            ClientMembership.client_id == client.id,
            ClientMembership.membership_id == membership.id,
        )
    )
    if existing is not None:
        if existing.status != "active":
            existing.status = "active"
        existing.is_primary_contact = payload.is_primary_contact
        db.flush()
        record_activity(
            db,
            action="client.access.reactivated",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="client_membership",
            entity_id=existing.id,
            message=f"Client portal access reactivated for {email}",
            after={"client_id": client.id, "membership_id": membership.id, "user_id": user.id},
            request=request,
        )
        db.commit()
        db.refresh(client)
        return _record(db, client)

    if payload.is_primary_contact:
        for item in db.scalars(
            select(ClientMembership).where(
                ClientMembership.organization_id == tenant.organization_id,
                ClientMembership.client_id == client.id,
                ClientMembership.status == "active",
                ClientMembership.is_primary_contact.is_(True),
            )
        ).all():
            item.is_primary_contact = False

    access = ClientMembership(
        organization_id=tenant.organization_id,
        client_id=client.id,
        membership_id=membership.id,
        is_primary_contact=payload.is_primary_contact,
        status="active",
        created_by_user_id=tenant.user_id,
    )
    db.add(access)
    db.flush()
    record_activity(
        db,
        action="client.access.granted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client_membership",
        entity_id=access.id,
        message=f"Client portal access granted to {email}",
        after={
            "client_id": client.id,
            "membership_id": membership.id,
            "user_id": user.id,
            "created_client_only_membership": created_membership,
            "is_primary_contact": access.is_primary_contact,
        },
        request=request,
    )
    db.commit()
    db.refresh(client)
    return _record(db, client)


@router.delete("/client/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def disable_client_access(
    client_id: str,
    request: Request,
    db: DbSession,
    tenant: ClientAccessManager,
) -> None:
    client = _client(db, tenant.organization_id, client_id)
    accesses = db.scalars(
        select(ClientMembership).where(
            ClientMembership.organization_id == tenant.organization_id,
            ClientMembership.client_id == client.id,
            ClientMembership.status == "active",
        )
    ).all()
    if not accesses:
        return

    membership_ids = {access.membership_id for access in accesses}
    access_ids = [access.id for access in accesses]
    for access in accesses:
        access.status = "revoked"
    db.flush()

    for membership_id in membership_ids:
        _deactivate_membership_if_orphaned(db, tenant.organization_id, membership_id)

    record_activity(
        db,
        action="client.access.disabled",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client",
        entity_id=client.id,
        message=f"Client portal access disabled for {client.display_name}",
        before={"active_access_count": len(accesses), "access_ids": access_ids},
        after={"active_access_count": 0},
        request=request,
    )
    db.commit()


@router.delete("/{access_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_client_access(
    access_id: str,
    request: Request,
    db: DbSession,
    tenant: ClientAccessManager,
) -> None:
    access = db.scalar(
        select(ClientMembership).where(
            ClientMembership.id == access_id,
            ClientMembership.organization_id == tenant.organization_id,
        )
    )
    if access is None:
        raise HTTPException(status_code=404, detail="Client access link not found")

    membership = db.get(Membership, access.membership_id)
    before = {
        "client_id": access.client_id,
        "membership_id": access.membership_id,
        "is_primary_contact": access.is_primary_contact,
        "status": access.status,
    }
    access.status = "revoked"
    db.flush()
    _deactivate_membership_if_orphaned(db, tenant.organization_id, access.membership_id)

    record_activity(
        db,
        action="client.access.revoked",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client_membership",
        entity_id=access.id,
        message="Client portal access revoked",
        before=before,
        after={"status": access.status, "membership_status": membership.status if membership else None},
        request=request,
    )
    db.commit()
