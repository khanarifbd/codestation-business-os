"""add projects

Revision ID: 0012_projects
Revises: 0011_orders
Create Date: 2026-08-08
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0012_projects"
down_revision: str | None = "0011_orders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("project_number", sa.String(40), nullable=False),
        sa.Column("order_id", sa.String(36), nullable=False),
        sa.Column("quotation_id", sa.String(36), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=False),
        sa.Column("source_lead_id", sa.String(36), nullable=True),
        sa.Column("project_manager_employee_id", sa.String(36), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(220), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("planned_start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("contract_value", sa.Numeric(16, 2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("actual_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_lead_id"], ["leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_manager_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "project_number", name="uq_projects_org_number"),
        sa.UniqueConstraint("organization_id", "order_id", name="uq_projects_org_order"),
    )
    op.create_index("ix_projects_organization_id", "projects", ["organization_id"])
    op.create_index("ix_projects_org_status_created", "projects", ["organization_id", "status", "created_at"])
    op.create_index("ix_projects_org_client_created", "projects", ["organization_id", "client_id", "created_at"])
    op.create_index("ix_projects_org_manager_status", "projects", ["organization_id", "project_manager_employee_id", "status"])
    op.create_index("ix_projects_org_due_date", "projects", ["organization_id", "due_date"])

    op.create_table(
        "project_members",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("employee_id", sa.String(36), nullable=False),
        sa.Column("role_label", sa.String(80), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("added_by_user_id", sa.String(36), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["added_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "project_id", "employee_id", name="uq_project_members_org_project_employee"),
    )
    op.create_index("ix_project_members_organization_id", "project_members", ["organization_id"])
    op.create_index("ix_project_members_org_project_active", "project_members", ["organization_id", "project_id", "is_active"])
    op.create_index("ix_project_members_org_employee_active", "project_members", ["organization_id", "employee_id", "is_active"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]
    for organization_id in organization_ids:
        exists = bind.execute(
            sa.text(
                "SELECT 1 FROM organization_document_sequences "
                "WHERE organization_id = CAST(:organization_id AS VARCHAR(36)) AND document_type = 'project' LIMIT 1"
            ),
            {"organization_id": organization_id},
        ).scalar()
        if exists:
            continue
        bind.execute(
            sa.text(
                """
                INSERT INTO organization_document_sequences
                    (id, organization_id, document_type, prefix, next_number, padding, separator, created_at, updated_at)
                VALUES
                    (:id, CAST(:organization_id AS VARCHAR(36)), 'project', 'PRJ', 1, 5, '-', :now, :now)
                """
            ),
            {"id": str(uuid4()), "organization_id": organization_id, "now": now},
        )


def downgrade() -> None:
    op.drop_index("ix_project_members_org_employee_active", table_name="project_members")
    op.drop_index("ix_project_members_org_project_active", table_name="project_members")
    op.drop_index("ix_project_members_organization_id", table_name="project_members")
    op.drop_table("project_members")
    op.drop_index("ix_projects_org_due_date", table_name="projects")
    op.drop_index("ix_projects_org_manager_status", table_name="projects")
    op.drop_index("ix_projects_org_client_created", table_name="projects")
    op.drop_index("ix_projects_org_status_created", table_name="projects")
    op.drop_index("ix_projects_organization_id", table_name="projects")
    op.drop_table("projects")
