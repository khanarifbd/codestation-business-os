from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.localization import (
    normalize_country_code,
    normalize_currency_code,
    normalize_timezone,
)


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    country_code: str = Field(default="BD", min_length=2, max_length=2)
    timezone: str = Field(default="Asia/Dhaka", min_length=2, max_length=64)
    currency: str = Field(default="BDT", min_length=3, max_length=3)
    business_type: str | None = Field(default=None, max_length=80)
    team_size: str | None = Field(default=None, max_length=32)
    financial_year_start_month: int = Field(default=1, ge=1, le=12)

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


class OrganizationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    status: str
    suspension_reason: str | None
    suspended_at: datetime | None
    country_code: str
    timezone: str
    currency: str
    business_type: str | None
    team_size: str | None
    financial_year_start_month: int
    setup_completed: bool
    created_by_user_id: str


class OrganizationMembershipRead(BaseModel):
    organization: OrganizationRead
    membership_id: str
    role_id: str
    role: str
    role_name: str
    role_slug: str
    status: str
    is_owner: bool
    relationships: list[str]
    primary_relationship: str
