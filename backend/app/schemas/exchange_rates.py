from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ExchangeRatePolicyRead(BaseModel):
    mode: str
    provider: str
    adjustment_percent: Decimal
    sync_frequency: str
    last_synced_at: datetime | None


class ExchangeRatePolicyUpdate(BaseModel):
    mode: Literal["automatic", "manual", "automatic_adjusted"]
    provider: Literal["frankfurter"] = "frankfurter"
    adjustment_percent: Decimal = Field(default=Decimal("0"), ge=-50, le=50)
    sync_frequency: Literal["manual", "daily"] = "daily"


class ExchangeRateCreate(BaseModel):
    base_currency: str = Field(min_length=3, max_length=3)
    quote_currency: str = Field(min_length=3, max_length=3)
    manual_rate: Decimal | None = Field(default=None, gt=0)


class ExchangeRateUpdate(BaseModel):
    manual_rate: Decimal = Field(gt=0)


class ExchangeRateHistoryCreate(BaseModel):
    base_currency: str = Field(min_length=3, max_length=3)
    quote_currency: str = Field(min_length=3, max_length=3)
    effective_date: date
    effective_rate: Decimal = Field(gt=0)


class ExchangeRateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    base_currency: str
    quote_currency: str
    reference_rate: Decimal | None
    manual_rate: Decimal | None
    effective_rate: Decimal
    source: str
    synced_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ExchangeRateHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    base_currency: str
    quote_currency: str
    effective_date: date
    reference_rate: Decimal | None
    effective_rate: Decimal
    source: str
    created_at: datetime
    updated_at: datetime


class ExchangeRateBundle(BaseModel):
    policy: ExchangeRatePolicyRead
    rates: list[ExchangeRateRead]
    history: list[ExchangeRateHistoryRead] = Field(default_factory=list)
