import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.company_defaults import OrganizationSystemDefaults
from app.models.company_settings import OrganizationDocumentSequence
from app.models.crm import LeadSource, LeadStatus
from app.models.organization import Organization

DEFAULT_LEAD_STATUSES = [
    ("new", "New", "open", "#64748b", 10, True),
    ("contacted", "Contacted", "open", "#0ea5e9", 20, False),
    ("qualified", "Qualified", "qualified", "#8b5cf6", 30, False),
    ("proposal", "Proposal", "qualified", "#f59e0b", 40, False),
    ("won", "Won", "won", "#16a34a", 50, False),
    ("lost", "Lost", "lost", "#dc2626", 60, False),
]

DEFAULT_LEAD_SOURCES = [
    ("website", "Website", 10),
    ("referral", "Referral", 20),
    ("fiverr", "Fiverr", 30),
    ("upwork", "Upwork", 40),
    ("linkedin", "LinkedIn", 50),
    ("facebook", "Facebook", 60),
    ("email", "Email", 70),
    ("phone", "Phone", 80),
    ("other", "Other", 90),
]


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return (slug or "item")[:64]


def ensure_crm_defaults(db: Session, organization: Organization) -> None:
    organization_id = organization.id
    existing_statuses = set(
        db.scalars(select(LeadStatus.slug).where(LeadStatus.organization_id == organization_id)).all()
    )
    for slug, name, category, color, sort_order, is_default in DEFAULT_LEAD_STATUSES:
        if slug not in existing_statuses:
            db.add(
                LeadStatus(
                    organization_id=organization_id,
                    slug=slug,
                    name=name,
                    category=category,
                    color=color,
                    sort_order=sort_order,
                    is_default=is_default,
                )
            )

    existing_sources = set(
        db.scalars(select(LeadSource.slug).where(LeadSource.organization_id == organization_id)).all()
    )
    for slug, name, sort_order in DEFAULT_LEAD_SOURCES:
        if slug not in existing_sources:
            db.add(
                LeadSource(
                    organization_id=organization_id,
                    slug=slug,
                    name=name,
                    sort_order=sort_order,
                )
            )

    lead_sequence = db.scalar(
        select(OrganizationDocumentSequence.id).where(
            OrganizationDocumentSequence.organization_id == organization_id,
            OrganizationDocumentSequence.document_type == "lead",
        )
    )
    if lead_sequence is None:
        db.add(
            OrganizationDocumentSequence(
                organization_id=organization_id,
                document_type="lead",
                prefix="LEAD",
            )
        )


def next_sequence_code(db: Session, organization_id: str, document_type: str) -> str:
    sequence = db.scalar(
        select(OrganizationDocumentSequence)
        .where(
            OrganizationDocumentSequence.organization_id == organization_id,
            OrganizationDocumentSequence.document_type == document_type,
        )
        .with_for_update()
    )
    if sequence is None:
        raise RuntimeError(f"Missing {document_type} numbering sequence")

    number = sequence.next_number
    sequence.next_number += 1
    prefix = sequence.prefix.strip()
    padded = str(number).zfill(sequence.padding)
    return f"{prefix}{sequence.separator}{padded}" if prefix else padded


def get_default_lead_status(db: Session, organization_id: str) -> LeadStatus:
    defaults = db.scalar(
        select(OrganizationSystemDefaults).where(
            OrganizationSystemDefaults.organization_id == organization_id
        )
    )
    if defaults and defaults.default_lead_status:
        status = db.scalar(
            select(LeadStatus).where(
                LeadStatus.organization_id == organization_id,
                LeadStatus.slug == defaults.default_lead_status,
                LeadStatus.is_active.is_(True),
            )
        )
        if status is not None:
            return status

    status = db.scalar(
        select(LeadStatus).where(
            LeadStatus.organization_id == organization_id,
            LeadStatus.is_default.is_(True),
            LeadStatus.is_active.is_(True),
        )
    )
    if status is None:
        status = db.scalar(
            select(LeadStatus)
            .where(
                LeadStatus.organization_id == organization_id,
                LeadStatus.is_active.is_(True),
            )
            .order_by(LeadStatus.sort_order.asc(), LeadStatus.created_at.asc())
        )
    if status is None:
        raise RuntimeError("No active lead status configured")
    return status
