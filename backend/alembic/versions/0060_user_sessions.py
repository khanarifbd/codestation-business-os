"""add per-device user sessions

Revision ID: 0060_user_sessions
Revises: 0059_client_resources
Create Date: 2026-08-20
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0060_user_sessions"
down_revision: str | None = "0059_client_resources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False),
        sa.Column("auth_method", sa.String(24), nullable=False),
        sa.Column("device_type", sa.String(24), nullable=False),
        sa.Column("browser", sa.String(80), nullable=False),
        sa.Column("operating_system", sa.String(80), nullable=False),
        sa.Column("user_agent", sa.String(1000), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(80), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_user_last_seen", "user_sessions", ["user_id", "last_seen_at"])
    op.create_index("ix_user_sessions_user_active", "user_sessions", ["user_id", "revoked_at", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_user_sessions_user_active", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_last_seen", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")
