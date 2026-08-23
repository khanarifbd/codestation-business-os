"""add persistent browser device identity to user sessions

Revision ID: 0063_session_device_id
Revises: 0062_user_login_identity
Create Date: 2026-08-23
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0063_session_device_id"
down_revision: str | None = "0062_user_login_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column("device_id_hash", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_user_sessions_user_device",
        "user_sessions",
        ["user_id", "device_id_hash"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_sessions_user_device", table_name="user_sessions")
    op.drop_column("user_sessions", "device_id_hash")
