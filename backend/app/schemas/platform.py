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


class PlatformSummaryRead(BaseModel):
    total_users: int
    total_companies: int
    active_companies: int
    suspended_companies: int
    trialing_subscriptions: int
    active_subscriptions: int


class OrganizationStatusUpdate(BaseModel):
    status: Literal["active", "suspended"]
    reason: str | None = Field(default=None, max_length=500)


class SubscriptionUpdate(BaseModel):
    plan_code: str | None = Field(default=None, min_length=1, max_length=64)
    status: Literal["trialing", "active", "past_due", "canceled", "suspended"] | None = None
    billing_cycle: Literal["monthly", "yearly"] | None = None
    current_period_end: datetime | None = None
