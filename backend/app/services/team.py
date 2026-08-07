import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import ADMIN_PERMISSIONS, USER_PERMISSIONS
from app.models.common import utc_now
from app.models.company_settings import OrganizationDocumentSequence
from app.models.organization import Organization
from app.models.team import OrganizationRole


SYSTEM_ROLES = {
    "admin": {
        "name": "Admin",
        "description": "Full company administration access",
        "permissions": ADMIN_PERMISSIONS,
    },
    "user": {
        "name": "User",
        "description": "Standard company employee access",
        "permissions": USER_PERMISSIONS,
    },
}


def ensure_system_roles(db: Session, organization: Organization) -> dict[str, OrganizationRole]:
    existing = {
        role.slug: role
        for role in db.scalars(
            select(OrganizationRole).where(
                OrganizationRole.organization_id == organization.id,
                OrganizationRole.slug.in_(SYSTEM_ROLES.keys()),
            )
        ).all()
    }
    for slug, values in SYSTEM_ROLES.items():
        if slug in existing:
            continue
        role = OrganizationRole(
            organization_id=organization.id,
            slug=slug,
            name=values["name"],
            description=values["description"],
            is_system=True,
            is_active=True,
            permissions=list(values["permissions"]),
        )
        db.add(role)
        existing[slug] = role
    db.flush()
    return existing


def next_employee_code(db: Session, organization_id: str) -> str:
    sequence = db.scalar(
        select(OrganizationDocumentSequence)
        .where(
            OrganizationDocumentSequence.organization_id == organization_id,
            OrganizationDocumentSequence.document_type == "employee",
        )
        .with_for_update()
    )
    if sequence is None:
        raise RuntimeError("Employee numbering sequence is missing")
    number = sequence.next_number
    sequence.next_number += 1
    return f"{sequence.prefix}{sequence.separator}{number:0{sequence.padding}d}"


def create_invitation_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_invitation_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def invitation_expiry(days: int = 7):
    return utc_now() + timedelta(days=days)
