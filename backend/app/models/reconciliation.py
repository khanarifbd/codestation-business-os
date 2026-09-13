from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class BankReconciliation(TenantOwnedMixin, Base):
    __tablename__ = "bank_reconciliations"
    __table_args__ = (
        Index("ix_bank_reconciliations_org_account_end", "organization_id", "account_id", "statement_end_date"),
        Index("ix_bank_reconciliations_org_status", "organization_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    statement_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    statement_end_date: Mapped[date] = mapped_column(Date, nullable=False)
    statement_ending_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    cleared_book_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    difference: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="draft", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    finalized_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class BankReconciliationItem(TenantOwnedMixin, Base):
    __tablename__ = "bank_reconciliation_items"
    __table_args__ = (
        UniqueConstraint("organization_id", "financial_transaction_id", name="uq_reconciliation_transaction_once"),
        Index("ix_reconciliation_items_org_reconciliation", "organization_id", "reconciliation_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    reconciliation_id: Mapped[str] = mapped_column(String(36), ForeignKey("bank_reconciliations.id", ondelete="CASCADE"), nullable=False)
    financial_transaction_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_transactions.id", ondelete="RESTRICT"), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
