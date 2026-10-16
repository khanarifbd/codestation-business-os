"""Stripe Connect linkage. No tenant Stripe secret keys are stored."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class PaymentGatewayConnection(TenantOwnedMixin, Base):
    __tablename__ = "payment_gateway_connections"
    __table_args__ = (
        UniqueConstraint("organization_id", "provider", "mode", name="uq_gateway_connection_org_provider_mode"),
        UniqueConstraint("provider", "mode", "provider_account_id", name="uq_gateway_connection_provider_account_mode"),
        Index("ix_gateway_connections_org_enabled", "organization_id", "is_active"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    provider: Mapped[str] = mapped_column(String(32), default="stripe", nullable=False)
    mode: Mapped[str] = mapped_column(String(8), nullable=False)  # test | live
    provider_account_id: Mapped[str] = mapped_column(String(100), nullable=False)
    charges_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payouts_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    details_submitted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    connected_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class GatewayOAuthState(TenantOwnedMixin, Base):
    __tablename__ = "gateway_oauth_states"
    __table_args__ = (
        Index("ix_gateway_oauth_states_org_expires", "organization_id", "expires_at"),
    )
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), default="stripe", nullable=False)
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    requested_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
