"""add product-aware sales and inventory fulfillment

Revision ID: 0042_inventory_sales
Revises: 0041_inventory_foundation
"""
from alembic import op
import sqlalchemy as sa

revision = "0042_inventory_sales"
down_revision = "0041_inventory_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ["quotation_items", "order_items", "invoice_items"]:
        op.add_column(table, sa.Column("product_id", sa.String(36), nullable=True))
        op.add_column(table, sa.Column("sku_snapshot", sa.String(80), nullable=True))
        op.add_column(table, sa.Column("item_type_snapshot", sa.String(24), nullable=True))
        op.create_foreign_key(f"fk_{table}_product", table, "products", ["product_id"], ["id"], ondelete="SET NULL")
        op.create_index(f"ix_{table}_org_product", table, ["organization_id", "product_id"])

    op.create_table(
        "order_fulfillments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fulfillment_number", sa.String(40), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.String(36), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("fulfillment_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="posted"),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "fulfillment_number", name="uq_order_fulfillments_org_number"),
    )
    op.create_index("ix_order_fulfillments_org_order_date", "order_fulfillments", ["organization_id", "order_id", "fulfillment_date"])
    op.create_table(
        "order_fulfillment_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fulfillment_id", sa.String(36), sa.ForeignKey("order_fulfillments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_item_id", sa.String(36), sa.ForeignKey("order_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("product_id", sa.String(36), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 4), nullable=False),
        sa.Column("total_cost", sa.Numeric(20, 4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_order_fulfillment_items_org_fulfillment", "order_fulfillment_items", ["organization_id", "fulfillment_id"])
    op.create_index("ix_order_fulfillment_items_org_order_item", "order_fulfillment_items", ["organization_id", "order_item_id"])


def downgrade() -> None:
    op.drop_table("order_fulfillment_items")
    op.drop_table("order_fulfillments")
    for table in ["invoice_items", "order_items", "quotation_items"]:
        op.drop_index(f"ix_{table}_org_product", table_name=table)
        op.drop_constraint(f"fk_{table}_product", table, type_="foreignkey")
        op.drop_column(table, "item_type_snapshot")
        op.drop_column(table, "sku_snapshot")
        op.drop_column(table, "product_id")
