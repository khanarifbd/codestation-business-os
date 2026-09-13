"""add Google identity linkage to users

Revision ID: 0046_google_identity
Revises: 0045_expense_defaults
Create Date: 2026-08-17
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0046_google_identity"
down_revision: str | None = "0045_expense_defaults"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_subject", sa.String(length=255), nullable=True))
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(length=255),
        nullable=True,
    )
    op.create_index(
        "ix_users_google_subject",
        "users",
        ["google_subject"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    google_only_users = bind.execute(
        sa.text("SELECT COUNT(*) FROM users WHERE password_hash IS NULL")
    ).scalar_one()
    if google_only_users:
        raise RuntimeError(
            "Cannot downgrade 0046_google_identity while Google-only user accounts exist. "
            "Set a password for those users before downgrading."
        )
    op.drop_index("ix_users_google_subject", table_name="users")
    op.drop_column("users", "google_subject")
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(length=255),
        nullable=False,
    )
