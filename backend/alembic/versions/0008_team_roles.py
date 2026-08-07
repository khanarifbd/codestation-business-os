"""add employee management and organization roles

Revision ID: 0008_team_roles
Revises: 0007_company_defaults
Create Date: 2026-08-07
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0008_team_roles"
down_revision: str | None = "0007_company_defaults"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organization_roles",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("description", sa.String(300), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("permissions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "slug", name="uq_org_roles_org_slug"),
    )
    op.create_index("ix_organization_roles_organization_id", "organization_roles", ["organization_id"])
    op.create_index("ix_org_roles_org_active", "organization_roles", ["organization_id", "is_active"])

    op.create_table(
        "departments",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("code", sa.String(24), nullable=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name", name="uq_departments_org_name"),
        sa.UniqueConstraint("organization_id", "code", name="uq_departments_org_code"),
    )
    op.create_index("ix_departments_organization_id", "departments", ["organization_id"])
    op.create_index("ix_departments_org_active_name", "departments", ["organization_id", "is_active", "name"])

    op.create_table(
        "designations",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("code", sa.String(24), nullable=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name", name="uq_designations_org_name"),
        sa.UniqueConstraint("organization_id", "code", name="uq_designations_org_code"),
    )
    op.create_index("ix_designations_organization_id", "designations", ["organization_id"])
    op.create_index("ix_designations_org_active_name", "designations", ["organization_id", "is_active", "name"])

    op.add_column("memberships", sa.Column("role_id", sa.String(36), nullable=True))
    op.create_index("ix_memberships_role_id", "memberships", ["role_id"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organizations = bind.execute(sa.text("SELECT id FROM organizations ORDER BY created_at, id")).mappings().all()
    role_ids: dict[tuple[str, str], str] = {}
    for organization in organizations:
        organization_id = organization["id"]
        for slug, name, permissions in (
            ("admin", "Admin", ["*"]),
            ("user", "User", ["dashboard.view"]),
        ):
            role_id = str(uuid4())
            role_ids[(organization_id, slug)] = role_id
            bind.execute(
                sa.text(
                    """
                    INSERT INTO organization_roles
                        (id, organization_id, name, slug, description, is_system, is_active,
                         permissions, created_at, updated_at)
                    VALUES
                        (:id, :organization_id, :name, :slug, :description, true, true,
                         CAST(:permissions AS jsonb), :now, :now)
                    """
                ),
                {
                    "id": role_id,
                    "organization_id": organization_id,
                    "name": name,
                    "slug": slug,
                    "description": f"Built-in company {name.lower()} role",
                    "permissions": json.dumps(permissions),
                    "now": now,
                },
            )

    memberships = bind.execute(
        sa.text("SELECT id, organization_id, role FROM memberships ORDER BY organization_id, created_at, id")
    ).mappings().all()
    for membership in memberships:
        role_slug = "admin" if membership["role"] == "admin" else "user"
        bind.execute(
            sa.text("UPDATE memberships SET role_id=:role_id WHERE id=:membership_id"),
            {
                "role_id": role_ids[(membership["organization_id"], role_slug)],
                "membership_id": membership["id"],
            },
        )

    op.alter_column("memberships", "role_id", nullable=False)
    op.create_foreign_key(
        "fk_memberships_role_id",
        "memberships",
        "organization_roles",
        ["role_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    op.create_table(
        "employees",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("membership_id", sa.String(36), nullable=False),
        sa.Column("employee_code", sa.String(40), nullable=False),
        sa.Column("department_id", sa.String(36), nullable=True),
        sa.Column("designation_id", sa.String(36), nullable=True),
        sa.Column("manager_employee_id", sa.String(36), nullable=True),
        sa.Column("work_email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("work_phone", sa.String(64), nullable=True),
        sa.Column("employment_type", sa.String(32), nullable=False),
        sa.Column("employment_status", sa.String(32), nullable=False),
        sa.Column("join_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("work_location", sa.String(180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["designation_id"], ["designations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["manager_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "membership_id", name="uq_employees_org_membership"),
        sa.UniqueConstraint("organization_id", "employee_code", name="uq_employees_org_code"),
    )
    op.create_index("ix_employees_organization_id", "employees", ["organization_id"])
    op.create_index("ix_employees_membership_id", "employees", ["membership_id"])
    op.create_index("ix_employees_org_status_created", "employees", ["organization_id", "employment_status", "created_at"])
    op.create_index("ix_employees_org_department", "employees", ["organization_id", "department_id"])

    op.create_table(
        "employee_invitations",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("full_name", sa.String(160), nullable=False),
        sa.Column("role_id", sa.String(36), nullable=False),
        sa.Column("department_id", sa.String(36), nullable=True),
        sa.Column("designation_id", sa.String(36), nullable=True),
        sa.Column("employee_code", sa.String(40), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("invited_by_user_id", sa.String(36), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["organization_roles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["designation_id"], ["designations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_employee_invitations_organization_id", "employee_invitations", ["organization_id"])
    op.create_index("ix_employee_invites_org_status", "employee_invitations", ["organization_id", "status", "created_at"])
    op.create_index("ix_employee_invites_token_hash", "employee_invitations", ["token_hash"], unique=True)

    # Existing memberships become baseline employee records so current company users are visible immediately.
    counters: dict[str, int] = {}
    for membership in memberships:
        organization_id = membership["organization_id"]
        counters[organization_id] = counters.get(organization_id, 0) + 1
        number = counters[organization_id]
        bind.execute(
            sa.text(
                """
                INSERT INTO employees
                    (id, organization_id, membership_id, employee_code, employment_type,
                     employment_status, created_at, updated_at)
                VALUES
                    (:id, :organization_id, :membership_id, :employee_code, 'full_time',
                     'active', :now, :now)
                """
            ),
            {
                "id": str(uuid4()),
                "organization_id": organization_id,
                "membership_id": membership["id"],
                "employee_code": f"EMP-{number:05d}",
                "now": now,
            },
        )

    for organization_id, count in counters.items():
        bind.execute(
            sa.text(
                """
                UPDATE organization_document_sequences
                SET next_number = GREATEST(next_number, :next_number), updated_at=:now
                WHERE organization_id=:organization_id AND document_type='employee'
                """
            ),
            {"next_number": count + 1, "organization_id": organization_id, "now": now},
        )

    bind.execute(
        sa.text(
            """
            INSERT INTO activity_logs
                (id, actor_type, scope, action, outcome, message, metadata_json, created_at)
            VALUES
                (:id, 'system', 'platform', 'system.team_roles.initialized', 'success',
                 'Employee management and organization roles initialized',
                 CAST(:metadata AS jsonb), :now)
            """
        ),
        {
            "id": str(uuid4()),
            "metadata": json.dumps(
                {
                    "organizations": len(organizations),
                    "memberships_backfilled": len(memberships),
                }
            ),
            "now": now,
        },
    )


def downgrade() -> None:
    op.drop_index("ix_employee_invites_token_hash", table_name="employee_invitations")
    op.drop_index("ix_employee_invites_org_status", table_name="employee_invitations")
    op.drop_index("ix_employee_invitations_organization_id", table_name="employee_invitations")
    op.drop_table("employee_invitations")
    op.drop_index("ix_employees_org_department", table_name="employees")
    op.drop_index("ix_employees_org_status_created", table_name="employees")
    op.drop_index("ix_employees_membership_id", table_name="employees")
    op.drop_index("ix_employees_organization_id", table_name="employees")
    op.drop_table("employees")
    op.drop_constraint("fk_memberships_role_id", "memberships", type_="foreignkey")
    op.drop_index("ix_memberships_role_id", table_name="memberships")
    op.drop_column("memberships", "role_id")
    op.drop_index("ix_designations_org_active_name", table_name="designations")
    op.drop_index("ix_designations_organization_id", table_name="designations")
    op.drop_table("designations")
    op.drop_index("ix_departments_org_active_name", table_name="departments")
    op.drop_index("ix_departments_organization_id", table_name="departments")
    op.drop_table("departments")
    op.drop_index("ix_org_roles_org_active", table_name="organization_roles")
    op.drop_index("ix_organization_roles_organization_id", table_name="organization_roles")
    op.drop_table("organization_roles")
