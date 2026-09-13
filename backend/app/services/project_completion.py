from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.projects import Project, ProjectMilestone, ProjectTask


def complete_project_execution(
    db: Session,
    project: Project,
    completed_at: datetime,
) -> dict[str, int]:
    """Bring project execution records into a terminal completed state.

    Cancelled tasks/milestones remain cancelled. Everything else is completed in
    the same transaction as the project status change so execution summaries can
    never report open/overdue work for a completed project.
    """

    tasks = list(
        db.scalars(
            select(ProjectTask)
            .where(
                ProjectTask.organization_id == project.organization_id,
                ProjectTask.project_id == project.id,
            )
            .with_for_update()
        ).all()
    )
    milestones = list(
        db.scalars(
            select(ProjectMilestone)
            .where(
                ProjectMilestone.organization_id == project.organization_id,
                ProjectMilestone.project_id == project.id,
            )
            .with_for_update()
        ).all()
    )

    auto_completed_tasks = 0
    cancelled_tasks_preserved = 0
    for task in tasks:
        if task.status == "cancelled":
            cancelled_tasks_preserved += 1
            continue
        if task.status != "completed" or task.progress_percent != 100:
            auto_completed_tasks += 1
        task.status = "completed"
        task.progress_percent = 100
        task.completed_at = task.completed_at or completed_at

    auto_completed_milestones = 0
    cancelled_milestones_preserved = 0
    for milestone in milestones:
        if milestone.status == "cancelled":
            cancelled_milestones_preserved += 1
            continue
        if milestone.status != "completed" or milestone.progress_percent != 100:
            auto_completed_milestones += 1
        milestone.status = "completed"
        milestone.progress_percent = 100
        milestone.completed_at = milestone.completed_at or completed_at

    project.progress_percent = 100

    return {
        "auto_completed_tasks": auto_completed_tasks,
        "auto_completed_milestones": auto_completed_milestones,
        "cancelled_tasks_preserved": cancelled_tasks_preserved,
        "cancelled_milestones_preserved": cancelled_milestones_preserved,
    }
