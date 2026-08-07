from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.company_defaults import OrganizationSystemDefaults
from app.models.company_settings import (
    OrganizationBranding,
    OrganizationDocumentSequence,
    OrganizationFinancialSettings,
    OrganizationLocalizationSettings,
    OrganizationOnlineProfile,
    OrganizationProfile,
)
from app.models.organization import Organization

SEQUENCE_DEFAULTS = {
    "invoice": "INV",
    "quotation": "QUO",
    "order": "ORD",
    "project": "PRJ",
    "client": "CLI",
    "employee": "EMP",
}


def ensure_company_settings_defaults(db: Session, organization: Organization) -> None:
    """Ensure one-to-one company settings and document sequences exist.

    The caller owns the transaction and must include an ActivityLog when this
    helper creates records. Organization creation already does this in the same transaction.
    """

    organization_id = organization.id

    if db.scalar(
        select(OrganizationProfile.id).where(OrganizationProfile.organization_id == organization_id)
    ) is None:
        db.add(
            OrganizationProfile(
                organization_id=organization_id,
                legal_name=organization.name,
                industry=organization.business_type,
                company_size=organization.team_size,
            )
        )

    if db.scalar(
        select(OrganizationLocalizationSettings.id).where(
            OrganizationLocalizationSettings.organization_id == organization_id
        )
    ) is None:
        db.add(OrganizationLocalizationSettings(organization_id=organization_id))

    if db.scalar(
        select(OrganizationFinancialSettings.id).where(
            OrganizationFinancialSettings.organization_id == organization_id
        )
    ) is None:
        db.add(
            OrganizationFinancialSettings(
                organization_id=organization_id,
                accounting_currency=organization.currency,
            )
        )

    if db.scalar(
        select(OrganizationSystemDefaults.id).where(
            OrganizationSystemDefaults.organization_id == organization_id
        )
    ) is None:
        db.add(
            OrganizationSystemDefaults(
                organization_id=organization_id,
                default_client_country_code=organization.country_code,
                default_client_currency=organization.currency,
            )
        )

    if db.scalar(
        select(OrganizationBranding.id).where(OrganizationBranding.organization_id == organization_id)
    ) is None:
        db.add(OrganizationBranding(organization_id=organization_id))

    if db.scalar(
        select(OrganizationOnlineProfile.id).where(
            OrganizationOnlineProfile.organization_id == organization_id
        )
    ) is None:
        db.add(OrganizationOnlineProfile(organization_id=organization_id))

    existing_types = set(
        db.scalars(
            select(OrganizationDocumentSequence.document_type).where(
                OrganizationDocumentSequence.organization_id == organization_id
            )
        ).all()
    )
    for document_type, prefix in SEQUENCE_DEFAULTS.items():
        if document_type not in existing_types:
            db.add(
                OrganizationDocumentSequence(
                    organization_id=organization_id,
                    document_type=document_type,
                    prefix=prefix,
                )
            )
