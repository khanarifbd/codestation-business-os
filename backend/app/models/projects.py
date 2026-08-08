from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class Project(TenantOwnedMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("organization_id", "project_number", name="uq_projects_org_number"),
        UniqueConstraint("organization_id", "order_id", name="uq_projects_org_order"),
        Index("ix_projects_org_status_created", "organization_id", "status", "created_at"),
        Index("ix_projects_org_client_created", "organization_id", "client_id", "created_at"),
        Index("ix_projects_org_manager_status", "organization_id", "project_manager_employee_id", "status"),
        Index("ix_projects_org_due_date", "organization_id", "due_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_number: Mapped[str] = mapped_column(String(40), nullable=False)
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False)
    quotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("quotations.id", ondelete="RESTRICT"), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False)
    source_lead_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    project_manager_employee_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)

    name: Mapped[str] = mapped_column(String(220), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="planned", nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    contract_value: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    actual_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class ProjectMember(TenantOwnedMixin, Base):
    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("organization_id", "project_id", "employee_id", name="uq_project_members_org_project_employee"),
        Index("ix_project_members_org_project_active", "organization_id", "project_id", "is_active"),
        Index("ix_project_members_org_employee_active", "organization_id", "employee_id", "is_active"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False)
    role_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    added_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
