"""support manual orders without quotations

Revision ID: 0035_manual_orders
Revises: 0034_posting_idempotency
"""

from alembic import op

revision = "0035_manual_orders"
down_revision = "0034_posting_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("orders", "quotation_id", nullable=True)


def downgrade() -> None:
    op.alter_column("orders", "quotation_id", nullable=False)
