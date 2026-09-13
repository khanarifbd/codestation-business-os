"""add sales fulfillment and base-currency inventory costing

Revision ID: 0043_sales_fulfillment_cogs
Revises: 0042_sales_catalog_crm
"""
from alembic import op
import sqlalchemy as sa

revision = "0043_sales_fulfillment_cogs"
down_revision = "0042_sales_catalog_crm"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inventory_balances", sa.Column("average_unit_cost_base", sa.Numeric(20, 4), nullable=True))
    op.add_column("inventory_balances", sa.Column("inventory_value_base", sa.Numeric(22, 4), nullable=True))

    op.add_column("stock_movements", sa.Column("base_currency", sa.String(3), nullable=True))
    op.add_column("stock_movements", sa.Column("unit_cost_base", sa.Numeric(20, 4), nullable=True))
    op.add_column("stock_movements", sa.Column("total_cost_base", sa.Numeric(22, 4), nullable=True))
    op.add_column("stock_movements", sa.Column("average_cost_base_after", sa.Numeric(20, 4), nullable=True))

    op.add_column("purchase_receipts", sa.Column("base_currency", sa.String(3), nullable=True))
    op.add_column("purchase_receipts", sa.Column("exchange_rate_to_base", sa.Numeric(24, 10), nullable=True))
    op.add_column("purchase_receipt_items", sa.Column("inventory_cost_base", sa.Numeric(22, 4), nullable=True))

    # Existing same-currency stock has an unambiguous base carrying value and is safe
    # to backfill. Historical foreign-currency stock intentionally remains NULL rather
    # than being revalued at today's FX rate.
    op.execute(sa.text("""
        UPDATE inventory_balances b
        SET average_unit_cost_base = b.average_unit_cost,
            inventory_value_base = b.inventory_value
        FROM products p, organizations o
        WHERE b.product_id = p.id
          AND b.organization_id = p.organization_id
          AND b.organization_id = o.id
          AND UPPER(p.currency) = UPPER(o.currency)
    """))
    op.execute(sa.text("""
        UPDATE stock_movements m
        SET base_currency = UPPER(o.currency),
            unit_cost_base = m.unit_cost,
            total_cost_base = m.total_cost,
            average_cost_base_after = m.average_cost_after
        FROM products p, organizations o
        WHERE m.product_id = p.id
          AND m.organization_id = p.organization_id
          AND m.organization_id = o.id
          AND UPPER(p.currency) = UPPER(o.currency)
    """))
    op.execute(sa.text("""
        UPDATE purchase_receipts r
        SET base_currency = UPPER(o.currency),
            exchange_rate_to_base = 1
        FROM organizations o
        WHERE r.organization_id = o.id
          AND UPPER(r.currency) = UPPER(o.currency)
    """))
    op.execute(sa.text("""
        UPDATE purchase_receipt_items i
        SET inventory_cost_base = i.inventory_cost
        FROM purchase_receipts r
        WHERE i.receipt_id = r.id
          AND i.organization_id = r.organization_id
          AND r.exchange_rate_to_base = 1
    """))

    op.create_table(
        "order_fulfillments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fulfillment_number", sa.String(48), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.String(36), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("fulfillment_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="posted"),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("total_cogs", sa.Numeric(22, 4), nullable=False, server_default="0"),
        sa.Column("total_cogs_base", sa.Numeric(22, 4), nullable=False, server_default="0"),
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
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(20, 4), nullable=False),
        sa.Column("total_cost", sa.Numeric(22, 4), nullable=False),
        sa.Column("unit_cost_base", sa.Numeric(20, 4), nullable=False),
        sa.Column("total_cost_base", sa.Numeric(22, 4), nullable=False),
        sa.Column("effective_rate_to_base", sa.Numeric(24, 10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_order_fulfillment_items_org_fulfillment", "order_fulfillment_items", ["organization_id", "fulfillment_id"])
    op.create_index("ix_order_fulfillment_items_org_order_item", "order_fulfillment_items", ["organization_id", "order_item_id"])


def downgrade() -> None:
    op.drop_index("ix_order_fulfillment_items_org_order_item", table_name="order_fulfillment_items")
    op.drop_index("ix_order_fulfillment_items_org_fulfillment", table_name="order_fulfillment_items")
    op.drop_table("order_fulfillment_items")
    op.drop_index("ix_order_fulfillments_org_order_date", table_name="order_fulfillments")
    op.drop_table("order_fulfillments")

    op.drop_column("purchase_receipt_items", "inventory_cost_base")
    op.drop_column("purchase_receipts", "exchange_rate_to_base")
    op.drop_column("purchase_receipts", "base_currency")
    op.drop_column("stock_movements", "average_cost_base_after")
    op.drop_column("stock_movements", "total_cost_base")
    op.drop_column("stock_movements", "unit_cost_base")
    op.drop_column("stock_movements", "base_currency")
    op.drop_column("inventory_balances", "inventory_value_base")
    op.drop_column("inventory_balances", "average_unit_cost_base")
