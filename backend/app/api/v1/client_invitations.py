from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.client_access import _access_users, _can_manage, _client
from app.core.roles import (
    MEMBERSHIP_ROLE_CLIENT,
    MEMBERSHIP_STATUS_ACTIVE,
    MEMBERSHIP_STATUS_LEFT,
    MEMBERSHIP_STATUS_SUSPENDED,
    ORGANIZATION_STATUS_ACTIVE,
)
from app.core.security import hash_password, verify_password
from app.models.client_access import ClientMembership
from app.models.client_invitations import ClientInvitation
from app.models.crm import Client
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User
from app.services.account_email import AccountEmailDeliveryError, send_client_portal_invitation
from app.services.activity_log import record_activity
from app.services.team import create_invitation_token, ensure_system_roles, hash_invitation_token, invitation_expiry
from app.tenancy.context import TenantContext
from app.models.common import utc_now

router = APIRouter(prefix="/crm/client-access", tags=["Client Access Invitations"])
public_router = APIRouter(prefix="/client-invitations", tags=["Client Invitations"])

ClientAccessViewer = Annotated[TenantContext, Depends(require_tenant_permission("clients.view"))]
ClientAccessManager = Annotated[TenantContext, Depends(require_tenant_permission("clients.manage"))]


class ClientInvitationCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=160)
    is_primary_contact: bool = True


class ClientInvitationRead(BaseModel):
    id: str
    email: str
    full_name: str
    status: str
    is_primary_contact: bool
    expires_at: str
    last_sent_at: str
    created_at: str


class ClientAccessOverview(BaseModel):
    client_id: str
    display_name: str
    suggested_email: str | None
    suggested_full_name: str
    account_exists_for_suggested_email: bool
    enabled: bool
    pending: bool
    can_manage: bool
    users: list[dict]
    invitations: list[ClientInvitationRead]


class ClientInvitationPreview(BaseModel):
    company_name: str
    client_name: str
    email: str
    full_name: str
    expires_at: str
    existing_user: bool
    requires_password: bool


class ClientInvitationAccept(BaseModel):
    token: str = Field(min_length=20)
    password: str | None = None


def _invitation_read(item: ClientInvitation) -> ClientInvitationRead:
    return ClientInvitationRead(
        id=item.id,
        email=item.email,
        full_name=item.full_name,
        status=item.status,
        is_primary_contact=item.is_primary_contact,
        expires_at=item.expires_at.isoformat(),
        last_sent_at=item.last_sent_at.isoformat(),
        created_at=item.created_at.isoformat(),
    )


def _valid_invitation(db: DbSession, token: str, *, lock: bool = False) -> ClientInvitation:
    query = select(ClientInvitation).where(ClientInvitation.token_hash == hash_invitation_token(token))
    if lock:
        query = query.with_for_update()
    item = db.scalar(query)
    if item is None or item.status != "pending" or item.expires_at <= utc_now():
        raise HTTPException(status_code=404, detail="Invitation is invalid or expired")
    return item


@router.get("/client/{client_id}/overview", response_model=ClientAccessOverview)
def client_access_overview(client_id: str, db: DbSession, tenant: ClientAccessViewer) -> ClientAccessOverview:
    client = _client(db, tenant.organization_id, client_id)
    users = _access_users(db, tenant.organization_id, client.id)
    pending = db.scalars(
        select(ClientInvitation).where(
            ClientInvitation.organization_id == tenant.organization_id,
            ClientInvitation.client_id == client.id,
            ClientInvitation.status == "pending",
        ).order_by(ClientInvitation.created_at.desc())
    ).all()
    email = (client.email or client.billing_email or "").strip().lower() or None
    existing_user = bool(email and db.scalar(select(User.id).where(User.email == email)))
    return ClientAccessOverview(
        client_id=client.id,
        display_name=client.display_name,
        suggested_email=email,
        suggested_full_name=(client.contact_name or client.display_name).strip(),
        account_exists_for_suggested_email=existing_user,
        enabled=bool(users),
        pending=bool(pending),
        can_manage=_can_manage(db, tenant),
        users=[user.model_dump() for user in users],
        invitations=[_invitation_read(item) for item in pending],
    )


@router.post("/client/{client_id}/invite", response_model=ClientInvitationRead, status_code=status.HTTP_201_CREATED)
def invite_client(
    client_id: str,
    payload: ClientInvitationCreate,
    request: Request,
    db: DbSession,
    tenant: ClientAccessManager,
) -> ClientInvitationRead:
    client = _client(db, tenant.organization_id, client_id)
    email = str(payload.email).strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="A Business OS account already exists for this email. Grant portal access directly instead.")

    for previous in db.scalars(
        select(ClientInvitation).where(
            ClientInvitation.organization_id == tenant.organization_id,
            ClientInvitation.client_id == client.id,
            ClientInvitation.status == "pending",
        )
    ).all():
        previous.status = "revoked"
        previous.revoked_at = utc_now()

    token, token_hash = create_invitation_token()
    now = utc_now()
    item = ClientInvitation(
        organization_id=tenant.organization_id,
        client_id=client.id,
        email=email,
        full_name=payload.full_name.strip(),
        token_hash=token_hash,
        status="pending",
        is_primary_contact=payload.is_primary_contact,
        invited_by_user_id=tenant.user_id,
        expires_at=invitation_expiry(),
        last_sent_at=now,
    )
    db.add(item)
    db.flush()
    try:
        send_client_portal_invitation(
            email=item.email,
            full_name=item.full_name,
            company_name=tenant.organization.name,
            client_name=client.display_name,
            token=token,
        )
    except AccountEmailDeliveryError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Unable to send the client invitation email. Check SMTP configuration and try again.") from exc

    record_activity(
        db,
        action="client.invitation.sent",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client_invitation",
        entity_id=item.id,
        after={"client_id": client.id, "email": item.email, "expires_at": item.expires_at.isoformat(), "is_primary_contact": item.is_primary_contact},
        message=f"Client portal invitation sent to {item.email}",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return _invitation_read(item)


@router.post("/invitations/{invitation_id}/resend", response_model=ClientInvitationRead)
def resend_client_invitation(
    invitation_id: str,
    request: Request,
    db: DbSession,
    tenant: ClientAccessManager,
) -> ClientInvitationRead:
    item = db.scalar(
        select(ClientInvitation).where(
            ClientInvitation.id == invitation_id,
            ClientInvitation.organization_id == tenant.organization_id,
            ClientInvitation.status == "pending",
        ).with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Pending client invitation not found")
    client = _client(db, tenant.organization_id, item.client_id)
    token, token_hash = create_invitation_token()
    item.token_hash = token_hash
    item.expires_at = invitation_expiry()
    item.last_sent_at = utc_now()
    db.flush()
    try:
        send_client_portal_invitation(
            email=item.email,
            full_name=item.full_name,
            company_name=tenant.organization.name,
            client_name=client.display_name,
            token=token,
        )
    except AccountEmailDeliveryError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Unable to resend the client invitation email. Check SMTP configuration and try again.") from exc
    record_activity(
        db,
        action="client.invitation.resent",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client_invitation",
        entity_id=item.id,
        after={"client_id": client.id, "email": item.email, "expires_at": item.expires_at.isoformat()},
        message=f"Client portal invitation resent to {item.email}",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return _invitation_read(item)


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_client_invitation(
    invitation_id: str,
    request: Request,
    db: DbSession,
    tenant: ClientAccessManager,
) -> None:
    item = db.scalar(
        select(ClientInvitation).where(
            ClientInvitation.id == invitation_id,
            ClientInvitation.organization_id == tenant.organization_id,
        ).with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Client invitation not found")
    if item.status == "pending":
        item.status = "revoked"
        item.revoked_at = utc_now()
        record_activity(
            db,
            action="client.invitation.revoked",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="client_invitation",
            entity_id=item.id,
            before={"status": "pending", "email": item.email},
            after={"status": "revoked"},
            message=f"Client portal invitation revoked for {item.email}",
            request=request,
        )
        db.commit()


@public_router.get("/{token}", response_model=ClientInvitationPreview)
def preview_client_invitation(token: str, db: DbSession) -> ClientInvitationPreview:
    item = _valid_invitation(db, token)
    organization = db.get(Organization, item.organization_id)
    client = db.get(Client, item.client_id)
    if organization is None or organization.status != ORGANIZATION_STATUS_ACTIVE or client is None or client.organization_id != item.organization_id:
        raise HTTPException(status_code=404, detail="Invitation is no longer available")
    user = db.scalar(select(User).where(User.email == item.email))
    return ClientInvitationPreview(
        company_name=organization.name,
        client_name=client.display_name,
        email=item.email,
        full_name=item.full_name,
        expires_at=item.expires_at.isoformat(),
        existing_user=user is not None,
        requires_password=bool(user and user.password_hash),
    )


@public_router.post("/accept", response_model=dict)
def accept_client_invitation(payload: ClientInvitationAccept, request: Request, db: DbSession):
    item = _valid_invitation(db, payload.token, lock=True)
    organization = db.get(Organization, item.organization_id)
    client = db.get(Client, item.client_id)
    if organization is None or organization.status != ORGANIZATION_STATUS_ACTIVE or client is None or client.organization_id != item.organization_id:
        raise HTTPException(status_code=403, detail="Company or client is unavailable")

    user = db.scalar(select(User).where(User.email == item.email))
    created_user = False
    if user is None:
        password = payload.password or ""
        if len(password) < 8:
            raise HTTPException(status_code=400, detail="Create a password with at least 8 characters")
        user = User(email=item.email, full_name=item.full_name, password_hash=hash_password(password), is_verified=True)
        db.add(user)
        db.flush()
        created_user = True
    else:
        if not user.is_active:
            raise HTTPException(status_code=403, detail="This Business OS account is suspended")
        if user.password_hash:
            if not payload.password or not verify_password(payload.password, user.password_hash):
                raise HTTPException(status_code=401, detail="Incorrect password for the existing Business OS account")
        user.is_verified = True

    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization.id,
            Membership.user_id == user.id,
        )
    )
    created_membership = False
    if membership is None:
        roles = ensure_system_roles(db, organization)
        membership = Membership(
            organization_id=organization.id,
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
        raise HTTPException(status_code=409, detail="Your membership in this company is suspended")
    elif membership.status == MEMBERSHIP_STATUS_LEFT:
        membership.status = MEMBERSHIP_STATUS_ACTIVE

    access = db.scalar(
        select(ClientMembership).where(
            ClientMembership.organization_id == organization.id,
            ClientMembership.client_id == client.id,
            ClientMembership.membership_id == membership.id,
        )
    )
    if item.is_primary_contact:
        for current in db.scalars(
            select(ClientMembership).where(
                ClientMembership.organization_id == organization.id,
                ClientMembership.client_id == client.id,
                ClientMembership.status == "active",
                ClientMembership.is_primary_contact.is_(True),
            )
        ).all():
            if access is None or current.id != access.id:
                current.is_primary_contact = False
    if access is None:
        access = ClientMembership(
            organization_id=organization.id,
            client_id=client.id,
            membership_id=membership.id,
            is_primary_contact=item.is_primary_contact,
            status="active",
            created_by_user_id=item.invited_by_user_id,
        )
        db.add(access)
    else:
        access.status = "active"
        access.is_primary_contact = item.is_primary_contact

    item.status = "accepted"
    item.accepted_at = utc_now()
    db.flush()
    record_activity(
        db,
        action="client.invitation.accepted",
        scope="tenant",
        actor_user_id=user.id,
        organization_id=organization.id,
        entity_type="client_membership",
        entity_id=access.id,
        after={
            "client_id": client.id,
            "user_id": user.id,
            "membership_id": membership.id,
            "email": user.email,
            "created_user": created_user,
            "created_client_only_membership": created_membership,
            "is_primary_contact": access.is_primary_contact,
        },
        message=f"Client portal invitation accepted by {user.email}",
        request=request,
    )
    db.commit()
    return {"ok": True, "company_name": organization.name, "client_name": client.display_name}
