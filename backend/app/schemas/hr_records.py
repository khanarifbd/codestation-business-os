"""Opt-in Records browse contract; legacy arrays remain unchanged."""
from datetime import date
from pydantic import BaseModel, Field, field_validator, model_validator

class RecordsPageQuery(BaseModel):
    limit: int = Field(default=50, ge=1, le=100)
    cursor: str | None = Field(default=None, min_length=1, max_length=4096)
    employee_id: str | None = Field(default=None, min_length=1, max_length=36)
    document_type: str | None = Field(default=None, min_length=1, max_length=64)
    event_type: str | None = Field(default=None, min_length=1, max_length=40)
    date_from: date | None = None
    date_to: date | None = None
    record_id: str | None = Field(default=None, min_length=1, max_length=36)

    @field_validator("employee_id", "document_type", "event_type", "record_id")
    @classmethod
    def database_text(cls, value):
        if value is not None:
            value.encode("utf-8", errors="strict")
            if "\x00" in value or not value.strip():
                raise ValueError("Invalid database text")
        return value

    @model_validator(mode="after")
    def coherent_selection(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("Reversed date range")
        if self.record_id and any(v is not None for v in (self.cursor, self.employee_id, self.document_type, self.event_type, self.date_from, self.date_to)):
            raise ValueError("record_id cannot be combined with browse filters or cursor")
        return self
