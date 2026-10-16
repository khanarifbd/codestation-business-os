"""Verified Stripe payout → Business OS own-account transfer linkage.

Stripe payouts aggregate available charges. They are not new revenue.
"""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class StripePayoutReconciliation(TenantOwnedMixin, Base):
    __tablename__ = "stripe_payout_reconciliations"
    __table_args__ = (
        UniqueConstraint("connection_id", "stripe_payout_id", name="uq_stripe_payout_connection_payout"),
        UniqueConstraint("transfer_id", name="uq_stripe_payout_transfer"),
        Index("ix_stripe_payout_org_connection", "organization_id", "connection_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    connection_id: Mapped[str] = mapped_column(String(36), ForeignKey("payment_gateway_connections.id", ondelete="RESTRICT"), nullable=False)
    stripe_payout_id: Mapped[str] = mapped_column(String(120), nullable=False)
    transfer_id: Mapped[str] = mapped_column(String(36), ForeignKey("account_transfers.id", ondelete="RESTRICT"), nullable=False)
    stripe_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    bank_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    bank_statement_reference: Mapped[str] = mapped_column(String(180), nullable=False)
    reconciled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
