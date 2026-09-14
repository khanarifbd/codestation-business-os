from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, select

from app.api.dependencies import CurrentTenant, DbSession, require_tenant_permission
from app.api.v1.capital import money as capital_money
from app.api.v1.capital_insights import entitlement, money as insight_money
from app.api.v1.client_portal import ClientPortalOrder, _client_portal_client_ids
from app.api.v1.hr_workspace import _admin, _permission, _role
from app.core.roles import MEMBERSHIP_ROLE_ADMIN
from app.models.capital import (
    CompanyInvestment,
    CompanyInvestor,
    CompanyInvestorPayout,
    CompanyLoan,
    InvestmentReturn,
    InvestorPayout,
    LoanRepayment,
    ProjectInvestor,
)
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice
from app.models.hr import AttendanceRecord, EmployeeHRDocument, HRShift, JobOpening, LeaveRequest, LeaveType
from app.models.membership import Membership
from app.models.order_commercial import OrderChange
from app.models.orders import Order
from app.models.projects import Project
from app.models.team import Department, Employee, OrganizationRole
from app.models.user import User
from app.tenancy.context import TenantContext

router = APIRouter()
client_portal_router = APIRouter(prefix="/client-portal", tags=["Client Portal"])
capital_router = APIRouter(prefix="/capital", tags=["Investments & Funding"])
hr_router = APIRouter(prefix="/hr", tags=["HR"])

CapitalViewer = Annotated[TenantContext, Depends(require_tenant_permission("capital.view"))]
HRViewer = Annotated[TenantContext, Depends(require_tenant_permission("hr.view"))]


@client_portal_router.get("/orders", response_model=list[ClientPortalOrder])
def list_client_portal_orders_fast(db: DbSession, tenant: CurrentTenant) -> list[ClientPortalOrder]:
    client_ids = _client_portal_client_ids(db, tenant)
    approved_delta = (
        select(
            func.coalesce(
                func.sum(
                    case(
                        (OrderChange.change_type == "addition", OrderChange.total),
                        else_=-OrderChange.total,
                    )
                ),
                0,
            )
        )
        .where(
            OrderChange.organization_id == tenant.organization_id,
            OrderChange.order_id == Order.id,
            OrderChange.status == "approved",
        )
        .correlate(Order)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Order, approved_delta.label("approved_delta"))
        .where(
            Order.organization_id == tenant.organization_id,
            Order.client_id.in_(client_ids),
        )
        .order_by(Order.order_date.desc(), Order.created_at.desc())
    ).all()
    return [
        ClientPortalOrder(
            id=order.id,
            order_number=order.order_number,
            client_id=order.client_id,
            quotation_id=order.quotation_id,
            status=order.status,
            subject=order.subject,
            order_date=order.order_date,
            currency=order.currency,
            total=order.total,
            approved_change_value=capital_money(approved_change_value),
            revised_contract_value=capital_money(Decimal(order.total) + Decimal(approved_change_value or 0)),
            confirmed_at=order.confirmed_at,
            started_at=order.started_at,
            completed_at=order.completed_at,
            cancelled_at=order.cancelled_at,
        )
        for order, approved_change_value in rows
    ]


@capital_router.get("/meta")
def capital_meta_fast(db: DbSession, tenant: CapitalViewer):
    transaction_totals = (
        select(
            FinancialTransaction.account_id.label("account_id"),
            func.coalesce(
                func.sum(
                    case(
                        (FinancialTransaction.direction == "credit", FinancialTransaction.amount),
                        else_=-FinancialTransaction.amount,
                    )
                ),
                0,
            ).label("net"),
        )
        .where(FinancialTransaction.organization_id == tenant.organization_id)
        .group_by(FinancialTransaction.account_id)
        .subquery()
    )
    account_rows = db.execute(
        select(FinancialAccount, func.coalesce(transaction_totals.c.net, 0).label("net"))
        .outerjoin(transaction_totals, transaction_totals.c.account_id == FinancialAccount.id)
        .where(
            FinancialAccount.organization_id == tenant.organization_id,
            FinancialAccount.is_active.is_(True),
        )
        .order_by(FinancialAccount.currency, FinancialAccount.name)
    ).all()
    projects = db.scalars(
        select(Project)
        .where(Project.organization_id == tenant.organization_id, Project.status != "cancelled")
        .order_by(Project.created_at.desc())
        .limit(200)
    ).all()
    return {
        "accounts": [
            {
                "id": account.id,
                "name": account.name,
                "currency": account.currency,
                "account_type": account.account_type,
                "balance": capital_money(Decimal(account.opening_balance) + Decimal(net or 0)),
            }
            for account, net in account_rows
        ],
        "projects": [
            {
                "id": project.id,
                "project_number": project.project_number,
                "name": project.name,
                "currency": project.currency,
                "contract_value": project.contract_value,
                "status": project.status,
            }
            for project in projects
        ],
    }


@capital_router.get("/insights")
def capital_insights_fast(
    db: DbSession,
    tenant: CapitalViewer,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
):
    org = tenant.organization_id
    today = datetime.now(timezone.utc).date()
    start = date_from or date(today.year, 1, 1)
    end = date_to or today

    overdue_loans = db.scalar(
        select(func.count(CompanyLoan.id)).where(
            CompanyLoan.organization_id == org,
            CompanyLoan.status == "active",
            CompanyLoan.maturity_date.is_not(None),
            CompanyLoan.maturity_date < today,
            CompanyLoan.outstanding_principal > 0,
        )
    ) or 0

    data: dict[str, dict[str, Decimal]] = {}

    def bucket(code: str):
        return data.setdefault(
            code,
            {
                "investment_income": Decimal("0"),
                "loan_interest": Decimal("0"),
                "investor_profit_share": Decimal("0"),
            },
        )

    investment_rows = db.execute(
        select(CompanyInvestment.currency, func.sum(InvestmentReturn.income_amount))
        .join(CompanyInvestment, CompanyInvestment.id == InvestmentReturn.investment_id)
        .where(
            InvestmentReturn.organization_id == org,
            CompanyInvestment.organization_id == org,
            InvestmentReturn.return_date >= start,
            InvestmentReturn.return_date <= end,
        )
        .group_by(CompanyInvestment.currency)
    ).all()
    for code, amount in investment_rows:
        bucket(code)["investment_income"] += insight_money(amount)

    interest_rows = db.execute(
        select(CompanyLoan.currency, func.sum(LoanRepayment.interest_amount))
        .join(CompanyLoan, CompanyLoan.id == LoanRepayment.loan_id)
        .where(
            LoanRepayment.organization_id == org,
            CompanyLoan.organization_id == org,
            LoanRepayment.payment_date >= start,
            LoanRepayment.payment_date <= end,
        )
        .group_by(CompanyLoan.currency)
    ).all()
    for code, amount in interest_rows:
        bucket(code)["loan_interest"] += insight_money(amount)

    project_share_rows = db.execute(
        select(ProjectInvestor.currency, func.sum(InvestorPayout.profit_share_amount))
        .join(ProjectInvestor, ProjectInvestor.id == InvestorPayout.investor_id)
        .where(
            InvestorPayout.organization_id == org,
            ProjectInvestor.organization_id == org,
            InvestorPayout.payout_date >= start,
            InvestorPayout.payout_date <= end,
        )
        .group_by(ProjectInvestor.currency)
    ).all()
    for code, amount in project_share_rows:
        bucket(code)["investor_profit_share"] += insight_money(amount)

    company_share_rows = db.execute(
        select(CompanyInvestor.currency, func.sum(CompanyInvestorPayout.profit_share_amount))
        .join(CompanyInvestor, CompanyInvestor.id == CompanyInvestorPayout.investor_id)
        .where(
            CompanyInvestorPayout.organization_id == org,
            CompanyInvestor.organization_id == org,
            CompanyInvestorPayout.payout_date >= start,
            CompanyInvestorPayout.payout_date <= end,
        )
        .group_by(CompanyInvestor.currency)
    ).all()
    for code, amount in company_share_rows:
        bucket(code)["investor_profit_share"] += insight_money(amount)

    pnl = []
    for code, values in sorted(data.items()):
        impact = insight_money(values["investment_income"] - values["loan_interest"] - values["investor_profit_share"])
        pnl.append(
            {
                "currency": code,
                **{key: insight_money(value) for key, value in values.items()},
                "net_capital_pnl_impact": impact,
            }
        )

    projects = db.scalars(
        select(Project)
        .where(Project.organization_id == org)
        .order_by(Project.created_at.desc())
        .limit(200)
    ).all()
    project_ids = [project.id for project in projects]
    if not project_ids:
        return {
            "date_from": start,
            "date_to": end,
            "overdue_loans": int(overdue_loans),
            "capital_pnl": pnl,
            "project_settlements": [],
        }

    investors = db.scalars(
        select(ProjectInvestor)
        .where(
            ProjectInvestor.organization_id == org,
            ProjectInvestor.project_id.in_(project_ids),
        )
        .order_by(ProjectInvestor.project_id.asc(), ProjectInvestor.created_at.asc())
    ).all()
    investors_by_project: dict[str, list[ProjectInvestor]] = {project_id: [] for project_id in project_ids}
    for investor in investors:
        investors_by_project.setdefault(investor.project_id, []).append(investor)

    revenue_rows = db.execute(
        select(Invoice.project_id, func.coalesce(func.sum(Invoice.total), 0))
        .where(
            Invoice.organization_id == org,
            Invoice.project_id.in_(project_ids),
            Invoice.status != "cancelled",
        )
        .group_by(Invoice.project_id)
    ).all()
    revenue_by_project = {str(project_id): insight_money(amount) for project_id, amount in revenue_rows if project_id}

    direct_cost_rows = db.execute(
        select(Expense.project_id, func.coalesce(func.sum(Expense.profitability_amount), 0))
        .join(
            ExpenseCategory,
            and_(
                ExpenseCategory.id == Expense.category_id,
                ExpenseCategory.organization_id == org,
            ),
        )
        .where(
            Expense.organization_id == org,
            Expense.project_id.in_(project_ids),
            Expense.status == "posted",
            ExpenseCategory.cost_type == "direct",
        )
        .group_by(Expense.project_id)
    ).all()
    direct_cost_by_project = {
        str(project_id): insight_money(amount) for project_id, amount in direct_cost_rows if project_id
    }

    investor_ids = [investor.id for investor in investors]
    payouts_by_investor: dict[str, tuple[Decimal, Decimal]] = {}
    if investor_ids:
        payout_rows = db.execute(
            select(
                InvestorPayout.investor_id,
                func.coalesce(func.sum(InvestorPayout.principal_return_amount), 0),
                func.coalesce(func.sum(InvestorPayout.profit_share_amount), 0),
            )
            .where(
                InvestorPayout.organization_id == org,
                InvestorPayout.investor_id.in_(investor_ids),
            )
            .group_by(InvestorPayout.investor_id)
        ).all()
        payouts_by_investor = {
            str(investor_id): (insight_money(principal), insight_money(profit))
            for investor_id, principal, profit in payout_rows
        }

    settlements = []
    for project in projects:
        project_investors = investors_by_project.get(project.id, [])
        if not project_investors:
            continue
        revenue = revenue_by_project.get(project.id, Decimal("0.00"))
        direct_cost = direct_cost_by_project.get(project.id, Decimal("0.00"))
        project_profit = insight_money(revenue - direct_cost)
        investor_rows = []
        total_entitlement = Decimal("0")
        total_paid_profit = Decimal("0")
        for investor in project_investors:
            entitled = entitlement(project_profit, revenue, investor)
            principal_paid, profit_paid = payouts_by_investor.get(
                investor.id,
                (Decimal("0.00"), Decimal("0.00")),
            )
            total_entitlement += entitled
            total_paid_profit += profit_paid
            investor_rows.append(
                {
                    "investor_id": investor.id,
                    "investor_name": investor.investor_name,
                    "share_type": investor.share_type,
                    "share_value": investor.share_value,
                    "committed_amount": investor.committed_amount,
                    "funded_amount": investor.funded_amount,
                    "principal_returned": principal_paid,
                    "principal_remaining": insight_money(
                        max(Decimal(investor.funded_amount) - principal_paid, Decimal("0"))
                    ),
                    "profit_entitlement": entitled,
                    "profit_paid": profit_paid,
                    "profit_remaining": insight_money(max(entitled - profit_paid, Decimal("0"))),
                    "status": investor.status,
                }
            )
        settlements.append(
            {
                "project_id": project.id,
                "project_number": project.project_number,
                "project_name": project.name,
                "currency": project.currency,
                "status": project.status,
                "revenue": revenue,
                "direct_cost": direct_cost,
                "project_profit": project_profit,
                "total_investor_profit_entitlement": insight_money(total_entitlement),
                "total_investor_profit_paid": insight_money(total_paid_profit),
                "company_retained_profit": insight_money(project_profit - total_entitlement),
                "investors": investor_rows,
            }
        )

    return {
        "date_from": start,
        "date_to": end,
        "overdue_loans": int(overdue_loans),
        "capital_pnl": pnl,
        "project_settlements": settlements,
    }


@hr_router.get("/dashboard")
def hr_dashboard_fast(db: DbSession, tenant: HRViewer):
    org = tenant.organization_id
    today = datetime.now(timezone.utc).date()
    row = db.execute(
        select(
            select(func.count(Employee.id))
            .where(Employee.organization_id == org, Employee.employment_status == "active")
            .scalar_subquery()
            .label("active_employees"),
            select(func.count(AttendanceRecord.id))
            .where(
                AttendanceRecord.organization_id == org,
                AttendanceRecord.attendance_date == today,
                AttendanceRecord.status.in_(["present", "late"]),
            )
            .scalar_subquery()
            .label("present_today"),
            select(func.count(LeaveRequest.id))
            .where(
                LeaveRequest.organization_id == org,
                LeaveRequest.status == "approved",
                LeaveRequest.start_date <= today,
                LeaveRequest.end_date >= today,
            )
            .scalar_subquery()
            .label("on_leave_today"),
            select(func.count(LeaveRequest.id))
            .where(LeaveRequest.organization_id == org, LeaveRequest.status == "pending")
            .scalar_subquery()
            .label("pending_leave"),
            select(func.count(EmployeeHRDocument.id))
            .where(
                EmployeeHRDocument.organization_id == org,
                EmployeeHRDocument.expires_on.is_not(None),
                EmployeeHRDocument.expires_on >= today,
                EmployeeHRDocument.expires_on <= date.fromordinal(today.toordinal() + 30),
            )
            .scalar_subquery()
            .label("documents_expiring_30d"),
            select(func.count(JobOpening.id))
            .where(JobOpening.organization_id == org, JobOpening.status == "open")
            .scalar_subquery()
            .label("open_jobs"),
        )
    ).one()
    return {
        "active_employees": int(row.active_employees or 0),
        "present_today": int(row.present_today or 0),
        "on_leave_today": int(row.on_leave_today or 0),
        "pending_leave": int(row.pending_leave or 0),
        "documents_expiring_30d": int(row.documents_expiring_30d or 0),
        "open_jobs": int(row.open_jobs or 0),
    }


@hr_router.get("/meta")
def hr_meta_fast(db: DbSession, tenant: HRViewer):
    employee_rows = db.execute(
        select(Employee, User.full_name)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Employee.organization_id == tenant.organization_id,
            Employee.employment_status == "active",
        )
        .order_by(Employee.employee_code)
    ).all()
    departments = db.scalars(
        select(Department)
        .where(Department.organization_id == tenant.organization_id, Department.is_active.is_(True))
        .order_by(Department.name)
    ).all()
    leave_types = db.scalars(
        select(LeaveType)
        .where(LeaveType.organization_id == tenant.organization_id, LeaveType.is_active.is_(True))
        .order_by(LeaveType.name)
    ).all()
    shifts = db.scalars(
        select(HRShift)
        .where(HRShift.organization_id == tenant.organization_id, HRShift.is_active.is_(True))
        .order_by(HRShift.name)
    ).all()
    return {
        "employees": [
            {"id": employee.id, "employee_code": employee.employee_code, "name": full_name}
            for employee, full_name in employee_rows
        ],
        "departments": [{"id": item.id, "name": item.name} for item in departments],
        "leave_types": [
            {
                "id": item.id,
                "name": item.name,
                "code": item.code,
                "annual_allowance_days": str(item.annual_allowance_days),
                "is_paid": item.is_paid,
            }
            for item in leave_types
        ],
        "shifts": [
            {
                "id": item.id,
                "name": item.name,
                "start_time": str(item.start_time),
                "end_time": str(item.end_time),
            }
            for item in shifts
        ],
    }


@hr_router.get("/access")
def hr_access_fast(db: DbSession, tenant: CurrentTenant):
    role = getattr(tenant, "organization_role", None)
    if not isinstance(role, OrganizationRole):
        role = _role(db, tenant)
    admin = tenant.role == MEMBERSHIP_ROLE_ADMIN or _permission(role, "*")
    can_view = _permission(role, "hr.view")
    can_manage = _permission(role, "hr.manage")
    can_view_people = admin or can_view or _permission(role, "employees.view") or _permission(role, "employees.manage")
    can_manage_people = admin or can_manage or _permission(role, "employees.manage")
    can_invite_employees = admin or _permission(role, "employees.invite")
    can_manage_structure = admin or can_manage or _permission(role, "departments.manage") or _permission(role, "designations.manage")
    is_employee = bool(
        db.scalar(
            select(func.count(Employee.id)).where(
                Employee.organization_id == tenant.organization_id,
                Employee.membership_id == tenant.membership_id,
                Employee.employment_status == "active",
            )
        )
    )
    can_self = _permission(role, "hr.self") and is_employee
    return {
        "can_view": bool(can_view),
        "can_manage": bool(can_manage),
        "can_self": bool(can_self),
        "can_view_people": bool(can_view_people),
        "can_manage_people": bool(can_manage_people),
        "can_invite_employees": bool(can_invite_employees),
        "can_manage_structure": bool(can_manage_structure),
        "is_employee": is_employee,
        "role_name": role.name if isinstance(role, OrganizationRole) else None,
        "timezone": tenant.organization.timezone,
        "currency": tenant.organization.currency,
        "landing": "overview" if can_view else ("me" if can_self else "unavailable"),
    }


router.include_router(client_portal_router)
router.include_router(capital_router)
router.include_router(hr_router)
