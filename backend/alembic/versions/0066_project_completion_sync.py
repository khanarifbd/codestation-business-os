"""synchronize completed project execution state

Revision ID: 0066_project_completion_sync
Revises: 0065_project_reviews
Create Date: 2026-09-03
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0066_project_completion_sync"
down_revision: str | None = "0065_project_reviews"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Historical completed projects could still contain open/overdue execution
    # records because project completion previously updated only the project row.
    # Preserve explicitly cancelled child records; synchronize all other work.
    op.execute(
        """
        UPDATE project_tasks AS task
        SET
            status = 'completed',
            progress_percent = 100,
            completed_at = COALESCE(task.completed_at, project.completed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        FROM projects AS project
        WHERE
            task.project_id = project.id
            AND task.organization_id = project.organization_id
            AND project.status = 'completed'
            AND task.status <> 'cancelled'
            AND (
                task.status <> 'completed'
                OR task.progress_percent <> 100
                OR task.completed_at IS NULL
            )
        """
    )
    op.execute(
        """
        UPDATE project_milestones AS milestone
        SET
            status = 'completed',
            progress_percent = 100,
            completed_at = COALESCE(milestone.completed_at, project.completed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        FROM projects AS project
        WHERE
            milestone.project_id = project.id
            AND milestone.organization_id = project.organization_id
            AND project.status = 'completed'
            AND milestone.status <> 'cancelled'
            AND (
                milestone.status <> 'completed'
                OR milestone.progress_percent <> 100
                OR milestone.completed_at IS NULL
            )
        """
    )
    op.execute(
        """
        UPDATE projects
        SET progress_percent = 100, updated_at = CURRENT_TIMESTAMP
        WHERE status = 'completed' AND progress_percent <> 100
        """
    )


def downgrade() -> None:
    # This is an intentional data-integrity backfill. Previous task/milestone
    # statuses and progress values cannot be reconstructed reliably.
    pass
