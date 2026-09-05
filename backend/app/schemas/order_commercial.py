from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

ChangeType = Literal["addition", "reduction", "cancellation"]
ChangeStatusAction = Literal["submit", "approve", "reject"]
BillingStatusAction = Literal["mark_billable", "cancel"]


class CommercialLineInput(BaseModel):
    source_order_item_id: str | None = None
    source_order_change_item_id: str | None = None
    product_id: str | None = None
    item_name: str | None = Field(default=None, max_length=220)
    item_type: str = Field(default="service", max_length=24)
    unit: str = Field(default="unit", min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=4000)
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=4)
    unit_price: Decimal = Field(ge=0, max_digits=16, decimal_places=4)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=7, decimal_places=4)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=8, decimal_places=4)


class CommercialLineRead(BaseModel):
    id: str
    source_order_item_id: str | None = None
    source_order_change_item_id: str | None = None
    product_id: str | None = None
    item_name: str
    item_type: str
    unit: str
    description: str
    quantity: Decimal
    unit_price: Decimal
    discount_percent: Decimal
    tax_rate: Decimal
    line_total: Decimal


class OrderChangeCreate(BaseModel):
    change_type: ChangeType
    title: str = Field(min_length=1, max_length=220)
    reason: str | None = Field(default=None, max_length=4000)
    items: list[CommercialLineInput] = Field(min_length=1, max_length=100)


class OrderChangeAction(BaseModel):
    action: ChangeStatusAction


class OrderChangeRead(BaseModel):
    id: str
    change_number: str
    change_type: str
    status: str
    title: str
    reason: str | None
    currency: str
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal
    effective_delta: Decimal
    items: list[CommercialLineRead]
    approved_at: datetime | None
    rejected_at: datetime | None
    created_at: datetime


class BillingMilestoneCreate(BaseModel):
    title: str = Field(min_length=1, max_length=220)
    description: str | None = Field(default=None, max_length=4000)
    project_id: str | None = None
    project_milestone_id: str | None = None
    order_change_id: str | None = None
    due_date: date | None = None
    items: list[CommercialLineInput] = Field(min_length=1, max_length=100)


class BillingMilestoneAction(BaseModel):
    action: BillingStatusAction


class BillingMilestoneRead(BaseModel):
    id: str
    title: str
    description: str | None
    project_id: str | None
    project_milestone_id: str | None
    order_change_id: str | None
    currency: str
    amount: Decimal
    due_date: date | None
    status: str
    invoice_id: str | None = None
    invoice_number: str | None = None
    items: list[CommercialLineRead]
    created_at: datetime


class OrderCommercialSummary(BaseModel):
    order_id: str
    order_number: str
    currency: str
    staged_billing_enabled: bool
    original_value: Decimal
    approved_change_value: Decimal
    revised_contract_value: Decimal
    scheduled_value: Decimal
    billed_value: Decimal
    draft_invoice_value: Decimal
    paid_value: Decimal
    accounts_receivable: Decimal
    remaining_to_bill: Decimal
    remaining_to_schedule: Decimal
    changes: list[OrderChangeRead]
    billing_milestones: list[BillingMilestoneRead]
