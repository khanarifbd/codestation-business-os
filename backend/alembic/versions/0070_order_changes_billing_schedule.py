"""add order changes and billing schedule

Revision ID: 0070_order_commercial
Revises: 0069_milestone_client_visibility
Create Date: 2026-09-05
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0070_order_commercial"
down_revision: str | None = "0069_milestone_client_visibility"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "order_changes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("change_number", sa.String(40), nullable=False),
        sa.Column("change_type", sa.String(24), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("subtotal", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("discount_total", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("tax_total", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("approved_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("rejected_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "order_id", "change_number", name="uq_order_changes_org_order_number"),
    )
    op.create_index("ix_order_changes_org_order_status", "order_changes", ["organization_id", "order_id", "status"])

    op.create_table(
        "order_change_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_change_id", sa.String(36), sa.ForeignKey("order_changes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_order_item_id", sa.String(36), sa.ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_id", sa.String(36), sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("item_name_snapshot", sa.String(220), nullable=False),
        sa.Column("sku_snapshot", sa.String(80), nullable=True),
        sa.Column("item_type_snapshot", sa.String(24), nullable=False, server_default="service"),
        sa.Column("unit_snapshot", sa.String(40), nullable=False, server_default="unit"),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(16, 4), nullable=False),
        sa.Column("discount_percent", sa.Numeric(7, 4), nullable=False, server_default="0"),
        sa.Column("tax_rate", sa.Numeric(8, 4), nullable=False, server_default="0"),
        sa.Column("line_subtotal", sa.Numeric(16, 2), nullable=False),
        sa.Column("discount_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("taxable_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(16, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_order_change_items_org_change_sort", "order_change_items", ["organization_id", "order_change_id", "sort_order"])

    op.create_table(
        "order_billing_milestones",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("project_milestone_id", sa.String(36), sa.ForeignKey("project_milestones.id", ondelete="SET NULL"), nullable=True),
        sa.Column("order_change_id", sa.String(36), sa.ForeignKey("order_changes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="planned"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_order_billing_org_order_sort", "order_billing_milestones", ["organization_id", "order_id", "sort_order"])
    op.create_index("ix_order_billing_org_order_status", "order_billing_milestones", ["organization_id", "order_id", "status"])

    op.create_table(
        "order_billing_milestone_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("billing_milestone_id", sa.String(36), sa.ForeignKey("order_billing_milestones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_order_item_id", sa.String(36), sa.ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_order_change_item_id", sa.String(36), sa.ForeignKey("order_change_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_id", sa.String(36), sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("item_name_snapshot", sa.String(220), nullable=False),
        sa.Column("sku_snapshot", sa.String(80), nullable=True),
        sa.Column("item_type_snapshot", sa.String(24), nullable=False, server_default="service"),
        sa.Column("unit_snapshot", sa.String(40), nullable=False, server_default="unit"),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(16, 4), nullable=False),
        sa.Column("discount_percent", sa.Numeric(7, 4), nullable=False, server_default="0"),
        sa.Column("tax_rate", sa.Numeric(8, 4), nullable=False, server_default="0"),
        sa.Column("line_subtotal", sa.Numeric(16, 2), nullable=False),
        sa.Column("discount_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("taxable_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(16, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_order_billing_items_org_milestone_sort", "order_billing_milestone_items", ["organization_id", "billing_milestone_id", "sort_order"])

    op.add_column("invoices", sa.Column("billing_milestone_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_invoices_billing_milestone", "invoices", "order_billing_milestones", ["billing_milestone_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_invoices_org_billing_milestone", "invoices", ["organization_id", "billing_milestone_id"])


def downgrade() -> None:
    op.drop_index("ix_invoices_org_billing_milestone", table_name="invoices")
    op.drop_constraint("fk_invoices_billing_milestone", "invoices", type_="foreignkey")
    op.drop_column("invoices", "billing_milestone_id")
    op.drop_index("ix_order_billing_items_org_milestone_sort", table_name="order_billing_milestone_items")
    op.drop_table("order_billing_milestone_items")
    op.drop_index("ix_order_billing_org_order_status", table_name="order_billing_milestones")
    op.drop_index("ix_order_billing_org_order_sort", table_name="order_billing_milestones")
    op.drop_table("order_billing_milestones")
    op.drop_index("ix_order_change_items_org_change_sort", table_name="order_change_items")
    op.drop_table("order_change_items")
    op.drop_index("ix_order_changes_org_order_status", table_name="order_changes")
    op.drop_table("order_changes")
