import re
import unicodedata
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentTenantAdmin, DbSession
from app.core.permissions import PERMISSION_CATALOG, permission_is_valid
from app.core.roles import MEMBERSHIP_ROLE_ADMIN, MEMBERSHIP_ROLE_USER, ORGANIZATION_STATUS_ACTIVE
from app.core.security import hash_password, verify_password
from app.models.common import new_uuid, utc_now
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import Department, Designation, Employee, EmployeeInvitation, OrganizationRole
from app.models.user import User
from app.schemas.team import (
    DepartmentCreate,
    DepartmentRead,
    DepartmentUpdate,
    DesignationCreate,
    DesignationRead,
    DesignationUpdate,
    EmployeeRead,
    EmployeeUpdate,
    InvitationAccept,
    InvitationCreate,
    InvitationCreated,
    InvitationPreview,
    InvitationRead,
    RoleCreate,
    RoleRead,
    RoleUpdate,
    TeamBundle,
    TeamSummary,
)
from app.services.activity_log import record_activity
from app.services.team import (
    create_invitation_token,
    hash_invitation_token,
    invitation_expiry,
    next_employee_code,
)

router = APIRouter(prefix="/team", tags=["Team Management"])
invitation_router = APIRouter(prefix="/employee-invitations", tags=["Employee Invitations"])


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-") or "role"


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _role(db: DbSession, organization_id: str, role_id: str) -> OrganizationRole:
    item = db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == role_id,
            OrganizationRole.organization_id == organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Role not found")
    return item


def _department(db: DbSession, organization_id: str, department_id: str | None) -> Department | None:
    if not department_id:
        return None
    item = db.scalar(
        select(Department).where(
            Department.id == department_id,
            Department.organization_id == organization_id,
            Department.is_active.is_(True),
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Department not found")
    return item


def _designation(db: DbSession, organization_id: str, designation_id: str | None) -> Designation | None:
    if not designation_id:
        return None
    item = db.scalar(
        select(Designation).where(
            Designation.id == designation_id,
            Designation.organization_id == organization_id,
            Designation.is_active.is_(True),
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Designation not found")
    return item


def _employee_query(organization_id: str):
    return (
        select(Employee, Membership, User, OrganizationRole, Department, Designation)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .join(OrganizationRole, OrganizationRole.id == Membership.role_id)
        .outerjoin(Department, Department.id == Employee.department_id)
        .outerjoin(Designation, Designation.id == Employee.designation_id)
        .where(Employee.organization_id == organization_id)
    )


def _employee_rows(db: DbSession, organization_id: str):
    return db.execute(
        _employee_query(organization_id).order_by(Employee.created_at.asc(), Employee.id.asc())
    ).all()


def _employee_row(db: DbSession, organization_id: str, employee_id: str):
    return db.execute(
        _employee_query(organization_id).where(Employee.id == employee_id)
    ).first()


def _employee_read(row) -> EmployeeRead:
    employee, membership, user, role, department, designation = row
    return EmployeeRead(
        id=employee.id,
        organization_id=employee.organization_id,
        membership_id=employee.membership_id,
        user_id=user.id,
        full_name=user.full_name,
        login_email=user.email,
        employee_code=employee.employee_code,
        role_id=role.id,
        role_name=role.name,
        role_slug=role.slug,
        membership_status=membership.status,
        department_id=employee.department_id,
        department_name=department.name if department else None,
        designation_id=employee.designation_id,
        designation_name=designation.name if designation else None,
        manager_employee_id=employee.manager_employee_id,
        work_email=employee.work_email,
        phone=employee.phone,
        work_phone=employee.work_phone,
        employment_type=employee.employment_type,
        employment_status=employee.employment_status,
        join_date=employee.join_date,
        end_date=employee.end_date,
        work_location=employee.work_location,
        notes=employee.notes,
        created_at=employee.created_at,
    )


def _invitation_read(item: EmployeeInvitation, role_name: str | None = None) -> InvitationRead:
    return InvitationRead(
        id=item.id,
        organization_id=item.organization_id,
        email=item.email,
        full_name=item.full_name,
        role_id=item.role_id,
        role_name=role_name or "Unknown",
        department_id=item.department_id,
        designation_id=item.designation_id,
        employee_code=item.employee_code,
        status=item.status,
        expires_at=item.expires_at,
        created_at=item.created_at,
    )


def _invitation_with_role(db: DbSession, organization_id: str, invitation_id: str):
    return db.execute(
        select(EmployeeInvitation, OrganizationRole.name)
        .outerjoin(OrganizationRole, OrganizationRole.id == EmployeeInvitation.role_id)
        .where(
            EmployeeInvitation.id == invitation_id,
            EmployeeInvitation.organization_id == organization_id,
        )
    ).first()


def _ensure_admin_remains(
    db: DbSession,
    organization_id: str,
    membership: Membership,
    current_role: OrganizationRole,
    *,
    next_role: OrganizationRole | None = None,
    next_status: str | None = None,
) -> None:
    removing_admin = current_role.slug == "admin" and (
        (next_role is not None and next_role.slug != "admin")
        or (next_status is not None and next_status != "active")
    )
    if not removing_admin:
        return
    remaining = db.scalar(
        select(func.count(Membership.id))
        .join(OrganizationRole, OrganizationRole.id == Membership.role_id)
        .where(
            Membership.organization_id == organization_id,
            Membership.id != membership.id,
            Membership.status == "active",
            OrganizationRole.slug == "admin",
            OrganizationRole.is_active.is_(True),
        )
    )
    if not remaining:
        raise HTTPException(status_code=400, detail="A company must keep at least one active admin")


@router.get("", response_model=TeamBundle)
def get_team_bundle(db: DbSession, tenant: CurrentTenantAdmin) -> TeamBundle:
    organization_id = tenant.organization_id
    employees = [_employee_read(row) for row in _employee_rows(db, organization_id)]
    departments = db.scalars(
        select(Department).where(Department.organization_id == organization_id).order_by(Department.name)
    ).all()
    designations = db.scalars(
        select(Designation).where(Designation.organization_id == organization_id).order_by(Designation.name)
    ).all()
    roles = db.scalars(
        select(OrganizationRole)
        .where(OrganizationRole.organization_id == organization_id)
        .order_by(OrganizationRole.is_system.desc(), OrganizationRole.name)
    ).all()
    invitation_rows = db.execute(
        select(EmployeeInvitation, OrganizationRole.name)
        .outerjoin(OrganizationRole, OrganizationRole.id == EmployeeInvitation.role_id)
        .where(EmployeeInvitation.organization_id == organization_id)
        .order_by(EmployeeInvitation.created_at.desc())
        .limit(100)
    ).all()
    invitations = [_invitation_read(invite, role_name) for invite, role_name in invitation_rows]
    return TeamBundle(
        summary=TeamSummary(
            total_employees=len(employees),
            active_employees=sum(
                1
                for employee in employees
                if employee.employment_status == "active" and employee.membership_status == "active"
            ),
            suspended_memberships=sum(1 for employee in employees if employee.membership_status != "active"),
            pending_invitations=sum(
                1
                for invite in invitations
                if invite.status == "pending" and invite.expires_at > utc_now()
            ),
        ),
        employees=employees,
        departments=[DepartmentRead.model_validate(item) for item in departments],
        designations=[DesignationRead.model_validate(item) for item in designations],
        roles=[RoleRead.model_validate(item) for item in roles],
        invitations=invitations,
        permission_catalog=PERMISSION_CATALOG,
    )


@router.post("/departments", response_model=DepartmentRead, status_code=201)
def create_department(payload: DepartmentCreate, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    item = Department(
        organization_id=tenant.organization_id,
        name=payload.name.strip(),
        code=_clean(payload.code.upper() if payload.code else None),
        description=_clean(payload.description),
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Department name or code already exists") from exc
    record_activity(
        db, action="department.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="department", entity_id=item.id,
        after=DepartmentRead.model_validate(item).model_dump(mode="json"), request=request,
        message=f"Department created: {item.name}",
    )
    db.commit(); db.refresh(item)
    return DepartmentRead.model_validate(item)


@router.patch("/departments/{department_id}", response_model=DepartmentRead)
def update_department(department_id: str, payload: DepartmentUpdate, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    item = db.scalar(select(Department).where(Department.id == department_id, Department.organization_id == tenant.organization_id))
    if item is None: raise HTTPException(status_code=404, detail="Department not found")
    before = DepartmentRead.model_validate(item).model_dump(mode="json")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "code" and value: value = value.strip().upper()
        elif isinstance(value, str): value = value.strip() or None
        setattr(item, field, value)
    try: db.flush()
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(status_code=409, detail="Department name or code already exists") from exc
    after = DepartmentRead.model_validate(item).model_dump(mode="json")
    record_activity(db, action="department.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="department", entity_id=item.id,
        before=before, after=after, request=request, message=f"Department updated: {item.name}")
    db.commit(); db.refresh(item); return DepartmentRead.model_validate(item)


@router.post("/designations", response_model=DesignationRead, status_code=201)
def create_designation(payload: DesignationCreate, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    item = Designation(organization_id=tenant.organization_id, name=payload.name.strip(),
        code=_clean(payload.code.upper() if payload.code else None), description=_clean(payload.description))
    db.add(item)
    try: db.flush()
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(status_code=409, detail="Designation name or code already exists") from exc
    record_activity(db, action="designation.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="designation", entity_id=item.id,
        after=DesignationRead.model_validate(item).model_dump(mode="json"), request=request,
        message=f"Designation created: {item.name}")
    db.commit(); db.refresh(item); return DesignationRead.model_validate(item)


@router.patch("/designations/{designation_id}", response_model=DesignationRead)
def update_designation(designation_id: str, payload: DesignationUpdate, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    item = db.scalar(select(Designation).where(Designation.id == designation_id, Designation.organization_id == tenant.organization_id))
    if item is None: raise HTTPException(status_code=404, detail="Designation not found")
    before = DesignationRead.model_validate(item).model_dump(mode="json")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "code" and value: value = value.strip().upper()
        elif isinstance(value, str): value = value.strip() or None
        setattr(item, field, value)
    try: db.flush()
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(status_code=409, detail="Designation name or code already exists") from exc
    after = DesignationRead.model_validate(item).model_dump(mode="json")
    record_activity(db, action="designation.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="designation", entity_id=item.id,
        before=before, after=after, request=request, message=f"Designation updated: {item.name}")
    db.commit(); db.refresh(item); return DesignationRead.model_validate(item)


@router.post("/roles", response_model=RoleRead, status_code=201)
def create_role(payload: RoleCreate, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    invalid = [permission for permission in payload.permissions if not permission_is_valid(permission)]
    if invalid: raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(invalid)}")
    base = _slug(payload.name)
    slug = base
    while db.scalar(select(OrganizationRole.id).where(OrganizationRole.organization_id == tenant.organization_id, OrganizationRole.slug == slug)):
        slug = f"{base}-{new_uuid()[:6]}"
    item = OrganizationRole(organization_id=tenant.organization_id, name=payload.name.strip(), slug=slug,
        description=_clean(payload.description), permissions=sorted(set(payload.permissions)), is_system=False)
    db.add(item); db.flush()
    record_activity(db, action="role.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="organization_role", entity_id=item.id,
        after=RoleRead.model_validate(item).model_dump(mode="json"), request=request,
        message=f"Custom role created: {item.name}")
    db.commit(); db.refresh(item); return RoleRead.model_validate(item)


@router.patch("/roles/{role_id}", response_model=RoleRead)
def update_role(role_id: str, payload: RoleUpdate, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    item = db.scalar(select(OrganizationRole).where(OrganizationRole.id == role_id, OrganizationRole.organization_id == tenant.organization_id))
    if item is None: raise HTTPException(status_code=404, detail="Role not found")
    if item.is_system: raise HTTPException(status_code=400, detail="Built-in roles cannot be edited")
    if payload.permissions is not None:
        invalid = [permission for permission in payload.permissions if not permission_is_valid(permission)]
        if invalid: raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(invalid)}")
    before = RoleRead.model_validate(item).model_dump(mode="json")
    changes = payload.model_dump(exclude_unset=True)
    if "permissions" in changes: changes["permissions"] = sorted(set(changes["permissions"] or []))
    for field, value in changes.items():
        if isinstance(value, str): value = value.strip() or None
        setattr(item, field, value)
    db.flush(); after = RoleRead.model_validate(item).model_dump(mode="json")
    record_activity(db, action="role.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="organization_role", entity_id=item.id,
        before=before, after=after, request=request, message=f"Custom role updated: {item.name}")
    db.commit(); db.refresh(item); return RoleRead.model_validate(item)


@router.post("/invitations", response_model=InvitationCreated, status_code=201)
def create_invitation(payload: InvitationCreate, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    email = payload.email.lower().strip()
    role = _role(db, tenant.organization_id, payload.role_id)
    department = _department(db, tenant.organization_id, payload.department_id)
    designation = _designation(db, tenant.organization_id, payload.designation_id)
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user and db.scalar(select(Membership.id).where(Membership.organization_id == tenant.organization_id, Membership.user_id == existing_user.id)):
        raise HTTPException(status_code=409, detail="This user is already a member of the company")

    pending = db.scalars(select(EmployeeInvitation).where(
        EmployeeInvitation.organization_id == tenant.organization_id,
        EmployeeInvitation.email == email,
        EmployeeInvitation.status == "pending",
    )).all()
    for previous in pending: previous.status = "revoked"

    employee_code = _clean(payload.employee_code.upper() if payload.employee_code else None) or next_employee_code(db, tenant.organization_id)
    if db.scalar(select(Employee.id).where(Employee.organization_id == tenant.organization_id, Employee.employee_code == employee_code)):
        raise HTTPException(status_code=409, detail="Employee code already exists")
    if db.scalar(select(EmployeeInvitation.id).where(
        EmployeeInvitation.organization_id == tenant.organization_id,
        EmployeeInvitation.employee_code == employee_code,
        EmployeeInvitation.status == "pending",
    )):
        raise HTTPException(status_code=409, detail="Employee code is already reserved by a pending invitation")

    token, token_hash = create_invitation_token()
    item = EmployeeInvitation(
        organization_id=tenant.organization_id, email=email, full_name=payload.full_name.strip(),
        role_id=role.id, department_id=department.id if department else None,
        designation_id=designation.id if designation else None, employee_code=employee_code,
        token_hash=token_hash, status="pending", invited_by_user_id=tenant.user_id,
        expires_at=invitation_expiry(),
    )
    db.add(item); db.flush()
    record_activity(db, action="employee.invited", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="employee_invitation", entity_id=item.id,
        after={"email": item.email, "full_name": item.full_name, "role": role.name,
               "employee_code": item.employee_code, "expires_at": item.expires_at.isoformat()},
        request=request, message=f"Employee invited: {item.email}")
    db.commit(); db.refresh(item)
    base = _invitation_read(item, role.name)
    return InvitationCreated(**base.model_dump(), invite_token=token)


@router.post("/invitations/{invitation_id}/revoke", response_model=InvitationRead)
def revoke_invitation(invitation_id: str, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    row = _invitation_with_role(db, tenant.organization_id, invitation_id)
    if row is None: raise HTTPException(status_code=404, detail="Invitation not found")
    item, role_name = row
    before = _invitation_read(item, role_name).model_dump(mode="json")
    if item.status == "pending": item.status = "revoked"
    db.flush(); after = _invitation_read(item, role_name).model_dump(mode="json")
    record_activity(db, action="employee.invitation.revoked", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="employee_invitation", entity_id=item.id,
        before=before, after=after, request=request, message=f"Employee invitation revoked: {item.email}")
    db.commit(); db.refresh(item); return _invitation_read(item, role_name)


@router.patch("/employees/{employee_id}", response_model=EmployeeRead)
def update_employee(employee_id: str, payload: EmployeeUpdate, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    before_row = _employee_row(db, tenant.organization_id, employee_id)
    if before_row is None: raise HTTPException(status_code=404, detail="Employee not found")
    employee, membership, user, current_role, _, _ = before_row
    before = _employee_read(before_row).model_dump(mode="json")
    changes = payload.model_dump(exclude_unset=True)

    next_role = None
    if "role_id" in changes and changes["role_id"]:
        next_role = _role(db, tenant.organization_id, changes.pop("role_id"))
    next_status = changes.pop("membership_status", None)
    if next_status not in (None, "active", "suspended"):
        raise HTTPException(status_code=400, detail="Invalid membership status")
    if user.id == tenant.user_id and next_status == "suspended":
        raise HTTPException(status_code=400, detail="You cannot suspend your own company membership")
    _ensure_admin_remains(db, tenant.organization_id, membership, current_role, next_role=next_role, next_status=next_status)

    if next_role:
        membership.role_id = next_role.id
        membership.role = MEMBERSHIP_ROLE_ADMIN if next_role.slug == "admin" else MEMBERSHIP_ROLE_USER
    if next_status:
        membership.status = next_status
        if next_status == "suspended": employee.employment_status = "suspended"
        elif employee.employment_status == "suspended": employee.employment_status = "active"

    if "department_id" in changes: _department(db, tenant.organization_id, changes["department_id"])
    if "designation_id" in changes: _designation(db, tenant.organization_id, changes["designation_id"])
    if "manager_employee_id" in changes and changes["manager_employee_id"]:
        manager = db.scalar(select(Employee).where(Employee.id == changes["manager_employee_id"], Employee.organization_id == tenant.organization_id))
        if manager is None or manager.id == employee.id: raise HTTPException(status_code=400, detail="Invalid manager")
    for field, field_value in changes.items():
        if isinstance(field_value, str): field_value = field_value.strip() or None
        setattr(employee, field, field_value)
    db.flush()
    after_row = _employee_row(db, tenant.organization_id, employee_id)
    if after_row is None: raise HTTPException(status_code=404, detail="Employee not found")
    after = _employee_read(after_row).model_dump(mode="json")
    record_activity(db, action="employee.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="employee", entity_id=employee.id,
        before=before, after=after, request=request, message=f"Employee updated: {user.full_name}")
    db.commit()
    return _employee_read(after_row)


@invitation_router.get("/{token}", response_model=InvitationPreview)
def preview_invitation(token: str, db: DbSession) -> InvitationPreview:
    item = db.scalar(select(EmployeeInvitation).where(EmployeeInvitation.token_hash == hash_invitation_token(token)))
    if item is None or item.status != "pending" or item.expires_at <= utc_now():
        raise HTTPException(status_code=404, detail="Invitation is invalid or expired")
    organization = db.get(Organization, item.organization_id)
    role = db.get(OrganizationRole, item.role_id)
    if organization is None or organization.status != ORGANIZATION_STATUS_ACTIVE or role is None or not role.is_active:
        raise HTTPException(status_code=404, detail="Invitation is no longer available")
    return InvitationPreview(company_name=organization.name, email=item.email, full_name=item.full_name,
        role_name=role.name, employee_code=item.employee_code, expires_at=item.expires_at,
        existing_user=db.scalar(select(User.id).where(User.email == item.email)) is not None)


@invitation_router.post("/accept", response_model=dict)
def accept_invitation(payload: InvitationAccept, request: Request, db: DbSession):
    item = db.scalar(
        select(EmployeeInvitation)
        .where(EmployeeInvitation.token_hash == hash_invitation_token(payload.token))
        .with_for_update()
    )
    if item is None or item.status != "pending" or item.expires_at <= utc_now():
        raise HTTPException(status_code=404, detail="Invitation is invalid or expired")
    organization = db.get(Organization, item.organization_id)
    role = db.get(OrganizationRole, item.role_id)
    if organization is None or organization.status != ORGANIZATION_STATUS_ACTIVE or role is None or not role.is_active:
        raise HTTPException(status_code=403, detail="Company or role is unavailable")

    user = db.scalar(select(User).where(User.email == item.email))
    if user:
        if not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect password for the existing account")
        if not user.is_active: raise HTTPException(status_code=403, detail="This user account is suspended")
    else:
        user = User(email=item.email, full_name=item.full_name, password_hash=hash_password(payload.password))
        db.add(user); db.flush()

    membership = db.scalar(select(Membership).where(Membership.organization_id == item.organization_id, Membership.user_id == user.id))
    if membership is None:
        membership = Membership(organization_id=item.organization_id, user_id=user.id, role_id=role.id,
            role=MEMBERSHIP_ROLE_ADMIN if role.slug == "admin" else MEMBERSHIP_ROLE_USER, status="active")
        db.add(membership); db.flush()
    else:
        membership.role_id = role.id
        membership.role = MEMBERSHIP_ROLE_ADMIN if role.slug == "admin" else MEMBERSHIP_ROLE_USER
        membership.status = "active"
        db.flush()

    employee = db.scalar(select(Employee).where(Employee.organization_id == item.organization_id, Employee.membership_id == membership.id))
    if employee is None:
        employee = Employee(organization_id=item.organization_id, membership_id=membership.id,
            employee_code=item.employee_code, department_id=item.department_id,
            designation_id=item.designation_id, work_email=item.email, employment_status="active")
        db.add(employee)
    else:
        employee.department_id = item.department_id
        employee.designation_id = item.designation_id
        employee.employment_status = "active"
    item.status = "accepted"; item.accepted_at = utc_now()
    db.flush()
    record_activity(db, action="employee.invitation.accepted", scope="tenant", actor_user_id=user.id,
        organization_id=item.organization_id, entity_type="employee", entity_id=employee.id,
        after={"user_id": user.id, "email": user.email, "employee_code": employee.employee_code,
               "role": role.name, "membership_id": membership.id}, request=request,
        message=f"Employee invitation accepted: {user.email}")
    db.commit()
    return {"ok": True, "company_name": organization.name, "employee_code": employee.employee_code}
