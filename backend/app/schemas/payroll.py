from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class PayrollComponent(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount: Decimal = Field(ge=0)


class SalaryProfileCreate(BaseModel):
    employee_id: str
    currency: str = Field(min_length=3, max_length=3)
    pay_frequency: str = "monthly"
    base_salary: Decimal = Field(gt=0)
    default_allowances: list[PayrollComponent] = Field(default_factory=list)
    default_deductions: list[PayrollComponent] = Field(default_factory=list)
    effective_from: date
    notes: str | None = None


class SalaryProfileUpdate(BaseModel):
    base_salary: Decimal | None = Field(default=None, gt=0)
    default_allowances: list[PayrollComponent] | None = None
    default_deductions: list[PayrollComponent] | None = None
    effective_to: date | None = None
    is_active: bool | None = None
    notes: str | None = None


class SalaryProfileRead(BaseModel):
    id: str
    employee_id: str
    employee_code: str
    employee_name: str
    currency: str
    pay_frequency: str
    base_salary: Decimal
    default_allowances: list[PayrollComponent]
    default_deductions: list[PayrollComponent]
    effective_from: date
    effective_to: date | None
    is_active: bool
    notes: str | None
    created_at: datetime


class PayrollPeriodCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    period_start: date
    period_end: date
    pay_date: date
    notes: str | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.period_end < self.period_start:
            raise ValueError("Period end cannot be before period start")
        if self.pay_date < self.period_start:
            raise ValueError("Pay date cannot be before period start")
        return self


class PayrollPeriodRead(BaseModel):
    id: str
    name: str
    period_start: date
    period_end: date
    pay_date: date
    status: str
    notes: str | None
    created_at: datetime


class PayrollRunCreate(BaseModel):
    period_id: str
    currency: str = Field(min_length=3, max_length=3)


class PayrollEntryUpdate(BaseModel):
    allowances: list[PayrollComponent] | None = None
    deductions: list[PayrollComponent] | None = None
    tax_amount: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class PayrollEntryRead(BaseModel):
    id: str
    employee_id: str
    employee_code: str
    employee_name: str
    currency: str
    base_salary: Decimal
    allowances: list[PayrollComponent]
    deductions: list[PayrollComponent]
    allowance_total: Decimal
    deduction_total: Decimal
    tax_amount: Decimal
    gross_pay: Decimal
    net_pay: Decimal
    notes: str | None


class PayrollRunRead(BaseModel):
    id: str
    run_number: str
    period_id: str
    period_name: str
    currency: str
    status: str
    employee_count: int
    gross_total: Decimal
    allowance_total: Decimal
    deduction_total: Decimal
    tax_total: Decimal
    net_total: Decimal
    paid_account_id: str | None
    approved_at: datetime | None
    paid_at: datetime | None
    created_at: datetime
    entries: list[PayrollEntryRead] = Field(default_factory=list)


class PayrollPayRequest(BaseModel):
    account_id: str


class PayrollEmployeeOption(BaseModel):
    id: str
    employee_code: str
    full_name: str


class PayrollAccountOption(BaseModel):
    id: str
    name: str
    currency: str
    is_active: bool


class PayrollMeta(BaseModel):
    employees: list[PayrollEmployeeOption]
    accounts: list[PayrollAccountOption]
    currencies: list[str]
