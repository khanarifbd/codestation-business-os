"""Additive HTTP contracts; pure calculation DTOs live in payroll_policy."""
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.payroll_policy import PayrollPolicyConfig


class PayrollPolicyVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    configuration: PayrollPolicyConfig
    effective_from: date
    expected_prior_version: int = Field(ge=0)
    activation_reason: str = Field(min_length=1, max_length=2000)

    @field_validator("activation_reason")
    @classmethod
    def nonblank_reason(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("An activation reason is required")
        return value


class PayrollPolicyVersionRead(BaseModel):
    id: str
    version: int
    effective_from: date
    configuration: PayrollPolicyConfig
    activation_reason: str
    created_by_user_id: str
    created_at: datetime


class PayrollPolicyRead(BaseModel):
    as_of: date
    legacy_manual: bool
    effective_policy: PayrollPolicyVersionRead | None
    latest_version: int
    scheduled_versions: list[PayrollPolicyVersionRead]


class PayrollRunPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period_id: str
    currency: str = Field(pattern=r"^[A-Za-z]{3}$")


class PayrollRunPreviewRead(BaseModel):
    ready: bool
    policy_version: int
    mode: str
    calculation_hash: str | None = None
    calculation: dict[str, Any] | None = None
    setup_issues: list[dict[str, Any]] = Field(default_factory=list)
