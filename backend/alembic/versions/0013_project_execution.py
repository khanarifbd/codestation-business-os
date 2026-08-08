"""add project execution workspace

Revision ID: 0013_project_execution
Revises: 0012_projects
Create Date: 2026-08-08
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0013_project_execution"
down_revision: str | None = "0012_projects"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pgcrypto keeps credential secrets encrypted at rest without adding a Python crypto dependency.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.add_column("projects", sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "project_milestones",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("progress_percent", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_milestones_organization_id", "project_milestones", ["organization_id"])
    op.create_index("ix_project_milestones_org_project_sort", "project_milestones", ["organization_id", "project_id", "sort_order"])
    op.create_index("ix_project_milestones_org_project_status", "project_milestones", ["organization_id", "project_id", "status"])
    op.create_index("ix_project_milestones_org_due", "project_milestones", ["organization_id", "due_date"])

    op.create_table(
        "project_tasks",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("milestone_id", sa.String(36), nullable=True),
        sa.Column("task_code", sa.String(40), nullable=False),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("progress_percent", sa.Integer(), nullable=False),
        sa.Column("assignee_employee_id", sa.String(36), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("planned_start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("estimated_minutes", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["milestone_id"], ["project_milestones.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assignee_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "task_code", name="uq_project_tasks_org_code"),
    )
    op.create_index("ix_project_tasks_organization_id", "project_tasks", ["organization_id"])
    op.create_index("ix_project_tasks_org_project_status", "project_tasks", ["organization_id", "project_id", "status"])
    op.create_index("ix_project_tasks_org_assignee_status", "project_tasks", ["organization_id", "assignee_employee_id", "status"])
    op.create_index("ix_project_tasks_org_milestone", "project_tasks", ["organization_id", "milestone_id"])
    op.create_index("ix_project_tasks_org_due", "project_tasks", ["organization_id", "due_date"])

    op.create_table(
        "project_work_logs",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("task_id", sa.String(36), nullable=False),
        sa.Column("employee_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("progress_percent", sa.Integer(), nullable=False),
        sa.Column("time_spent_minutes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["project_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_work_logs_organization_id", "project_work_logs", ["organization_id"])
    op.create_index("ix_project_work_logs_org_project_created", "project_work_logs", ["organization_id", "project_id", "created_at"])
    op.create_index("ix_project_work_logs_org_task_created", "project_work_logs", ["organization_id", "task_id", "created_at"])
    op.create_index("ix_project_work_logs_org_employee_created", "project_work_logs", ["organization_id", "employee_id", "created_at"])

    op.create_table(
        "project_documents",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("document_type", sa.String(64), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(160), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("uploaded_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_documents_organization_id", "project_documents", ["organization_id"])
    op.create_index("ix_project_documents_org_project_created", "project_documents", ["organization_id", "project_id", "created_at"])

    op.create_table(
        "project_credentials",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("credential_type", sa.String(40), nullable=False),
        sa.Column("environment", sa.String(32), nullable=False),
        sa.Column("username", sa.String(320), nullable=True),
        sa.Column("secret_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("url", sa.String(1000), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("access_level", sa.String(24), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_credentials_organization_id", "project_credentials", ["organization_id"])
    op.create_index("ix_project_credentials_org_project_created", "project_credentials", ["organization_id", "project_id", "created_at"])
    op.create_index("ix_project_credentials_org_project_access", "project_credentials", ["organization_id", "project_id", "access_level"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]
    for organization_id in organization_ids:
        exists = bind.execute(
            sa.text("SELECT 1 FROM organization_document_sequences WHERE organization_id=CAST(:organization_id AS VARCHAR(36)) AND document_type='task' LIMIT 1"),
            {"organization_id": organization_id},
        ).scalar()
        if not exists:
            bind.execute(
                sa.text("""
                    INSERT INTO organization_document_sequences
                        (id, organization_id, document_type, prefix, next_number, padding, separator, created_at, updated_at)
                    VALUES
                        (:id, CAST(:organization_id AS VARCHAR(36)), 'task', 'TSK', 1, 5, '-', :now, :now)
                """),
                {"id": str(uuid4()), "organization_id": organization_id, "now": now},
            )

    # Existing built-in employee users need project visibility/work capability.
    bind.execute(sa.text("""
        UPDATE organization_roles
        SET permissions = CASE
            WHEN permissions ? 'projects.view' THEN permissions ELSE permissions || '[\"projects.view\"]'::jsonb END
        WHERE slug='user' AND is_system=true
    """))
    bind.execute(sa.text("""
        UPDATE organization_roles
        SET permissions = CASE
            WHEN permissions ? 'projects.work' THEN permissions ELSE permissions || '[\"projects.work\"]'::jsonb END
        WHERE slug='user' AND is_system=true
    """))


def downgrade() -> None:
    op.drop_index("ix_project_credentials_org_project_access", table_name="project_credentials")
    op.drop_index("ix_project_credentials_org_project_created", table_name="project_credentials")
    op.drop_index("ix_project_credentials_organization_id", table_name="project_credentials")
    op.drop_table("project_credentials")
    op.drop_index("ix_project_documents_org_project_created", table_name="project_documents")
    op.drop_index("ix_project_documents_organization_id", table_name="project_documents")
    op.drop_table("project_documents")
    op.drop_index("ix_project_work_logs_org_employee_created", table_name="project_work_logs")
    op.drop_index("ix_project_work_logs_org_task_created", table_name="project_work_logs")
    op.drop_index("ix_project_work_logs_org_project_created", table_name="project_work_logs")
    op.drop_index("ix_project_work_logs_organization_id", table_name="project_work_logs")
    op.drop_table("project_work_logs")
    op.drop_index("ix_project_tasks_org_due", table_name="project_tasks")
    op.drop_index("ix_project_tasks_org_milestone", table_name="project_tasks")
    op.drop_index("ix_project_tasks_org_assignee_status", table_name="project_tasks")
    op.drop_index("ix_project_tasks_org_project_status", table_name="project_tasks")
    op.drop_index("ix_project_tasks_organization_id", table_name="project_tasks")
    op.drop_table("project_tasks")
    op.drop_index("ix_project_milestones_org_due", table_name="project_milestones")
    op.drop_index("ix_project_milestones_org_project_status", table_name="project_milestones")
    op.drop_index("ix_project_milestones_org_project_sort", table_name="project_milestones")
    op.drop_index("ix_project_milestones_organization_id", table_name="project_milestones")
    op.drop_table("project_milestones")
    op.drop_column("projects", "progress_percent")
