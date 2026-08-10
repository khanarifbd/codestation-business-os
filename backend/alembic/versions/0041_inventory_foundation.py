"""add inventory foundation

Revision ID: 0041_inventory_foundation
Revises: 0040_tax_center
"""
from alembic import op
import sqlalchemy as sa

revision = "0041_inventory_foundation"
down_revision = "0040_tax_center"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_categories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "name", name="uq_product_categories_org_name"),
    )
    op.create_table(
        "warehouses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "code", name="uq_warehouses_org_code"),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sku", sa.String(80), nullable=False),
        sa.Column("barcode", sa.String(120), nullable=True),
        sa.Column("name", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("item_type", sa.String(24), nullable=False, server_default="stock_item"),
        sa.Column("category_id", sa.String(36), sa.ForeignKey("product_categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("unit", sa.String(40), nullable=False, server_default="unit"),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("selling_price", sa.Numeric(18,4), nullable=False, server_default="0"),
        sa.Column("standard_cost", sa.Numeric(18,4), nullable=False, server_default="0"),
        sa.Column("last_purchase_cost", sa.Numeric(18,4), nullable=False, server_default="0"),
        sa.Column("reorder_level", sa.Numeric(18,4), nullable=False, server_default="0"),
        sa.Column("tax_code_id", sa.String(36), sa.ForeignKey("tax_codes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("track_inventory", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_negative_stock", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "sku", name="uq_products_org_sku"),
    )
    op.create_index("ix_products_org_type_active", "products", ["organization_id","item_type","is_active"])
    op.create_index("ix_products_org_category", "products", ["organization_id","category_id"])
    op.create_table(
        "inventory_balances",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.String(36), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.String(36), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("on_hand_quantity", sa.Numeric(18,4), nullable=False, server_default="0"),
        sa.Column("average_unit_cost", sa.Numeric(18,4), nullable=False, server_default="0"),
        sa.Column("inventory_value", sa.Numeric(20,4), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id","product_id","warehouse_id", name="uq_inventory_balances_org_product_warehouse"),
    )
    op.create_index("ix_inventory_balances_org_warehouse", "inventory_balances", ["organization_id","warehouse_id"])
    op.create_table(
        "purchase_receipts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("receipt_number", sa.String(40), nullable=False),
        sa.Column("supplier_name", sa.String(220), nullable=False),
        sa.Column("vendor_id", sa.String(36), sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("warehouse_id", sa.String(36), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("receipt_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("subtotal", sa.Numeric(18,2), nullable=False),
        sa.Column("tax_total", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("recoverable_tax_total", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(18,2), nullable=False),
        sa.Column("amount_paid", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("balance_due", sa.Numeric(18,2), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="received"),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id","receipt_number", name="uq_purchase_receipts_org_number"),
    )
    op.create_index("ix_purchase_receipts_org_date", "purchase_receipts", ["organization_id","receipt_date"])
    op.create_index("ix_purchase_receipts_org_supplier", "purchase_receipts", ["organization_id","supplier_name","receipt_date"])
    op.create_table(
        "purchase_receipt_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("receipt_id", sa.String(36), sa.ForeignKey("purchase_receipts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.String(36), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(18,4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18,4), nullable=False),
        sa.Column("tax_code_id", sa.String(36), sa.ForeignKey("tax_codes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tax_rate_snapshot", sa.Numeric(8,4), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("recoverable_tax_amount", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("inventory_cost", sa.Numeric(20,4), nullable=False),
        sa.Column("line_total", sa.Numeric(18,2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_purchase_receipt_items_org_receipt", "purchase_receipt_items", ["organization_id","receipt_id"])
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.String(36), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.String(36), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("movement_date", sa.Date(), nullable=False),
        sa.Column("movement_type", sa.String(32), nullable=False),
        sa.Column("quantity", sa.Numeric(18,4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18,4), nullable=False),
        sa.Column("total_cost", sa.Numeric(20,4), nullable=False),
        sa.Column("quantity_after", sa.Numeric(18,4), nullable=False),
        sa.Column("average_cost_after", sa.Numeric(18,4), nullable=False),
        sa.Column("source_type", sa.String(48), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_stock_movements_org_product_date", "stock_movements", ["organization_id","product_id","movement_date"])
    op.create_index("ix_stock_movements_org_warehouse_date", "stock_movements", ["organization_id","warehouse_id","movement_date"])
    op.create_index("ix_stock_movements_org_source", "stock_movements", ["organization_id","source_type","source_id"])


def downgrade() -> None:
    for table in ["stock_movements","purchase_receipt_items","purchase_receipts","inventory_balances","products","warehouses","product_categories"]:
        op.drop_table(table)
