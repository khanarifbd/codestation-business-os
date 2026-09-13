"""deduplicate legacy session upgrades

Revision ID: 0061_session_upgrade_dedup
Revises: 0060_user_sessions
Create Date: 2026-08-20
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0061_session_upgrade_dedup"
down_revision: str | None = "0060_user_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column("legacy_refresh_fingerprint", sa.String(length=64), nullable=True),
    )
    op.create_unique_constraint(
        "uq_user_sessions_legacy_refresh_fingerprint",
        "user_sessions",
        ["legacy_refresh_fingerprint"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_user_sessions_legacy_refresh_fingerprint",
        "user_sessions",
        type_="unique",
    )
    op.drop_column("user_sessions", "legacy_refresh_fingerprint")
