from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LeadStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    slug: str
    color: str | None
    category: str
    sort_order: int
    is_default: bool
    is_active: bool


class LeadStatusCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str | None = Field(default=None, max_length=16, pattern=r"^#[0-9A-Fa-f]{6}$")
    category: Literal["open", "qualified", "won", "lost"] = "open"
    sort_order: int = Field(default=100, ge=0, le=10000)
    is_default: bool = False


class LeadStatusUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, max_length=16, pattern=r"^#[0-9A-Fa-f]{6}$")
    category: Literal["open", "qualified", "won", "lost"] | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_default: bool | None = None
    is_active: bool | None = None


class LeadSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    slug: str
    sort_order: int
    is_active: bool


class LeadSourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(default=100, ge=0, le=10000)


class LeadSourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None


class CrmEmployeeOption(BaseModel):
    id: str
    employee_code: str
    full_name: str


class CrmMetaRead(BaseModel):
    statuses: list[LeadStatusRead]
    sources: list[LeadSourceRead]
    employees: list[CrmEmployeeOption]
    default_country_code: str | None
    default_currency: str | None


class LeadInterestInput(BaseModel):
    product_id: str | None = None
    item_name: str | None = Field(default=None, max_length=220)
    description: str | None = None
    item_type: Literal["service", "non_stock_item"] = "service"
    unit: str = Field(default="unit", min_length=1, max_length=40)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, le=Decimal("100000000"))
    estimated_unit_price: Decimal | None = Field(default=None, ge=0, le=Decimal("1000000000000"))
    notes: str | None = None


class LeadInterestRead(BaseModel):
    id: str
    product_id: str | None
    sort_order: int
    item_name_snapshot: str
    description: str | None
    item_type_snapshot: str
    unit_snapshot: str
    currency: str
    quantity: Decimal
    estimated_unit_price: Decimal | None
    notes: str | None


class LeadInterestReplace(BaseModel):
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    interests: list[LeadInterestInput] = Field(default_factory=list, max_length=100)


class LeadCreate(BaseModel):
    lead_type: Literal["company", "individual"] = "company"
    company_name: str | None = Field(default=None, max_length=220)
    contact_name: str = Field(min_length=1, max_length=180)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=64)
    whatsapp: str | None = Field(default=None, max_length=64)
    website: str | None = Field(default=None, max_length=500)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    state_region: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    address_line1: str | None = Field(default=None, max_length=250)
    source_id: str | None = None
    status_id: str | None = None
    assigned_employee_id: str | None = None
    estimated_value: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    probability_percent: int = Field(default=0, ge=0, le=100)
    next_follow_up_at: datetime | None = None
    notes: str | None = None


class LeadUpdate(BaseModel):
    lead_type: Literal["company", "individual"] | None = None
    company_name: str | None = Field(default=None, max_length=220)
    contact_name: str | None = Field(default=None, min_length=1, max_length=180)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=64)
    whatsapp: str | None = Field(default=None, max_length=64)
    website: str | None = Field(default=None, max_length=500)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    state_region: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    address_line1: str | None = Field(default=None, max_length=250)
    source_id: str | None = None
    status_id: str | None = None
    assigned_employee_id: str | None = None
    estimated_value: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    probability_percent: int | None = Field(default=None, ge=0, le=100)
    next_follow_up_at: datetime | None = None
    notes: str | None = None


class LeadListItem(BaseModel):
    id: str
    lead_code: str
    lead_type: str
    company_name: str | None
    contact_name: str
    email: str | None
    phone: str | None
    status_id: str
    status_name: str
    status_color: str | None
    status_category: str
    source_id: str | None
    source_name: str | None
    assigned_employee_id: str | None
    assigned_employee_name: str | None
    estimated_value: Decimal | None
    currency: str | None
    probability_percent: int
    next_follow_up_at: datetime | None
    converted_client_id: str | None
    created_at: datetime
    updated_at: datetime


class LeadPage(BaseModel):
    items: list[LeadListItem]
    next_cursor: str | None


class LeadInteractionCreate(BaseModel):
    interaction_type: Literal["note", "call", "email", "meeting", "follow_up"] = "note"
    subject: str | None = Field(default=None, max_length=180)
    body: str | None = None
    scheduled_at: datetime | None = None
    completed_at: datetime | None = None


class LeadInteractionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    interaction_type: str
    subject: str | None
    body: str | None
    scheduled_at: datetime | None
    completed_at: datetime | None
    created_by_user_id: str
    created_at: datetime


class LeadDetail(BaseModel):
    lead: LeadListItem
    website: str | None
    whatsapp: str | None
    country_code: str | None
    state_region: str | None
    city: str | None
    address_line1: str | None
    notes: str | None
    interests: list[LeadInterestRead] = Field(default_factory=list)
    interactions: list[LeadInteractionRead]


class ClientCreate(BaseModel):
    client_type: Literal["company", "individual"] = "company"
    display_name: str = Field(min_length=1, max_length=220)
    legal_name: str | None = Field(default=None, max_length=220)
    contact_name: str | None = Field(default=None, max_length=180)
    email: EmailStr | None = None
    billing_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=64)
    whatsapp: str | None = Field(default=None, max_length=64)
    website: str | None = Field(default=None, max_length=500)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    state_region: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=32)
    address_line1: str | None = Field(default=None, max_length=250)
    address_line2: str | None = Field(default=None, max_length=250)
    tax_identifier: str | None = Field(default=None, max_length=180)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    assigned_employee_id: str | None = None
    notes: str | None = None


class ClientUpdate(BaseModel):
    client_type: Literal["company", "individual"] | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=220)
    legal_name: str | None = Field(default=None, max_length=220)
    contact_name: str | None = Field(default=None, max_length=180)
    email: EmailStr | None = None
    billing_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=64)
    whatsapp: str | None = Field(default=None, max_length=64)
    website: str | None = Field(default=None, max_length=500)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    state_region: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=32)
    address_line1: str | None = Field(default=None, max_length=250)
    address_line2: str | None = Field(default=None, max_length=250)
    tax_identifier: str | None = Field(default=None, max_length=180)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    assigned_employee_id: str | None = None
    status: Literal["active", "inactive"] | None = None
    notes: str | None = None


class ClientListItem(BaseModel):
    id: str
    client_code: str
    client_type: str
    display_name: str
    contact_name: str | None
    email: str | None
    phone: str | None
    country_code: str | None
    currency: str | None
    status: str
    assigned_employee_id: str | None
    assigned_employee_name: str | None
    created_at: datetime
    updated_at: datetime


class ClientPage(BaseModel):
    items: list[ClientListItem]
    next_cursor: str | None


class LeadConvertRequest(BaseModel):
    client_type: Literal["company", "individual"] | None = None
    display_name: str | None = Field(default=None, max_length=220)
    legal_name: str | None = Field(default=None, max_length=220)
    contact_name: str | None = Field(default=None, max_length=180)
    email: EmailStr | None = None
    billing_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=64)
    whatsapp: str | None = Field(default=None, max_length=64)
    website: str | None = Field(default=None, max_length=500)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    state_region: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=32)
    address_line1: str | None = Field(default=None, max_length=250)
    address_line2: str | None = Field(default=None, max_length=250)
    tax_identifier: str | None = Field(default=None, max_length=180)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    assigned_employee_id: str | None = None
    notes: str | None = None
