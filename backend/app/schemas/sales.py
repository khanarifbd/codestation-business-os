from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

QuotationStatus = Literal["draft", "sent", "accepted", "rejected", "cancelled"]
TaxCalculationMode = Literal["exclusive", "inclusive"]
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
    "custom",
]
PaymentScheduleType = Literal["percentage", "fixed"]


class QuotationItemInput(BaseModel):
    group_name: str | None = Field(default=None, max_length=160)
    title: str | None = Field(default=None, max_length=220)
    description: str = Field(min_length=1, max_length=4000)
    unit: str = Field(default="item", min_length=1, max_length=32)
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=4)
    unit_price: Decimal = Field(ge=0, max_digits=16, decimal_places=4)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=7, decimal_places=4)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=8, decimal_places=4)


class QuotationItemRead(BaseModel):
    id: str
    sort_order: int
    group_name: str | None
    title: str | None
    description: str
    unit: str
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
    title: str = Field(min_length=1, max_length=180)
    content: str = Field(min_length=1, max_length=30000)
    is_visible: bool = True


class QuotationSectionRead(QuotationSectionInput):
    id: str
    sort_order: int


class QuotationMilestoneInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)
    start_date: date | None = None
    due_date: date | None = None
    duration_text: str | None = Field(default=None, max_length=120)
    acceptance_criteria: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("Milestone due date cannot be before start date")
        return self


class QuotationMilestoneRead(QuotationMilestoneInput):
    id: str
    sort_order: int


class QuotationPaymentScheduleInput(BaseModel):
    label: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)
    payment_type: PaymentScheduleType
    percentage: Decimal | None = Field(default=None, gt=0, le=100, max_digits=7, decimal_places=4)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=16, decimal_places=2)
    due_condition: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def validate_value(self):
        if self.payment_type == "percentage":
            if self.percentage is None:
                raise ValueError("Percentage is required for percentage payment schedule entries")
            if self.amount is not None:
                raise ValueError("Amount must be empty for percentage payment schedule entries")
        elif self.payment_type == "fixed":
            if self.amount is None:
                raise ValueError("Amount is required for fixed payment schedule entries")
            if self.percentage is not None:
                raise ValueError("Percentage must be empty for fixed payment schedule entries")
        return self


class QuotationPaymentScheduleRead(QuotationPaymentScheduleInput):
    id: str
    calculated_amount: Decimal
    sort_order: int


class QuotationCommercialFields(BaseModel):
    subject: str | None = Field(default=None, max_length=220)
    project_title: str | None = Field(default=None, max_length=220)
    executive_summary: str | None = Field(default=None, max_length=30000)
    issue_date: date | None = None
    valid_until: date | None = None
    estimated_start_date: date | None = None
    estimated_end_date: date | None = None
    estimated_duration: str | None = Field(default=None, max_length=120)
    start_condition: str | None = Field(default=None, max_length=10000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    tax_calculation_mode: TaxCalculationMode | None = None
    assigned_employee_id: str | None = None
    notes: str | None = None
    terms_conditions: str | None = None
    internal_notes: str | None = None

    @model_validator(mode="after")
    def validate_timeline(self):
        if self.issue_date and self.valid_until and self.valid_until < self.issue_date:
            raise ValueError("Valid until date cannot be before issue date")
        if self.estimated_start_date and self.estimated_end_date and self.estimated_end_date < self.estimated_start_date:
            raise ValueError("Estimated end date cannot be before estimated start date")
        return self


class QuotationCreate(QuotationCommercialFields):
    client_id: str
    issue_date: date
    items: list[QuotationItemInput] = Field(min_length=1, max_length=200)
    sections: list[QuotationSectionInput] | None = Field(default=None, max_length=50)
    milestones: list[QuotationMilestoneInput] | None = Field(default=None, max_length=100)
    payment_schedule: list[QuotationPaymentScheduleInput] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def validate_sections(self):
        _validate_section_uniqueness(self.sections)
        return self


class QuotationUpdate(QuotationCommercialFields):
    items: list[QuotationItemInput] | None = Field(default=None, min_length=1, max_length=200)
    sections: list[QuotationSectionInput] | None = Field(default=None, max_length=50)
    milestones: list[QuotationMilestoneInput] | None = Field(default=None, max_length=100)
    payment_schedule: list[QuotationPaymentScheduleInput] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def validate_sections(self):
        _validate_section_uniqueness(self.sections)
        return self


def _validate_section_uniqueness(sections: list[QuotationSectionInput] | None) -> None:
    if not sections:
        return
    standard_types = [item.section_type for item in sections if item.section_type != "custom"]
    if len(standard_types) != len(set(standard_types)):
        raise ValueError("Each standard quotation section type can appear only once")


class QuotationStatusChange(BaseModel):
    status: Literal["sent", "accepted", "rejected", "cancelled"]


class QuotationListItem(BaseModel):
    id: str
    quotation_number: str
    revision_number: int
    client_id: str
    client_name: str
    status: str
    subject: str | None
    project_title: str | None
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
    root_quotation_id: str | None
    supersedes_quotation_id: str | None
    revision_number: int
    client_id: str
    source_lead_id: str | None
    assigned_employee_id: str | None
    assigned_employee_name: str | None
    status: str
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
    notes: str | None
    terms_conditions: str | None
    internal_notes: str | None
    sent_at: datetime | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    cancelled_at: datetime | None
    is_expired: bool
    items: list[QuotationItemRead]
    sections: list[QuotationSectionRead]
    milestones: list[QuotationMilestoneRead]
    payment_schedule: list[QuotationPaymentScheduleRead]
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


class SalesMeta(BaseModel):
    default_currency: str
    default_tax_calculation_mode: str
    default_tax_rate: Decimal
    default_validity_days: int
    employees: list[SalesEmployeeOption]
