from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, func, literal, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_any_tenant_permission, require_tenant_permission
from app.api.v1.client_access import ClientAccessRecord, ClientAccessUser
from app.api.v1.project_execution import _document_reads, _milestone_reads, _work_log_reads
from app.models.activity_log import ActivityLog
from app.models.client_access import ClientMembership
from app.models.crm import Client
from app.models.expenses import Vendor
from app.models.inventory import InventoryBalance, Product, PurchaseReceipt
from app.models.membership import Membership
from app.models.projects import Project, ProjectCredential, ProjectMilestone, ProjectTask
from app.models.team import Employee
from app.models.user import User
from app.schemas.project_execution import CredentialRead, ProjectExecutionSummary, ProjectWorkspace, TaskRead
from app.services.project_access import require_project_access
from app.tenancy.context import TenantContext

router = APIRouter()
inventory_router = APIRouter(prefix="/inventory", tags=["Inventory"])
projects_router = APIRouter(prefix="/projects", tags=["Project Execution"])
client_access_router = APIRouter(prefix="/crm/client-access", tags=["Client Access"])

InventoryViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
ProjectReader = Annotated[TenantContext, Depends(require_any_tenant_permission("projects.view", "projects.work"))]
ClientAccessViewer = Annotated[TenantContext, Depends(require_tenant_permission("clients.view"))]

QTY = Decimal("0.0001")
COST = Decimal("0.0001")


def _qty(value) -> Decimal:
    return Decimal(value or 0).quantize(QTY, rounding=ROUND_HALF_UP)


def _cost(value) -> Decimal:
    return Decimal(value or 0).quantize(COST, rounding=ROUND_HALF_UP)


@inventory_router.get("/products")
def products_fast(db: DbSession, tenant: InventoryViewer, include_inactive: bool = False):
    totals = (
        select(
            InventoryBalance.product_id.label("product_id"),
            func.coalesce(func.sum(InventoryBalance.on_hand_quantity), 0).label("on_hand"),
            func.coalesce(func.sum(InventoryBalance.inventory_value), 0).label("inventory_value"),
        )
        .where(InventoryBalance.organization_id == tenant.organization_id)
        .group_by(InventoryBalance.product_id)
        .subquery()
    )
    query = (
        select(
            Product,
            func.coalesce(totals.c.on_hand, 0).label("on_hand"),
            func.coalesce(totals.c.inventory_value, 0).label("inventory_value"),
        )
        .outerjoin(totals, totals.c.product_id == Product.id)
        .where(Product.organization_id == tenant.organization_id)
    )
    if not include_inactive:
        query = query.where(Product.is_active.is_(True))
    rows = db.execute(query.order_by(Product.name.asc())).all()
    return [
        {
            "id": item.id,
            "sku": item.sku,
            "barcode": item.barcode,
            "name": item.name,
            "description": item.description,
            "item_type": item.item_type,
            "category_id": item.category_id,
            "unit": item.unit,
            "currency": item.currency,
            "selling_price": item.selling_price,
            "standard_cost": item.standard_cost,
            "last_purchase_cost": item.last_purchase_cost,
            "reorder_level": item.reorder_level,
            "tax_code_id": item.tax_code_id,
            "track_inventory": item.track_inventory,
            "allow_negative_stock": item.allow_negative_stock,
            "is_active": item.is_active,
            "on_hand": _qty(on_hand),
            "inventory_value": _cost(inventory_value),
        }
        for item, on_hand, inventory_value in rows
    ]


@inventory_router.get("/suppliers")
def suppliers_fast(db: DbSession, tenant: InventoryViewer, include_inactive: bool = True):
    totals = (
        select(
            PurchaseReceipt.vendor_id.label("vendor_id"),
            func.count(PurchaseReceipt.id).label("purchase_count"),
            func.coalesce(func.sum(PurchaseReceipt.total), 0).label("purchased_total"),
            func.coalesce(func.sum(PurchaseReceipt.balance_due), 0).label("outstanding_total"),
        )
        .where(PurchaseReceipt.organization_id == tenant.organization_id)
        .group_by(PurchaseReceipt.vendor_id)
        .subquery()
    )
    query = (
        select(
            Vendor,
            func.coalesce(totals.c.purchase_count, 0).label("purchase_count"),
            func.coalesce(totals.c.purchased_total, 0).label("purchased_total"),
            func.coalesce(totals.c.outstanding_total, 0).label("outstanding_total"),
        )
        .outerjoin(totals, totals.c.vendor_id == Vendor.id)
        .where(Vendor.organization_id == tenant.organization_id)
    )
    if not include_inactive:
        query = query.where(Vendor.is_active.is_(True))
    rows = db.execute(query.order_by(Vendor.is_active.desc(), Vendor.name.asc())).all()
    return [
        {
            "id": item.id,
            "vendor_code": item.vendor_code,
            "name": item.name,
            "contact_name": item.contact_name,
            "email": item.email,
            "phone": item.phone,
            "website": item.website,
            "tax_identifier": item.tax_identifier,
            "country_code": item.country_code,
            "currency": item.currency,
            "notes": item.notes,
            "is_active": item.is_active,
            "purchase_count": int(purchase_count or 0),
            "purchased_total": purchased_total or Decimal("0"),
            "outstanding_total": outstanding_total or Decimal("0"),
        }
        for item, purchase_count, purchased_total, outstanding_total in rows
    ]


@client_access_router.get("", response_model=list[ClientAccessRecord])
def list_client_access_fast(db: DbSession, tenant: ClientAccessViewer) -> list[ClientAccessRecord]:
    clients = db.scalars(
        select(Client)
        .where(Client.organization_id == tenant.organization_id)
        .order_by(Client.status.desc(), Client.display_name.asc())
        .limit(500)
    ).all()
    if not clients:
        return []

    client_ids = [client.id for client in clients]
    rows = db.execute(
        select(ClientMembership, Membership, User)
        .join(Membership, Membership.id == ClientMembership.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            ClientMembership.organization_id == tenant.organization_id,
            ClientMembership.client_id.in_(client_ids),
            ClientMembership.status == "active",
        )
        .order_by(
            ClientMembership.client_id.asc(),
            ClientMembership.is_primary_contact.desc(),
            User.full_name.asc(),
        )
    ).all()
    users_by_client: dict[str, list[ClientAccessUser]] = {client_id: [] for client_id in client_ids}
    for access, membership, user in rows:
        users_by_client.setdefault(access.client_id, []).append(
            ClientAccessUser(
                access_id=access.id,
                membership_id=membership.id,
                user_id=user.id,
                full_name=user.full_name,
                email=user.email,
                is_primary_contact=access.is_primary_contact,
                membership_role=membership.role,
                membership_status=membership.status,
            )
        )
    return [
        ClientAccessRecord(
            client_id=client.id,
            client_code=client.client_code,
            display_name=client.display_name,
            client_type=client.client_type,
            email=client.email,
            status=client.status,
            users=users_by_client.get(client.id, []),
        )
        for client in clients
    ]


def _workspace_summary_fast(db: DbSession, project: Project, allowed_tabs: frozenset[str]) -> ProjectExecutionSummary:
    today = datetime.now(timezone.utc).date()
    can_see_tasks = "tasks" in allowed_tabs or "overview" in allowed_tabs
    can_see_milestones = "milestones" in allowed_tabs or "overview" in allowed_tabs

    def count_scalar(model, *conditions):
        return (
            select(func.count(model.id))
            .where(
                model.organization_id == project.organization_id,
                model.project_id == project.id,
                *conditions,
            )
            .scalar_subquery()
        )

    task_count = count_scalar(ProjectTask) if can_see_tasks else literal(0)
    open_count = count_scalar(ProjectTask, ProjectTask.status.not_in(["completed", "cancelled"])) if can_see_tasks else literal(0)
    overdue_count = count_scalar(
        ProjectTask,
        ProjectTask.due_date < today,
        ProjectTask.status.not_in(["completed", "cancelled"]),
    ) if can_see_tasks else literal(0)
    blocked_count = count_scalar(ProjectTask, ProjectTask.status == "blocked") if can_see_tasks else literal(0)
    milestone_count = count_scalar(ProjectMilestone) if can_see_milestones else literal(0)

    from app.models.projects import ProjectDocument

    document_count = count_scalar(ProjectDocument) if "documents" in allowed_tabs else literal(0)
    credential_count = count_scalar(ProjectCredential) if "credentials" in allowed_tabs else literal(0)
    row = db.execute(
        select(
            task_count.label("task_count"),
            open_count.label("open_count"),
            overdue_count.label("overdue_count"),
            blocked_count.label("blocked_count"),
            milestone_count.label("milestone_count"),
            document_count.label("document_count"),
            credential_count.label("credential_count"),
        )
    ).one()
    return ProjectExecutionSummary(
        progress_percent=project.progress_percent,
        milestone_count=int(row.milestone_count or 0),
        task_count=int(row.task_count or 0),
        open_task_count=int(row.open_count or 0),
        overdue_task_count=int(row.overdue_count or 0),
        blocked_task_count=int(row.blocked_count or 0),
        document_count=int(row.document_count or 0),
        credential_count=int(row.credential_count or 0),
    )


def _task_reads_fast(db: DbSession, project: Project) -> list[TaskRead]:
    assignee_employee = aliased(Employee)
    assignee_membership = aliased(Membership)
    assignee_user = aliased(User)
    rows = db.execute(
        select(
            ProjectTask,
            ProjectMilestone.title.label("milestone_title"),
            assignee_user.full_name.label("assignee_name"),
        )
        .outerjoin(
            ProjectMilestone,
            and_(
                ProjectMilestone.id == ProjectTask.milestone_id,
                ProjectMilestone.organization_id == project.organization_id,
                ProjectMilestone.project_id == project.id,
            ),
        )
        .outerjoin(
            assignee_employee,
            and_(
                assignee_employee.id == ProjectTask.assignee_employee_id,
                assignee_employee.organization_id == project.organization_id,
            ),
        )
        .outerjoin(
            assignee_membership,
            and_(
                assignee_membership.id == assignee_employee.membership_id,
                assignee_membership.organization_id == project.organization_id,
            ),
        )
        .outerjoin(assignee_user, assignee_user.id == assignee_membership.user_id)
        .where(
            ProjectTask.organization_id == project.organization_id,
            ProjectTask.project_id == project.id,
        )
        .order_by(ProjectTask.created_at.asc())
    ).all()
    return [
        TaskRead(
            id=item.id,
            task_code=item.task_code,
            milestone_id=item.milestone_id,
            milestone_title=milestone_title,
            title=item.title,
            description=item.description,
            status=item.status,
            priority=item.priority,
            progress_percent=item.progress_percent,
            assignee_employee_id=item.assignee_employee_id,
            assignee_name=assignee_name,
            planned_start_date=item.planned_start_date,
            due_date=item.due_date,
            estimated_minutes=item.estimated_minutes,
            completed_at=item.completed_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item, milestone_title, assignee_name in rows
    ]


def _credential_reads_fast(
    db: DbSession,
    project: Project,
    *,
    can_manage_credentials: bool,
) -> list[CredentialRead]:
    query = select(ProjectCredential).where(
        ProjectCredential.organization_id == project.organization_id,
        ProjectCredential.project_id == project.id,
    )
    if not can_manage_credentials:
        query = query.where(ProjectCredential.access_level == "team")
    items = db.scalars(query.order_by(ProjectCredential.created_at.desc())).all()
    if not items:
        return []

    credential_ids = [item.id for item in items]
    reveal_rows = db.execute(
        select(ActivityLog.entity_id, ActivityLog.created_at, User.full_name)
        .outerjoin(User, User.id == ActivityLog.actor_user_id)
        .where(
            ActivityLog.organization_id == project.organization_id,
            ActivityLog.action == "projects.credential.revealed",
            ActivityLog.entity_type == "project_credential",
            ActivityLog.entity_id.in_(credential_ids),
            ActivityLog.outcome == "success",
        )
        .order_by(ActivityLog.entity_id.asc(), ActivityLog.created_at.desc(), ActivityLog.id.desc())
    ).all()
    last_reveals: dict[str, tuple[datetime, str | None]] = {}
    for credential_id, revealed_at, revealed_by in reveal_rows:
        last_reveals.setdefault(credential_id, (revealed_at, revealed_by))

    result: list[CredentialRead] = []
    for item in items:
        last_revealed_at, last_revealed_by = last_reveals.get(item.id, (None, None))
        result.append(
            CredentialRead(
                id=item.id,
                name=item.name,
                credential_type=item.credential_type,
                environment=item.environment,
                username=item.username,
                url=item.url,
                notes=item.notes,
                access_level=item.access_level,
                created_by_user_id=item.created_by_user_id,
                last_revealed_by=last_revealed_by,
                last_revealed_at=last_revealed_at,
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
        )
    return result


@projects_router.get("/{project_id}/workspace", response_model=ProjectWorkspace)
def project_workspace_fast(project_id: str, db: DbSession, tenant: ProjectReader) -> ProjectWorkspace:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == tenant.organization_id,
        )
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    access = require_project_access(db, tenant, project)
    allowed = access.allowed_tabs
    can_manage_credentials = access.can_manage_project or access.is_project_manager
    return ProjectWorkspace(
        summary=_workspace_summary_fast(db, project, allowed),
        milestones=_milestone_reads(db, project) if "milestones" in allowed or "overview" in allowed else [],
        tasks=_task_reads_fast(db, project) if "tasks" in allowed else [],
        recent_work=_work_log_reads(db, project) if "work" in allowed or "overview" in allowed else [],
        documents=_document_reads(db, project) if "documents" in allowed else [],
        credentials=_credential_reads_fast(db, project, can_manage_credentials=can_manage_credentials) if "credentials" in allowed else [],
        can_manage_credentials="credentials" in allowed and can_manage_credentials,
    )


router.include_router(inventory_router)
router.include_router(projects_router)
router.include_router(client_access_router)
