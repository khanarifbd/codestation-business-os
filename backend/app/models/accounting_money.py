from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class AccountingMoneyEntry(TenantOwnedMixin, Base):
    __tablename__ = "accounting_money_entries"
    __table_args__ = (
        Index("ix_accounting_money_entries_org_date_kind", "organization_id", "entry_date", "kind"),
        Index("ix_accounting_money_entries_org_account_date", "organization_id", "financial_account_id", "entry_date"),
        Index("ix_accounting_money_entries_org_source", "organization_id", "source_type", "source_id"),
        Index("ix_accounting_money_entries_org_project_date", "organization_id", "project_id", "entry_date"),
        Index("ix_accounting_money_entries_org_order_date", "organization_id", "order_id", "entry_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    financial_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    category_ledger_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=False)
    source_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    order_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
