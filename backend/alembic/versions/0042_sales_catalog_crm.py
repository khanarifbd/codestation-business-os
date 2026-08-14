"""add sales catalog lineage and CRM lead interests

Revision ID: 0042_sales_catalog_crm
Revises: 0041_inventory_foundation
"""
from alembic import op
import sqlalchemy as sa

revision = "0042_sales_catalog_crm"
down_revision = "0041_inventory_foundation"
branch_labels = None
depends_on = None


def _add_sales_snapshot_columns(table: str, *, lead_interest: bool = False) -> None:
    op.add_column(table, sa.Column("product_id", sa.String(36), nullable=True))
    if lead_interest:
        op.add_column(table, sa.Column("lead_interest_id", sa.String(36), nullable=True))
    op.add_column(table, sa.Column("item_name_snapshot", sa.String(220), nullable=True))
    op.add_column(table, sa.Column("sku_snapshot", sa.String(80), nullable=True))
    op.add_column(table, sa.Column("item_type_snapshot", sa.String(24), nullable=True))
    op.add_column(table, sa.Column("unit_snapshot", sa.String(40), nullable=True))

    op.create_foreign_key(
        f"fk_{table}_product_id_products",
        table,
        "products",
        ["product_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(f"ix_{table}_org_product", table, ["organization_id", "product_id"])

    op.execute(
        sa.text(
            f"""
            UPDATE {table}
            SET item_name_snapshot = LEFT(description, 220),
                item_type_snapshot = 'service',
                unit_snapshot = 'unit'
            WHERE item_name_snapshot IS NULL
            """
        )
    )
    op.alter_column(table, "item_name_snapshot", nullable=False)
    op.alter_column(table, "item_type_snapshot", nullable=False, server_default="service")
    op.alter_column(table, "unit_snapshot", nullable=False, server_default="unit")
    op.alter_column(table, "item_type_snapshot", server_default=None)
    op.alter_column(table, "unit_snapshot", server_default=None)


def upgrade() -> None:
    op.create_table(
        "lead_interests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lead_id", sa.String(36), sa.ForeignKey("leads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.String(36), sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("item_name_snapshot", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("item_type_snapshot", sa.String(24), nullable=False, server_default="service"),
        sa.Column("unit_snapshot", sa.String(40), nullable=False, server_default="unit"),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False, server_default="1"),
        sa.Column("estimated_unit_price", sa.Numeric(16, 4), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_lead_interests_org_lead_sort", "lead_interests", ["organization_id", "lead_id", "sort_order"])
    op.create_index("ix_lead_interests_org_product", "lead_interests", ["organization_id", "product_id"])

    _add_sales_snapshot_columns("quotation_items", lead_interest=True)
    op.create_foreign_key(
        "fk_quotation_items_lead_interest_id_lead_interests",
        "quotation_items",
        "lead_interests",
        ["lead_interest_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_quotation_items_org_lead_interest", "quotation_items", ["organization_id", "lead_interest_id"])

    _add_sales_snapshot_columns("order_items")
    _add_sales_snapshot_columns("invoice_items")


def downgrade() -> None:
    for table in ("invoice_items", "order_items"):
        op.drop_index(f"ix_{table}_org_product", table_name=table)
        op.drop_constraint(f"fk_{table}_product_id_products", table, type_="foreignkey")
        for column in ("unit_snapshot", "item_type_snapshot", "sku_snapshot", "item_name_snapshot", "product_id"):
            op.drop_column(table, column)

    op.drop_index("ix_quotation_items_org_lead_interest", table_name="quotation_items")
    op.drop_constraint("fk_quotation_items_lead_interest_id_lead_interests", "quotation_items", type_="foreignkey")
    op.drop_index("ix_quotation_items_org_product", table_name="quotation_items")
    op.drop_constraint("fk_quotation_items_product_id_products", "quotation_items", type_="foreignkey")
    for column in ("unit_snapshot", "item_type_snapshot", "sku_snapshot", "item_name_snapshot", "lead_interest_id", "product_id"):
        op.drop_column("quotation_items", column)

    op.drop_index("ix_lead_interests_org_product", table_name="lead_interests")
    op.drop_index("ix_lead_interests_org_lead_sort", table_name="lead_interests")
    op.drop_table("lead_interests")
