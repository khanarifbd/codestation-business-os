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


class PlatformOrganizationDirectoryItem(BaseModel):
    organization: OrganizationRead
    subscription: SubscriptionRead | None
    created_by_email: EmailStr
    created_by_name: str
    member_count: int
    active_member_count: int
    created_at: datetime


class PlatformOrganizationDirectoryPage(BaseModel):
    items: list[PlatformOrganizationDirectoryItem]
    total: int
    limit: int
    offset: int
    country_codes: list[str]
    plan_codes: list[str]


class PlatformOrganizationMemberRead(BaseModel):
    membership_id: str
    user_id: str
    full_name: str
    email: EmailStr
    username: str | None
    role_id: str
    role_name: str
    role_slug: str
    membership_status: str
    is_owner: bool
    user_is_active: bool
    user_is_verified: bool
    joined_at: datetime


class PlatformOrganizationUsageRead(BaseModel):
    employees: int
    active_employees: int
    clients: int
    active_clients: int
    leads: int
    quotations: int
    orders: int
    open_orders: int
    projects: int
    active_projects: int
    invoices: int
    open_invoices: int


class PlatformOrganizationActivityRead(BaseModel):
    id: str
    action: str
    outcome: str
    message: str | None
    actor_user_id: str | None
    actor_name: str | None
    actor_email: EmailStr | None
    entity_type: str | None
    entity_id: str | None
    created_at: datetime


class PlatformOrganizationDetailRead(BaseModel):
    organization: OrganizationRead
    subscription: SubscriptionRead | None
    created_at: datetime
    updated_at: datetime
    created_by_user_id: str
    created_by_name: str
    created_by_email: EmailStr
    members: list[PlatformOrganizationMemberRead]
    usage: PlatformOrganizationUsageRead
    recent_activity: list[PlatformOrganizationActivityRead]


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
