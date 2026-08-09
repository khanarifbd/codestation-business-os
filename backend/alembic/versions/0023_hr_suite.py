"""add HR suite

Revision ID: 0023_hr_suite
Revises: 0022_payroll_foundation
Create Date: 2026-08-09
"""

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_hr_suite"
down_revision: str | None = "0022_payroll_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("hr_shifts",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False), sa.Column("start_time", sa.Time(), nullable=False), sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("break_minutes", sa.Integer(), nullable=False, server_default="0"), sa.Column("grace_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("weekly_off_days", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")), sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.UniqueConstraint("organization_id", "name", name="uq_hr_shifts_org_name"))
    op.create_index("ix_hr_shifts_org_active", "hr_shifts", ["organization_id", "is_active"])

    op.create_table("employee_shift_assignments",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False), sa.Column("shift_id", sa.String(36), sa.ForeignKey("hr_shifts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False), sa.Column("effective_to", sa.Date(), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_employee_shift_org_employee_start", "employee_shift_assignments", ["organization_id", "employee_id", "effective_from"])

    op.create_table("attendance_records",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False), sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("check_in_at", sa.DateTime(timezone=True), nullable=True), sa.Column("check_out_at", sa.DateTime(timezone=True), nullable=True), sa.Column("status", sa.String(24), nullable=False, server_default="present"),
        sa.Column("work_minutes", sa.Integer(), nullable=False, server_default="0"), sa.Column("overtime_minutes", sa.Integer(), nullable=False, server_default="0"), sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source", sa.String(24), nullable=False, server_default="manual"), sa.Column("approved_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "employee_id", "attendance_date", name="uq_attendance_org_employee_date"))
    op.create_index("ix_attendance_org_date_status", "attendance_records", ["organization_id", "attendance_date", "status"])

    op.create_table("leave_types",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False), sa.Column("code", sa.String(24), nullable=False), sa.Column("annual_allowance_days", sa.Numeric(8,2), nullable=False, server_default="0"),
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default=sa.true()), sa.Column("requires_approval", sa.Boolean(), nullable=False, server_default=sa.true()), sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.UniqueConstraint("organization_id", "name", name="uq_leave_types_org_name"))
    op.create_index("ix_leave_types_org_active", "leave_types", ["organization_id", "is_active"])

    op.create_table("leave_requests",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False), sa.Column("leave_type_id", sa.String(36), sa.ForeignKey("leave_types.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False), sa.Column("end_date", sa.Date(), nullable=False), sa.Column("days", sa.Numeric(8,2), nullable=False), sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"), sa.Column("review_notes", sa.Text(), nullable=True), sa.Column("reviewed_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_leave_requests_org_status_start", "leave_requests", ["organization_id", "status", "start_date"])
    op.create_index("ix_leave_requests_org_employee_start", "leave_requests", ["organization_id", "employee_id", "start_date"])

    op.create_table("employee_hr_documents",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False), sa.Column("title", sa.String(180), nullable=False), sa.Column("document_type", sa.String(64), nullable=False),
        sa.Column("reference_number", sa.String(120), nullable=True), sa.Column("issued_on", sa.Date(), nullable=True), sa.Column("expires_on", sa.Date(), nullable=True), sa.Column("file_url", sa.String(1000), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_employee_hr_docs_org_employee_expiry", "employee_hr_documents", ["organization_id", "employee_id", "expires_on"])

    op.create_table("employee_lifecycle_events",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False), sa.Column("event_type", sa.String(40), nullable=False), sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(180), nullable=False), sa.Column("details", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")), sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_employee_lifecycle_org_employee_effective", "employee_lifecycle_events", ["organization_id", "employee_id", "effective_date"])

    op.create_table("performance_reviews",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False), sa.Column("reviewer_employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
        sa.Column("period_start", sa.Date(), nullable=False), sa.Column("period_end", sa.Date(), nullable=False), sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
        sa.Column("goals", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")), sa.Column("self_review", sa.Text(), nullable=True), sa.Column("manager_review", sa.Text(), nullable=True),
        sa.Column("rating", sa.Numeric(4,2), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_performance_reviews_org_employee_period", "performance_reviews", ["organization_id", "employee_id", "period_end"])

    op.create_table("hr_announcements",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False), sa.Column("body", sa.Text(), nullable=False), sa.Column("audience", sa.String(40), nullable=False, server_default="all"),
        sa.Column("is_policy", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_hr_announcements_org_published", "hr_announcements", ["organization_id", "published_at"])

    op.create_table("job_openings",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False), sa.Column("department_id", sa.String(36), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("employment_type", sa.String(32), nullable=False, server_default="full_time"), sa.Column("location", sa.String(180), nullable=True), sa.Column("description", sa.Text(), nullable=True),
        sa.Column("openings", sa.Integer(), nullable=False, server_default="1"), sa.Column("status", sa.String(24), nullable=False, server_default="open"), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_job_openings_org_status_created", "job_openings", ["organization_id", "status", "created_at"])

    op.create_table("job_candidates",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_opening_id", sa.String(36), sa.ForeignKey("job_openings.id", ondelete="CASCADE"), nullable=False), sa.Column("full_name", sa.String(180), nullable=False), sa.Column("email", sa.String(320), nullable=False),
        sa.Column("phone", sa.String(80), nullable=True), sa.Column("resume_url", sa.String(1000), nullable=True), sa.Column("stage", sa.String(24), nullable=False, server_default="applied"),
        sa.Column("rating", sa.Numeric(4,2), nullable=True), sa.Column("notes", sa.Text(), nullable=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_job_candidates_org_job_stage", "job_candidates", ["organization_id", "job_opening_id", "stage"])


def downgrade() -> None:
    for index, table in [
        ("ix_job_candidates_org_job_stage","job_candidates"),("ix_job_openings_org_status_created","job_openings"),("ix_hr_announcements_org_published","hr_announcements"),
        ("ix_performance_reviews_org_employee_period","performance_reviews"),("ix_employee_lifecycle_org_employee_effective","employee_lifecycle_events"),
        ("ix_employee_hr_docs_org_employee_expiry","employee_hr_documents"),("ix_leave_requests_org_employee_start","leave_requests"),("ix_leave_requests_org_status_start","leave_requests"),
        ("ix_leave_types_org_active","leave_types"),("ix_attendance_org_date_status","attendance_records"),("ix_employee_shift_org_employee_start","employee_shift_assignments"),("ix_hr_shifts_org_active","hr_shifts")]:
        op.drop_index(index, table_name=table)
    for table in ["job_candidates","job_openings","hr_announcements","performance_reviews","employee_lifecycle_events","employee_hr_documents","leave_requests","leave_types","attendance_records","employee_shift_assignments","hr_shifts"]:
        op.drop_table(table)
