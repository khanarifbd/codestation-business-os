"""add organization onboarding fields

Revision ID: 0002_organization_onboarding
Revises: 0001_saas_foundation
Create Date: 2026-08-07
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0002_organization_onboarding"
down_revision: str | None = "0001_saas_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("business_type", sa.String(length=80), nullable=True))
    op.add_column("organizations", sa.Column("team_size", sa.String(length=32), nullable=True))
    op.add_column(
        "organizations",
        sa.Column("financial_year_start_month", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "organizations",
        sa.Column("setup_completed", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.alter_column("organizations", "financial_year_start_month", server_default=None)
    op.alter_column("organizations", "setup_completed", server_default=None)


def downgrade() -> None:
    op.drop_column("organizations", "setup_completed")
    op.drop_column("organizations", "financial_year_start_month")
    op.drop_column("organizations", "team_size")
    op.drop_column("organizations", "business_type")
