from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class OrderFulfillment(TenantOwnedMixin, Base):
    __tablename__ = "order_fulfillments"
    __table_args__ = (
        UniqueConstraint("organization_id", "fulfillment_number", name="uq_order_fulfillments_org_number"),
        CheckConstraint("reversal_date IS NULL OR reversal_date >= fulfillment_date", name="ck_order_fulfillment_reversal_date"),
        Index("ix_order_fulfillments_org_order_date", "organization_id", "order_id", "fulfillment_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    fulfillment_number: Mapped[str] = mapped_column(String(48), nullable=False)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(36), ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    fulfillment_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="posted", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    total_cogs: Mapped[Decimal] = mapped_column(Numeric(22, 4), default=Decimal("0"), nullable=False)
    total_cogs_base: Mapped[Decimal] = mapped_column(Numeric(22, 4), default=Decimal("0"), nullable=False)
    reversal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reversed_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class OrderFulfillmentItem(TenantOwnedMixin, Base):
    __tablename__ = "order_fulfillment_items"
    __table_args__ = (
        Index("ix_order_fulfillment_items_org_fulfillment", "organization_id", "fulfillment_id"),
        Index("ix_order_fulfillment_items_org_order_item", "organization_id", "order_item_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    fulfillment_id: Mapped[str] = mapped_column(String(36), ForeignKey("order_fulfillments.id", ondelete="CASCADE"), nullable=False)
    order_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=False)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(22, 4), nullable=False)
    unit_cost_base: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    total_cost_base: Mapped[Decimal] = mapped_column(Numeric(22, 4), nullable=False)
    effective_rate_to_base: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
