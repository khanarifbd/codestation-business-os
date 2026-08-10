"""add tenant context lookup index

Revision ID: 0003_tenant_context_foundation
Revises: 0002_organization_onboarding
Create Date: 2026-08-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003_tenant_context_foundation"
down_revision: str | None = "0002_organization_onboarding"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_memberships_user_status_org",
        "memberships",
        ["user_id", "status", "organization_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_memberships_user_status_org", table_name="memberships")
