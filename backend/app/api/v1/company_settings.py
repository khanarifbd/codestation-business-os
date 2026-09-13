from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import CurrentTenantAdmin, DbSession
from app.models.company_settings import (
    OrganizationAddress,
    OrganizationBranding,
    OrganizationDocument,
    OrganizationDocumentSequence,
    OrganizationFinancialSettings,
    OrganizationIdentifier,
    OrganizationLocalizationSettings,
    OrganizationOnlineProfile,
    OrganizationProfile,
)
from app.schemas.company_settings import (
    AddressRead,
    AddressUpdate,
    BrandingRead,
    BrandingUpdate,
    CompanyDocumentCreate,
    CompanyDocumentRead,
    CompanySettingsBundle,
    CoreCompanyUpdate,
    FinancialRead,
    FinancialUpdate,
    IdentifierCreate,
    IdentifierRead,
    LocalizationRead,
    LocalizationUpdate,
    OnlineLegalRead,
    OnlineLegalUpdate,
    ProfileRead,
    ProfileUpdate,
    SequenceRead,
    SequenceUpdate,
)
from app.schemas.organization import OrganizationRead
from app.services.activity_log import record_activity

router = APIRouter(prefix="/company-settings", tags=["Company Settings"])

ADDRESS_TYPES = {"registered", "office", "billing", "mailing"}
SEQUENCE_TYPES = {"invoice", "quotation", "order", "project", "client", "employee"}


def _required(value, name: str):
    if value is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Company settings are incomplete: {name} is missing",
        )
    return value


def _record_section_change(
    db: DbSession,
    request: Request,
    tenant: CurrentTenantAdmin,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    before,
    after,
    message: str,
) -> None:
    record_activity(
        db,
        action=action,
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
        message=message,
        request=request,
    )


@router.get("", response_model=CompanySettingsBundle)
def get_company_settings(
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> CompanySettingsBundle:
    organization_id = tenant.organization_id
    profile = _required(
        db.scalar(select(OrganizationProfile).where(OrganizationProfile.organization_id == organization_id)),
        "profile",
    )
    localization = _required(
        db.scalar(
            select(OrganizationLocalizationSettings).where(
                OrganizationLocalizationSettings.organization_id == organization_id
            )
        ),
        "localization",
    )
    financial = _required(
        db.scalar(
            select(OrganizationFinancialSettings).where(
                OrganizationFinancialSettings.organization_id == organization_id
            )
        ),
        "financial",
    )
    branding = _required(
        db.scalar(select(OrganizationBranding).where(OrganizationBranding.organization_id == organization_id)),
        "branding",
    )
    online = _required(
        db.scalar(
            select(OrganizationOnlineProfile).where(
                OrganizationOnlineProfile.organization_id == organization_id
            )
        ),
        "online profile",
    )

    identifiers = db.scalars(
        select(OrganizationIdentifier)
        .where(OrganizationIdentifier.organization_id == organization_id)
        .order_by(OrganizationIdentifier.is_primary.desc(), OrganizationIdentifier.label.asc())
    ).all()
    addresses = db.scalars(
        select(OrganizationAddress)
        .where(OrganizationAddress.organization_id == organization_id)
        .order_by(OrganizationAddress.address_type.asc())
    ).all()
    sequences = db.scalars(
        select(OrganizationDocumentSequence)
        .where(OrganizationDocumentSequence.organization_id == organization_id)
        .order_by(OrganizationDocumentSequence.document_type.asc())
    ).all()
    documents = db.scalars(
        select(OrganizationDocument)
        .where(OrganizationDocument.organization_id == organization_id)
        .order_by(OrganizationDocument.created_at.desc())
    ).all()

    return CompanySettingsBundle(
        organization=OrganizationRead.model_validate(tenant.organization),
        profile=ProfileRead.model_validate(profile),
        identifiers=[IdentifierRead.model_validate(item) for item in identifiers],
        addresses=[AddressRead.model_validate(item) for item in addresses],
        localization=LocalizationRead.model_validate(localization),
        financial=FinancialRead.model_validate(financial),
        sequences=[SequenceRead.model_validate(item) for item in sequences],
        branding=BrandingRead.model_validate(branding),
        online_legal=OnlineLegalRead.model_validate(online),
        documents=[CompanyDocumentRead.model_validate(item) for item in documents],
    )


@router.patch("/core", response_model=OrganizationRead)
def update_core_company(
    payload: CoreCompanyUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> OrganizationRead:
    organization = tenant.organization
    before = OrganizationRead.model_validate(organization).model_dump(mode="json")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(organization, field, value)
    db.flush()
    after = OrganizationRead.model_validate(organization).model_dump(mode="json")
    _record_section_change(
        db, request, tenant,
        action="company.core.updated",
        entity_type="organization",
        entity_id=organization.id,
        before=before,
        after=after,
        message="Core company information updated",
    )
    db.commit()
    db.refresh(organization)
    return OrganizationRead.model_validate(organization)


@router.patch("/profile", response_model=ProfileRead)
def update_profile(
    payload: ProfileUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> ProfileRead:
    profile = _required(
        db.scalar(
            select(OrganizationProfile).where(
                OrganizationProfile.organization_id == tenant.organization_id
            )
        ),
        "profile",
    )
    before = ProfileRead.model_validate(profile).model_dump(mode="json")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(profile, field, value)
    db.flush()
    after = ProfileRead.model_validate(profile).model_dump(mode="json")
    _record_section_change(
        db, request, tenant,
        action="company.profile.updated",
        entity_type="organization_profile",
        entity_id=profile.id,
        before=before,
        after=after,
        message="Company profile updated",
    )
    db.commit()
    db.refresh(profile)
    return ProfileRead.model_validate(profile)


@router.post("/identifiers", response_model=IdentifierRead, status_code=status.HTTP_201_CREATED)
def create_identifier(
    payload: IdentifierCreate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> IdentifierRead:
    item = OrganizationIdentifier(
        organization_id=tenant.organization_id,
        identifier_type=payload.identifier_type.strip().lower(),
        label=payload.label.strip(),
        value=payload.value.strip(),
        country_code=payload.country_code.upper() if payload.country_code else None,
        issuing_authority=payload.issuing_authority.strip() if payload.issuing_authority else None,
        issue_date=payload.issue_date,
        expiry_date=payload.expiry_date,
        is_primary=payload.is_primary,
    )
    db.add(item)
    db.flush()
    after = IdentifierRead.model_validate(item).model_dump(mode="json")
    _record_section_change(
        db, request, tenant,
        action="company.identifier.created",
        entity_type="organization_identifier",
        entity_id=item.id,
        before=None,
        after=after,
        message=f"Business identifier added: {item.label}",
    )
    db.commit()
    db.refresh(item)
    return IdentifierRead.model_validate(item)


@router.delete("/identifiers/{identifier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_identifier(
    identifier_id: str,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> None:
    item = db.scalar(
        select(OrganizationIdentifier).where(
            OrganizationIdentifier.id == identifier_id,
            OrganizationIdentifier.organization_id == tenant.organization_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Identifier not found")
    before = IdentifierRead.model_validate(item).model_dump(mode="json")
    db.delete(item)
    record_activity(
        db,
        action="company.identifier.deleted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="organization_identifier",
        entity_id=item.id,
        before=before,
        after=None,
        message=f"Business identifier removed: {item.label}",
        request=request,
    )
    db.commit()


@router.put("/addresses/{address_type}", response_model=AddressRead)
def upsert_address(
    address_type: str,
    payload: AddressUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> AddressRead:
    if address_type not in ADDRESS_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid address type")
    item = db.scalar(
        select(OrganizationAddress).where(
            OrganizationAddress.organization_id == tenant.organization_id,
            OrganizationAddress.address_type == address_type,
        )
    )
    before = AddressRead.model_validate(item).model_dump(mode="json") if item else None
    if item is None:
        item = OrganizationAddress(
            organization_id=tenant.organization_id,
            address_type=address_type,
        )
        db.add(item)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        if field == "country_code" and value:
            value = value.upper()
        setattr(item, field, value)
    db.flush()
    after = AddressRead.model_validate(item).model_dump(mode="json")
    _record_section_change(
        db, request, tenant,
        action="company.address.updated",
        entity_type="organization_address",
        entity_id=item.id,
        before=before,
        after=after,
        message=f"{address_type.title()} address updated",
    )
    db.commit()
    db.refresh(item)
    return AddressRead.model_validate(item)


@router.patch("/localization", response_model=LocalizationRead)
def update_localization(
    payload: LocalizationUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> LocalizationRead:
    item = _required(
        db.scalar(
            select(OrganizationLocalizationSettings).where(
                OrganizationLocalizationSettings.organization_id == tenant.organization_id
            )
        ),
        "localization",
    )
    canonical_accounting_currency = tenant.organization.currency.upper()
    if payload.currency.upper() != canonical_accounting_currency:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Currency roles are managed in Company Settings → Currencies & FX. Localization cannot change the accounting currency.",
        )
    before = {
        "organization": {
            "country_code": tenant.organization.country_code,
            "timezone": tenant.organization.timezone,
            "currency": canonical_accounting_currency,
        },
        "settings": LocalizationRead.model_validate(item).model_dump(mode="json"),
    }
    tenant.organization.country_code = payload.country_code.upper()
    tenant.organization.timezone = payload.timezone.strip()
    for field in (
        "default_language", "date_format", "time_format", "number_format",
        "decimal_places", "currency_position", "first_day_of_week",
    ):
        setattr(item, field, getattr(payload, field))
    db.flush()
    after = {
        "organization": {
            "country_code": tenant.organization.country_code,
            "timezone": tenant.organization.timezone,
            "currency": canonical_accounting_currency,
        },
        "settings": LocalizationRead.model_validate(item).model_dump(mode="json"),
    }
    _record_section_change(
        db, request, tenant,
        action="company.localization.updated",
        entity_type="organization_localization_settings",
        entity_id=item.id,
        before=before,
        after=after,
        message="Company localization settings updated",
    )
    db.commit()
    db.refresh(item)
    return LocalizationRead.model_validate(item)


@router.patch("/financial", response_model=FinancialRead)
def update_financial(
    payload: FinancialUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> FinancialRead:
    item = _required(
        db.scalar(
            select(OrganizationFinancialSettings).where(
                OrganizationFinancialSettings.organization_id == tenant.organization_id
            )
        ),
        "financial",
    )
    canonical_accounting_currency = tenant.organization.currency.upper()
    if payload.accounting_currency.upper() != canonical_accounting_currency:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Accounting currency is managed in Company Settings → Currencies & FX.",
        )
    before = {
        "financial_year_start_month": tenant.organization.financial_year_start_month,
        "settings": FinancialRead.model_validate(item).model_dump(mode="json"),
    }
    tenant.organization.financial_year_start_month = payload.financial_year_start_month
    # Keep the duplicate compatibility field aligned with the canonical functional
    # currency. Reporting currency is intentionally untouched by this endpoint.
    item.accounting_currency = canonical_accounting_currency
    item.default_payment_terms_days = payload.default_payment_terms_days
    item.tax_calculation_mode = payload.tax_calculation_mode
    item.default_tax_rate = payload.default_tax_rate
    item.prices_include_tax = payload.prices_include_tax
    db.flush()
    after = {
        "financial_year_start_month": tenant.organization.financial_year_start_month,
        "settings": FinancialRead.model_validate(item).model_dump(mode="json"),
    }
    _record_section_change(
        db, request, tenant,
        action="company.financial.updated",
        entity_type="organization_financial_settings",
        entity_id=item.id,
        before=before,
        after=after,
        message="Company finance and tax defaults updated",
    )
    db.commit()
    db.refresh(item)
    return FinancialRead.model_validate(item)


@router.put("/sequences/{document_type}", response_model=SequenceRead)
def update_sequence(
    document_type: str,
    payload: SequenceUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> SequenceRead:
    if document_type not in SEQUENCE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid document type")
    item = db.scalar(
        select(OrganizationDocumentSequence).where(
            OrganizationDocumentSequence.organization_id == tenant.organization_id,
            OrganizationDocumentSequence.document_type == document_type,
        )
    )
    before = SequenceRead.model_validate(item).model_dump(mode="json") if item else None
    if item is None:
        item = OrganizationDocumentSequence(
            organization_id=tenant.organization_id,
            document_type=document_type,
            prefix=payload.prefix.strip().upper(),
        )
        db.add(item)
    item.prefix = payload.prefix.strip().upper()
    item.next_number = payload.next_number
    item.padding = payload.padding
    item.separator = payload.separator
    db.flush()
    after = SequenceRead.model_validate(item).model_dump(mode="json")
    _record_section_change(
        db, request, tenant,
        action="company.numbering.updated",
        entity_type="organization_document_sequence",
        entity_id=item.id,
        before=before,
        after=after,
        message=f"{document_type.title()} numbering settings updated",
    )
    db.commit()
    db.refresh(item)
    return SequenceRead.model_validate(item)


@router.patch("/branding", response_model=BrandingRead)
def update_branding(
    payload: BrandingUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> BrandingRead:
    item = _required(
        db.scalar(
            select(OrganizationBranding).where(
                OrganizationBranding.organization_id == tenant.organization_id
            )
        ),
        "branding",
    )
    before = BrandingRead.model_validate(item).model_dump(mode="json")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(item, field, value)
    db.flush()
    after = BrandingRead.model_validate(item).model_dump(mode="json")
    _record_section_change(
        db, request, tenant,
        action="company.branding.updated",
        entity_type="organization_branding",
        entity_id=item.id,
        before=before,
        after=after,
        message="Company branding settings updated",
    )
    db.commit()
    db.refresh(item)
    return BrandingRead.model_validate(item)


@router.patch("/online-legal", response_model=OnlineLegalRead)
def update_online_legal(
    payload: OnlineLegalUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> OnlineLegalRead:
    item = _required(
        db.scalar(
            select(OrganizationOnlineProfile).where(
                OrganizationOnlineProfile.organization_id == tenant.organization_id
            )
        ),
        "online profile",
    )
    before = OnlineLegalRead.model_validate(item).model_dump(mode="json")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(item, field, value)
    db.flush()
    after = OnlineLegalRead.model_validate(item).model_dump(mode="json")
    _record_section_change(
        db, request, tenant,
        action="company.online_legal.updated",
        entity_type="organization_online_profile",
        entity_id=item.id,
        before=before,
        after=after,
        message="Company online and legal links updated",
    )
    db.commit()
    db.refresh(item)
    return OnlineLegalRead.model_validate(item)


@router.post("/documents", response_model=CompanyDocumentRead, status_code=status.HTTP_201_CREATED)
def create_company_document(
    payload: CompanyDocumentCreate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> CompanyDocumentRead:
    item = OrganizationDocument(
        organization_id=tenant.organization_id,
        document_type=payload.document_type.strip().lower(),
        title=payload.title.strip(),
        document_number=payload.document_number.strip() if payload.document_number else None,
        issuing_authority=payload.issuing_authority.strip() if payload.issuing_authority else None,
        issue_date=payload.issue_date,
        expiry_date=payload.expiry_date,
        file_url=payload.file_url.strip() if payload.file_url else None,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(item)
    db.flush()
    after = CompanyDocumentRead.model_validate(item).model_dump(mode="json")
    _record_section_change(
        db, request, tenant,
        action="company.document.created",
        entity_type="organization_document",
        entity_id=item.id,
        before=None,
        after=after,
        message=f"Company document added: {item.title}",
    )
    db.commit()
    db.refresh(item)
    return CompanyDocumentRead.model_validate(item)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company_document(
    document_id: str,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> None:
    item = db.scalar(
        select(OrganizationDocument).where(
            OrganizationDocument.id == document_id,
            OrganizationDocument.organization_id == tenant.organization_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    before = CompanyDocumentRead.model_validate(item).model_dump(mode="json")
    db.delete(item)
    record_activity(
        db,
        action="company.document.deleted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="organization_document",
        entity_id=item.id,
        before=before,
        after=None,
        message=f"Company document removed: {item.title}",
        request=request,
    )
    db.commit()