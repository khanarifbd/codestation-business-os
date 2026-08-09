from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client, Lead, LeadStatus
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import AccountTransfer, FinancialAccount, FinancialTransaction, Invoice, Payment
from app.models.orders import Order
from app.models.payroll import PayrollPeriod, PayrollRun
from app.models.projects import Project, ProjectTask
from app.schemas.reports import (
    ReportAccountBalance,
    ReportClientRow,
    ReportFinancialRow,
    ReportMetaItem,
    ReportOperationalSummary,
    ReportProjectRow,
    ReportsMeta,
    ReportsOverview,
    ReportTrendRow,
)
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/reports", tags=["Reports"])
ReportsViewer = Annotated[TenantContext, Depends(require_tenant_permission("reports.view"))]
MONEY = Decimal("0.01")
PLATFORM_FEE_SLUGS = {"marketplace-platform-fees", "marketplace-platform-fee", "platform-fees", "platform-fee"}


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _tenant_today(timezone_name: str) -> date:
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except Exception:
        return datetime.now(timezone.utc).date()


def _period(date_from: date | None, date_to: date | None, timezone_name: str) -> tuple[date, date]:
    today = _tenant_today(timezone_name)
    start = date_from or today.replace(day=1)
    end = date_to or today
    if end < start:
        raise HTTPException(status_code=400, detail="Date to cannot be before date from")
    return start, end


def _currency_filter(value: str | None) -> str | None:
    return value.strip().upper() if value else None


def _invoice_scope(query, org_id: str, start: date, end: date, currency: str | None, client_id: str | None, project_id: str | None):
    query = query.where(
        Invoice.organization_id == org_id,
        Invoice.issue_date >= start,
        Invoice.issue_date <= end,
        Invoice.status != "cancelled",
    )
    if currency:
        query = query.where(Invoice.currency == currency)
    if client_id:
        query = query.where(Invoice.client_id == client_id)
    if project_id:
        query = query.where(Invoice.project_id == project_id)
    return query


def _expense_scope(query, org_id: str, start: date, end: date, currency: str | None, client_id: str | None, project_id: str | None):
    query = query.where(
        Expense.organization_id == org_id,
        Expense.expense_date >= start,
        Expense.expense_date <= end,
        Expense.status == "posted",
    )
    if currency:
        query = query.where(Expense.expense_currency == currency)
    if client_id:
        query = query.where(Expense.client_id == client_id)
    if project_id:
        query = query.where(Expense.project_id == project_id)
    return query


def _account_balances(db: DbSession, org_id: str, currency: str | None) -> list[ReportAccountBalance]:
    tx = (
        select(
            FinancialTransaction.account_id,
            func.coalesce(func.sum(case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)), 0).label("net"),
        )
        .where(FinancialTransaction.organization_id == org_id)
        .group_by(FinancialTransaction.account_id)
        .subquery()
    )
    query = (
        select(FinancialAccount, func.coalesce(tx.c.net, 0))
        .outerjoin(tx, tx.c.account_id == FinancialAccount.id)
        .where(FinancialAccount.organization_id == org_id, FinancialAccount.is_active.is_(True))
        .order_by(FinancialAccount.currency, FinancialAccount.name)
    )
    if currency:
        query = query.where(FinancialAccount.currency == currency)
    return [
        ReportAccountBalance(
            account_id=account.id,
            account_name=account.name,
            account_type=account.account_type,
            currency=account.currency,
            balance=_money(account.opening_balance + Decimal(net or 0)),
        )
        for account, net in db.execute(query).all()
    ]


def _financials(db: DbSession, org_id: str, start: date, end: date, currency: str | None, client_id: str | None, project_id: str | None) -> list[ReportFinancialRow]:
    data: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))

    invoice_query = _invoice_scope(
        select(Invoice.currency, func.sum(Invoice.total), func.sum(Invoice.balance_due)).group_by(Invoice.currency),
        org_id, start, end, currency, client_id, project_id,
    )
    for code, total, receivable in db.execute(invoice_query).all():
        data[code]["invoiced"] += _money(total)
        data[code]["receivable"] += _money(receivable)

    payment_query = (
        select(Payment.invoice_currency, func.sum(Payment.invoice_amount))
        .join(Invoice, Invoice.id == Payment.invoice_id)
        .where(
            Payment.organization_id == org_id,
            Payment.payment_date >= start,
            Payment.payment_date <= end,
            Payment.status == "confirmed",
        )
        .group_by(Payment.invoice_currency)
    )
    if currency:
        payment_query = payment_query.where(Payment.invoice_currency == currency)
    if client_id:
        payment_query = payment_query.where(Invoice.client_id == client_id)
    if project_id:
        payment_query = payment_query.where(Invoice.project_id == project_id)
    for code, amount in db.execute(payment_query).all():
        data[code]["collected"] += _money(amount)

    expense_query = _expense_scope(
        select(
            Expense.expense_currency,
            func.sum(Expense.expense_amount),
            func.sum(case((ExpenseCategory.slug.in_(PLATFORM_FEE_SLUGS), Expense.expense_amount), else_=0)),
        )
        .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
        .group_by(Expense.expense_currency),
        org_id, start, end, currency, client_id, project_id,
    )
    for code, amount, platform in db.execute(expense_query).all():
        data[code]["expenses"] += _money(amount)
        data[code]["platform"] += _money(platform)

    if not client_id and not project_id:
        payroll_query = (
            select(PayrollRun.currency, func.sum(PayrollRun.gross_total))
            .join(PayrollPeriod, PayrollPeriod.id == PayrollRun.period_id)
            .where(
                PayrollRun.organization_id == org_id,
                PayrollRun.status.in_(["approved", "paid"]),
                PayrollPeriod.period_end >= start,
                PayrollPeriod.period_end <= end,
            )
            .group_by(PayrollRun.currency)
        )
        if currency:
            payroll_query = payroll_query.where(PayrollRun.currency == currency)
        for code, amount in db.execute(payroll_query).all():
            data[code]["expenses"] += _money(amount)

        fee_query = (
            select(AccountTransfer.source_currency, func.sum(AccountTransfer.fee_amount))
            .where(
                AccountTransfer.organization_id == org_id,
                AccountTransfer.transfer_date >= start,
                AccountTransfer.transfer_date <= end,
                AccountTransfer.status == "confirmed",
                AccountTransfer.fee_amount > 0,
            )
            .group_by(AccountTransfer.source_currency)
        )
        if currency:
            fee_query = fee_query.where(AccountTransfer.source_currency == currency)
        for code, amount in db.execute(fee_query).all():
            data[code]["transfer"] += _money(amount)

    return [
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
        for code, values in sorted(data.items())
    ]


def _trend(db: DbSession, org_id: str, start: date, end: date, currency: str | None, client_id: str | None, project_id: str | None) -> list[ReportTrendRow]:
    data: dict[tuple[str, str], dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    period = func.to_char(func.date_trunc("month", Invoice.issue_date), "YYYY-MM")
    query = _invoice_scope(
        select(period, Invoice.currency, func.sum(Invoice.total)).group_by(period, Invoice.currency),
        org_id, start, end, currency, client_id, project_id,
    )
    for month, code, amount in db.execute(query).all():
        data[(month, code)]["invoiced"] += _money(amount)

    pay_period = func.to_char(func.date_trunc("month", Payment.payment_date), "YYYY-MM")
    payment_query = (
        select(pay_period, Payment.invoice_currency, func.sum(Payment.invoice_amount))
        .join(Invoice, Invoice.id == Payment.invoice_id)
        .where(Payment.organization_id == org_id, Payment.payment_date >= start, Payment.payment_date <= end, Payment.status == "confirmed")
        .group_by(pay_period, Payment.invoice_currency)
    )
    if currency: payment_query = payment_query.where(Payment.invoice_currency == currency)
    if client_id: payment_query = payment_query.where(Invoice.client_id == client_id)
    if project_id: payment_query = payment_query.where(Invoice.project_id == project_id)
    for month, code, amount in db.execute(payment_query).all():
        data[(month, code)]["collected"] += _money(amount)

    exp_period = func.to_char(func.date_trunc("month", Expense.expense_date), "YYYY-MM")
    expense_query = _expense_scope(
        select(exp_period, Expense.expense_currency, func.sum(Expense.expense_amount)).group_by(exp_period, Expense.expense_currency),
        org_id, start, end, currency, client_id, project_id,
    )
    for month, code, amount in db.execute(expense_query).all():
        data[(month, code)]["expenses"] += _money(amount)

    if not client_id and not project_id:
        payroll_period = func.to_char(func.date_trunc("month", PayrollPeriod.period_end), "YYYY-MM")
        payroll_query = (
            select(payroll_period, PayrollRun.currency, func.sum(PayrollRun.gross_total))
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
            data[(month, code)]["expenses"] += _money(amount)

        tr_period = func.to_char(func.date_trunc("month", AccountTransfer.transfer_date), "YYYY-MM")
        fee_query = select(tr_period, AccountTransfer.source_currency, func.sum(AccountTransfer.fee_amount)).where(
            AccountTransfer.organization_id == org_id,
            AccountTransfer.transfer_date >= start,
            AccountTransfer.transfer_date <= end,
            AccountTransfer.status == "confirmed",
            AccountTransfer.fee_amount > 0,
        ).group_by(tr_period, AccountTransfer.source_currency)
        if currency: fee_query = fee_query.where(AccountTransfer.source_currency == currency)
        for month, code, amount in db.execute(fee_query).all():
            data[(month, code)]["transfer"] += _money(amount)

    return [
        ReportTrendRow(
            period=month,
            currency=code,
            invoiced_revenue=_money(values["invoiced"]),
            collected_revenue=_money(values["collected"]),
            expenses=_money(values["expenses"]),
            transfer_fees=_money(values["transfer"]),
            net_profit=_money(values["invoiced"] - values["expenses"] - values["transfer"]),
        )
        for (month, code), values in sorted(data.items())
    ]


def _operations(db: DbSession, org_id: str, timezone_name: str) -> ReportOperationalSummary:
    today = _tenant_today(timezone_name)
    now = datetime.now(timezone.utc)
    active_clients = db.scalar(select(func.count(Client.id)).where(Client.organization_id == org_id, Client.status == "active")) or 0
    open_orders = db.scalar(select(func.count(Order.id)).where(Order.organization_id == org_id, Order.status.not_in(["completed", "cancelled"]))) or 0
    active_projects = db.scalar(select(func.count(Project.id)).where(Project.organization_id == org_id, Project.status.in_(["planned", "active", "on_hold"]))) or 0
    overdue_tasks = db.scalar(select(func.count(ProjectTask.id)).where(ProjectTask.organization_id == org_id, ProjectTask.due_date < today, ProjectTask.status.not_in(["completed", "cancelled"]))) or 0
    due_followups = db.scalar(
        select(func.count(Lead.id)).join(LeadStatus, LeadStatus.id == Lead.status_id).where(
            Lead.organization_id == org_id,
            Lead.next_follow_up_at.is_not(None),
            Lead.next_follow_up_at <= now,
            LeadStatus.category == "open",
        )
    ) or 0
    open_invoices = db.scalar(select(func.count(Invoice.id)).where(Invoice.organization_id == org_id, Invoice.status.not_in(["paid", "cancelled"]))) or 0
    return ReportOperationalSummary(
        active_clients=int(active_clients), open_orders=int(open_orders), active_projects=int(active_projects),
        overdue_tasks=int(overdue_tasks), due_followups=int(due_followups), open_invoices=int(open_invoices),
    )


def _project_rows(db: DbSession, org_id: str, start: date, end: date, currency: str | None, client_id: str | None, project_id: str | None) -> list[ReportProjectRow]:
    projects = select(Project, Client.display_name).join(Client, Client.id == Project.client_id).where(Project.organization_id == org_id)
    if currency: projects = projects.where(Project.currency == currency)
    if client_id: projects = projects.where(Project.client_id == client_id)
    if project_id: projects = projects.where(Project.id == project_id)
    rows = []
    for project, client_name in db.execute(projects.order_by(Project.created_at.desc()).limit(100)).all():
        invoiced = db.scalar(select(func.coalesce(func.sum(Invoice.total), 0)).where(Invoice.organization_id == org_id, Invoice.project_id == project.id, Invoice.issue_date >= start, Invoice.issue_date <= end, Invoice.status != "cancelled")) or 0
        collected = db.scalar(select(func.coalesce(func.sum(Payment.invoice_amount), 0)).join(Invoice, Invoice.id == Payment.invoice_id).where(Payment.organization_id == org_id, Invoice.project_id == project.id, Payment.payment_date >= start, Payment.payment_date <= end, Payment.status == "confirmed")) or 0
        direct = db.scalar(select(func.coalesce(func.sum(Expense.profitability_amount), 0)).join(ExpenseCategory, ExpenseCategory.id == Expense.category_id).where(Expense.organization_id == org_id, Expense.project_id == project.id, Expense.expense_date >= start, Expense.expense_date <= end, Expense.status == "posted", ExpenseCategory.cost_type == "direct")) or 0
        invoiced_d, collected_d, direct_d = _money(invoiced), _money(collected), _money(direct)
        profit = _money(invoiced_d - direct_d)
        margin = _money((profit / invoiced_d) * 100) if invoiced_d > 0 else None
        rows.append(ReportProjectRow(project_id=project.id, project_number=project.project_number, project_name=project.name, client_name=client_name, currency=project.currency, contract_value=_money(project.contract_value), invoiced_revenue=invoiced_d, collected_revenue=collected_d, direct_expenses=direct_d, estimated_profit=profit, margin_percent=margin))
    return rows


def _client_rows(db: DbSession, org_id: str, start: date, end: date, currency: str | None, client_id: str | None) -> list[ReportClientRow]:
    clients = select(Client).where(Client.organization_id == org_id)
    if client_id: clients = clients.where(Client.id == client_id)
    rows = []
    for client in db.scalars(clients.order_by(Client.display_name).limit(100)).all():
        currencies = [currency] if currency else list(db.scalars(select(Invoice.currency).where(Invoice.organization_id == org_id, Invoice.client_id == client.id).distinct()).all())
        if not currencies and client.currency: currencies = [client.currency]
        for code in currencies:
            invoiced = db.scalar(select(func.coalesce(func.sum(Invoice.total), 0)).where(Invoice.organization_id == org_id, Invoice.client_id == client.id, Invoice.currency == code, Invoice.issue_date >= start, Invoice.issue_date <= end, Invoice.status != "cancelled")) or 0
            collected = db.scalar(select(func.coalesce(func.sum(Payment.invoice_amount), 0)).join(Invoice, Invoice.id == Payment.invoice_id).where(Payment.organization_id == org_id, Invoice.client_id == client.id, Payment.invoice_currency == code, Payment.payment_date >= start, Payment.payment_date <= end, Payment.status == "confirmed")) or 0
            direct = db.scalar(select(func.coalesce(func.sum(Expense.profitability_amount), 0)).join(ExpenseCategory, ExpenseCategory.id == Expense.category_id).where(Expense.organization_id == org_id, Expense.client_id == client.id, Expense.profitability_currency == code, Expense.expense_date >= start, Expense.expense_date <= end, Expense.status == "posted", ExpenseCategory.cost_type == "direct")) or 0
            invoiced_d, collected_d, direct_d = _money(invoiced), _money(collected), _money(direct)
            if invoiced_d == 0 and collected_d == 0 and direct_d == 0: continue
            profit = _money(invoiced_d - direct_d)
            margin = _money((profit / invoiced_d) * 100) if invoiced_d > 0 else None
            rows.append(ReportClientRow(client_id=client.id, client_name=client.display_name, currency=code, invoiced_revenue=invoiced_d, collected_revenue=collected_d, direct_expenses=direct_d, estimated_profit=profit, margin_percent=margin))
    return rows


@router.get("/meta", response_model=ReportsMeta)
def report_meta(db: DbSession, tenant: ReportsViewer) -> ReportsMeta:
    org_id = tenant.organization_id
    currencies = set(db.scalars(select(FinancialAccount.currency).where(FinancialAccount.organization_id == org_id)).all())
    currencies.update(db.scalars(select(Invoice.currency).where(Invoice.organization_id == org_id)).all())
    currencies.update(db.scalars(select(Expense.expense_currency).where(Expense.organization_id == org_id)).all())
    currencies.update(db.scalars(select(PayrollRun.currency).where(PayrollRun.organization_id == org_id)).all())
    clients = db.scalars(select(Client).where(Client.organization_id == org_id).order_by(Client.display_name)).all()
    projects = db.scalars(select(Project).where(Project.organization_id == org_id).order_by(Project.created_at.desc())).all()
    return ReportsMeta(
        currencies=sorted(code for code in currencies if code),
        clients=[ReportMetaItem(id=item.id, label=f"{item.client_code} · {item.display_name}") for item in clients],
        projects=[ReportMetaItem(id=item.id, label=f"{item.project_number} · {item.name}") for item in projects],
    )


@router.get("/overview", response_model=ReportsOverview)
def reports_overview(
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
    return ReportsOverview(
        date_from=start,
        date_to=end,
        financials=_financials(db, tenant.organization_id, start, end, code, client_id, project_id),
        trend=_trend(db, tenant.organization_id, start, end, code, client_id, project_id),
        accounts=_account_balances(db, tenant.organization_id, code),
        operations=_operations(db, tenant.organization_id, tenant.organization.timezone),
        projects=_project_rows(db, tenant.organization_id, start, end, code, client_id, project_id),
        clients=_client_rows(db, tenant.organization_id, start, end, code, client_id),
    )