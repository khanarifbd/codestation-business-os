"""add payroll withholding payments

Revision ID: 0083_payroll_withholding
Revises: 0082_owner_equity_transactions
Create Date: 2026-09-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0083_payroll_withholding"
down_revision: str | None = "0082_owner_equity_transactions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payroll_withholding_payments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("reference", sa.String(length=180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_payroll_withholding_payments_organization_id", "payroll_withholding_payments", ["organization_id"])
    op.create_index("ix_payroll_withholding_payments_org_date", "payroll_withholding_payments", ["organization_id", "payment_date"])


def downgrade() -> None:
    op.drop_index("ix_payroll_withholding_payments_org_date", table_name="payroll_withholding_payments")
    op.drop_index("ix_payroll_withholding_payments_organization_id", table_name="payroll_withholding_payments")
    op.drop_table("payroll_withholding_payments")
