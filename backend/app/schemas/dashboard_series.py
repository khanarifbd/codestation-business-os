"""Exact, unit-separated dashboard history response (not a profit report)."""
from datetime import date
from typing import Literal

from pydantic import BaseModel


class DashboardCountPoint(BaseModel):
    period_start: date
    period_end: date
    projects: int = 0
    orders: int = 0
    clients: int = 0


class DashboardMoneyPoint(BaseModel):
    period_start: date
    period_end: date
    income: str
    expenses: str


class DashboardCurrencySeries(BaseModel):
    currency: str
    points: list[DashboardMoneyPoint]


class DashboardSeries(BaseModel):
    organization_id: str
    date_from: date
    date_to: date
    effective_date_to: date | None
    timezone: str
    bucket: Literal['day', 'month']
    income_basis: Literal['received'] = 'received'
    expense_basis: Literal['recorded'] = 'recorded'
    counts: list[DashboardCountPoint]
    money: list[DashboardCurrencySeries]
