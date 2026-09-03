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
    get_workspace,
    reveal_credential,
    update_credential,
    update_task_progress,
)
from app.api.v1.workspace import notifications, personal_task_detail, personal_workspace
from app.db.session import SessionLocal, engine
from app.models.projects import Project, ProjectCredential, ProjectMilestone, ProjectWorkLog
from app.schemas.project_execution import CredentialCreate, CredentialUpdate, MilestoneCreate, TaskCreate, TaskProgressUpdate


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    membership: object
    organization: object


def make_request(method: str, path: str) -> Request:
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "headers": [], "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    now = datetime.now(timezone.utc)

    with engine.begin() as connection:
        row = connection.execute(text("""
            SELECT p.id AS project_id, p.organization_id, o.created_by_user_id AS user_id
            FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE o.name='Existing Tenant Fixture' AND p.status='active'
            ORDER BY p.created_at DESC LIMIT 1
        """)).mappings().one()
        project_id = str(row["project_id"]); organization_id = str(row["organization_id"]); user_id = str(row["user_id"])

        membership = connection.execute(text("""
            SELECT m.id, m.role_id, m.role, r.permissions
            FROM memberships m
            JOIN organization_roles r ON r.id = m.role_id AND r.organization_id = m.organization_id
            WHERE m.organization_id=:organization_id AND m.user_id=:user_id AND m.status='active'
            ORDER BY m.created_at, m.id
            LIMIT 1
        """), {"organization_id": organization_id, "user_id": user_id}).mappings().first()

        if membership is None:
            role_id = str(uuid4())
            membership_id = str(uuid4())
            connection.execute(text("""
                INSERT INTO organization_roles
                    (id, organization_id, name, slug, description, is_system, is_active, permissions, created_at, updated_at)
                VALUES (:id, :organization_id, 'CI Manager', :slug, 'CI only', false, true, '[\"*\"]'::jsonb, :now, :now)
            """), {"id": role_id, "organization_id": organization_id, "slug": f"ci-manager-{role_id[:8]}", "now": now})
            connection.execute(text("""
                INSERT INTO memberships
                    (id, organization_id, user_id, role_id, role, status, created_at)
                VALUES (:id, :organization_id, :user_id, :role_id, 'admin', 'active', :now)
            """), {"id": membership_id, "organization_id": organization_id, "user_id": user_id, "role_id": role_id, "now": now})
            membership_role = "admin"
        else:
            membership_id = str(membership["id"])
            role_id = str(membership["role_id"])
            membership_role = str(membership["role"])
            permissions = membership["permissions"] if isinstance(membership["permissions"], list) else []
            if "*" not in permissions:
                role_id = str(uuid4())
                connection.execute(text("""
                    INSERT INTO organization_roles
                        (id, organization_id, name, slug, description, is_system, is_active, permissions, created_at, updated_at)
                    VALUES (:id, :organization_id, 'CI Manager', :slug, 'CI only', false, true, '[\"*\"]'::jsonb, :now, :now)
                """), {"id": role_id, "organization_id": organization_id, "slug": f"ci-manager-{role_id[:8]}", "now": now})
                connection.execute(text("""
                    UPDATE memberships
                    SET role_id=:role_id, role='admin'
                    WHERE id=:membership_id AND organization_id=:organization_id
                """), {"role_id": role_id, "membership_id": membership_id, "organization_id": organization_id})
                membership_role = "admin"

        existing_employee_id = connection.execute(text("""
            SELECT id FROM employees
            WHERE organization_id=:organization_id AND membership_id=:membership_id
            LIMIT 1
        """), {"organization_id": organization_id, "membership_id": membership_id}).scalar_one_or_none()
        if existing_employee_id is None:
            employee_id = str(uuid4())
            connection.execute(text("""
                INSERT INTO employees
                    (id, organization_id, membership_id, employee_code, employment_type, employment_status, created_at, updated_at)
                VALUES (:id, :organization_id, :membership_id, :employee_code, 'full_time', 'active', :now, :now)
            """), {"id": employee_id, "organization_id": organization_id, "membership_id": membership_id, "employee_code": f"CI-{employee_id[:8]}", "now": now})
        else:
            employee_id = str(existing_employee_id)

        connection.execute(text("UPDATE projects SET project_manager_employee_id=:employee_id WHERE id=:project_id"), {"employee_id": employee_id, "project_id": project_id})
        existing_member_id = connection.execute(text("""
            SELECT id FROM project_members
            WHERE organization_id=:organization_id AND project_id=:project_id AND employee_id=:employee_id
            LIMIT 1
        """), {"organization_id": organization_id, "project_id": project_id, "employee_id": employee_id}).scalar_one_or_none()
        if existing_member_id is None:
            connection.execute(text("""
                INSERT INTO project_members
                    (id, organization_id, project_id, employee_id, role_label, is_active, added_by_user_id, added_at, updated_at)
                VALUES (:id, :organization_id, :project_id, :employee_id, 'Project Manager', true, :user_id, :now, :now)
            """), {"id": str(uuid4()), "organization_id": organization_id, "project_id": project_id, "employee_id": employee_id, "user_id": user_id, "now": now})
        else:
            connection.execute(text("""
                UPDATE project_members
                SET role_label='Project Manager', is_active=true, updated_at=:now
                WHERE id=:id AND organization_id=:organization_id
            """), {"id": str(existing_member_id), "organization_id": organization_id, "now": now})

        for table_name in ("project_milestones", "project_tasks", "project_work_logs", "project_documents", "project_credentials"):
            if connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table_name}"}).scalar_one() is None:
                raise AssertionError(f"missing project execution table: {table_name}")
        if connection.execute(text("SELECT prefix FROM organization_document_sequences WHERE organization_id=:organization_id AND document_type='task'"), {"organization_id": organization_id}).scalar_one() != "TSK":
            raise AssertionError("task sequence was not backfilled")

    tenant = FixtureTenant(
        organization_id=organization_id,
        user_id=user_id,
        membership=SimpleNamespace(id=membership_id, role_id=role_id, role=membership_role),
        organization=SimpleNamespace(timezone="UTC"),
    )
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
            TaskCreate(
                title="CI Execution Task",
                milestone_id=milestone.id,
                assignee_employee_id=employee_id,
                priority="high",
                due_date=date.today(),
            ),
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

        employee_workspace = personal_workspace(db, tenant)  # type: ignore[arg-type]
        employee_task = next((item for item in employee_workspace["tasks"] if item["id"] == task.id), None)
        if employee_task is None or employee_task["project_id"] != project_id or not employee_task["project_number"]:
            raise AssertionError("Assigned task missing from employee workspace")
        if employee_workspace["summary"]["assigned_tasks"] < 1:
            raise AssertionError("Employee assigned task count was not calculated")

        task_detail = personal_task_detail(task.id, db, tenant)  # type: ignore[arg-type]
        if task_detail["task"]["id"] != task.id or not task_detail["activity"]:
            raise AssertionError("Employee task detail or activity is missing")
        if task_detail["activity"][0]["progress_percent"] != 65:
            raise AssertionError("Latest employee task activity has the wrong progress")

        alerts = notifications(db, tenant)  # type: ignore[arg-type]
        task_alert = next((item for item in alerts["items"] if task.id in item["href"]), None)
        if task_alert is None or not task_alert["href"].startswith("/dashboard/my-work?task="):
            raise AssertionError("Employee task notification did not deep-link to My Work")

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
        if any(item["id"] == task.id for item in personal_workspace(db, tenant)["tasks"]):  # type: ignore[arg-type]
            raise AssertionError("Completed task remained in employee open work")

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

        edited = update_credential(
            project_id,
            credential.id,
            CredentialUpdate(username="updated-ci@example.com", notes="Edited without rotating secret"),
            make_request("PATCH", f"/api/v1/projects/{project_id}/credentials/{credential.id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if edited.username != "updated-ci@example.com":
            raise AssertionError("Credential metadata edit failed")

        revealed = reveal_credential(
            project_id,
            credential.id,
            make_request("POST", f"/api/v1/projects/{project_id}/credentials/{credential.id}/reveal"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if revealed.secret != "ci-super-secret":
            raise AssertionError("Credential edit unexpectedly changed encrypted secret")

        workspace = get_workspace(project_id, db, tenant)  # type: ignore[arg-type]
        credential_row = next((item for item in workspace.credentials if item.id == credential.id), None)
        if credential_row is None or credential_row.last_revealed_at is None or not credential_row.last_revealed_by:
            raise AssertionError("Last revealed credential audit metadata missing from workspace")
        if not workspace.can_manage_credentials:
            raise AssertionError("Project manager credential management capability missing")
    finally:
        db.close()

    print("project execution workspace verification passed")


if __name__ == "__main__":
    main()
