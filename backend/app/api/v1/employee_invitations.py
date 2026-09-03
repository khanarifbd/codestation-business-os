from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.team import create_invitation
from app.models.team import EmployeeInvitation, OrganizationRole
from app.schemas.team import InvitationCreate
from app.services.account_email import AccountEmailDeliveryError, send_employee_invitation
from app.services.activity_log import record_activity
from app.services.team import create_invitation_token, invitation_expiry
from app.services.team_role_grants import ensure_grantable_employee_role
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr/people/invitations", tags=["Employee Invitations"])
EmployeeInviter = Annotated[TenantContext, Depends(require_tenant_permission("employees.invite"))]


def _pending_invitation(
    db: DbSession,
    organization_id: str,
    invitation_id: str,
    *,
    lock: bool = False,
) -> EmployeeInvitation:
    query = select(EmployeeInvitation).where(
        EmployeeInvitation.id == invitation_id,
        EmployeeInvitation.organization_id == organization_id,
        EmployeeInvitation.status == "pending",
    )
    if lock:
        query = query.with_for_update()
    item = db.scalar(query)
    if item is None:
        raise HTTPException(status_code=404, detail="Pending employee invitation not found")
    return item


def _role_name(db: DbSession, organization_id: str, role_id: str) -> str:
    name = db.scalar(
        select(OrganizationRole.name).where(
            OrganizationRole.id == role_id,
            OrganizationRole.organization_id == organization_id,
        )
    )
    return name or "Employee"


def _try_send_employee_invitation(
    *,
    tenant: TenantContext,
    item: EmployeeInvitation,
    role_name: str,
    token: str,
) -> bool:
    try:
        return send_employee_invitation(
            email=item.email,
            full_name=item.full_name,
            company_name=tenant.organization.name,
            role_name=role_name,
            employee_code=item.employee_code,
            token=token,
        )
    except AccountEmailDeliveryError:
        return False


def _record_delivery(
    db: DbSession,
    request: Request,
    tenant: TenantContext,
    item: EmployeeInvitation,
    *,
    action: str,
    email_sent: bool,
) -> None:
    record_activity(
        db,
        action=action,
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="employee_invitation",
        entity_id=item.id,
        outcome="success" if email_sent else "failure",
        after={
            "email": item.email,
            "email_sent": email_sent,
            "expires_at": item.expires_at.isoformat(),
        },
        message=(
            f"Employee invitation email sent to {item.email}"
            if email_sent
            else f"Employee invitation email could not be sent to {item.email}"
        ),
        request=request,
    )


@router.post("/send", status_code=status.HTTP_201_CREATED)
def create_and_send_employee_invitation(
    payload: InvitationCreate,
    request: Request,
    db: DbSession,
    tenant: EmployeeInviter,
):
    ensure_grantable_employee_role(db, tenant, payload.role_id)
    created = create_invitation(payload, request, db, tenant)  # type: ignore[arg-type]
    item = _pending_invitation(db, tenant.organization_id, created.id)
    email_sent = _try_send_employee_invitation(
        tenant=tenant,
        item=item,
        role_name=created.role_name,
        token=created.invite_token,
    )
    _record_delivery(
        db,
        request,
        tenant,
        item,
        action="employee.invitation.email_sent" if email_sent else "employee.invitation.email_failed",
        email_sent=email_sent,
    )
    db.commit()
    return {
        **created.model_dump(mode="json"),
        "email_sent": email_sent,
    }


@router.post("/{invitation_id}/resend")
def resend_employee_invitation(
    invitation_id: str,
    request: Request,
    db: DbSession,
    tenant: EmployeeInviter,
):
    item = _pending_invitation(db, tenant.organization_id, invitation_id, lock=True)
    role_name = _role_name(db, tenant.organization_id, item.role_id)
    token, token_hash = create_invitation_token()
    item.token_hash = token_hash
    item.expires_at = invitation_expiry()
    db.flush()
    email_sent = _try_send_employee_invitation(
        tenant=tenant,
        item=item,
        role_name=role_name,
        token=token,
    )
    _record_delivery(
        db,
        request,
        tenant,
        item,
        action="employee.invitation.resent" if email_sent else "employee.invitation.resend_failed",
        email_sent=email_sent,
    )
    db.commit()
    return {
        "id": item.id,
        "email": item.email,
        "invite_token": token,
        "email_sent": email_sent,
        "expires_at": item.expires_at.isoformat(),
    }


@router.post("/{invitation_id}/link")
def refresh_employee_invitation_link(
    invitation_id: str,
    request: Request,
    db: DbSession,
    tenant: EmployeeInviter,
):
    item = _pending_invitation(db, tenant.organization_id, invitation_id, lock=True)
    token, token_hash = create_invitation_token()
    before_expiry = item.expires_at.isoformat()
    item.token_hash = token_hash
    item.expires_at = invitation_expiry()
    db.flush()
    record_activity(
        db,
        action="employee.invitation.link_refreshed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="employee_invitation",
        entity_id=item.id,
        before={"expires_at": before_expiry},
        after={"expires_at": item.expires_at.isoformat(), "email": item.email},
        message=f"Employee invitation link refreshed for {item.email}",
        request=request,
    )
    db.commit()
    return {
        "id": item.id,
        "invite_token": token,
        "expires_at": item.expires_at.isoformat(),
    }


@router.post("/{invitation_id}/revoke")
def revoke_employee_invitation(
    invitation_id: str,
    request: Request,
    db: DbSession,
    tenant: EmployeeInviter,
):
    item = _pending_invitation(db, tenant.organization_id, invitation_id, lock=True)
    item.status = "revoked"
    record_activity(
        db,
        action="employee.invitation.revoked",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="employee_invitation",
        entity_id=item.id,
        before={"status": "pending", "email": item.email},
        after={"status": "revoked"},
        message=f"Employee invitation revoked for {item.email}",
        request=request,
    )
    db.commit()
    return {"id": item.id, "status": item.status}
