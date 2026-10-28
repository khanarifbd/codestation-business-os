"""Versioned payroll calculation DTOs. No database or runtime configuration imports."""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MoneyInput = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=2)]
PolicyMode = Literal["manual", "calendar_day", "working_day"]
ComponentTreatment = Literal["fixed_latest", "prorate_profile_segments"]
PayFrequency = Literal["monthly", "weekly", "biweekly"]


class FrozenPayrollModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class PayrollPolicyConfig(FrozenPayrollModel):
    mode: PolicyMode = "manual"
    allowance_treatment: ComponentTreatment = "fixed_latest"
    deduction_treatment: ComponentTreatment = "fixed_latest"
    working_weekdays: tuple[int, ...] | None = None
    holiday_treatment: Literal["count_scheduled", "exclude"] | None = None
    weekly_anchor: date | None = None
    biweekly_anchor: date | None = None

    @field_validator("working_weekdays", mode="before")
    @classmethod
    def validate_weekdays(cls, value):
        if value is not None and not isinstance(value, (list, tuple)):
            raise ValueError("Working weekdays must be a list of integer weekdays")
        if value is not None and any(type(day) is not int for day in value):
            raise ValueError("Working weekdays must be integer Monday=0 through Sunday=6")
        return value

    @model_validator(mode="after")
    def validate_calendar(self):
        if self.working_weekdays is not None:
            if not self.working_weekdays or len(set(self.working_weekdays)) != len(self.working_weekdays) or any(day < 0 or day > 6 for day in self.working_weekdays):
                raise ValueError("Provide a nonempty, unique Monday=0 through Sunday=6 weekday set")
            object.__setattr__(self, "working_weekdays", tuple(sorted(self.working_weekdays)))
        if self.mode == "working_day" and (self.working_weekdays is None or self.holiday_treatment is None):
            raise ValueError("Working-day mode requires an explicit payroll calendar and holiday treatment")
        return self


class PayrollPolicySnapshot(FrozenPayrollModel):
    id: str = Field(min_length=1)
    version: int = Field(ge=1, strict=True)
    effective_from: date
    config: PayrollPolicyConfig


class PayrollEmployeeInput(FrozenPayrollModel):
    id: str = Field(min_length=1)
    organization_id: str = Field(min_length=1)
    employment_status: str
    join_date: date | None = None
    end_date: date | None = None


class PayrollComponentInput(FrozenPayrollModel):
    name: str
    amount: MoneyInput

    @field_validator("amount")
    @classmethod
    def canonical_amount(cls, value):
        return Decimal("0.00") if value == 0 else value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class PayrollSalaryProfileInput(FrozenPayrollModel):
    id: str = Field(min_length=1)
    organization_id: str = Field(min_length=1)
    employee_id: str = Field(min_length=1)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    pay_frequency: PayFrequency = "monthly"
    base_salary: MoneyInput
    default_allowances: tuple[PayrollComponentInput, ...] = ()
    default_deductions: tuple[PayrollComponentInput, ...] = ()
    effective_from: date
    effective_to: date | None = None
    is_active: bool = True

    @field_validator("base_salary")
    @classmethod
    def canonical_base(cls, value):
        return Decimal("0.00") if value == 0 else value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class PayrollHolidayInput(FrozenPayrollModel):
    id: str = Field(min_length=1)
    organization_id: str = Field(min_length=1)
    holiday_date: date
    name: str
    is_paid: bool = True  # Snapshot only: never infers an absence/pay deduction.


class PayrollCalculationInput(FrozenPayrollModel):
    organization_id: str = Field(min_length=1)
    timezone: str
    period_id: str = Field(min_length=1)
    period_start: date
    period_end: date
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    policy: PayrollPolicySnapshot | None = None
    # Explicit authoritative candidate roster; resolver must not hide total profile gaps.
    employees: tuple[PayrollEmployeeInput, ...] = ()
    # All relevant currencies and full historical coverage, not currency-filtered first.
    profiles: tuple[PayrollSalaryProfileInput, ...] = ()
    # Include full reference-cycle dates, not just payroll-period dates.
    holidays: tuple[PayrollHolidayInput, ...] = ()

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("A configured IANA organization timezone is required") from exc
        return value

    @model_validator(mode="after")
    def validate_period(self):
        if self.period_end < self.period_start:
            raise ValueError("Period end cannot precede period start")
        return self


class PayrollSetupIssue(FrozenPayrollModel):
    code: str
    message: str
    employee_id: str | None = None
    profile_ids: tuple[str, ...] = ()


class PayrollCalculatedComponent(FrozenPayrollModel):
    name: str
    amount: Decimal
    source_profile_id: str
    source_component_index: int


class PayrollCalculatedEntry(FrozenPayrollModel):
    employee_id: str
    salary_profile_id: str  # Representative latest profile; all sources are in breakdown.
    profile_ids: tuple[str, ...]
    currency: str
    base_salary: Decimal
    allowances: tuple[PayrollCalculatedComponent, ...]
    deductions: tuple[PayrollCalculatedComponent, ...]
    allowance_total: Decimal
    deduction_total: Decimal
    tax_amount: Decimal = Decimal("0.00")
    gross_pay: Decimal
    net_pay: Decimal
    calculation_snapshot_json: str


class PayrollCalculationResult(FrozenPayrollModel):
    engine_version: str
    policy_id: str | None
    policy_version: int
    mode: PolicyMode
    currency: str
    entries: tuple[PayrollCalculatedEntry, ...]
    employee_count: int
    gross_total: Decimal
    allowance_total: Decimal
    deduction_total: Decimal
    tax_total: Decimal
    net_total: Decimal
    calculation_hash: str
    input_snapshot_json: str
    output_snapshot_json: str
