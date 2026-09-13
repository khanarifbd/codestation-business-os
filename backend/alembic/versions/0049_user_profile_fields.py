"""add user profile fields

Revision ID: 0049_user_profile_fields
Revises: 0048_functional_currency_periods
Create Date: 2026-08-18
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0049_user_profile_fields"
down_revision: str | None = "0048_functional_currency_periods"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(length=40), nullable=True))
    op.add_column("users", sa.Column("timezone", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "timezone")
    op.drop_column("users", "phone")
