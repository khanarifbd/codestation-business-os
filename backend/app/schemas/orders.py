from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


OrderStatus = Literal["confirmed", "in_progress", "completed", "cancelled"]
TaxCalculationMode = Literal["exclusive", "inclusive"]
CustomSalesItemType = Literal["service", "non_stock_item"]


class OrderStatusChange(BaseModel):
    status: Literal["in_progress", "completed", "cancelled"]


class OrderItemInput(BaseModel):
    product_id: str | None = None
    item_name: str | None = Field(default=None, max_length=220)
    item_type: CustomSalesItemType = "service"
    unit: str = Field(default="unit", min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=4000)
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=4)
    unit_price: Decimal = Field(ge=0, max_digits=16, decimal_places=4)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=7, decimal_places=4)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=8, decimal_places=4)


class ManualOrderCreate(BaseModel):
    client_id: str
    subject: str | None = Field(default=None, max_length=220)
    order_date: date
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    tax_calculation_mode: TaxCalculationMode | None = None
    assigned_employee_id: str | None = None
    source: str | None = Field(default=None, max_length=100)
    external_order_id: str | None = Field(default=None, max_length=180)
    notes: str | None = None
    terms_conditions: str | None = None
    internal_notes: str | None = None
    items: list[OrderItemInput] = Field(min_length=1, max_length=200)


class OrderItemRead(BaseModel):
    id: str
    quotation_item_id: str | None
    product_id: str | None
    sort_order: int
    item_name_snapshot: str
    sku_snapshot: str | None
    item_type_snapshot: str
    unit_snapshot: str
    description: str
    quantity: Decimal
    fulfilled_quantity: Decimal = Decimal("0")
    remaining_quantity: Decimal = Decimal("0")
    unit_price: Decimal
    discount_percent: Decimal
    tax_rate: Decimal
    line_subtotal: Decimal
    discount_amount: Decimal
    taxable_amount: Decimal
    tax_amount: Decimal
    line_total: Decimal


class OrderListItem(BaseModel):
    id: str
    order_number: str
    quotation_id: str | None
    quotation_number: str | None
    client_id: str
    client_name: str
    source: str | None
    external_order_id: str | None
    status: str
    subject: str | None
    order_date: date
    currency: str
    total: Decimal
    assigned_employee_id: str | None
    assigned_employee_name: str | None
    created_at: datetime
    updated_at: datetime


class OrderPage(BaseModel):
    items: list[OrderListItem]
    next_cursor: str | None


class OrderDetail(BaseModel):
    id: str
    order_number: str
    quotation_id: str | None
    quotation_number: str | None
    client_id: str
    source_lead_id: str | None
    assigned_employee_id: str | None
    assigned_employee_name: str | None
    source: str | None
    external_order_id: str | None
    status: str
    subject: str | None
    order_date: date
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
    confirmed_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    items: list[OrderItemRead]
    created_at: datetime
    updated_at: datetime


class OrderSummary(BaseModel):
    total: int
    confirmed: int
    in_progress: int
    completed: int
    cancelled: int


class FulfillmentLineInput(BaseModel):
    order_item_id: str
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=4)


class FulfillmentCreate(BaseModel):
    warehouse_id: str
    fulfillment_date: date
    reference: str | None = Field(default=None, max_length=180)
    items: list[FulfillmentLineInput] = Field(min_length=1, max_length=200)


class FulfillmentReverse(BaseModel):
    reversal_date: date
    reason: str = Field(min_length=3, max_length=1000)


class FulfillmentItemRead(BaseModel):
    id: str
    order_item_id: str
    product_id: str
    item_name: str
    sku: str | None
    quantity: Decimal
    currency: str
    base_currency: str
    unit_cost: Decimal
    total_cost: Decimal
    unit_cost_base: Decimal
    total_cost_base: Decimal
    effective_rate_to_base: Decimal


class FulfillmentRead(BaseModel):
    id: str
    fulfillment_number: str
    order_id: str
    warehouse_id: str
    warehouse_name: str
    fulfillment_date: date
    status: str
    reference: str | None
    currency: str
    base_currency: str
    total_cogs: Decimal
    total_cogs_base: Decimal
    reversal_date: date | None
    reversal_reason: str | None
    reversed_at: datetime | None
    items: list[FulfillmentItemRead]
    created_at: datetime
