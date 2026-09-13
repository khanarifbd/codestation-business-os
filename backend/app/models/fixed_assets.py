from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class FixedAsset(TenantOwnedMixin, Base):
    __tablename__ = "fixed_assets"
    __table_args__ = (
        UniqueConstraint("organization_id", "asset_code", name="uq_fixed_assets_org_code"),
        Index("ix_fixed_assets_org_status", "organization_id", "status"),
        Index("ix_fixed_assets_org_in_service", "organization_id", "in_service_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    asset_code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(220), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="equipment", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    acquisition_cost: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    salvage_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    accumulated_depreciation: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    acquisition_date: Mapped[date] = mapped_column(Date, nullable=False)
    in_service_date: Mapped[date] = mapped_column(Date, nullable=False)
    useful_life_months: Mapped[int] = mapped_column(Integer, nullable=False)
    depreciation_method: Mapped[str] = mapped_column(String(32), default="straight_line", nullable=False)
    purchase_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class AssetDepreciationEntry(TenantOwnedMixin, Base):
    __tablename__ = "asset_depreciation_entries"
    __table_args__ = (
        UniqueConstraint("organization_id", "asset_id", "period_date", name="uq_asset_depreciation_period"),
        Index("ix_asset_depreciation_org_period", "organization_id", "period_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("fixed_assets.id", ondelete="RESTRICT"), nullable=False)
    period_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    journal_entry_id: Mapped[str] = mapped_column(String(36), ForeignKey("journal_entries.id", ondelete="RESTRICT"), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
