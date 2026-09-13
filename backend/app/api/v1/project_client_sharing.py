from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies import CurrentTenant, DbSession
from app.models.projects import Project, ProjectMilestone
from app.services.activity_log import record_activity
from app.services.project_access import require_project_access

router = APIRouter(prefix="/projects", tags=["Project Client Sharing"])


class MilestoneClientVisibilityUpdate(BaseModel):
    client_visible: bool


@router.patch("/{project_id}/milestones/{milestone_id}/client-visibility")
def update_milestone_client_visibility(
    project_id: str,
    milestone_id: str,
    payload: MilestoneClientVisibilityUpdate,
    request: Request,
    db: DbSession,
    tenant: CurrentTenant,
) -> dict[str, bool | str]:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == tenant.organization_id,
        )
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    access = require_project_access(db, tenant, project)
    if not (access.can_manage_project or access.is_project_manager):
        raise HTTPException(status_code=403, detail="Project manager access required")

    milestone = db.scalar(
        select(ProjectMilestone)
        .where(
            ProjectMilestone.id == milestone_id,
            ProjectMilestone.organization_id == tenant.organization_id,
            ProjectMilestone.project_id == project.id,
        )
        .with_for_update()
    )
    if milestone is None:
        raise HTTPException(status_code=404, detail="Milestone not found")

    previous = bool(milestone.client_visible)
    if previous == payload.client_visible:
        return {"id": milestone.id, "client_visible": previous}

    milestone.client_visible = payload.client_visible
    db.flush()
    record_activity(
        db,
        action="projects.milestone.client_visibility_changed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project_milestone",
        entity_id=milestone.id,
        before={"client_visible": previous},
        after={"client_visible": milestone.client_visible},
        metadata={"project_id": project.id, "project_number": project.project_number},
        message=(
            f"Milestone shared with client: {milestone.title}"
            if milestone.client_visible
            else f"Milestone hidden from client: {milestone.title}"
        ),
        request=request,
    )
    db.commit()
    return {"id": milestone.id, "client_visible": bool(milestone.client_visible)}
