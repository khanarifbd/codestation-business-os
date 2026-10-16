"""Stripe settlement-to-accounting posting linkage.

Revision ID: 0092_stripe_accounting
Revises: 0091_stripe_settlement
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0092_stripe_accounting"
down_revision: str | None = "0091_stripe_settlement"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stripe_accounting_postings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snapshot_id", sa.String(36), sa.ForeignKey("stripe_settlement_snapshots.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("payment_id", sa.String(36), sa.ForeignKey("payments.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("fee_journal_entry_id", sa.String(36), sa.ForeignKey("journal_entries.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("snapshot_id", name="uq_stripe_accounting_posting_snapshot"),
        sa.UniqueConstraint("payment_id", name="uq_stripe_accounting_posting_payment"),
    )
    op.create_index(
        "ix_stripe_accounting_postings_org_created",
        "stripe_accounting_postings", ["organization_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_stripe_accounting_postings_org_created", table_name="stripe_accounting_postings")
    op.drop_table("stripe_accounting_postings")
