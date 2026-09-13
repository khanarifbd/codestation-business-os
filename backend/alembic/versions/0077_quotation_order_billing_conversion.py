"""carry quotation payment schedule into order billing milestones

Revision ID: 0077_quotation_order_billing
Revises: 0076_quotation_v2_api
Create Date: 2026-09-11
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0077_quotation_order_billing"
down_revision: str | None = "0076_quotation_v2_api"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "order_billing_milestones",
        sa.Column("source_quotation_payment_milestone_id", sa.String(36), nullable=True),
    )
    op.add_column(
        "order_billing_milestones",
        sa.Column("source_quotation_milestone_id", sa.String(36), nullable=True),
    )
    op.add_column(
        "order_billing_milestones",
        sa.Column("source_payment_type", sa.String(16), nullable=True),
    )
    op.add_column(
        "order_billing_milestones",
        sa.Column("source_percentage", sa.Numeric(7, 4), nullable=True),
    )
    op.add_column(
        "order_billing_milestones",
        sa.Column("due_condition", sa.Text(), nullable=True),
    )

    op.create_foreign_key(
        "fk_order_billing_source_quotation_payment",
        "order_billing_milestones",
        "quotation_payment_milestones",
        ["source_quotation_payment_milestone_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_order_billing_source_quotation_milestone",
        "order_billing_milestones",
        "quotation_milestones",
        ["source_quotation_milestone_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_order_billing_source_quotation_payment",
        "order_billing_milestones",
        ["organization_id", "order_id", "source_quotation_payment_milestone_id"],
    )
    op.create_index(
        "ix_order_billing_org_source_quotation_milestone",
        "order_billing_milestones",
        ["organization_id", "source_quotation_milestone_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_order_billing_org_source_quotation_milestone",
        table_name="order_billing_milestones",
    )
    op.drop_constraint(
        "uq_order_billing_source_quotation_payment",
        "order_billing_milestones",
        type_="unique",
    )
    op.drop_constraint(
        "fk_order_billing_source_quotation_milestone",
        "order_billing_milestones",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_order_billing_source_quotation_payment",
        "order_billing_milestones",
        type_="foreignkey",
    )
    op.drop_column("order_billing_milestones", "due_condition")
    op.drop_column("order_billing_milestones", "source_percentage")
    op.drop_column("order_billing_milestones", "source_payment_type")
    op.drop_column("order_billing_milestones", "source_quotation_milestone_id")
    op.drop_column("order_billing_milestones", "source_quotation_payment_milestone_id")
