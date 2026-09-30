"""Office GPS attendance, weekly work modes and audited requests.

Revision ID: 0087_hr_gps_attendance
Revises: 0086_session_idle
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0087_hr_gps_attendance"
down_revision: str | None = "0086_session_idle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hr_office_locations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("radius_meters", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_hr_office_latitude"),
        sa.CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_hr_office_longitude"),
        sa.CheckConstraint("radius_meters BETWEEN 25 AND 1000", name="ck_hr_office_radius"),
    )
    op.create_index("ix_hr_office_locations_org_active", "hr_office_locations", ["organization_id", "is_active"])
    op.create_table(
        "employee_attendance_policies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("office_id", sa.String(36), sa.ForeignKey("hr_office_locations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("weekly_modes", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("uq_employee_attendance_policy_org_employee", "employee_attendance_policies", ["organization_id", "employee_id"], unique=True)
    op.create_table(
        "hr_attendance_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("request_type", sa.String(20), nullable=False),
        sa.Column("requested_mode", sa.String(16), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("proposed_check_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proposed_check_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("reviewed_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("request_type IN ('mode', 'correction')", name="ck_hr_attendance_request_type"),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected', 'cancelled')", name="ck_hr_attendance_request_status"),
    )
    op.create_index("ix_hr_attendance_requests_org_status_date", "hr_attendance_requests", ["organization_id", "status", "work_date"])
    op.create_index("ix_hr_attendance_requests_org_employee_date", "hr_attendance_requests", ["organization_id", "employee_id", "work_date"])
    op.create_index(
        "uq_hr_attendance_open_mode_request", "hr_attendance_requests",
        ["organization_id", "employee_id", "work_date"], unique=True,
        postgresql_where=sa.text("request_type = 'mode' AND status IN ('pending', 'approved')"),
    )
    # Historical records remain unchanged. Future self check-ins carry verified mode/office information.
    op.add_column("attendance_records", sa.Column("attendance_mode", sa.String(16), nullable=True))
    op.add_column("attendance_records", sa.Column("office_id", sa.String(36), sa.ForeignKey("hr_office_locations.id", ondelete="SET NULL"), nullable=True))
    op.add_column("attendance_records", sa.Column("check_in_latitude", sa.Float(), nullable=True))
    op.add_column("attendance_records", sa.Column("check_in_longitude", sa.Float(), nullable=True))
    op.add_column("attendance_records", sa.Column("check_in_accuracy_meters", sa.Float(), nullable=True))
    op.add_column("attendance_records", sa.Column("verification_method", sa.String(24), nullable=True))


def downgrade() -> None:
    for col in ("verification_method", "check_in_accuracy_meters", "check_in_longitude", "check_in_latitude", "office_id", "attendance_mode"):
        op.drop_column("attendance_records", col)
    op.drop_index("uq_hr_attendance_open_mode_request", table_name="hr_attendance_requests")
    op.drop_index("ix_hr_attendance_requests_org_employee_date", table_name="hr_attendance_requests")
    op.drop_index("ix_hr_attendance_requests_org_status_date", table_name="hr_attendance_requests")
    op.drop_table("hr_attendance_requests")
    op.drop_index("uq_employee_attendance_policy_org_employee", table_name="employee_attendance_policies")
    op.drop_table("employee_attendance_policies")
    op.drop_index("ix_hr_office_locations_org_active", table_name="hr_office_locations")
    op.drop_table("hr_office_locations")
