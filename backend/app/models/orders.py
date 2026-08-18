from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class Order(TenantOwnedMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("organization_id", "order_number", name="uq_orders_org_number"),
        UniqueConstraint("organization_id", "quotation_id", name="uq_orders_org_quotation"),
        Index("ix_orders_org_status_created", "organization_id", "status", "created_at"),
        Index("ix_orders_org_client_created", "organization_id", "client_id", "created_at"),
        Index("ix_orders_org_source_external", "organization_id", "source", "external_order_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_number: Mapped[str] = mapped_column(String(40), nullable=False)
    quotation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("quotations.id", ondelete="RESTRICT"), nullable=True)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False)
    source_lead_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    assigned_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)

    source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_order_id: Mapped[str | None] = mapped_column(String(180), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="confirmed", nullable=False)
    subject: Mapped[str | None] = mapped_column(String(220), nullable=True)
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    tax_calculation_mode: Mapped[str] = mapped_column(String(16), default="exclusive", nullable=False)

    seller_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    seller_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    seller_address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    seller_tax_identifier_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)

    client_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    client_contact_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)
    client_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    client_address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_tax_identifier_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)

    subtotal: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    terms_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class OrderItem(TenantOwnedMixin, Base):
    __tablename__ = "order_items"
    __table_args__ = (
        Index("ix_order_items_org_order_sort", "organization_id", "order_id", "sort_order"),
        Index("ix_order_items_org_product", "organization_id", "product_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    quotation_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("quotation_items.id", ondelete="SET NULL"), nullable=True)
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
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
