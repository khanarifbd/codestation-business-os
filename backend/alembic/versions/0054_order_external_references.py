"""add external order source references

Revision ID: 0054_order_external_references
Revises: 0053_manual_order_projects
"""

from alembic import op
import sqlalchemy as sa

revision = "0054_order_external_references"
down_revision = "0053_manual_order_projects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("source", sa.String(length=100), nullable=True))
    op.add_column("orders", sa.Column("external_order_id", sa.String(length=180), nullable=True))
    op.create_index(
        "ix_orders_org_source_external",
        "orders",
        ["organization_id", "source", "external_order_id"],
        unique=False,
    )
    op.create_index(
        "uq_orders_org_source_external_order",
        "orders",
        ["organization_id", "source", "external_order_id"],
        unique=True,
        postgresql_where=sa.text("source IS NOT NULL AND external_order_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_orders_org_source_external_order", table_name="orders")
    op.drop_index("ix_orders_org_source_external", table_name="orders")
    op.drop_column("orders", "external_order_id")
    op.drop_column("orders", "source")
