"""add bank reconciliation control

Revision ID: 0038_bank_reconciliation
Revises: 0037_investments_funding_v2
"""

import sqlalchemy as sa
from alembic import op

revision = "0038_bank_reconciliation"
down_revision = "0037_investments_funding_v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bank_reconciliations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("statement_start_date", sa.Date(), nullable=True),
        sa.Column("statement_end_date", sa.Date(), nullable=False),
        sa.Column("statement_ending_balance", sa.Numeric(18, 2), nullable=False),
        sa.Column("cleared_book_balance", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("difference", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="draft"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("finalized_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["finalized_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bank_reconciliations_organization_id", "bank_reconciliations", ["organization_id"])
    op.create_index("ix_bank_reconciliations_org_account_end", "bank_reconciliations", ["organization_id", "account_id", "statement_end_date"])
    op.create_index("ix_bank_reconciliations_org_status", "bank_reconciliations", ["organization_id", "status"])

    op.create_table(
        "bank_reconciliation_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("reconciliation_id", sa.String(length=36), nullable=False),
        sa.Column("financial_transaction_id", sa.String(length=36), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reconciliation_id"], ["bank_reconciliations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["financial_transaction_id"], ["financial_transactions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "financial_transaction_id", name="uq_reconciliation_transaction_once"),
    )
    op.create_index("ix_bank_reconciliation_items_organization_id", "bank_reconciliation_items", ["organization_id"])
    op.create_index("ix_reconciliation_items_org_reconciliation", "bank_reconciliation_items", ["organization_id", "reconciliation_id"])


def downgrade() -> None:
    op.drop_index("ix_reconciliation_items_org_reconciliation", table_name="bank_reconciliation_items")
    op.drop_index("ix_bank_reconciliation_items_organization_id", table_name="bank_reconciliation_items")
    op.drop_table("bank_reconciliation_items")
    op.drop_index("ix_bank_reconciliations_org_status", table_name="bank_reconciliations")
    op.drop_index("ix_bank_reconciliations_org_account_end", table_name="bank_reconciliations")
    op.drop_index("ix_bank_reconciliations_organization_id", table_name="bank_reconciliations")
    op.drop_table("bank_reconciliations")
