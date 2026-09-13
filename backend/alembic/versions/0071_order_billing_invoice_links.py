"""normalize billing milestone invoice linkage

Revision ID: 0071_order_billing_invoice_links
Revises: 0070_order_commercial
Create Date: 2026-09-05
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0071_order_billing_invoice_links"
down_revision: str | None = "0070_order_commercial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_invoices_org_billing_milestone", table_name="invoices")
    op.drop_constraint("fk_invoices_billing_milestone", "invoices", type_="foreignkey")
    op.drop_column("invoices", "billing_milestone_id")
    op.create_table(
        "order_billing_invoice_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("billing_milestone_id", sa.String(36), sa.ForeignKey("order_billing_milestones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "invoice_id", name="uq_order_billing_links_org_invoice"),
    )
    op.create_index("ix_order_billing_links_org_milestone", "order_billing_invoice_links", ["organization_id", "billing_milestone_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_order_billing_links_org_milestone", table_name="order_billing_invoice_links")
    op.drop_table("order_billing_invoice_links")
    op.add_column("invoices", sa.Column("billing_milestone_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_invoices_billing_milestone", "invoices", "order_billing_milestones", ["billing_milestone_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_invoices_org_billing_milestone", "invoices", ["organization_id", "billing_milestone_id"])
