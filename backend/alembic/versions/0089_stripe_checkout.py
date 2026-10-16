"""Add Stripe Checkout sandbox attempts and deduplicated signed events.

Revision ID: 0089_stripe_checkout
Revises: 0088_gateway_credentials
"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0089_stripe_checkout"
down_revision: str | None = "0088_gateway_credentials"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stripe_checkout_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("connection_id", sa.String(36), sa.ForeignKey("payment_gateway_connections.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("mode", sa.String(8), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("stripe_session_id", sa.String(120), nullable=True),
        sa.Column("stripe_payment_intent_id", sa.String(120), nullable=True),
        sa.Column("checkout_url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), server_default="initiated", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("mode IN ('test', 'live')", name="ck_stripe_checkout_mode"),
        sa.CheckConstraint("amount_minor > 0", name="ck_stripe_checkout_positive_amount"),
        sa.UniqueConstraint("stripe_session_id", name="uq_stripe_checkout_session"),
    )
    op.create_index("ix_stripe_checkout_org_invoice_created", "stripe_checkout_attempts", ["organization_id", "invoice_id", "created_at"])
    op.create_index("ix_stripe_checkout_org_connection", "stripe_checkout_attempts", ["organization_id", "connection_id"])
    op.create_table(
        "stripe_webhook_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.String(36), sa.ForeignKey("payment_gateway_connections.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("stripe_event_id", sa.String(140), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("attempt_id", sa.String(36), sa.ForeignKey("stripe_checkout_attempts.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("result", sa.String(32), server_default="received", nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("connection_id", "stripe_event_id", name="uq_stripe_webhook_connection_event"),
    )
    op.create_index("ix_stripe_webhook_org_received", "stripe_webhook_events", ["organization_id", "received_at"])


def downgrade() -> None:
    op.drop_index("ix_stripe_webhook_org_received", table_name="stripe_webhook_events")
    op.drop_table("stripe_webhook_events")
    op.drop_index("ix_stripe_checkout_org_connection", table_name="stripe_checkout_attempts")
    op.drop_index("ix_stripe_checkout_org_invoice_created", table_name="stripe_checkout_attempts")
    op.drop_table("stripe_checkout_attempts")
