from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    country_code: str = Field(default="BD", min_length=2, max_length=2)
    timezone: str = Field(default="Asia/Dhaka", min_length=2, max_length=64)
    currency: str = Field(default="BDT", min_length=3, max_length=3)
    business_type: str | None = Field(default=None, max_length=80)
    team_size: str | None = Field(default=None, max_length=32)
    financial_year_start_month: int = Field(default=1, ge=1, le=12)


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
