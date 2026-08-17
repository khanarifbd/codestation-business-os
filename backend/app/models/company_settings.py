from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin, tenant_index, tenant_unique_constraint


class OrganizationProfile(TenantOwnedMixin, Base):
    __tablename__ = "organization_profiles"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_organization_profiles_organization_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    legal_name: Mapped[str | None] = mapped_column(String(220), nullable=True)
    trading_name: Mapped[str | None] = mapped_column(String(220), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(120), nullable=True)
    company_size: Mapped[str | None] = mapped_column(String(32), nullable=True)
    incorporation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    primary_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    billing_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    support_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    alternate_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    whatsapp: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fax: Mapped[str | None] = mapped_column(String(64), nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class OrganizationIdentifier(TenantOwnedMixin, Base):
    __tablename__ = "organization_identifiers"
    __table_args__ = (
        tenant_unique_constraint("organization_identifiers", "identifier_type", "value"),
        tenant_index("organization_identifiers", "identifier_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    identifier_type: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    value: Mapped[str] = mapped_column(String(180), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    issuing_authority: Mapped[str | None] = mapped_column(String(180), nullable=True)
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class OrganizationAddress(TenantOwnedMixin, Base):
    __tablename__ = "organization_addresses"
    __table_args__ = (
        tenant_unique_constraint("organization_addresses", "address_type"),
        tenant_index("organization_addresses", "country_code"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    address_type: Mapped[str] = mapped_column(String(32), nullable=False)
    recipient_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    line1: Mapped[str | None] = mapped_column(String(250), nullable=True)
    line2: Mapped[str | None] = mapped_column(String(250), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state_region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class OrganizationLocalizationSettings(TenantOwnedMixin, Base):
    __tablename__ = "organization_localization_settings"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_org_localization_organization_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    default_language: Mapped[str] = mapped_column(String(16), default="en", nullable=False)
    date_format: Mapped[str] = mapped_column(String(32), default="YYYY-MM-DD", nullable=False)
    time_format: Mapped[str] = mapped_column(String(16), default="24h", nullable=False)
    number_format: Mapped[str] = mapped_column(String(32), default="1,234.56", nullable=False)
    decimal_places: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    currency_position: Mapped[str] = mapped_column(String(16), default="before", nullable=False)
    first_day_of_week: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class OrganizationFinancialSettings(TenantOwnedMixin, Base):
    __tablename__ = "organization_financial_settings"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_org_financial_organization_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    accounting_currency: Mapped[str] = mapped_column(String(3), default="BDT", nullable=False)
    reporting_currency: Mapped[str] = mapped_column(String(3), default="BDT", nullable=False)
    default_payment_terms_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    tax_calculation_mode: Mapped[str] = mapped_column(String(16), default="exclusive", nullable=False)
    default_tax_rate: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0"), nullable=False)
    prices_include_tax: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class OrganizationDocumentSequence(TenantOwnedMixin, Base):
    __tablename__ = "organization_document_sequences"
    __table_args__ = (
        tenant_unique_constraint("organization_document_sequences", "document_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    document_type: Mapped[str] = mapped_column(String(40), nullable=False)
    prefix: Mapped[str] = mapped_column(String(24), nullable=False)
    next_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    padding: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    separator: Mapped[str] = mapped_column(String(4), default="-", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class OrganizationBranding(TenantOwnedMixin, Base):
    __tablename__ = "organization_branding"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_organization_branding_organization_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    logo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    square_icon_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    invoice_logo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    primary_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    secondary_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    document_footer: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class OrganizationOnlineProfile(TenantOwnedMixin, Base):
    __tablename__ = "organization_online_profiles"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_org_online_profile_organization_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    privacy_policy_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    terms_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    linkedin_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    facebook_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    x_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    instagram_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    youtube_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class OrganizationDocument(TenantOwnedMixin, Base):
    __tablename__ = "organization_documents"
    __table_args__ = (
        tenant_index("org_documents", "document_type", "expiry_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    document_type: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    document_number: Mapped[str | None] = mapped_column(String(180), nullable=True)
    issuing_authority: Mapped[str | None] = mapped_column(String(180), nullable=True)
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    file_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
