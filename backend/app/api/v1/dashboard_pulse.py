from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import case, func, select

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
    rows = db.execute(
        select(
            Order.currency,
            func.count(Order.id),
            func.coalesce(func.sum(Order.total), 0),
        )
        .where(*conditions)
        .group_by(Order.currency)
        .order_by(Order.currency.asc())
    ).all()
    count = sum(int(row_count or 0) for _, row_count, _ in rows)
    return OrderPulse(
        open_orders=count,
        values=_currency_amounts((currency, amount) for currency, _, amount in rows),
    )


@router.get("/projects", response_model=ProjectPulse)
def project_pulse(db: DbSession, tenant: ProjectsViewer) -> ProjectPulse:
    conditions = [
        Project.organization_id == tenant.organization_id,
        Project.status.in_(["planned", "active", "on_hold"]),
    ]
    rows = db.execute(
        select(
            Project.currency,
            func.count(Project.id),
            func.coalesce(func.sum(Project.contract_value), 0),
        )
        .where(*conditions)
        .group_by(Project.currency)
        .order_by(Project.currency.asc())
    ).all()
    count = sum(int(row_count or 0) for _, row_count, _ in rows)
    return ProjectPulse(
        active_projects=count,
        values=_currency_amounts((currency, amount) for currency, _, amount in rows),
    )


@router.get("/crm", response_model=CrmPulse)
def crm_pulse(db: DbSession, tenant: CrmViewer) -> CrmPulse:
    base_conditions = [
        Lead.organization_id == tenant.organization_id,
        Lead.converted_client_id.is_(None),
        LeadStatus.category.in_(["open", "qualified"]),
    ]
    rows = db.execute(
        select(
            Lead.currency,
            func.count(Lead.id),
            func.count(Lead.estimated_value),
            func.coalesce(func.sum(Lead.estimated_value), 0),
            func.coalesce(
                func.sum(Lead.estimated_value * func.coalesce(Lead.probability_percent, 0)),
                0,
            ),
        )
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(*base_conditions)
        .group_by(Lead.currency)
        .order_by(Lead.currency.asc())
    ).all()

    open_leads = sum(int(row_count or 0) for _, row_count, _, _, _ in rows)
    values: list[PipelineCurrencyAmount] = []
    for currency, _, estimated_count, amount, weighted_raw in rows:
        if not currency or int(estimated_count or 0) == 0:
            continue
        values.append(
            PipelineCurrencyAmount(
                currency=str(currency).upper(),
                amount=Decimal(amount or 0),
                weighted_amount=Decimal(weighted_raw or 0) / Decimal("100"),
            )
        )
    return CrmPulse(open_leads=open_leads, values=values)


@router.get("/finance", response_model=FinancePulse)
def finance_pulse(db: DbSession, tenant: FinanceViewer) -> FinancePulse:
    today = _tenant_today(tenant.organization.timezone)
    open_conditions = [
        Invoice.organization_id == tenant.organization_id,
        Invoice.status == "sent",
        Invoice.balance_due > 0,
    ]
    rows = db.execute(
        select(
            Invoice.currency,
            func.count(Invoice.id),
            func.coalesce(
                func.sum(case((Invoice.due_date < today, 1), else_=0)),
                0,
            ),
            func.coalesce(func.sum(Invoice.balance_due), 0),
            func.coalesce(
                func.sum(case((Invoice.due_date < today, Invoice.balance_due), else_=0)),
                0,
            ),
        )
        .where(*open_conditions)
        .group_by(Invoice.currency)
        .order_by(Invoice.currency.asc())
    ).all()

    open_invoices = sum(int(row_count or 0) for _, row_count, _, _, _ in rows)
    overdue_invoices = sum(int(overdue_count or 0) for _, _, overdue_count, _, _ in rows)
    outstanding = _currency_amounts((currency, amount) for currency, _, _, amount, _ in rows)
    overdue = _currency_amounts(
        (currency, amount)
        for currency, _, overdue_count, _, amount in rows
        if int(overdue_count or 0) > 0
    )

    return FinancePulse(
        open_invoices=open_invoices,
        overdue_invoices=overdue_invoices,
        outstanding=outstanding,
        overdue=overdue,
    )


@router.get("/people", response_model=PeoplePulse)
def people_pulse(db: DbSession, tenant: HRViewer) -> PeoplePulse:
    today = _tenant_today(tenant.organization.timezone)
    org_id = tenant.organization_id

    active_employees = (
        select(func.count(Employee.id))
        .where(
            Employee.organization_id == org_id,
            Employee.employment_status == "active",
        )
        .scalar_subquery()
    )
    present_today = (
        select(func.count(AttendanceRecord.id))
        .where(
            AttendanceRecord.organization_id == org_id,
            AttendanceRecord.attendance_date == today,
            AttendanceRecord.status.in_(["present", "late"]),
        )
        .scalar_subquery()
    )
    late_today = (
        select(func.count(AttendanceRecord.id))
        .where(
            AttendanceRecord.organization_id == org_id,
            AttendanceRecord.attendance_date == today,
            AttendanceRecord.status == "late",
        )
        .scalar_subquery()
    )
    on_leave_today = (
        select(func.count(LeaveRequest.id))
        .where(
            LeaveRequest.organization_id == org_id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= today,
            LeaveRequest.end_date >= today,
        )
        .scalar_subquery()
    )
    pending_leave = (
        select(func.count(LeaveRequest.id))
        .where(
            LeaveRequest.organization_id == org_id,
            LeaveRequest.status == "pending",
        )
        .scalar_subquery()
    )

    row = db.execute(
        select(
            active_employees.label("active_employees"),
            present_today.label("present_today"),
            late_today.label("late_today"),
            on_leave_today.label("on_leave_today"),
            pending_leave.label("pending_leave"),
        )
    ).one()

    return PeoplePulse(
        active_employees=int(row.active_employees or 0),
        present_today=int(row.present_today or 0),
        late_today=int(row.late_today or 0),
        on_leave_today=int(row.on_leave_today or 0),
        pending_leave=int(row.pending_leave or 0),
    )
