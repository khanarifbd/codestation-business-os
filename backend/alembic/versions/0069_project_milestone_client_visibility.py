"""add client visibility to project milestones

Revision ID: 0069_milestone_client_visibility
Revises: 0068_project_member_tabs
Create Date: 2026-09-04
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0069_milestone_client_visibility"
down_revision: str | None = "0068_project_member_tabs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project_milestones",
        sa.Column("client_visible", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("project_milestones", "client_visible")
