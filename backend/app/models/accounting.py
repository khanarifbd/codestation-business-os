from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint, event, or_, select
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.models.organization import Organization
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
        Index("ix_journal_entries_org_functional_date", "organization_id", "functional_currency", "entry_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    entry_number: Mapped[str] = mapped_column(String(40), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    functional_currency: Mapped[str] = mapped_column(String(3), nullable=False)
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


class OrganizationFunctionalCurrencyPeriod(TenantOwnedMixin, Base):
    __tablename__ = "organization_functional_currency_periods"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "effective_from",
            name="uq_org_functional_currency_period_start",
        ),
        Index(
            "ix_org_functional_currency_period_range",
            "organization_id",
            "effective_from",
            "effective_to",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    previous_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    transition_rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 8), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    transition_journal_entry_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("journal_entries.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


@event.listens_for(JournalEntry, "before_insert")
def _populate_journal_functional_currency(_mapper, connection, target: JournalEntry) -> None:
    """Backstop every journal constructor with an immutable functional currency.

    Normal posting paths set this field explicitly. The listener protects legacy
    constructors and test/import code so a future organization setting cannot
    silently relabel an existing journal.
    """
    if target.functional_currency:
        target.functional_currency = target.functional_currency.upper()
        return

    periods = OrganizationFunctionalCurrencyPeriod.__table__
    currency = connection.execute(
        select(periods.c.currency)
        .where(
            periods.c.organization_id == target.organization_id,
            periods.c.effective_from <= target.entry_date,
            or_(periods.c.effective_to.is_(None), periods.c.effective_to >= target.entry_date),
        )
        .order_by(periods.c.effective_from.desc())
        .limit(1)
    ).scalar_one_or_none()

    if currency is None:
        organizations = Organization.__table__
        currency = connection.execute(
            select(organizations.c.currency).where(organizations.c.id == target.organization_id)
        ).scalar_one_or_none()

    target.functional_currency = str(currency or "BDT").upper()
