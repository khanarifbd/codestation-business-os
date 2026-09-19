"""add owner equity transactions

Revision ID: 0082_owner_equity_transactions
Revises: 0081_tax_settlements
Create Date: 2026-09-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0082_owner_equity_transactions"
down_revision: str | None = "0081_tax_settlements"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "owner_equity_transactions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("transaction_type", sa.String(length=24), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
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
    op.create_index("ix_owner_equity_transactions_organization_id", "owner_equity_transactions", ["organization_id"])
    op.create_index("ix_owner_equity_transactions_org_date", "owner_equity_transactions", ["organization_id", "transaction_date"])
    op.create_index("ix_owner_equity_transactions_org_type_date", "owner_equity_transactions", ["organization_id", "transaction_type", "transaction_date"])


def downgrade() -> None:
    op.drop_index("ix_owner_equity_transactions_org_type_date", table_name="owner_equity_transactions")
    op.drop_index("ix_owner_equity_transactions_org_date", table_name="owner_equity_transactions")
    op.drop_index("ix_owner_equity_transactions_organization_id", table_name="owner_equity_transactions")
    op.drop_table("owner_equity_transactions")
