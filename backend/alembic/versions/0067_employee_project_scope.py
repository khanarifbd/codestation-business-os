"""scope default employee project access to assigned projects

Revision ID: 0067_employee_project_scope
Revises: 0066_project_completion_sync
Create Date: 2026-09-03
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0067_employee_project_scope"
down_revision: str | None = "0066_project_completion_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The built-in User role is the employee self-service role. Employee project
    # visibility now flows through projects.work + active ProjectMember scope.
    # Remove the legacy broad projects.view grant while preserving custom roles.
    op.execute(
        """
        UPDATE organization_roles
        SET permissions = permissions - 'projects.view', updated_at = CURRENT_TIMESTAMP
        WHERE slug = 'user' AND is_system = true AND permissions ? 'projects.view'
        """
    )
    op.execute(
        """
        UPDATE organization_roles
        SET permissions = permissions || '["projects.work"]'::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE slug = 'user' AND is_system = true AND NOT (permissions ? 'projects.work')
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE organization_roles
        SET permissions = permissions || '["projects.view"]'::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE slug = 'user' AND is_system = true AND NOT (permissions ? 'projects.view')
        """
    )
