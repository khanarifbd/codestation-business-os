"""Opt-in HR time queries; legacy list routes do not parse these fields."""
from datetime import date

from pydantic import BaseModel, Field, field_validator, model_validator


class TimePageQuery(BaseModel):
    limit: int = Field(default=50, ge=1, le=100)
    cursor: str | None = Field(default=None, min_length=1, max_length=4096)
    employee_id: str | None = Field(default=None, min_length=1, max_length=36)
    status: str | None = Field(default=None, min_length=1, max_length=24)
    date_from: date | None = None
    date_to: date | None = None
    record_id: str | None = Field(default=None, min_length=1, max_length=36)

    @field_validator("employee_id", "status", "record_id")
    @classmethod
    def database_text(cls, value):
        if value is not None:
            value.encode("utf-8", errors="strict")
            if "\x00" in value:
                raise ValueError("NUL is not valid database text")
        return value

    @model_validator(mode="after")
    def coherent_selection(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must not be after date_to")
        if self.record_id and any(value is not None for value in (
            self.cursor, self.employee_id, self.status, self.date_from, self.date_to,
        )):
            raise ValueError("record_id cannot be combined with browse filters or cursor")
        return self


class LeaveReview(BaseModel):
    status: str
    review_notes: str | None = None
    # Opt-in stale-intent protection, not a version/ABA or new lifecycle rule.
    expected_status: str | None = Field(default=None, min_length=1, max_length=24)
