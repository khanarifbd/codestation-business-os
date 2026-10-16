"""Stripe test settlement records: verified gross, fee and net, no ledger mutation.

Revision ID: 0091_stripe_settlement
Revises: 0090_gateway_account_mapping
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0091_stripe_settlement"
down_revision: str | None = "0090_gateway_account_mapping"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stripe_settlement_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attempt_id", sa.String(36), sa.ForeignKey("stripe_checkout_attempts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("connection_id", sa.String(36), sa.ForeignKey("payment_gateway_connections.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("stripe_payment_intent_id", sa.String(120), nullable=False),
        sa.Column("stripe_charge_id", sa.String(120), nullable=False),
        sa.Column("stripe_balance_transaction_id", sa.String(120), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("gross_minor", sa.Integer(), nullable=False),
        sa.Column("fee_minor", sa.Integer(), nullable=False),
        sa.Column("net_minor", sa.Integer(), nullable=False),
        sa.Column("availability_status", sa.String(32), nullable=False),
        sa.Column("reconciled_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("gross_minor > 0", name="ck_stripe_settlement_gross_positive"),
        sa.CheckConstraint("fee_minor >= 0", name="ck_stripe_settlement_fee_nonnegative"),
        sa.CheckConstraint("net_minor >= 0", name="ck_stripe_settlement_net_nonnegative"),
        sa.CheckConstraint("gross_minor = fee_minor + net_minor", name="ck_stripe_settlement_gross_fee_net"),
        sa.UniqueConstraint("attempt_id", name="uq_stripe_settlement_attempt"),
        sa.UniqueConstraint("connection_id", "stripe_balance_transaction_id", name="uq_stripe_settlement_connection_transaction"),
    )
    op.create_index("ix_stripe_settlement_org_connection", "stripe_settlement_snapshots", ["organization_id", "connection_id"])


def downgrade() -> None:
    op.drop_index("ix_stripe_settlement_org_connection", table_name="stripe_settlement_snapshots")
    op.drop_table("stripe_settlement_snapshots")
