from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class LedgerAccount(TenantOwnedMixin, Base):
    __tablename__ = "ledger_accounts"
    __table_args__ = (
        UniqueConstraint("organization_id", "code", name="uq_ledger_accounts_org_code"),
        UniqueConstraint("organization_id", "system_key", name="uq_ledger_accounts_org_system_key"),
        Index("ix_ledger_accounts_org_category_active", "organization_id", "category", "is_active"),
        Index("ix_ledger_accounts_org_parent", "organization_id", "parent_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    category: Mapped[str] = mapped_column(String(24), nullable=False)
    subtype: Mapped[str | None] = mapped_column(String(48), nullable=True)
    normal_balance: Mapped[str] = mapped_column(String(8), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=True)
    system_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_manual_posting: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class JournalEntry(TenantOwnedMixin, Base):
    __tablename__ = "journal_entries"
    __table_args__ = (
        UniqueConstraint("organization_id", "entry_number", name="uq_journal_entries_org_number"),
        Index("ix_journal_entries_org_date_status", "organization_id", "entry_date", "status"),
        Index("ix_journal_entries_org_source", "organization_id", "source_type", "source_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    entry_number: Mapped[str] = mapped_column(String(40), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="posted", nullable=False)
    source_type: Mapped[str] = mapped_column(String(48), default="manual", nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    reversed_entry_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("journal_entries.id", ondelete="RESTRICT"), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    posted_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class JournalLine(TenantOwnedMixin, Base):
    __tablename__ = "journal_lines"
    __table_args__ = (
        CheckConstraint(
            "(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)",
            name="ck_journal_lines_one_sided_amount",
        ),
        CheckConstraint("exchange_rate_to_base > 0", name="ck_journal_lines_positive_exchange_rate"),
        Index("ix_journal_lines_org_entry", "organization_id", "journal_entry_id"),
        Index("ix_journal_lines_org_account", "organization_id", "ledger_account_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    journal_entry_id: Mapped[str] = mapped_column(String(36), ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False)
    ledger_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    exchange_rate_to_base: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("1"), nullable=False)
    debit: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    credit: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    original_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
