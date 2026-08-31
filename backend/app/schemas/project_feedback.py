from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class ProjectReviewUpsert(BaseModel):
    rating: int | None = Field(default=None, ge=1, le=5)
    review_text: str | None = Field(default=None, max_length=10000)
    source: str | None = Field(default=None, max_length=64)
    reviewer_name: str | None = Field(default=None, max_length=180)
    received_at: date | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def require_review_content(self):
        if self.rating is None and not (self.review_text or "").strip():
            raise ValueError("Add a rating or review text")
        return self


class ProjectReviewRead(BaseModel):
    id: str
    rating: int | None
    review_text: str | None
    source: str | None
    reviewer_name: str | None
    received_at: date | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class ProjectTipRead(BaseModel):
    id: str
    entry_date: date
    currency: str
    amount: Decimal
    financial_account_id: str
    financial_account_name: str
    category_ledger_account_id: str
    category_ledger_account_name: str
    description: str
    reference: str | None
    notes: str | None
    created_at: datetime


class ProjectTipCurrencyTotal(BaseModel):
    currency: str
    amount: Decimal


class ProjectFeedbackWorkspace(BaseModel):
    project_status: str
    project_currency: str
    review: ProjectReviewRead | None
    tips: list[ProjectTipRead]
    tip_totals: list[ProjectTipCurrencyTotal]
    can_manage_review: bool = False
    can_view_tips: bool = False
    can_record_tip: bool = False
