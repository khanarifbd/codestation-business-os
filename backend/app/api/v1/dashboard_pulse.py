from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Lead, LeadStatus
from app.models.finance import Invoice
from app.models.hr import AttendanceRecord, LeaveRequest
from app.models.orders import Order
from app.models.projects import Project
from app.models.team import Employee
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/dashboard-pulse", tags=["Dashboard"])

OrdersViewer = Annotated[TenantContext, Depends(require_tenant_permission("orders.view"))]
ProjectsViewer = Annotated[TenantContext, Depends(require_tenant_permission("projects.view"))]
CrmViewer = Annotated[TenantContext, Depends(require_tenant_permission("crm.view"))]
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
HRViewer = Annotated[TenantContext, Depends(require_tenant_permission("hr.view"))]


class CurrencyAmount(BaseModel):
    currency: str
    amount: Decimal


class PipelineCurrencyAmount(BaseModel):
    currency: str
    amount: Decimal
    weighted_amount: Decimal


class OrderPulse(BaseModel):
    open_orders: int
    values: list[CurrencyAmount]


class ProjectPulse(BaseModel):
    active_projects: int
    values: list[CurrencyAmount]


class CrmPulse(BaseModel):
    open_leads: int
    values: list[PipelineCurrencyAmount]


class FinancePulse(BaseModel):
    open_invoices: int
    overdue_invoices: int
    outstanding: list[CurrencyAmount]
    overdue: list[CurrencyAmount]


class PeoplePulse(BaseModel):
    active_employees: int
    present_today: int
    late_today: int
    on_leave_today: int
    pending_leave: int


def _tenant_today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except (ZoneInfoNotFoundError, ValueError):
        return datetime.now(timezone.utc).date()


def _currency_amounts(rows) -> list[CurrencyAmount]:
    return [
        CurrencyAmount(currency=str(currency).upper(), amount=Decimal(amount or 0))
        for currency, amount in rows
        if currency
    ]


@router.get("/orders", response_model=OrderPulse)
def order_pulse(db: DbSession, tenant: OrdersViewer) -> OrderPulse:
    conditions = [
        Order.organization_id == tenant.organization_id,
        Order.status.in_(["confirmed", "in_progress"]),
    ]
    count = db.scalar(select(func.count(Order.id)).where(*conditions)) or 0
    rows = db.execute(
        select(Order.currency, func.coalesce(func.sum(Order.total), 0))
        .where(*conditions)
        .group_by(Order.currency)
        .order_by(Order.currency.asc())
    ).all()
    return OrderPulse(open_orders=int(count), values=_currency_amounts(rows))


@router.get("/projects", response_model=ProjectPulse)
def project_pulse(db: DbSession, tenant: ProjectsViewer) -> ProjectPulse:
    conditions = [
        Project.organization_id == tenant.organization_id,
        Project.status.in_(["planned", "active", "on_hold"]),
    ]
    count = db.scalar(select(func.count(Project.id)).where(*conditions)) or 0
    rows = db.execute(
        select(Project.currency, func.coalesce(func.sum(Project.contract_value), 0))
        .where(*conditions)
        .group_by(Project.currency)
        .order_by(Project.currency.asc())
    ).all()
    return ProjectPulse(active_projects=int(count), values=_currency_amounts(rows))


@router.get("/crm", response_model=CrmPulse)
def crm_pulse(db: DbSession, tenant: CrmViewer) -> CrmPulse:
    base_conditions = [
        Lead.organization_id == tenant.organization_id,
        Lead.converted_client_id.is_(None),
        LeadStatus.category.in_(["open", "qualified"]),
    ]
    open_leads = db.scalar(
        select(func.count(Lead.id))
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(*base_conditions)
    ) or 0

    rows = db.execute(
        select(Lead.currency, Lead.estimated_value, Lead.probability_percent)
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(
            *base_conditions,
            Lead.currency.is_not(None),
            Lead.estimated_value.is_not(None),
        )
    ).all()

    totals: dict[str, tuple[Decimal, Decimal]] = {}
    for currency, estimated_value, probability_percent in rows:
        code = str(currency).upper()
        amount = Decimal(estimated_value or 0)
        probability = Decimal(probability_percent or 0) / Decimal("100")
        current_amount, current_weighted = totals.get(code, (Decimal("0"), Decimal("0")))
        totals[code] = (current_amount + amount, current_weighted + (amount * probability))

    values = [
        PipelineCurrencyAmount(currency=code, amount=amount, weighted_amount=weighted)
        for code, (amount, weighted) in sorted(totals.items())
    ]
    return CrmPulse(open_leads=int(open_leads), values=values)


@router.get("/finance", response_model=FinancePulse)
def finance_pulse(db: DbSession, tenant: FinanceViewer) -> FinancePulse:
    today = _tenant_today(tenant.organization.timezone)
    open_conditions = [
        Invoice.organization_id == tenant.organization_id,
        Invoice.status.not_in(["paid", "cancelled"]),
        Invoice.balance_due > 0,
    ]
    overdue_conditions = [*open_conditions, Invoice.due_date < today]

    open_invoices = db.scalar(select(func.count(Invoice.id)).where(*open_conditions)) or 0
    overdue_invoices = db.scalar(select(func.count(Invoice.id)).where(*overdue_conditions)) or 0

    outstanding_rows = db.execute(
        select(Invoice.currency, func.coalesce(func.sum(Invoice.balance_due), 0))
        .where(*open_conditions)
        .group_by(Invoice.currency)
        .order_by(Invoice.currency.asc())
    ).all()
    overdue_rows = db.execute(
        select(Invoice.currency, func.coalesce(func.sum(Invoice.balance_due), 0))
        .where(*overdue_conditions)
        .group_by(Invoice.currency)
        .order_by(Invoice.currency.asc())
    ).all()

    return FinancePulse(
        open_invoices=int(open_invoices),
        overdue_invoices=int(overdue_invoices),
        outstanding=_currency_amounts(outstanding_rows),
        overdue=_currency_amounts(overdue_rows),
    )


@router.get("/people", response_model=PeoplePulse)
def people_pulse(db: DbSession, tenant: HRViewer) -> PeoplePulse:
    today = _tenant_today(tenant.organization.timezone)
    org_id = tenant.organization_id

    active_employees = db.scalar(
        select(func.count(Employee.id)).where(
            Employee.organization_id == org_id,
            Employee.employment_status == "active",
        )
    ) or 0
    present_today = db.scalar(
        select(func.count(AttendanceRecord.id)).where(
            AttendanceRecord.organization_id == org_id,
            AttendanceRecord.attendance_date == today,
            AttendanceRecord.status.in_(["present", "late"]),
        )
    ) or 0
    late_today = db.scalar(
        select(func.count(AttendanceRecord.id)).where(
            AttendanceRecord.organization_id == org_id,
            AttendanceRecord.attendance_date == today,
            AttendanceRecord.status == "late",
        )
    ) or 0
    on_leave_today = db.scalar(
        select(func.count(LeaveRequest.id)).where(
            LeaveRequest.organization_id == org_id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= today,
            LeaveRequest.end_date >= today,
        )
    ) or 0
    pending_leave = db.scalar(
        select(func.count(LeaveRequest.id)).where(
            LeaveRequest.organization_id == org_id,
            LeaveRequest.status == "pending",
        )
    ) or 0

    return PeoplePulse(
        active_employees=int(active_employees),
        present_today=int(present_today),
        late_today=int(late_today),
        on_leave_today=int(on_leave_today),
        pending_leave=int(pending_leave),
    )
