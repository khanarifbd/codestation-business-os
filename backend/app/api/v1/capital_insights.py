from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
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
from app.models.finance import Invoice
from app.models.projects import Project
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/capital", tags=["Investments & Funding"])
CapitalViewer = Annotated[TenantContext, Depends(require_tenant_permission("capital.view"))]
MONEY = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def entitlement(project_profit: Decimal, project_revenue: Decimal, investor: ProjectInvestor) -> Decimal:
    if investor.share_type == "fixed_return":
        return money(investor.share_value)
    if investor.share_type == "revenue_share":
        return money(max(project_revenue, Decimal("0")) * Decimal(investor.share_value) / Decimal("100"))
    if investor.share_type == "profit_percent":
        return money(max(project_profit, Decimal("0")) * Decimal(investor.share_value) / Decimal("100"))
    # Convertible and custom agreements are intentionally not auto-accrued because
    # their legal conversion/return terms require an explicit settlement event.
    return Decimal("0.00")


@router.get("/insights")
def insights(
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
        return data.setdefault(code, {"investment_income": Decimal("0"), "loan_interest": Decimal("0"), "investor_profit_share": Decimal("0")})

    investment_rows = db.execute(
        select(CompanyInvestment.currency, func.sum(InvestmentReturn.income_amount))
        .join(CompanyInvestment, CompanyInvestment.id == InvestmentReturn.investment_id)
        .where(InvestmentReturn.organization_id == org, InvestmentReturn.return_date >= start, InvestmentReturn.return_date <= end)
        .group_by(CompanyInvestment.currency)
    ).all()
    for code, amount in investment_rows:
        bucket(code)["investment_income"] += money(amount)

    interest_rows = db.execute(
        select(CompanyLoan.currency, func.sum(LoanRepayment.interest_amount))
        .join(CompanyLoan, CompanyLoan.id == LoanRepayment.loan_id)
        .where(LoanRepayment.organization_id == org, LoanRepayment.payment_date >= start, LoanRepayment.payment_date <= end)
        .group_by(CompanyLoan.currency)
    ).all()
    for code, amount in interest_rows:
        bucket(code)["loan_interest"] += money(amount)

    project_share_rows = db.execute(
        select(ProjectInvestor.currency, func.sum(InvestorPayout.profit_share_amount))
        .join(ProjectInvestor, ProjectInvestor.id == InvestorPayout.investor_id)
        .where(InvestorPayout.organization_id == org, InvestorPayout.payout_date >= start, InvestorPayout.payout_date <= end)
        .group_by(ProjectInvestor.currency)
    ).all()
    for code, amount in project_share_rows:
        bucket(code)["investor_profit_share"] += money(amount)

    company_share_rows = db.execute(
        select(CompanyInvestor.currency, func.sum(CompanyInvestorPayout.profit_share_amount))
        .join(CompanyInvestor, CompanyInvestor.id == CompanyInvestorPayout.investor_id)
        .where(CompanyInvestorPayout.organization_id == org, CompanyInvestorPayout.payout_date >= start, CompanyInvestorPayout.payout_date <= end)
        .group_by(CompanyInvestor.currency)
    ).all()
    for code, amount in company_share_rows:
        bucket(code)["investor_profit_share"] += money(amount)

    pnl = []
    for code, values in sorted(data.items()):
        impact = money(values["investment_income"] - values["loan_interest"] - values["investor_profit_share"])
        pnl.append({"currency": code, **{k: money(v) for k, v in values.items()}, "net_capital_pnl_impact": impact})

    project_rows = db.scalars(select(Project).where(Project.organization_id == org).order_by(Project.created_at.desc()).limit(200)).all()
    settlements = []
    for project in project_rows:
        investors = db.scalars(select(ProjectInvestor).where(ProjectInvestor.organization_id == org, ProjectInvestor.project_id == project.id).order_by(ProjectInvestor.created_at.asc())).all()
        if not investors:
            continue
        revenue = money(db.scalar(select(func.coalesce(func.sum(Invoice.total), 0)).where(Invoice.organization_id == org, Invoice.project_id == project.id, Invoice.status != "cancelled")) or 0)
        direct_cost = money(db.scalar(
            select(func.coalesce(func.sum(Expense.profitability_amount), 0))
            .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
            .where(Expense.organization_id == org, Expense.project_id == project.id, Expense.status == "posted", ExpenseCategory.cost_type == "direct")
        ) or 0)
        project_profit = money(revenue - direct_cost)
        investor_rows = []
        total_entitlement = Decimal("0")
        total_paid_profit = Decimal("0")
        for investor in investors:
            entitled = entitlement(project_profit, revenue, investor)
            principal_paid, profit_paid = db.execute(
                select(func.coalesce(func.sum(InvestorPayout.principal_return_amount), 0), func.coalesce(func.sum(InvestorPayout.profit_share_amount), 0))
                .where(InvestorPayout.organization_id == org, InvestorPayout.investor_id == investor.id)
            ).one()
            principal_paid = money(principal_paid); profit_paid = money(profit_paid)
            total_entitlement += entitled; total_paid_profit += profit_paid
            investor_rows.append({
                "investor_id": investor.id,
                "investor_name": investor.investor_name,
                "share_type": investor.share_type,
                "share_value": investor.share_value,
                "committed_amount": investor.committed_amount,
                "funded_amount": investor.funded_amount,
                "principal_returned": principal_paid,
                "principal_remaining": money(max(Decimal(investor.funded_amount) - principal_paid, Decimal("0"))),
                "profit_entitlement": entitled,
                "profit_paid": profit_paid,
                "profit_remaining": money(max(entitled - profit_paid, Decimal("0"))),
                "status": investor.status,
            })
        settlements.append({
            "project_id": project.id,
            "project_number": project.project_number,
            "project_name": project.name,
            "currency": project.currency,
            "status": project.status,
            "revenue": revenue,
            "direct_cost": direct_cost,
            "project_profit": project_profit,
            "total_investor_profit_entitlement": money(total_entitlement),
            "total_investor_profit_paid": money(total_paid_profit),
            "company_retained_profit": money(project_profit - total_entitlement),
            "investors": investor_rows,
        })

    return {"date_from": start, "date_to": end, "overdue_loans": int(overdue_loans), "capital_pnl": pnl, "project_settlements": settlements}
