"""link loan repayment fees to their exact repayment

Revision ID: 0079_loan_fee_repayment_link
Revises: 0078_journal_source_idempotency
Create Date: 2026-09-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0079_loan_fee_repayment_link"
down_revision: str | None = "0078_journal_source_idempotency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "loan_fees",
        sa.Column("repayment_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_loan_fees_repayment_id",
        "loan_fees",
        "loan_repayments",
        ["repayment_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ux_loan_fees_org_repayment",
        "loan_fees",
        ["organization_id", "repayment_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_loan_fees_org_repayment", table_name="loan_fees")
    op.drop_constraint("fk_loan_fees_repayment_id", "loan_fees", type_="foreignkey")
    op.drop_column("loan_fees", "repayment_id")
