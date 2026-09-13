from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class ServiceDurationUpdate(BaseModel):
    duration_months: int | None = Field(default=None, ge=1, le=120)


class ServiceCatalogRead(BaseModel):
    product_id: str
    sku: str
    name: str
    currency: str
    selling_price: Decimal
    duration_months: int | None
    is_active: bool


class ServicePeriodUpdate(BaseModel):
    start_date: date


class ClientServiceRead(BaseModel):
    order_item_id: str
    order_id: str
    order_number: str
    order_status: str
    product_id: str | None
    sku: str | None
    name: str
    quantity: Decimal
    currency: str
    line_total: Decimal
    duration_months: int | None
    start_date: date | None
    end_date: date | None
    service_status: str


class ServiceSalesRow(BaseModel):
    product_id: str
    sku: str
    name: str
    currency: str
    duration_months: int | None
    quoted_quantity: Decimal
    quoted_value: Decimal
    ordered_quantity: Decimal
    ordered_value: Decimal
    invoiced_quantity: Decimal
    invoiced_value: Decimal
    fully_paid_invoice_value: Decimal
    active_terms: int
    upcoming_terms: int
    expired_terms: int
