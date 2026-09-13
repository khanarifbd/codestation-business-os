from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.localization import (
    normalize_country_code,
    normalize_currency_code,
    normalize_timezone,
)
from app.schemas.organization import OrganizationRead


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    legal_name: str | None
    trading_name: str | None
    industry: str | None
    company_size: str | None
    incorporation_date: date | None
    website: str | None
    description: str | None
    primary_email: EmailStr | None
    billing_email: EmailStr | None
    support_email: EmailStr | None
    phone: str | None
    alternate_phone: str | None
    whatsapp: str | None
    fax: str | None
    internal_notes: str | None


class ProfileUpdate(BaseModel):
    legal_name: str | None = Field(default=None, max_length=220)
    trading_name: str | None = Field(default=None, max_length=220)
    industry: str | None = Field(default=None, max_length=120)
    company_size: str | None = Field(default=None, max_length=32)
    incorporation_date: date | None = None
    website: str | None = Field(default=None, max_length=500)
    description: str | None = None
    primary_email: EmailStr | None = None
    billing_email: EmailStr | None = None
    support_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=64)
    alternate_phone: str | None = Field(default=None, max_length=64)
    whatsapp: str | None = Field(default=None, max_length=64)
    fax: str | None = Field(default=None, max_length=64)
    internal_notes: str | None = None


class CoreCompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    business_type: str | None = Field(default=None, max_length=80)
    team_size: str | None = Field(default=None, max_length=32)


class IdentifierBase(BaseModel):
    identifier_type: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=180)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    issuing_authority: str | None = Field(default=None, max_length=180)
    issue_date: date | None = None
    expiry_date: date | None = None
    is_primary: bool = False

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, value: str | None) -> str | None:
        return normalize_country_code(value) if value else None


class IdentifierCreate(IdentifierBase):
    pass


class IdentifierRead(IdentifierBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str


class AddressUpdate(BaseModel):
    recipient_name: str | None = Field(default=None, max_length=180)
    line1: str | None = Field(default=None, max_length=250)
    line2: str | None = Field(default=None, max_length=250)
    city: str | None = Field(default=None, max_length=120)
    state_region: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=32)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, value: str | None) -> str | None:
        return normalize_country_code(value) if value else None


class AddressRead(AddressUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    address_type: str


class LocalizationUpdate(BaseModel):
    country_code: str = Field(min_length=2, max_length=2)
    timezone: str = Field(min_length=2, max_length=64)
    currency: str = Field(min_length=3, max_length=3)
    default_language: str = Field(min_length=2, max_length=16)
    date_format: str = Field(min_length=2, max_length=32)
    time_format: Literal["12h", "24h"]
    number_format: str = Field(min_length=2, max_length=32)
    decimal_places: int = Field(ge=0, le=6)
    currency_position: Literal["before", "after"]
    first_day_of_week: int = Field(ge=0, le=6)

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, value: str) -> str:
        return normalize_country_code(value)

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        return normalize_currency_code(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return normalize_timezone(value)


class LocalizationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    default_language: str
    date_format: str
    time_format: str
    number_format: str
    decimal_places: int
    currency_position: str
    first_day_of_week: int


class FinancialUpdate(BaseModel):
    financial_year_start_month: int = Field(ge=1, le=12)
    accounting_currency: str = Field(min_length=3, max_length=3)
    default_payment_terms_days: int = Field(ge=0, le=365)
    tax_calculation_mode: Literal["exclusive", "inclusive"]
    default_tax_rate: Decimal = Field(ge=0, le=100)
    prices_include_tax: bool

    @field_validator("accounting_currency")
    @classmethod
    def validate_accounting_currency(cls, value: str) -> str:
        return normalize_currency_code(value)


class FinancialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    accounting_currency: str
    reporting_currency: str
    default_payment_terms_days: int
    tax_calculation_mode: str
    default_tax_rate: Decimal
    prices_include_tax: bool


class SystemDefaultsUpdate(BaseModel):
    default_client_country_code: str | None = Field(default=None, min_length=2, max_length=2)
    default_client_currency: str | None = Field(default=None, min_length=3, max_length=3)
    default_document_language: str = Field(min_length=2, max_length=16)
    default_lead_status: str = Field(min_length=1, max_length=64)
    default_project_status: str = Field(min_length=1, max_length=64)
    default_order_status: str = Field(min_length=1, max_length=64)
    default_invoice_status: str = Field(min_length=1, max_length=64)
    quotation_validity_days: int = Field(ge=1, le=365)

    @field_validator("default_client_country_code")
    @classmethod
    def validate_default_country(cls, value: str | None) -> str | None:
        return normalize_country_code(value) if value else None

    @field_validator("default_client_currency")
    @classmethod
    def validate_default_currency(cls, value: str | None) -> str | None:
        return normalize_currency_code(value) if value else None


class SystemDefaultsRead(SystemDefaultsUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str


class SequenceUpdate(BaseModel):
    prefix: str = Field(min_length=1, max_length=24)
    next_number: int = Field(ge=1)
    padding: int = Field(ge=1, le=12)
    separator: str = Field(default="-", max_length=4)


class SequenceRead(SequenceUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    document_type: str


class BrandingUpdate(BaseModel):
    logo_url: str | None = Field(default=None, max_length=1000)
    square_icon_url: str | None = Field(default=None, max_length=1000)
    invoice_logo_url: str | None = Field(default=None, max_length=1000)
    primary_color: str | None = Field(default=None, max_length=16)
    secondary_color: str | None = Field(default=None, max_length=16)
    document_footer: str | None = None


class BrandingRead(BrandingUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str


class OnlineLegalUpdate(BaseModel):
    privacy_policy_url: str | None = Field(default=None, max_length=1000)
    terms_url: str | None = Field(default=None, max_length=1000)
    linkedin_url: str | None = Field(default=None, max_length=1000)
    facebook_url: str | None = Field(default=None, max_length=1000)
    x_url: str | None = Field(default=None, max_length=1000)
    instagram_url: str | None = Field(default=None, max_length=1000)
    youtube_url: str | None = Field(default=None, max_length=1000)


class OnlineLegalRead(OnlineLegalUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str


class CompanyDocumentCreate(BaseModel):
    document_type: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=180)
    document_number: str | None = Field(default=None, max_length=180)
    issuing_authority: str | None = Field(default=None, max_length=180)
    issue_date: date | None = None
    expiry_date: date | None = None
    file_url: str | None = Field(default=None, max_length=1000)
    notes: str | None = None


class CompanyDocumentRead(CompanyDocumentCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    created_at: datetime


class CompanySettingsBundle(BaseModel):
    organization: OrganizationRead
    profile: ProfileRead
    identifiers: list[IdentifierRead]
    addresses: list[AddressRead]
    localization: LocalizationRead
    financial: FinancialRead
    system_defaults: SystemDefaultsRead | None = None
    sequences: list[SequenceRead]
    branding: BrandingRead
    online_legal: OnlineLegalRead
    documents: list[CompanyDocumentRead]
