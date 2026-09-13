"""add user avatar metadata

Revision ID: 0050_user_avatar
Revises: 0049_user_profile_fields
Create Date: 2026-08-18
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0050_user_avatar"
down_revision: str | None = "0049_user_profile_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_storage_key", sa.String(length=500), nullable=True))
    op.add_column("users", sa.Column("avatar_content_type", sa.String(length=64), nullable=True))
    op.add_column(
        "users",
        sa.Column("avatar_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "avatar_version")
    op.drop_column("users", "avatar_content_type")
    op.drop_column("users", "avatar_storage_key")
