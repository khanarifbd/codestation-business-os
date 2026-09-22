"""Separate explicit user activity from background request telemetry.

Revision ID: 0086_session_idle
Revises: 0085_passkeys
Create Date: 2026-09-22
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0086_session_idle"
down_revision: str | None = "0085_passkeys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_sessions", sa.Column("last_user_activity_at", sa.DateTime(timezone=True), nullable=True))
    # Historical last_seen_at includes automated API polling. Existing sessions
    # created before the idle window must reauthenticate once on rollout.
    op.execute("UPDATE user_sessions SET last_user_activity_at = created_at")
    op.alter_column("user_sessions", "last_user_activity_at", nullable=False)


def downgrade() -> None:
    op.drop_column("user_sessions", "last_user_activity_at")
