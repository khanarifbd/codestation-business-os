from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class OrderChange(TenantOwnedMixin, Base):
    __tablename__ = "order_changes"
    __table_args__ = (
        UniqueConstraint("organization_id", "order_id", "change_number", name="uq_order_changes_org_order_number"),
        Index("ix_order_changes_org_order_status", "organization_id", "order_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    change_number: Mapped[str] = mapped_column(String(40), nullable=False)
    change_type: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="draft", nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    approved_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    rejected_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class OrderChangeItem(TenantOwnedMixin, Base):
    __tablename__ = "order_change_items"
    __table_args__ = (Index("ix_order_change_items_org_change_sort", "organization_id", "order_change_id", "sort_order"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_change_id: Mapped[str] = mapped_column(String(36), ForeignKey("order_changes.id", ondelete="CASCADE"), nullable=False)
    source_order_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True)
    product_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    item_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    sku_snapshot: Mapped[str | None] = mapped_column(String(80), nullable=True)
    item_type_snapshot: Mapped[str] = mapped_column(String(24), default="service", nullable=False)
    unit_snapshot: Mapped[str] = mapped_column(String(40), default="unit", nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(16, 4), nullable=False)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), default=Decimal("0"), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0"), nullable=False)
    line_subtotal: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    taxable_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class OrderBillingMilestone(TenantOwnedMixin, Base):
    __tablename__ = "order_billing_milestones"
    __table_args__ = (
        Index("ix_order_billing_org_order_sort", "organization_id", "order_id", "sort_order"),
        Index("ix_order_billing_org_order_status", "organization_id", "order_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    project_milestone_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("project_milestones.id", ondelete="SET NULL"), nullable=True)
    order_change_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("order_changes.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="planned", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class OrderBillingMilestoneItem(TenantOwnedMixin, Base):
    __tablename__ = "order_billing_milestone_items"
    __table_args__ = (Index("ix_order_billing_items_org_milestone_sort", "organization_id", "billing_milestone_id", "sort_order"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    billing_milestone_id: Mapped[str] = mapped_column(String(36), ForeignKey("order_billing_milestones.id", ondelete="CASCADE"), nullable=False)
    source_order_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True)
    source_order_change_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("order_change_items.id", ondelete="SET NULL"), nullable=True)
    product_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    item_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    sku_snapshot: Mapped[str | None] = mapped_column(String(80), nullable=True)
    item_type_snapshot: Mapped[str] = mapped_column(String(24), default="service", nullable=False)
    unit_snapshot: Mapped[str] = mapped_column(String(40), default="unit", nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(16, 4), nullable=False)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), default=Decimal("0"), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0"), nullable=False)
    line_subtotal: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    taxable_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
