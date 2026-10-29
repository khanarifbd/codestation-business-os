"""Optional stale-intent protection for the existing unkeyed Auto Post retry."""
from datetime import date

from pydantic import BaseModel


class AutoPostRetry(BaseModel):
    # Omitted body/field or null preserves legacy current-due behavior. This is
    # not an idempotency key or a fingerprint of amount/account configuration.
    expected_next_due_date: date | None = None
