from dataclasses import dataclass
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.project_execution import (
    create_credential,
    create_milestone,
    create_task,
    reveal_credential,
    update_task_progress,
)
from app.db.session import SessionLocal, engine
from app.models.projects import Project, ProjectCredential, ProjectMilestone, ProjectTask, ProjectWorkLog
from app.schemas.project_execution import CredentialCreate, MilestoneCreate, TaskCreate, TaskProgressUpdate


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    membership: object


def make_request(method: str, path: str) -> Request:
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "headers": [], "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    now = datetime.now(timezone.utc)
    role_id = str(uuid4())
    membership_id = str(uuid4())
    employee_id = str(uuid4())

    with engine.begin() as connection:
        row = connection.execute(text("""
            SELECT p.id AS project_id, p.organization_id, o.created_by_user_id AS user_id
            FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE o.name='Existing Tenant Fixture' AND p.status='active'
            ORDER BY p.created_at DESC LIMIT 1
        """)).mappings().one()
        project_id = str(row["project_id"]); organization_id = str(row["organization_id"]); user_id = str(row["user_id"])

        # The migration fixture organization was inserted after the team migration, so create
        # a minimal active manager identity for this execution test.
        connection.execute(text("""
            INSERT INTO organization_roles
                (id, organization_id, name, slug, description, is_system, is_active, permissions, created_at, updated_at)
            VALUES (:id, :organization_id, 'CI Manager', :slug, 'CI only', false, true, '[\"*\"]'::jsonb, :now, :now)
        """), {"id": role_id, "organization_id": organization_id, "slug": f"ci-manager-{role_id[:8]}", "now": now})
        connection.execute(text("""
            INSERT INTO memberships
                (id, organization_id, user_id, role_id, role, status, joined_at, created_at, updated_at)
            VALUES (:id, :organization_id, :user_id, :role_id, 'admin', 'active', :now, :now, :now)
        """), {"id": membership_id, "organization_id": organization_id, "user_id": user_id, "role_id": role_id, "now": now})
        connection.execute(text("""
            INSERT INTO employees
                (id, organization_id, membership_id, employee_code, employment_type, employment_status, created_at, updated_at)
            VALUES (:id, :organization_id, :membership_id, :employee_code, 'full_time', 'active', :now, :now)
        """), {"id": employee_id, "organization_id": organization_id, "membership_id": membership_id, "employee_code": f"CI-{employee_id[:8]}", "now": now})
        connection.execute(text("UPDATE projects SET project_manager_employee_id=:employee_id WHERE id=:project_id"), {"employee_id": employee_id, "project_id": project_id})
        connection.execute(text("""
            INSERT INTO project_members
                (id, organization_id, project_id, employee_id, role_label, is_active, added_by_user_id, added_at, updated_at)
            VALUES (:id, :organization_id, :project_id, :employee_id, 'Project Manager', true, :user_id, :now, :now)
        """), {"id": str(uuid4()), "organization_id": organization_id, "project_id": project_id, "employee_id": employee_id, "user_id": user_id, "now": now})

        for table_name in ("project_milestones", "project_tasks", "project_work_logs", "project_documents", "project_credentials"):
            if connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table_name}"}).scalar_one() is None:
                raise AssertionError(f"missing project execution table: {table_name}")
        if connection.execute(text("SELECT prefix FROM organization_document_sequences WHERE organization_id=:organization_id AND document_type='task'"), {"organization_id": organization_id}).scalar_one() != "TSK":
            raise AssertionError("task sequence was not backfilled")

    tenant = FixtureTenant(organization_id=organization_id, user_id=user_id, membership=SimpleNamespace(role_id=role_id))
    db = SessionLocal()
    try:
        milestone = create_milestone(
            project_id,
            MilestoneCreate(title="CI Delivery Milestone", due_date=date.today()),
            make_request("POST", f"/api/v1/projects/{project_id}/milestones"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        task = create_task(
            project_id,
            TaskCreate(title="CI Execution Task", milestone_id=milestone.id, assignee_employee_id=employee_id, priority="high"),
            make_request("POST", f"/api/v1/projects/{project_id}/tasks"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if not task.task_code.startswith("TSK-"):
            raise AssertionError("Task numbering sequence not used")

        progressed = update_task_progress(
            project_id,
            task.id,
            TaskProgressUpdate(progress_percent=65, note="Implemented the main execution path", time_spent_minutes=90),
            make_request("POST", f"/api/v1/projects/{project_id}/tasks/{task.id}/progress"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if progressed.progress_percent != 65 or progressed.status != "in_progress":
            raise AssertionError("Task progress did not update correctly")
        project = db.scalar(select(Project).where(Project.id == project_id))
        milestone_row = db.scalar(select(ProjectMilestone).where(ProjectMilestone.id == milestone.id))
        if project is None or project.progress_percent != 65 or milestone_row is None or milestone_row.progress_percent != 65:
            raise AssertionError("Task progress did not cascade to milestone/project")
        if db.scalar(select(ProjectWorkLog).where(ProjectWorkLog.task_id == task.id)) is None:
            raise AssertionError("Work log was not persisted")

        completed = update_task_progress(
            project_id,
            task.id,
            TaskProgressUpdate(progress_percent=100, note="Finished and ready for delivery"),
            make_request("POST", f"/api/v1/projects/{project_id}/tasks/{task.id}/progress"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if completed.status != "completed":
            raise AssertionError("100 percent progress did not complete the task")
        db.refresh(project); db.refresh(milestone_row)
        if project.progress_percent != 100 or milestone_row.progress_percent != 100 or milestone_row.status != "completed":
            raise AssertionError("Completion did not cascade correctly")

        credential = create_credential(
            project_id,
            CredentialCreate(name="CI Staging Login", secret="ci-super-secret", username="ci@example.com", environment="staging", access_level="team"),
            make_request("POST", f"/api/v1/projects/{project_id}/credentials"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        stored = db.scalar(select(ProjectCredential).where(ProjectCredential.id == credential.id))
        if stored is None or stored.secret_ciphertext == b"ci-super-secret" or b"ci-super-secret" in stored.secret_ciphertext:
            raise AssertionError("Credential was not encrypted at rest")
        revealed = reveal_credential(
            project_id,
            credential.id,
            make_request("POST", f"/api/v1/projects/{project_id}/credentials/{credential.id}/reveal"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if revealed.secret != "ci-super-secret":
            raise AssertionError("Encrypted credential could not be revealed")
    finally:
        db.close()

    print("project execution workspace verification passed")


if __name__ == "__main__":
    main()
