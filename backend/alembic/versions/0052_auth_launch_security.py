"""add launch authentication security controls

Revision ID: 0052_auth_launch_security
Revises: 0051_fx_history_and_gl_integrity
Create Date: 2026-08-18
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0052_auth_launch_security"
down_revision: str | None = "0051_fx_history_and_gl_integrity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "auth_token_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    # Password accounts that pre-date mandatory email verification must remain
    # usable after deployment. New password signups are created unverified by the
    # application and must complete the verification flow.
    op.execute(
        """
        UPDATE users
        SET is_verified = TRUE
        WHERE password_hash IS NOT NULL
          AND is_verified = FALSE
        """
    )

    op.create_table(
        "auth_rate_limit_buckets",
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("request_count > 0", name="ck_auth_rate_limit_positive_count"),
        sa.PrimaryKeyConstraint("key_hash"),
    )
    op.create_index(
        "ix_auth_rate_limit_expires_at",
        "auth_rate_limit_buckets",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_auth_rate_limit_expires_at", table_name="auth_rate_limit_buckets")
    op.drop_table("auth_rate_limit_buckets")
    op.drop_column("users", "auth_token_version")
