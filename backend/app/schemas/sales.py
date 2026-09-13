from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

QuotationStatus = Literal["draft", "sent", "accepted", "rejected", "cancelled"]
TaxCalculationMode = Literal["exclusive", "inclusive"]
CustomSalesItemType = Literal["service", "non_stock_item"]


class QuotationItemInput(BaseModel):
    product_id: str | None = None
    lead_interest_id: str | None = None
    item_name: str | None = Field(default=None, max_length=220)
    item_type: CustomSalesItemType = "service"
    unit: str = Field(default="unit", min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=4000)
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=4)
    unit_price: Decimal = Field(ge=0, max_digits=16, decimal_places=4)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=7, decimal_places=4)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=8, decimal_places=4)


class QuotationItemRead(BaseModel):
    id: str
    product_id: str | None
    lead_interest_id: str | None
    sort_order: int
    item_name_snapshot: str
    sku_snapshot: str | None
    item_type_snapshot: str
    unit_snapshot: str
    description: str
    quantity: Decimal
    unit_price: Decimal
    discount_percent: Decimal
    tax_rate: Decimal
    line_subtotal: Decimal
    discount_amount: Decimal
    taxable_amount: Decimal
    tax_amount: Decimal
    line_total: Decimal


class QuotationCreate(BaseModel):
    client_id: str
    source_lead_id: str | None = None
    subject: str | None = Field(default=None, max_length=220)
    issue_date: date
    valid_until: date | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    tax_calculation_mode: TaxCalculationMode | None = None
    assigned_employee_id: str | None = None
    notes: str | None = None
    terms_conditions: str | None = None
    internal_notes: str | None = None
    items: list[QuotationItemInput] = Field(min_length=1, max_length=200)


class QuotationUpdate(BaseModel):
    subject: str | None = Field(default=None, max_length=220)
    issue_date: date | None = None
    valid_until: date | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    tax_calculation_mode: TaxCalculationMode | None = None
    assigned_employee_id: str | None = None
    notes: str | None = None
    terms_conditions: str | None = None
    internal_notes: str | None = None
    items: list[QuotationItemInput] | None = Field(default=None, min_length=1, max_length=200)


class QuotationStatusChange(BaseModel):
    status: Literal["sent", "accepted", "rejected", "cancelled"]


class QuotationListItem(BaseModel):
    id: str
    quotation_number: str
    client_id: str
    client_name: str
    status: str
    subject: str | None
    issue_date: date
    valid_until: date | None
    currency: str
    total: Decimal
    assigned_employee_id: str | None
    assigned_employee_name: str | None
    is_expired: bool
    created_at: datetime
    updated_at: datetime


class QuotationPage(BaseModel):
    items: list[QuotationListItem]
    next_cursor: str | None


class QuotationDetail(BaseModel):
    id: str
    quotation_number: str
    client_id: str
    source_lead_id: str | None
    assigned_employee_id: str | None
    assigned_employee_name: str | None
    status: str
    subject: str | None
    issue_date: date
    valid_until: date | None
    currency: str
    tax_calculation_mode: str
    seller_name_snapshot: str
    seller_email_snapshot: str | None
    seller_address_snapshot: str | None
    seller_tax_identifier_snapshot: str | None
    client_name_snapshot: str
    client_contact_snapshot: str | None
    client_email_snapshot: str | None
    client_address_snapshot: str | None
    client_tax_identifier_snapshot: str | None
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal
    notes: str | None
    terms_conditions: str | None
    internal_notes: str | None
    sent_at: datetime | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    cancelled_at: datetime | None
    is_expired: bool
    items: list[QuotationItemRead]
    created_at: datetime
    updated_at: datetime


class QuotationSummary(BaseModel):
    total: int
    draft: int
    sent: int
    accepted: int
    rejected: int
    cancelled: int


class SalesClientOption(BaseModel):
    id: str
    client_code: str
    display_name: str
    currency: str | None
    contact_name: str | None


class SalesEmployeeOption(BaseModel):
    id: str
    employee_code: str
    full_name: str


class SalesCatalogOption(BaseModel):
    id: str
    sku: str
    name: str
    description: str | None
    item_type: str
    unit: str
    currency: str
    selling_price: Decimal
    tax_rate: Decimal | None


class LeadQuotationInterest(BaseModel):
    id: str
    product_id: str | None
    item_name: str
    description: str | None
    item_type: str
    unit: str
    currency: str
    quantity: Decimal
    estimated_unit_price: Decimal | None


class LeadQuotationSource(BaseModel):
    lead_id: str
    lead_code: str
    client_id: str
    client_name: str
    currency: str
    subject: str
    interests: list[LeadQuotationInterest]


class SalesMeta(BaseModel):
    default_currency: str
    default_tax_calculation_mode: str
    default_tax_rate: Decimal
    default_validity_days: int
    employees: list[SalesEmployeeOption]
