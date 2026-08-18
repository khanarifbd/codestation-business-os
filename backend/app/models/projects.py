from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint
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
    quotation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("quotations.id", ondelete="RESTRICT"), nullable=True)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False)
    source_lead_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    project_manager_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)

    name: Mapped[str] = mapped_column(String(220), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="planned", nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
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


class ProjectMilestone(TenantOwnedMixin, Base):
    __tablename__ = "project_milestones"
    __table_args__ = (
        Index("ix_project_milestones_org_project_sort", "organization_id", "project_id", "sort_order"),
        Index("ix_project_milestones_org_project_status", "organization_id", "project_id", "status"),
        Index("ix_project_milestones_org_due", "organization_id", "due_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="planned", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class ProjectTask(TenantOwnedMixin, Base):
    __tablename__ = "project_tasks"
    __table_args__ = (
        UniqueConstraint("organization_id", "task_code", name="uq_project_tasks_org_code"),
        Index("ix_project_tasks_org_project_status", "organization_id", "project_id", "status"),
        Index("ix_project_tasks_org_assignee_status", "organization_id", "assignee_employee_id", "status"),
        Index("ix_project_tasks_org_milestone", "organization_id", "milestone_id"),
        Index("ix_project_tasks_org_due", "organization_id", "due_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    milestone_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("project_milestones.id", ondelete="SET NULL"), nullable=True)
    task_code: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="todo", nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    assignee_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class ProjectWorkLog(TenantOwnedMixin, Base):
    __tablename__ = "project_work_logs"
    __table_args__ = (
        Index("ix_project_work_logs_org_project_created", "organization_id", "project_id", "created_at"),
        Index("ix_project_work_logs_org_task_created", "organization_id", "task_id", "created_at"),
        Index("ix_project_work_logs_org_employee_created", "organization_id", "employee_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    time_spent_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ProjectDocument(TenantOwnedMixin, Base):
    __tablename__ = "project_documents"
    __table_args__ = (
        Index("ix_project_documents_org_project_created", "organization_id", "project_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), default="other", nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ProjectCredential(TenantOwnedMixin, Base):
    __tablename__ = "project_credentials"
    __table_args__ = (
        Index("ix_project_credentials_org_project_created", "organization_id", "project_id", "created_at"),
        Index("ix_project_credentials_org_project_access", "organization_id", "project_id", "access_level"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    credential_type: Mapped[str] = mapped_column(String(40), default="login", nullable=False)
    environment: Mapped[str] = mapped_column(String(32), default="production", nullable=False)
    username: Mapped[str | None] = mapped_column(String(320), nullable=True)
    secret_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_level: Mapped[str] = mapped_column(String(24), default="manager_only", nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
