"""Per-organization Stripe Connect account links and short-lived OAuth states.

Revision ID: 0087_stripe_connections
Revises: 0086_session_idle
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0087_stripe_connections"
down_revision: str | None = "0086_session_idle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payment_gateway_connections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(32), server_default="stripe", nullable=False),
        sa.Column("mode", sa.String(8), nullable=False),
        sa.Column("provider_account_id", sa.String(100), nullable=False),
        sa.Column("charges_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("payouts_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("details_submitted", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("connected_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("mode IN ('test', 'live')", name="ck_payment_gateway_mode"),
        sa.UniqueConstraint("organization_id", "provider", "mode", name="uq_gateway_connection_org_provider_mode"),
        sa.UniqueConstraint("provider", "mode", "provider_account_id", name="uq_gateway_connection_provider_account_mode"),
    )
    op.create_index("ix_gateway_connections_org_enabled", "payment_gateway_connections", ["organization_id", "is_active"])
    op.create_table(
        "gateway_oauth_states",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(32), server_default="stripe", nullable=False),
        sa.Column("mode", sa.String(8), nullable=False),
        sa.Column("requested_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("mode IN ('test', 'live')", name="ck_gateway_oauth_mode"),
    )
    op.create_index("ix_gateway_oauth_states_org_expires", "gateway_oauth_states", ["organization_id", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_gateway_oauth_states_org_expires", table_name="gateway_oauth_states")
    op.drop_table("gateway_oauth_states")
    op.drop_index("ix_gateway_connections_org_enabled", table_name="payment_gateway_connections")
    op.drop_table("payment_gateway_connections")
