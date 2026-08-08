from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

ProjectStatus = Literal["planned", "active", "on_hold", "completed", "cancelled"]
ProjectPriority = Literal["low", "normal", "high", "urgent"]


class ProjectCreateFromOrder(BaseModel):
    name: str | None = Field(default=None, max_length=220)
    priority: ProjectPriority = "normal"
    project_manager_employee_id: str | None = None
    member_employee_ids: list[str] = Field(default_factory=list, max_length=100)
    planned_start_date: date | None = None
    due_date: date | None = None
    description: str | None = None
    notes: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=220)
    priority: ProjectPriority | None = None
    project_manager_employee_id: str | None = None
    planned_start_date: date | None = None
    due_date: date | None = None
    description: str | None = None
    notes: str | None = None


class ProjectTeamUpdate(BaseModel):
    project_manager_employee_id: str | None = None
    member_employee_ids: list[str] = Field(default_factory=list, max_length=100)


class ProjectStatusChange(BaseModel):
    status: Literal["active", "on_hold", "completed", "cancelled"]


class ProjectEmployeeOption(BaseModel):
    id: str
    employee_code: str
    full_name: str


class ProjectMeta(BaseModel):
    employees: list[ProjectEmployeeOption]


class ProjectMemberRead(BaseModel):
    id: str
    employee_id: str
    employee_code: str
    full_name: str
    role_label: str | None
    is_active: bool
    added_at: datetime


class ProjectListItem(BaseModel):
    id: str
    project_number: str
    order_id: str
    order_number: str
    client_id: str
    client_name: str
    name: str
    status: str
    priority: str
    progress_percent: int
    planned_start_date: date | None
    due_date: date | None
    currency: str
    contract_value: Decimal
    project_manager_employee_id: str | None
    project_manager_name: str | None
    member_count: int
    created_at: datetime
    updated_at: datetime


class ProjectPage(BaseModel):
    items: list[ProjectListItem]
    next_cursor: str | None


class ProjectDetail(BaseModel):
    id: str
    project_number: str
    order_id: str
    order_number: str
    quotation_id: str
    quotation_number: str
    client_id: str
    client_name: str
    source_lead_id: str | None
    project_manager_employee_id: str | None
    project_manager_name: str | None
    name: str
    status: str
    priority: str
    progress_percent: int
    planned_start_date: date | None
    due_date: date | None
    currency: str
    contract_value: Decimal
    description: str | None
    notes: str | None
    actual_started_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    members: list[ProjectMemberRead]
    created_at: datetime
    updated_at: datetime


class ProjectSummary(BaseModel):
    total: int
    planned: int
    active: int
    on_hold: int
    completed: int
    cancelled: int


class OrderProjectLink(BaseModel):
    project_id: str
    project_number: str
    status: str
