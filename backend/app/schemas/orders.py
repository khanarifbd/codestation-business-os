from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


OrderStatus = Literal["confirmed", "in_progress", "completed", "cancelled"]


class OrderStatusChange(BaseModel):
    status: Literal["in_progress", "completed", "cancelled"]


class OrderItemRead(BaseModel):
    id: str
    quotation_item_id: str | None
    sort_order: int
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


class OrderListItem(BaseModel):
    id: str
    order_number: str
    quotation_id: str
    quotation_number: str
    client_id: str
    client_name: str
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
    quotation_id: str
    quotation_number: str
    client_id: str
    source_lead_id: str | None
    assigned_employee_id: str | None
    assigned_employee_name: str | None
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
