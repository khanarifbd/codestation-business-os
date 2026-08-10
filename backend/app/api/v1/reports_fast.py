from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.reports import _account_balances, _currency_filter, _financials, _operations, _period, _trend
from app.models.crm import Client
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import Invoice, Payment
from app.models.projects import Project
from app.schemas.reports import ReportClientRow, ReportProjectRow, ReportsOverview
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/reports", tags=["Reports"])
ReportsViewer = Annotated[TenantContext, Depends(require_tenant_permission("reports.view"))]
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


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
    return ReportsOverview(
        date_from=start,
        date_to=end,
        financials=_financials(db, tenant.organization_id, start, end, code, client_id, project_id),
        trend=_trend(db, tenant.organization_id, start, end, code, client_id, project_id),
        accounts=_account_balances(db, tenant.organization_id, code),
        operations=_operations(db, tenant.organization_id, tenant.organization.timezone),
        projects=_project_rows_fast(db, tenant.organization_id, start, end, code, client_id, project_id),
        clients=_client_rows_fast(db, tenant.organization_id, start, end, code, client_id),
    )
