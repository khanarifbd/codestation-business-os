"""Organization-scoped office geofences, weekly work modes and attendance requests."""
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class HROfficeLocation(TenantOwnedMixin, Base):
    __tablename__ = "hr_office_locations"
    __table_args__ = (
        Index("ix_hr_office_locations_org_active", "organization_id", "is_active"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    radius_meters: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class EmployeeAttendancePolicy(TenantOwnedMixin, Base):
    __tablename__ = "employee_attendance_policies"
    __table_args__ = (
        Index("uq_employee_attendance_policy_org_employee", "organization_id", "employee_id", unique=True),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    office_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("hr_office_locations.id", ondelete="SET NULL"), nullable=True)
    # Monday through Sunday: office / remote / field / off. No silent default for existing employees.
    weekly_modes: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class HRAttendanceRequest(TenantOwnedMixin, Base):
    __tablename__ = "hr_attendance_requests"
    __table_args__ = (
        Index("ix_hr_attendance_requests_org_status_date", "organization_id", "status", "work_date"),
        Index("ix_hr_attendance_requests_org_employee_date", "organization_id", "employee_id", "work_date"),
        Index(
            "uq_hr_attendance_open_mode_request",
            "organization_id", "employee_id", "work_date",
            unique=True,
            postgresql_where=text("request_type = 'mode' AND status IN ('pending', 'approved')"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    request_type: Mapped[str] = mapped_column(String(20), nullable=False)  # mode | correction
    requested_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)  # remote
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_check_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    proposed_check_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
