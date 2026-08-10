from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    name: str
    slug: str
    description: str | None
    is_system: bool
    is_active: bool
    permissions: list[str]


class RoleCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    permissions: list[str] | None = None
    is_active: bool | None = None


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str | None = Field(default=None, max_length=24)
    description: str | None = Field(default=None, max_length=500)


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    code: str | None = Field(default=None, max_length=24)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class DepartmentRead(DepartmentCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    is_active: bool


class DesignationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str | None = Field(default=None, max_length=24)
    description: str | None = Field(default=None, max_length=500)


class DesignationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    code: str | None = Field(default=None, max_length=24)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class DesignationRead(DesignationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    organization_id: str
    is_active: bool


class EmployeeUpdate(BaseModel):
    department_id: str | None = None
    designation_id: str | None = None
    manager_employee_id: str | None = None
    work_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=64)
    work_phone: str | None = Field(default=None, max_length=64)
    employment_type: str | None = Field(default=None, max_length=32)
    employment_status: str | None = Field(default=None, max_length=32)
    join_date: date | None = None
    end_date: date | None = None
    work_location: str | None = Field(default=None, max_length=180)
    notes: str | None = None
    role_id: str | None = None
    membership_status: str | None = Field(default=None, max_length=32)


class EmployeeRead(BaseModel):
    id: str
    organization_id: str
    membership_id: str
    user_id: str
    full_name: str
    login_email: str
    employee_code: str
    role_id: str
    role_name: str
    role_slug: str
    membership_status: str
    department_id: str | None
    department_name: str | None
    designation_id: str | None
    designation_name: str | None
    manager_employee_id: str | None
    work_email: str | None
    phone: str | None
    work_phone: str | None
    employment_type: str
    employment_status: str
    join_date: date | None
    end_date: date | None
    work_location: str | None
    notes: str | None
    created_at: datetime


class InvitationCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    role_id: str
    department_id: str | None = None
    designation_id: str | None = None
    employee_code: str | None = Field(default=None, max_length=40)


class InvitationRead(BaseModel):
    id: str
    organization_id: str
    email: str
    full_name: str
    role_id: str
    role_name: str
    department_id: str | None
    designation_id: str | None
    employee_code: str
    status: str
    expires_at: datetime
    created_at: datetime


class InvitationCreated(InvitationRead):
    invite_token: str


class InvitationPreview(BaseModel):
    company_name: str
    email: str
    full_name: str
    role_name: str
    employee_code: str
    expires_at: datetime
    existing_user: bool


class InvitationAccept(BaseModel):
    token: str = Field(min_length=20)
    password: str = Field(min_length=8, max_length=128)


class TeamSummary(BaseModel):
    total_employees: int
    active_employees: int
    suspended_memberships: int
    pending_invitations: int


class TeamBundle(BaseModel):
    summary: TeamSummary
    employees: list[EmployeeRead]
    departments: list[DepartmentRead]
    designations: list[DesignationRead]
    roles: list[RoleRead]
    invitations: list[InvitationRead]
    permission_catalog: list[str]
