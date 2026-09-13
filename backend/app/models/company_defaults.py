from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class OrganizationSystemDefaults(TenantOwnedMixin, Base):
    __tablename__ = "organization_system_defaults"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_org_system_defaults_organization_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    default_client_country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    default_client_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    default_document_language: Mapped[str] = mapped_column(String(16), default="en", nullable=False)
    default_lead_status: Mapped[str] = mapped_column(String(64), default="new", nullable=False)
    default_project_status: Mapped[str] = mapped_column(String(64), default="planned", nullable=False)
    default_order_status: Mapped[str] = mapped_column(String(64), default="draft", nullable=False)
    default_invoice_status: Mapped[str] = mapped_column(String(64), default="draft", nullable=False)
    quotation_validity_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    exchange_rate_mode: Mapped[str] = mapped_column(String(32), default="automatic", nullable=False)
    exchange_rate_provider: Mapped[str] = mapped_column(String(64), default="frankfurter", nullable=False)
    exchange_rate_adjustment_percent: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"), nullable=False)
    exchange_rate_sync_frequency: Mapped[str] = mapped_column(String(16), default="daily", nullable=False)
    exchange_rate_last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class OrganizationExchangeRate(TenantOwnedMixin, Base):
    """Current/reference FX pair used by UI and non-historical presentation."""

    __tablename__ = "organization_exchange_rates"
    __table_args__ = (
        UniqueConstraint("organization_id", "base_currency", "quote_currency", name="uq_org_exchange_rate_pair"),
        CheckConstraint("base_currency <> quote_currency", name="ck_exchange_rate_distinct_pair"),
        CheckConstraint("effective_rate > 0", name="ck_exchange_rate_positive"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    quote_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    reference_rate: Mapped[Decimal | None] = mapped_column(Numeric(24, 10), nullable=True)
    manual_rate: Mapped[Decimal | None] = mapped_column(Numeric(24, 10), nullable=True)
    effective_rate: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    source: Mapped[str] = mapped_column(String(64), default="manual", nullable=False)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class OrganizationExchangeRateHistory(TenantOwnedMixin, Base):
    """Effective-dated accounting FX snapshots.

    Journal lines keep the exact rate actually used, while this table lets a new
    backdated posting resolve the rate that was configured for its transaction date.
    Updating today's reference rate never changes an already-posted journal.
    """

    __tablename__ = "organization_exchange_rate_history"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "base_currency",
            "quote_currency",
            "effective_date",
            name="uq_org_exchange_rate_history_date",
        ),
        CheckConstraint("base_currency <> quote_currency", name="ck_exchange_rate_history_distinct_pair"),
        CheckConstraint("effective_rate > 0", name="ck_exchange_rate_history_positive"),
        Index(
            "ix_org_exchange_rate_history_lookup",
            "organization_id",
            "base_currency",
            "quote_currency",
            "effective_date",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    quote_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    reference_rate: Mapped[Decimal | None] = mapped_column(Numeric(24, 10), nullable=True)
    effective_rate: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    source: Mapped[str] = mapped_column(String(64), default="manual", nullable=False)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
