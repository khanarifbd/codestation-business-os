"""add fulfillment reversal metadata and stock catalog integrity

Revision ID: 0044_sales_reversal_integrity
Revises: 0043_sales_fulfillment_cogs
"""
from alembic import op
import sqlalchemy as sa

revision = "0044_sales_reversal_integrity"
down_revision = "0043_sales_fulfillment_cogs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_fulfillments", sa.Column("reversal_date", sa.Date(), nullable=True))
    op.add_column("order_fulfillments", sa.Column("reversal_reason", sa.Text(), nullable=True))
    op.add_column("order_fulfillments", sa.Column("reversed_by_user_id", sa.String(36), nullable=True))
    op.add_column("order_fulfillments", sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_order_fulfillments_reversed_by_user",
        "order_fulfillments",
        "users",
        ["reversed_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # Business OS already has a distinct non_stock_item type. Make catalog semantics
    # deterministic for historical documents: stock_item always means inventory-tracked,
    # while service/non_stock_item never creates stock movements.
    op.execute(sa.text("""
        UPDATE products
        SET track_inventory = TRUE
        WHERE item_type = 'stock_item' AND track_inventory IS NOT TRUE
    """))
    op.execute(sa.text("""
        UPDATE products
        SET track_inventory = FALSE, allow_negative_stock = FALSE, reorder_level = 0
        WHERE item_type <> 'stock_item'
          AND (track_inventory IS TRUE OR allow_negative_stock IS TRUE OR reorder_level <> 0)
    """))


def downgrade() -> None:
    op.drop_constraint("fk_order_fulfillments_reversed_by_user", "order_fulfillments", type_="foreignkey")
    op.drop_column("order_fulfillments", "reversed_at")
    op.drop_column("order_fulfillments", "reversed_by_user_id")
    op.drop_column("order_fulfillments", "reversal_reason")
    op.drop_column("order_fulfillments", "reversal_date")
