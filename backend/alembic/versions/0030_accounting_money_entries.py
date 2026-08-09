"""add accounting money entries

Revision ID: 0030_accounting_money_entries
Revises: 0029_loan_accounting
Create Date: 2026-08-09
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_accounting_money_entries"
down_revision: str | None = "0029_loan_accounting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "accounting_money_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("financial_account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("category_ledger_account_id", sa.String(36), sa.ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("reference", sa.String(180)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_accounting_money_entries_org_date_kind", "accounting_money_entries", ["organization_id", "entry_date", "kind"])
    op.create_index("ix_accounting_money_entries_org_account_date", "accounting_money_entries", ["organization_id", "financial_account_id", "entry_date"])


def downgrade() -> None:
    op.drop_index("ix_accounting_money_entries_org_account_date", table_name="accounting_money_entries")
    op.drop_index("ix_accounting_money_entries_org_date_kind", table_name="accounting_money_entries")
    op.drop_table("accounting_money_entries")
