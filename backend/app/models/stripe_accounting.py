"""Idempotent linkage of a verified Stripe settlement to operational accounting."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class StripeAccountingPosting(TenantOwnedMixin, Base):
    __tablename__ = "stripe_accounting_postings"
    __table_args__ = (
        UniqueConstraint("snapshot_id", name="uq_stripe_accounting_posting_snapshot"),
        UniqueConstraint("payment_id", name="uq_stripe_accounting_posting_payment"),
        Index("ix_stripe_accounting_postings_org_created", "organization_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    snapshot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stripe_settlement_snapshots.id", ondelete="RESTRICT"), nullable=False,
    )
    payment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("payments.id", ondelete="RESTRICT"), nullable=False,
    )
    fee_journal_entry_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("journal_entries.id", ondelete="RESTRICT"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
