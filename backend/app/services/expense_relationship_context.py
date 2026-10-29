"""Read-only ancestor closure for the existing expense metadata response.

The independently capped suggestion arrays are unchanged. At most three batched,
tenant-scoped reads supplement their referenced invoices, projects and orders.
Only the existing expense-meta DTO fields are exposed; no document contents,
credentials, internal notes or extra client choices are included.
"""
from __future__ import annotations

from sqlalchemy import and_, select

from app.models.crm import Client
from app.models.finance import Invoice
from app.models.orders import Order
from app.models.projects import Project
from app.schemas.expenses import (
    ExpenseMetaInvoice,
    ExpenseMetaOrder,
    ExpenseMetaProject,
    ExpenseRelationshipContext,
)


def expense_relationship_context(db, organization_id, *, invoices, project_rows, orders, payment_rows):
    invoice_ids = {row.id for row in invoices}
    missing_invoices = sorted({row[0].invoice_id for row in payment_rows} - invoice_ids)
    extra_invoices = db.scalars(
        select(Invoice)
        .where(Invoice.organization_id == organization_id, Invoice.id.in_(missing_invoices))
        .order_by(Invoice.id)
    ).all() if missing_invoices else []

    all_invoices = [*invoices, *extra_invoices]
    project_ids = {row[0].id for row in project_rows}
    missing_projects = sorted({row.project_id for row in all_invoices if row.project_id} - project_ids)
    extra_projects = db.execute(
        select(Project, Client.display_name)
        .join(Client, and_(Client.id == Project.client_id, Client.organization_id == organization_id))
        .where(Project.organization_id == organization_id, Project.id.in_(missing_projects))
        .order_by(Project.id)
    ).all() if missing_projects else []

    order_ids = {row.id for row in orders}
    referenced_orders = {row.order_id for row in all_invoices if row.order_id}
    referenced_orders.update(row[0].order_id for row in [*project_rows, *extra_projects] if row[0].order_id)
    missing_orders = sorted(referenced_orders - order_ids)
    extra_orders = db.scalars(
        select(Order)
        .where(Order.organization_id == organization_id, Order.id.in_(missing_orders))
        .order_by(Order.id)
    ).all() if missing_orders else []

    return ExpenseRelationshipContext(
        invoices=[ExpenseMetaInvoice(
            id=row.id, number=row.invoice_number, client_id=row.client_id,
            client_name=row.client_name_snapshot, order_id=row.order_id,
            project_id=row.project_id, currency=row.currency, total=row.total, status=row.status,
        ) for row in extra_invoices],
        projects=[ExpenseMetaProject(
            id=row.id, number=row.project_number, name=row.name, order_id=row.order_id,
            client_id=row.client_id, client_name=client_name, currency=row.currency, status=row.status,
        ) for row, client_name in extra_projects],
        orders=[ExpenseMetaOrder(
            id=row.id, number=row.order_number, client_id=row.client_id,
            client_name=row.client_name_snapshot, currency=row.currency, total=row.total, status=row.status,
        ) for row in extra_orders],
    )
