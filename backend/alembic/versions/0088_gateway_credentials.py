"""Support self-managed Stripe connections while preserving Stripe Connect OAuth.

Revision ID: 0088_gateway_credentials
Revises: 0087_stripe_connections
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0088_gateway_credentials"
down_revision: str | None = "0087_stripe_connections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("payment_gateway_connections", sa.Column("connection_method", sa.String(24), server_default="oauth", nullable=False))
    op.add_column("payment_gateway_connections", sa.Column("account_label", sa.String(180), nullable=True))
    op.add_column("payment_gateway_connections", sa.Column("secret_key_ciphertext", sa.Text(), nullable=True))
    op.add_column("payment_gateway_connections", sa.Column("webhook_secret_ciphertext", sa.Text(), nullable=True))
    op.add_column("payment_gateway_connections", sa.Column("credential_hint", sa.String(16), nullable=True))
    op.create_check_constraint(
        "ck_gateway_connection_method", "payment_gateway_connections",
        "connection_method IN ('oauth', 'api_key')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_gateway_connection_method", "payment_gateway_connections", type_="check")
    for name in ("credential_hint", "webhook_secret_ciphertext", "secret_key_ciphertext", "account_label", "connection_method"):
        op.drop_column("payment_gateway_connections", name)
