from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class AssetRead(BaseModel):
    id: str
    asset_code: str
    name: str
    category: str
    currency: str
    acquisition_cost: Decimal
    salvage_value: Decimal
    accumulated_depreciation: Decimal
    book_value: Decimal
    depreciable_amount: Decimal
    acquisition_date: date
    in_service_date: date
    useful_life_months: int
    depreciation_method: str
    purchase_account_id: str | None = None
    reference: str | None = None
    status: str
    notes: str | None = None


class AssetAccountMetaRead(BaseModel):
    id: str
    name: str
    currency: str
    account_type: str
    balance: Decimal


class AssetMetaRead(BaseModel):
    accounts: list[AssetAccountMetaRead]
    base_currency: str


class AssetSummaryRowRead(BaseModel):
    currency: str
    cost: Decimal
    accumulated_depreciation: Decimal
    book_value: Decimal


class AssetSummaryRead(BaseModel):
    rows: list[AssetSummaryRowRead]
    active_assets: int


class AssetDepreciationPostedRead(BaseModel):
    asset_id: str
    asset_code: str
    amount: Decimal
    currency: str
    book_value: Decimal


class AssetDepreciationSkippedRead(BaseModel):
    asset_id: str
    reason: str


class AssetDepreciationRunRead(BaseModel):
    period_date: date
    posting_date: date
    posted: list[AssetDepreciationPostedRead]
    skipped: list[AssetDepreciationSkippedRead]


class AssetDepreciationEntryRead(BaseModel):
    id: str
    period_date: date
    amount: Decimal
    journal_entry_id: str


class AssetDepreciationHistoryRead(BaseModel):
    asset: AssetRead
    entries: list[AssetDepreciationEntryRead]
