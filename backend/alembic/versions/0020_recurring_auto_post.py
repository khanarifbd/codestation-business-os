"""add recurring expense auto posting controls

Revision ID: 0020_recurring_auto_post
Revises: 0019_finance_controls
Create Date: 2026-08-08
"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0020_recurring_auto_post"
down_revision: str | None = "0019_finance_controls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("recurring_expenses", sa.Column("auto_post", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("recurring_expenses", sa.Column("auto_post_last_attempt_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("recurring_expenses", sa.Column("auto_post_last_error", sa.Text(), nullable=True))
    op.create_index(
        "ix_recurring_expenses_org_auto_due",
        "recurring_expenses",
        ["organization_id", "auto_post", "is_active", "next_due_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_recurring_expenses_org_auto_due", table_name="recurring_expenses")
    op.drop_column("recurring_expenses", "auto_post_last_error")
    op.drop_column("recurring_expenses", "auto_post_last_attempt_at")
    op.drop_column("recurring_expenses", "auto_post")
