"""Immutable snapshot of a Stripe payment's gross, fee and net settlement facts.

The snapshot is *not* a journal posting and does not change financial accounts.
Stripe payouts, refunds and disputed transactions must be reconciled separately.
"""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class StripeSettlementSnapshot(TenantOwnedMixin, Base):
    __tablename__ = "stripe_settlement_snapshots"
    __table_args__ = (
        UniqueConstraint("attempt_id", name="uq_stripe_settlement_attempt"),
        UniqueConstraint("connection_id", "stripe_balance_transaction_id", name="uq_stripe_settlement_connection_transaction"),
        Index("ix_stripe_settlement_org_connection", "organization_id", "connection_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("stripe_checkout_attempts.id", ondelete="RESTRICT"), nullable=False)
    connection_id: Mapped[str] = mapped_column(String(36), ForeignKey("payment_gateway_connections.id", ondelete="RESTRICT"), nullable=False)
    stripe_payment_intent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    stripe_charge_id: Mapped[str] = mapped_column(String(120), nullable=False)
    stripe_balance_transaction_id: Mapped[str] = mapped_column(String(120), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    gross_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    fee_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    net_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    availability_status: Mapped[str] = mapped_column(String(32), nullable=False)
    reconciled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
