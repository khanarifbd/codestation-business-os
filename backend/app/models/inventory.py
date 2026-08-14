from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class ProductCategory(TenantOwnedMixin, Base):
    __tablename__ = "product_categories"
    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_product_categories_org_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Product(TenantOwnedMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("organization_id", "sku", name="uq_products_org_sku"),
        Index("ix_products_org_type_active", "organization_id", "item_type", "is_active"),
        Index("ix_products_org_category", "organization_id", "category_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    sku: Mapped[str] = mapped_column(String(80), nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(120), nullable=True)
    name: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_type: Mapped[str] = mapped_column(String(24), default="stock_item", nullable=False)
    category_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("product_categories.id", ondelete="SET NULL"), nullable=True)
    unit: Mapped[str] = mapped_column(String(40), default="unit", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    selling_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    standard_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    last_purchase_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    reorder_level: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    tax_code_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_codes.id", ondelete="SET NULL"), nullable=True)
    track_inventory: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_negative_stock: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Warehouse(TenantOwnedMixin, Base):
    __tablename__ = "warehouses"
    __table_args__ = (UniqueConstraint("organization_id", "code", name="uq_warehouses_org_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class InventoryBalance(TenantOwnedMixin, Base):
    __tablename__ = "inventory_balances"
    __table_args__ = (
        UniqueConstraint("organization_id", "product_id", "warehouse_id", name="uq_inventory_balances_org_product_warehouse"),
        Index("ix_inventory_balances_org_warehouse", "organization_id", "warehouse_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(36), ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    on_hand_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    average_unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"), nullable=False)
    inventory_value: Mapped[Decimal] = mapped_column(Numeric(20, 4), default=Decimal("0"), nullable=False)
    # Base-currency carrying values are nullable for pre-migration foreign stock whose
    # historical FX cannot be inferred safely. New stock movements always maintain them.
    average_unit_cost_base: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    inventory_value_base: Mapped[Decimal | None] = mapped_column(Numeric(22, 4), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class StockMovement(TenantOwnedMixin, Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        Index("ix_stock_movements_org_product_date", "organization_id", "product_id", "movement_date"),
        Index("ix_stock_movements_org_warehouse_date", "organization_id", "warehouse_id", "movement_date"),
        Index("ix_stock_movements_org_source", "organization_id", "source_type", "source_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(36), ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    movement_date: Mapped[date] = mapped_column(Date, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    quantity_after: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    average_cost_after: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    base_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    unit_cost_base: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    total_cost_base: Mapped[Decimal | None] = mapped_column(Numeric(22, 4), nullable=True)
    average_cost_base_after: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    source_type: Mapped[str] = mapped_column(String(48), nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class PurchaseReceipt(TenantOwnedMixin, Base):
    __tablename__ = "purchase_receipts"
    __table_args__ = (
        UniqueConstraint("organization_id", "receipt_number", name="uq_purchase_receipts_org_number"),
        Index("ix_purchase_receipts_org_date", "organization_id", "receipt_date"),
        Index("ix_purchase_receipts_org_supplier", "organization_id", "supplier_name", "receipt_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    receipt_number: Mapped[str] = mapped_column(String(40), nullable=False)
    supplier_name: Mapped[str] = mapped_column(String(220), nullable=False)
    vendor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    warehouse_id: Mapped[str] = mapped_column(String(36), ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    receipt_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    base_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    exchange_rate_to_base: Mapped[Decimal | None] = mapped_column(Numeric(24, 10), nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    recoverable_tax_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    balance_due: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="received", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class PurchaseReceiptItem(TenantOwnedMixin, Base):
    __tablename__ = "purchase_receipt_items"
    __table_args__ = (Index("ix_purchase_receipt_items_org_receipt", "organization_id", "receipt_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    receipt_id: Mapped[str] = mapped_column(String(36), ForeignKey("purchase_receipts.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    tax_code_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_codes.id", ondelete="SET NULL"), nullable=True)
    tax_rate_snapshot: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0"), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    recoverable_tax_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    inventory_cost: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    inventory_cost_base: Mapped[Decimal | None] = mapped_column(Numeric(22, 4), nullable=True)
    line_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
