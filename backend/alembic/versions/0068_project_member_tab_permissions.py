"""add per-member project tab permissions

Revision ID: 0068_project_member_tabs
Revises: 0067_employee_project_scope
Create Date: 2026-09-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0068_project_member_tabs"
down_revision: str | None = "0067_employee_project_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULT_MEMBER_TABS = '["overview","milestones","tasks","work","documents","team"]'
_ALL_TABS = '["overview","milestones","tasks","work","documents","credentials","team","review_tips"]'


def upgrade() -> None:
    op.add_column(
        "project_members",
        sa.Column(
            "tab_permissions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text(f"'{_DEFAULT_MEMBER_TABS}'::jsonb"),
        ),
    )
    # Existing project managers retain the complete execution workspace. Existing
    # team members get the safe execution tabs they already used; sensitive
    # Credentials and Review & Tips require an explicit admin grant.
    op.execute(
        f"""
        UPDATE project_members pm
        SET tab_permissions = '{_ALL_TABS}'::jsonb
        FROM projects p
        WHERE p.id = pm.project_id
          AND p.organization_id = pm.organization_id
          AND p.project_manager_employee_id = pm.employee_id
        """
    )


def downgrade() -> None:
    op.drop_column("project_members", "tab_permissions")
