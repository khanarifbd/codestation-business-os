"""Stripe live payout reconciliation.

Revision ID: 0093_stripe_payout
Revises: 0092_stripe_accounting
"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0093_stripe_payout"
down_revision: str | None = "0092_stripe_accounting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stripe_payout_reconciliations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.String(36), sa.ForeignKey("payment_gateway_connections.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("stripe_payout_id", sa.String(120), nullable=False),
        sa.Column("transfer_id", sa.String(36), sa.ForeignKey("account_transfers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("stripe_account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("bank_account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("bank_statement_reference", sa.String(180), nullable=False),
        sa.Column("reconciled_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount_minor > 0", name="ck_stripe_payout_positive_amount"),
        sa.UniqueConstraint("connection_id", "stripe_payout_id", name="uq_stripe_payout_connection_payout"),
        sa.UniqueConstraint("transfer_id", name="uq_stripe_payout_transfer"),
    )
    op.create_index("ix_stripe_payout_org_connection", "stripe_payout_reconciliations", ["organization_id", "connection_id"])


def downgrade() -> None:
    op.drop_index("ix_stripe_payout_org_connection", table_name="stripe_payout_reconciliations")
    op.drop_table("stripe_payout_reconciliations")
