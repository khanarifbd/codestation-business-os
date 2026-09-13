from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

QuotationSectionType = Literal[
    "scope",
    "deliverables",
    "client_responsibilities",
    "exclusions",
    "third_party_costs",
    "support_warranty",
    "change_request_policy",
    "ip_terms",
    "confidentiality",
    "terms_conditions",
    "additional_notes",
]
QuotationPaymentType = Literal["percentage", "fixed"]


class QuotationV2ItemRead(BaseModel):
    id: str
    product_id: str | None
    lead_interest_id: str | None
    sort_order: int
    item_name_snapshot: str
    sku_snapshot: str | None
    item_type_snapshot: str
    unit_snapshot: str
    service_duration_months_snapshot: int | None
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


class QuotationSectionInput(BaseModel):
    section_type: QuotationSectionType
    title: str | None = Field(default=None, max_length=220)
    content: str = Field(min_length=1, max_length=30000)
    sort_order: int | None = Field(default=None, ge=0)
    is_visible: bool = True


class QuotationSectionRead(BaseModel):
    id: str
    section_type: str
    title: str | None
    content: str
    sort_order: int
    is_visible: bool
    created_at: datetime
    updated_at: datetime


class QuotationMilestoneInput(BaseModel):
    title: str = Field(min_length=1, max_length=220)
    description: str | None = Field(default=None, max_length=10000)
    estimated_start_date: date | None = None
    estimated_end_date: date | None = None
    estimated_duration: str | None = Field(default=None, max_length=120)
    acceptance_criteria: str | None = Field(default=None, max_length=10000)
    sort_order: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.estimated_start_date and self.estimated_end_date and self.estimated_end_date < self.estimated_start_date:
            raise ValueError("Milestone end date cannot be before start date")
        return self


class QuotationMilestoneRead(BaseModel):
    id: str
    title: str
    description: str | None
    estimated_start_date: date | None
    estimated_end_date: date | None
    estimated_duration: str | None
    acceptance_criteria: str | None
    sort_order: int
    created_at: datetime
    updated_at: datetime


class QuotationPaymentMilestoneInput(BaseModel):
    quotation_milestone_id: str | None = None
    quotation_milestone_index: int | None = Field(default=None, ge=0)
    title: str = Field(min_length=1, max_length=220)
    description: str | None = Field(default=None, max_length=10000)
    payment_type: QuotationPaymentType
    percentage: Decimal | None = Field(default=None, gt=0, le=100, max_digits=7, decimal_places=4)
    amount: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)
    due_condition: str | None = Field(default=None, max_length=5000)
    due_date: date | None = None
    sort_order: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_payment_shape(self):
        if self.quotation_milestone_id and self.quotation_milestone_index is not None:
            raise ValueError("Use either quotation_milestone_id or quotation_milestone_index, not both")
        if self.payment_type == "percentage":
            if self.percentage is None:
                raise ValueError("Percentage is required for percentage payment milestones")
            if self.amount is not None:
                raise ValueError("Amount is calculated by the server for percentage payment milestones")
        elif self.payment_type == "fixed":
            if self.amount is None:
                raise ValueError("Amount is required for fixed payment milestones")
            if self.percentage is not None:
                raise ValueError("Percentage must be empty for fixed payment milestones")
        return self


class QuotationPaymentMilestoneRead(BaseModel):
    id: str
    quotation_milestone_id: str | None
    title: str
    description: str | None
    payment_type: str
    percentage: Decimal | None
    amount: Decimal
    due_condition: str | None
    due_date: date | None
    sort_order: int
    created_at: datetime
    updated_at: datetime


class QuotationCommercialUpdate(BaseModel):
    project_title: str | None = Field(default=None, max_length=220)
    executive_summary: str | None = Field(default=None, max_length=15000)
    estimated_start_date: date | None = None
    estimated_end_date: date | None = None
    estimated_duration: str | None = Field(default=None, max_length=120)
    start_condition: str | None = Field(default=None, max_length=10000)
    sections: list[QuotationSectionInput] | None = Field(default=None, max_length=50)
    milestones: list[QuotationMilestoneInput] | None = Field(default=None, max_length=100)
    payment_milestones: list[QuotationPaymentMilestoneInput] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.estimated_start_date and self.estimated_end_date and self.estimated_end_date < self.estimated_start_date:
            raise ValueError("Estimated end date cannot be before start date")
        return self


class QuotationRevisionCreate(BaseModel):
    revision_reason: str = Field(min_length=1, max_length=4000)
    issue_date: date | None = None
    valid_until: date | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.issue_date and self.valid_until and self.valid_until < self.issue_date:
            raise ValueError("Valid until date cannot be before issue date")
        return self


class QuotationRevisionListItem(BaseModel):
    id: str
    quotation_number: str
    revision_number: int
    revision_reason: str | None
    status: str
    issue_date: date
    valid_until: date | None
    currency: str
    total: Decimal
    created_at: datetime


class QuotationCommercialDetail(BaseModel):
    id: str
    quotation_number: str
    root_quotation_id: str | None
    supersedes_quotation_id: str | None
    revision_number: int
    revision_reason: str | None
    status: str
    client_id: str
    source_lead_id: str | None
    assigned_employee_id: str | None
    subject: str | None
    project_title: str | None
    executive_summary: str | None
    issue_date: date
    valid_until: date | None
    estimated_start_date: date | None
    estimated_end_date: date | None
    estimated_duration: str | None
    start_condition: str | None
    currency: str
    tax_calculation_mode: str
    seller_name_snapshot: str
    seller_email_snapshot: str | None
    seller_phone_snapshot: str | None
    seller_address_snapshot: str | None
    seller_tax_identifier_snapshot: str | None
    client_name_snapshot: str
    client_contact_snapshot: str | None
    client_email_snapshot: str | None
    client_phone_snapshot: str | None
    client_address_snapshot: str | None
    client_tax_identifier_snapshot: str | None
    prepared_by_name_snapshot: str | None
    prepared_by_email_snapshot: str | None
    prepared_by_designation_snapshot: str | None
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal
    internal_notes: str | None
    sent_at: datetime | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    cancelled_at: datetime | None
    items: list[QuotationV2ItemRead]
    sections: list[QuotationSectionRead]
    milestones: list[QuotationMilestoneRead]
    payment_milestones: list[QuotationPaymentMilestoneRead]
    created_at: datetime
    updated_at: datetime
