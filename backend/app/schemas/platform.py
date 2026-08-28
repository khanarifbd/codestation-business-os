from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.organization import OrganizationRead


class SubscriptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    plan_code: str
    status: str
    billing_cycle: str
    trial_ends_at: datetime | None
    current_period_start: datetime | None
    current_period_end: datetime | None
    canceled_at: datetime | None


class PlatformOrganizationRead(BaseModel):
    organization: OrganizationRead
    subscription: SubscriptionRead | None
    admin_email: EmailStr
    admin_name: str


class PlatformUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: str
    system_role: str
    is_active: bool
    is_verified: bool
    created_at: datetime


class PlatformSummaryRead(BaseModel):
    total_users: int
    active_users: int
    suspended_users: int
    verified_users: int
    unverified_users: int
    new_users_7d: int
    new_users_30d: int

    total_companies: int
    active_companies: int
    suspended_companies: int
    setup_incomplete_companies: int
    new_companies_7d: int
    new_companies_30d: int

    total_subscriptions: int
    trialing_subscriptions: int
    active_subscriptions: int
    past_due_subscriptions: int
    suspended_subscriptions: int
    canceled_subscriptions: int
    trials_ending_7d: int
    periods_ending_7d: int
    companies_without_subscription: int


class OrganizationStatusUpdate(BaseModel):
    status: Literal["active", "suspended"]
    reason: str | None = Field(default=None, max_length=500)


class UserStatusUpdate(BaseModel):
    is_active: bool


class SubscriptionUpdate(BaseModel):
    plan_code: str | None = Field(default=None, min_length=1, max_length=64)
    status: Literal["trialing", "active", "past_due", "canceled", "suspended"] | None = None
    billing_cycle: Literal["monthly", "yearly"] | None = None
    current_period_end: datetime | None = None
