from __future__ import annotations

import calendar
from datetime import date, timedelta


def add_months(value: date, months: int) -> date:
    if months <= 0:
        raise ValueError("Service duration must be a positive number of months")
    month_index = (value.month - 1) + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def service_end_date(start_date: date, duration_months: int) -> date:
    """Return the inclusive final service date for a fixed-term service."""
    return add_months(start_date, duration_months) - timedelta(days=1)
