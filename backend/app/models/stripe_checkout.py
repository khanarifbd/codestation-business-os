"""External Stripe Checkout attempts and deduplicated signed webhook events.

Sandbox Stripe payments are recorded here but never posted to production books.
"""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class StripeCheckoutAttempt(TenantOwnedMixin, Base):
    __tablename__ = "stripe_checkout_attempts"
    __table_args__ = (
        UniqueConstraint("stripe_session_id", name="uq_stripe_checkout_session"),
        Index("ix_stripe_checkout_org_invoice_created", "organization_id", "invoice_id", "created_at"),
        Index("ix_stripe_checkout_org_connection", "organization_id", "connection_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False)
    connection_id: Mapped[str] = mapped_column(String(36), ForeignKey("payment_gateway_connections.id", ondelete="RESTRICT"), nullable=False)
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    stripe_session_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    checkout_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="initiated", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class StripeWebhookEvent(TenantOwnedMixin, Base):
    __tablename__ = "stripe_webhook_events"
    __table_args__ = (
        UniqueConstraint("connection_id", "stripe_event_id", name="uq_stripe_webhook_connection_event"),
        Index("ix_stripe_webhook_org_received", "organization_id", "received_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    connection_id: Mapped[str] = mapped_column(String(36), ForeignKey("payment_gateway_connections.id", ondelete="RESTRICT"), nullable=False)
    stripe_event_id: Mapped[str] = mapped_column(String(140), nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    attempt_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stripe_checkout_attempts.id", ondelete="RESTRICT"), nullable=True)
    result: Mapped[str] = mapped_column(String(32), default="received", nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
