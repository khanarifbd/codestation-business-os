from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

TaskStatus = Literal["todo", "in_progress", "blocked", "review", "completed", "cancelled"]
TaskPriority = Literal["low", "normal", "high", "urgent"]
MilestoneStatus = Literal["planned", "in_progress", "completed", "cancelled"]
CredentialAccess = Literal["manager_only", "team"]


class MilestoneCreate(BaseModel):
    title: str = Field(min_length=1, max_length=220)
    description: str | None = None
    due_date: date | None = None
    sort_order: int = Field(default=0, ge=0, le=10000)


class MilestoneUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=220)
    description: str | None = None
    due_date: date | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    status: MilestoneStatus | None = None


class MilestoneRead(BaseModel):
    id: str
    title: str
    description: str | None
    status: str
    sort_order: int
    progress_percent: int
    due_date: date | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TaskCreate(BaseModel):
    milestone_id: str | None = None
    title: str = Field(min_length=1, max_length=220)
    description: str | None = None
    priority: TaskPriority = "normal"
    assignee_employee_id: str | None = None
    planned_start_date: date | None = None
    due_date: date | None = None
    estimated_minutes: int | None = Field(default=None, ge=0, le=1000000)


class TaskUpdate(BaseModel):
    milestone_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=220)
    description: str | None = None
    priority: TaskPriority | None = None
    assignee_employee_id: str | None = None
    planned_start_date: date | None = None
    due_date: date | None = None
    estimated_minutes: int | None = Field(default=None, ge=0, le=1000000)
    status: TaskStatus | None = None


class TaskProgressUpdate(BaseModel):
    progress_percent: int = Field(ge=0, le=100)
    note: str = Field(min_length=2, max_length=5000)
    status: TaskStatus | None = None
    time_spent_minutes: int | None = Field(default=None, ge=0, le=100000)


class TaskRead(BaseModel):
    id: str
    task_code: str
    milestone_id: str | None
    milestone_title: str | None
    title: str
    description: str | None
    status: str
    priority: str
    progress_percent: int
    assignee_employee_id: str | None
    assignee_name: str | None
    planned_start_date: date | None
    due_date: date | None
    estimated_minutes: int | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class WorkLogRead(BaseModel):
    id: str
    task_id: str
    task_code: str
    task_title: str
    employee_id: str
    employee_name: str
    note: str
    progress_percent: int
    time_spent_minutes: int | None
    created_at: datetime


class ProjectDocumentRead(BaseModel):
    id: str
    title: str
    document_type: str
    original_filename: str
    content_type: str | None
    size_bytes: int
    notes: str | None
    uploaded_by_user_id: str
    created_at: datetime


class CredentialCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    credential_type: str = Field(default="login", min_length=1, max_length=40)
    environment: str = Field(default="production", min_length=1, max_length=32)
    username: str | None = Field(default=None, max_length=320)
    secret: str = Field(min_length=1, max_length=10000)
    url: str | None = Field(default=None, max_length=1000)
    notes: str | None = None
    access_level: CredentialAccess = "manager_only"


class CredentialUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    credential_type: str | None = Field(default=None, min_length=1, max_length=40)
    environment: str | None = Field(default=None, min_length=1, max_length=32)
    username: str | None = Field(default=None, max_length=320)
    secret: str | None = Field(default=None, min_length=1, max_length=10000)
    url: str | None = Field(default=None, max_length=1000)
    notes: str | None = None
    access_level: CredentialAccess | None = None


class CredentialRead(BaseModel):
    id: str
    name: str
    credential_type: str
    environment: str
    username: str | None
    url: str | None
    notes: str | None
    access_level: str
    created_by_user_id: str
    last_revealed_by: str | None = None
    last_revealed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class CredentialReveal(BaseModel):
    id: str
    secret: str


class ProjectExecutionSummary(BaseModel):
    progress_percent: int
    milestone_count: int
    task_count: int
    open_task_count: int
    overdue_task_count: int
    blocked_task_count: int
    document_count: int
    credential_count: int


class ProjectWorkspace(BaseModel):
    summary: ProjectExecutionSummary
    milestones: list[MilestoneRead]
    tasks: list[TaskRead]
    recent_work: list[WorkLogRead]
    documents: list[ProjectDocumentRead]
    credentials: list[CredentialRead]
    can_manage_credentials: bool = False
