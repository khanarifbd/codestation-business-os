from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.reports import (
    PLATFORM_FEE_SLUGS,
    _account_balances,
    _currency_filter,
    _expense_scope,
    _invoice_scope,
    _period,
    _tenant_today,
)
from app.models.crm import Client, Lead, LeadStatus
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import AccountTransfer, Invoice, Payment
from app.models.orders import Order
from app.models.payroll import PayrollPeriod, PayrollRun
from app.models.projects import Project, ProjectTask
from app.schemas.reports import (
    ReportClientRow,
    ReportFinancialRow,
    ReportOperationalSummary,
    ReportProjectRow,
    ReportsOverview,
    ReportTrendRow,
)
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/reports", tags=["Reports"])
ReportsViewer = Annotated[TenantContext, Depends(require_tenant_permission("reports.view"))]
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _financials_and_trend_fast(
    db: DbSession,
    org_id: str,
    start: date,
    end: date,
    currency: str | None,
    client_id: str | None,
    project_id: str | None,
) -> tuple[list[ReportFinancialRow], list[ReportTrendRow]]:
    financial_data: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    trend_data: dict[tuple[str, str], dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))

    invoice_period = func.to_char(func.date_trunc("month", Invoice.issue_date), "YYYY-MM")
    invoice_query = _invoice_scope(
        select(
            invoice_period,
            Invoice.currency,
            func.sum(Invoice.total),
            func.sum(Invoice.balance_due),
        ).group_by(invoice_period, Invoice.currency),
        org_id,
        start,
        end,
        currency,
        client_id,
        project_id,
    )
    for month, code, total, receivable in db.execute(invoice_query).all():
        total_amount = _money(total)
        receivable_amount = _money(receivable)
        financial_data[code]["invoiced"] += total_amount
        financial_data[code]["receivable"] += receivable_amount
        trend_data[(month, code)]["invoiced"] += total_amount

    payment_period = func.to_char(func.date_trunc("month", Payment.payment_date), "YYYY-MM")
    payment_query = (
        select(
            payment_period,
            Payment.invoice_currency,
            func.sum(Payment.invoice_amount),
        )
        .join(Invoice, Invoice.id == Payment.invoice_id)
        .where(
            Payment.organization_id == org_id,
            Payment.payment_date >= start,
            Payment.payment_date <= end,
            Payment.status == "confirmed",
        )
        .group_by(payment_period, Payment.invoice_currency)
    )
    if currency:
        payment_query = payment_query.where(Payment.invoice_currency == currency)
    if client_id:
        payment_query = payment_query.where(Invoice.client_id == client_id)
    if project_id:
        payment_query = payment_query.where(Invoice.project_id == project_id)
    for month, code, amount in db.execute(payment_query).all():
        collected = _money(amount)
        financial_data[code]["collected"] += collected
        trend_data[(month, code)]["collected"] += collected

    expense_period = func.to_char(func.date_trunc("month", Expense.expense_date), "YYYY-MM")
    expense_query = _expense_scope(
        select(
            expense_period,
            Expense.expense_currency,
            func.sum(Expense.expense_amount),
            func.sum(case((ExpenseCategory.slug.in_(PLATFORM_FEE_SLUGS), Expense.expense_amount), else_=0)),
        )
        .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
        .group_by(expense_period, Expense.expense_currency),
        org_id,
        start,
        end,
        currency,
        client_id,
        project_id,
    )
    for month, code, amount, platform in db.execute(expense_query).all():
        expense_amount = _money(amount)
        financial_data[code]["expenses"] += expense_amount
        financial_data[code]["platform"] += _money(platform)
        trend_data[(month, code)]["expenses"] += expense_amount

    if not client_id and not project_id:
        payroll_period = func.to_char(func.date_trunc("month", PayrollPeriod.period_end), "YYYY-MM")
        payroll_query = (
            select(
                payroll_period,
                PayrollRun.currency,
                func.sum(PayrollRun.gross_total),
            )
            .join(PayrollPeriod, PayrollPeriod.id == PayrollRun.period_id)
            .where(
                PayrollRun.organization_id == org_id,
                PayrollRun.status.in_(["approved", "paid"]),
                PayrollPeriod.period_end >= start,
                PayrollPeriod.period_end <= end,
            )
            .group_by(payroll_period, PayrollRun.currency)
        )
        if currency:
            payroll_query = payroll_query.where(PayrollRun.currency == currency)
        for month, code, amount in db.execute(payroll_query).all():
            payroll_amount = _money(amount)
            financial_data[code]["expenses"] += payroll_amount
            trend_data[(month, code)]["expenses"] += payroll_amount

        transfer_period = func.to_char(func.date_trunc("month", AccountTransfer.transfer_date), "YYYY-MM")
        transfer_query = (
            select(
                transfer_period,
                AccountTransfer.source_currency,
                func.sum(AccountTransfer.fee_amount),
            )
            .where(
                AccountTransfer.organization_id == org_id,
                AccountTransfer.transfer_date >= start,
                AccountTransfer.transfer_date <= end,
                AccountTransfer.status == "confirmed",
                AccountTransfer.fee_amount > 0,
            )
            .group_by(transfer_period, AccountTransfer.source_currency)
        )
        if currency:
            transfer_query = transfer_query.where(AccountTransfer.source_currency == currency)
        for month, code, amount in db.execute(transfer_query).all():
            transfer_amount = _money(amount)
            financial_data[code]["transfer"] += transfer_amount
            trend_data[(month, code)]["transfer"] += transfer_amount

    financials = [
        ReportFinancialRow(
            currency=code,
            invoiced_revenue=_money(values["invoiced"]),
            collected_revenue=_money(values["collected"]),
            receivables=_money(values["receivable"]),
            expenses=_money(values["expenses"]),
            platform_fees=_money(values["platform"]),
            transfer_fees=_money(values["transfer"]),
            net_profit=_money(values["invoiced"] - values["expenses"] - values["transfer"]),
        )
        for code, values in sorted(financial_data.items())
    ]
    trend = [
        ReportTrendRow(
            period=month,
            currency=code,
            invoiced_revenue=_money(values["invoiced"]),
            collected_revenue=_money(values["collected"]),
            expenses=_money(values["expenses"]),
            transfer_fees=_money(values["transfer"]),
            net_profit=_money(values["invoiced"] - values["expenses"] - values["transfer"]),
        )
        for (month, code), values in sorted(trend_data.items())
    ]
    return financials, trend


def _operations_fast(db: DbSession, org_id: str, timezone_name: str) -> ReportOperationalSummary:
    today = _tenant_today(timezone_name)
    now = datetime.now(timezone.utc)

    active_clients = (
        select(func.count(Client.id))
        .where(Client.organization_id == org_id, Client.status == "active")
        .scalar_subquery()
    )
    open_orders = (
        select(func.count(Order.id))
        .where(Order.organization_id == org_id, Order.status.not_in(["completed", "cancelled"]))
        .scalar_subquery()
    )
    active_projects = (
        select(func.count(Project.id))
        .where(Project.organization_id == org_id, Project.status.in_(["planned", "active", "on_hold"]))
        .scalar_subquery()
    )
    overdue_tasks = (
        select(func.count(ProjectTask.id))
        .where(
            ProjectTask.organization_id == org_id,
            ProjectTask.due_date < today,
            ProjectTask.status.not_in(["completed", "cancelled"]),
        )
        .scalar_subquery()
    )
    due_followups = (
        select(func.count(Lead.id))
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(
            Lead.organization_id == org_id,
            Lead.next_follow_up_at.is_not(None),
            Lead.next_follow_up_at <= now,
            LeadStatus.category == "open",
        )
        .scalar_subquery()
    )
    open_invoices = (
        select(func.count(Invoice.id))
        .where(Invoice.organization_id == org_id, Invoice.status.not_in(["paid", "cancelled"]))
        .scalar_subquery()
    )

    row = db.execute(
        select(
            active_clients.label("active_clients"),
            open_orders.label("open_orders"),
            active_projects.label("active_projects"),
            overdue_tasks.label("overdue_tasks"),
            due_followups.label("due_followups"),
            open_invoices.label("open_invoices"),
        )
    ).one()
    return ReportOperationalSummary(
        active_clients=int(row.active_clients or 0),
        open_orders=int(row.open_orders or 0),
        active_projects=int(row.active_projects or 0),
        overdue_tasks=int(row.overdue_tasks or 0),
        due_followups=int(row.due_followups or 0),
        open_invoices=int(row.open_invoices or 0),
    )


def _project_rows_fast(
    db: DbSession,
    org_id: str,
    start: date,
    end: date,
    currency: str | None,
    client_id: str | None,
    project_id: str | None,
) -> list[ReportProjectRow]:
    project_query = (
        select(Project, Client.display_name)
        .join(Client, Client.id == Project.client_id)
        .where(Project.organization_id == org_id)
    )
    if currency:
        project_query = project_query.where(Project.currency == currency)
    if client_id:
        project_query = project_query.where(Project.client_id == client_id)
    if project_id:
        project_query = project_query.where(Project.id == project_id)

    project_rows = db.execute(project_query.order_by(Project.created_at.desc()).limit(100)).all()
    if not project_rows:
        return []
    project_ids = [project.id for project, _ in project_rows]

    invoiced_map = dict(
        db.execute(
            select(Invoice.project_id, func.coalesce(func.sum(Invoice.total), 0))
            .where(
                Invoice.organization_id == org_id,
                Invoice.project_id.in_(project_ids),
                Invoice.issue_date >= start,
                Invoice.issue_date <= end,
                Invoice.status != "cancelled",
            )
            .group_by(Invoice.project_id)
        ).all()
    )
    collected_map = dict(
        db.execute(
            select(Invoice.project_id, func.coalesce(func.sum(Payment.invoice_amount), 0))
            .join(Invoice, Invoice.id == Payment.invoice_id)
            .where(
                Payment.organization_id == org_id,
                Invoice.project_id.in_(project_ids),
                Payment.payment_date >= start,
                Payment.payment_date <= end,
                Payment.status == "confirmed",
            )
            .group_by(Invoice.project_id)
        ).all()
    )
    direct_map = dict(
        db.execute(
            select(Expense.project_id, func.coalesce(func.sum(Expense.profitability_amount), 0))
            .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
            .where(
                Expense.organization_id == org_id,
                Expense.project_id.in_(project_ids),
                Expense.expense_date >= start,
                Expense.expense_date <= end,
                Expense.status == "posted",
                ExpenseCategory.cost_type == "direct",
            )
            .group_by(Expense.project_id)
        ).all()
    )

    rows: list[ReportProjectRow] = []
    for project, client_name in project_rows:
        invoiced = _money(invoiced_map.get(project.id, 0))
        collected = _money(collected_map.get(project.id, 0))
        direct = _money(direct_map.get(project.id, 0))
        profit = _money(invoiced - direct)
        margin = _money((profit / invoiced) * 100) if invoiced > 0 else None
        rows.append(
            ReportProjectRow(
                project_id=project.id,
                project_number=project.project_number,
                project_name=project.name,
                client_name=client_name,
                currency=project.currency,
                contract_value=_money(project.contract_value),
                invoiced_revenue=invoiced,
                collected_revenue=collected,
                direct_expenses=direct,
                estimated_profit=profit,
                margin_percent=margin,
            )
        )
    return rows


def _client_rows_fast(
    db: DbSession,
    org_id: str,
    start: date,
    end: date,
    currency: str | None,
    client_id: str | None,
) -> list[ReportClientRow]:
    client_query = select(Client).where(Client.organization_id == org_id)
    if client_id:
        client_query = client_query.where(Client.id == client_id)
    clients = db.scalars(client_query.order_by(Client.display_name).limit(100)).all()
    if not clients:
        return []
    client_ids = [client.id for client in clients]
    client_map = {client.id: client for client in clients}

    invoice_query = (
        select(Invoice.client_id, Invoice.currency, func.coalesce(func.sum(Invoice.total), 0))
        .where(
            Invoice.organization_id == org_id,
            Invoice.client_id.in_(client_ids),
            Invoice.issue_date >= start,
            Invoice.issue_date <= end,
            Invoice.status != "cancelled",
        )
        .group_by(Invoice.client_id, Invoice.currency)
    )
    payment_query = (
        select(Invoice.client_id, Payment.invoice_currency, func.coalesce(func.sum(Payment.invoice_amount), 0))
        .join(Invoice, Invoice.id == Payment.invoice_id)
        .where(
            Payment.organization_id == org_id,
            Invoice.client_id.in_(client_ids),
            Payment.payment_date >= start,
            Payment.payment_date <= end,
            Payment.status == "confirmed",
        )
        .group_by(Invoice.client_id, Payment.invoice_currency)
    )
    expense_query = (
        select(Expense.client_id, Expense.profitability_currency, func.coalesce(func.sum(Expense.profitability_amount), 0))
        .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
        .where(
            Expense.organization_id == org_id,
            Expense.client_id.in_(client_ids),
            Expense.expense_date >= start,
            Expense.expense_date <= end,
            Expense.status == "posted",
            ExpenseCategory.cost_type == "direct",
        )
        .group_by(Expense.client_id, Expense.profitability_currency)
    )
    if currency:
        invoice_query = invoice_query.where(Invoice.currency == currency)
        payment_query = payment_query.where(Payment.invoice_currency == currency)
        expense_query = expense_query.where(Expense.profitability_currency == currency)

    aggregates: dict[tuple[str, str], dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for cid, code, amount in db.execute(invoice_query).all():
        if cid and code:
            aggregates[(cid, code)]["invoiced"] += _money(amount)
    for cid, code, amount in db.execute(payment_query).all():
        if cid and code:
            aggregates[(cid, code)]["collected"] += _money(amount)
    for cid, code, amount in db.execute(expense_query).all():
        if cid and code:
            aggregates[(cid, code)]["direct"] += _money(amount)

    rows: list[ReportClientRow] = []
    for (cid, code), values in sorted(aggregates.items(), key=lambda item: (client_map[item[0][0]].display_name, item[0][1])):
        client = client_map[cid]
        invoiced = _money(values["invoiced"])
        collected = _money(values["collected"])
        direct = _money(values["direct"])
        if invoiced == 0 and collected == 0 and direct == 0:
            continue
        profit = _money(invoiced - direct)
        margin = _money((profit / invoiced) * 100) if invoiced > 0 else None
        rows.append(
            ReportClientRow(
                client_id=client.id,
                client_name=client.display_name,
                currency=code,
                invoiced_revenue=invoiced,
                collected_revenue=collected,
                direct_expenses=direct,
                estimated_profit=profit,
                margin_percent=margin,
            )
        )
    return rows


@router.get("/overview", response_model=ReportsOverview)
def reports_overview_fast(
    db: DbSession,
    tenant: ReportsViewer,
    date_from: date | None = None,
    date_to: date | None = None,
    currency: str | None = Query(default=None, min_length=3, max_length=3),
    client_id: str | None = None,
    project_id: str | None = None,
) -> ReportsOverview:
    start, end = _period(date_from, date_to, tenant.organization.timezone)
    code = _currency_filter(currency)
    if client_id and db.scalar(select(Client.id).where(Client.id == client_id, Client.organization_id == tenant.organization_id)) is None:
        raise HTTPException(status_code=404, detail="Client not found")
    if project_id and db.scalar(select(Project.id).where(Project.id == project_id, Project.organization_id == tenant.organization_id)) is None:
        raise HTTPException(status_code=404, detail="Project not found")

    financials, trend = _financials_and_trend_fast(
        db,
        tenant.organization_id,
        start,
        end,
        code,
        client_id,
        project_id,
    )
    return ReportsOverview(
        date_from=start,
        date_to=end,
        financials=financials,
        trend=trend,
        accounts=_account_balances(db, tenant.organization_id, code),
        operations=_operations_fast(db, tenant.organization_id, tenant.organization.timezone),
        projects=_project_rows_fast(db, tenant.organization_id, start, end, code, client_id, project_id),
        clients=_client_rows_fast(db, tenant.organization_id, start, end, code, client_id),
    )
