from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client, Lead, LeadStatus
from app.models.finance import Invoice, Payment
from app.models.membership import Membership
from app.models.orders import Order
from app.models.projects import Project
from app.models.sales import Quotation
from app.models.team import Employee, OrganizationRole
from app.models.user import User
from app.schemas.client_detail import ClientDetailRead
from app.schemas.client_workspace import (
    ClientCurrencyAmount,
    ClientInvoiceCurrencySummary,
    ClientInvoiceSummary,
    ClientOrderSummary,
    ClientPaymentSummary,
    ClientProjectSummary,
    ClientQuotationSummary,
    ClientTimelineEvent,
    ClientWorkspaceAccess,
    ClientWorkspaceCounts,
    ClientWorkspaceRead,
)
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm", tags=["CRM Clients"])
ClientViewer = Annotated[TenantContext, Depends(require_tenant_permission("clients.view"))]


def _tenant_today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _can(permissions: set[str], permission: str) -> bool:
    return "*" in permissions or permission in permissions


def _client_detail(db: DbSession, organization_id: str, client_id: str) -> ClientDetailRead:
    employee_alias = aliased(Employee)
    membership_alias = aliased(Membership)
    user_alias = aliased(User)
    row = db.execute(
        select(Client, user_alias.full_name)
        .outerjoin(employee_alias, employee_alias.id == Client.assigned_employee_id)
        .outerjoin(membership_alias, membership_alias.id == employee_alias.membership_id)
        .outerjoin(user_alias, user_alias.id == membership_alias.user_id)
        .where(Client.id == client_id, Client.organization_id == organization_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    client, assigned_name = row

    source = db.execute(
        select(Lead.id, Lead.lead_code, LeadStatus.name)
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(
            Lead.organization_id == organization_id,
            Lead.converted_client_id == client.id,
        )
        .order_by(Lead.converted_at.desc().nullslast(), Lead.created_at.desc())
        .limit(1)
    ).first()

    return ClientDetailRead(
        id=client.id,
        client_code=client.client_code,
        client_type=client.client_type,
        display_name=client.display_name,
        legal_name=client.legal_name,
        contact_name=client.contact_name,
        email=client.email,
        billing_email=client.billing_email,
        phone=client.phone,
        whatsapp=client.whatsapp,
        website=client.website,
        country_code=client.country_code,
        state_region=client.state_region,
        city=client.city,
        postal_code=client.postal_code,
        address_line1=client.address_line1,
        address_line2=client.address_line2,
        tax_identifier=client.tax_identifier,
        currency=client.currency,
        assigned_employee_id=client.assigned_employee_id,
        assigned_employee_name=assigned_name,
        status=client.status,
        notes=client.notes,
        source_lead_id=source.id if source else None,
        source_lead_code=source.lead_code if source else None,
        source_lead_status=source.name if source else None,
        created_at=client.created_at,
        updated_at=client.updated_at,
    )


def _invoice_display_status(invoice: Invoice, today) -> str:
    if invoice.status in {"draft", "cancelled", "paid"}:
        return invoice.status
    if invoice.balance_due > 0 and invoice.due_date and invoice.due_date < today:
        return "overdue"
    return invoice.status


@router.get("/clients/{client_id}/workspace", response_model=ClientWorkspaceRead)
def get_client_workspace(
    client_id: str,
    db: DbSession,
    tenant: ClientViewer,
    limit: Annotated[int, Query(ge=5, le=100)] = 30,
) -> ClientWorkspaceRead:
    organization_id = tenant.organization_id
    client = _client_detail(db, organization_id, client_id)

    role = db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == tenant.membership.role_id,
            OrganizationRole.organization_id == organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )
    permissions = set(role.permissions or []) if role else set()
    access = ClientWorkspaceAccess(
        quotations=_can(permissions, "quotations.view"),
        orders=_can(permissions, "orders.view"),
        projects=_can(permissions, "projects.view"),
        finance=_can(permissions, "finance.view"),
    )
    counts = ClientWorkspaceCounts()
    business_value: list[ClientCurrencyAmount] = []
    invoice_summary: list[ClientInvoiceCurrencySummary] = []
    quotations: list[ClientQuotationSummary] = []
    orders: list[ClientOrderSummary] = []
    projects: list[ClientProjectSummary] = []
    invoices: list[ClientInvoiceSummary] = []
    payments: list[ClientPaymentSummary] = []
    timeline: list[ClientTimelineEvent] = [
        ClientTimelineEvent(
            kind="client",
            title="Client relationship created",
            subtitle=f"{client.client_code} · {client.display_name}",
            occurred_at=client.created_at,
            href=f"/dashboard/clients/{client.id}",
        )
    ]

    if access.quotations:
        counts.quotations = db.scalar(
            select(func.count(Quotation.id)).where(
                Quotation.organization_id == organization_id,
                Quotation.client_id == client_id,
            )
        ) or 0
        quotation_rows = db.scalars(
            select(Quotation)
            .where(Quotation.organization_id == organization_id, Quotation.client_id == client_id)
            .order_by(Quotation.created_at.desc())
            .limit(limit)
        ).all()
        quotations = [
            ClientQuotationSummary(
                id=item.id,
                quotation_number=item.quotation_number,
                status=item.status,
                subject=item.subject,
                issue_date=item.issue_date,
                valid_until=item.valid_until,
                currency=item.currency,
                total=item.total,
                created_at=item.created_at,
            )
            for item in quotation_rows
        ]
        timeline.extend(
            ClientTimelineEvent(
                kind="quotation",
                title=f"Quotation {item.quotation_number}",
                subtitle=f"{item.status.title()} · {item.currency} {item.total:,.2f}",
                occurred_at=item.created_at,
                href=f"/dashboard/quotations?quotation_id={item.id}",
            )
            for item in quotation_rows[:10]
        )

    if access.orders:
        counts.orders = db.scalar(
            select(func.count(Order.id)).where(Order.organization_id == organization_id, Order.client_id == client_id)
        ) or 0
        order_rows = db.scalars(
            select(Order)
            .where(Order.organization_id == organization_id, Order.client_id == client_id)
            .order_by(Order.created_at.desc())
            .limit(limit)
        ).all()
        orders = [
            ClientOrderSummary(
                id=item.id,
                order_number=item.order_number,
                quotation_id=item.quotation_id,
                status=item.status,
                subject=item.subject,
                order_date=item.order_date,
                currency=item.currency,
                total=item.total,
                created_at=item.created_at,
            )
            for item in order_rows
        ]
        value_rows = db.execute(
            select(Order.currency, func.coalesce(func.sum(Order.total), 0))
            .where(
                Order.organization_id == organization_id,
                Order.client_id == client_id,
                Order.status != "cancelled",
            )
            .group_by(Order.currency)
            .order_by(Order.currency.asc())
        ).all()
        business_value = [ClientCurrencyAmount(currency=currency, amount=Decimal(total or 0)) for currency, total in value_rows]
        timeline.extend(
            ClientTimelineEvent(
                kind="order",
                title=f"Order {item.order_number}",
                subtitle=f"{item.status.title()} · {item.currency} {item.total:,.2f}",
                occurred_at=item.created_at,
                href="/dashboard/orders",
            )
            for item in order_rows[:10]
        )

    if access.projects:
        project_count, active_project_count = db.execute(
            select(
                func.count(Project.id),
                func.count(Project.id).filter(Project.status.notin_(["completed", "cancelled"])),
            ).where(Project.organization_id == organization_id, Project.client_id == client_id)
        ).one()
        counts.projects = project_count or 0
        counts.active_projects = active_project_count or 0
        project_rows = db.scalars(
            select(Project)
            .where(Project.organization_id == organization_id, Project.client_id == client_id)
            .order_by(Project.created_at.desc())
            .limit(limit)
        ).all()
        projects = [
            ClientProjectSummary(
                id=item.id,
                project_number=item.project_number,
                order_id=item.order_id,
                quotation_id=item.quotation_id,
                name=item.name,
                status=item.status,
                priority=item.priority,
                progress_percent=item.progress_percent,
                due_date=item.due_date,
                currency=item.currency,
                contract_value=item.contract_value,
                created_at=item.created_at,
            )
            for item in project_rows
        ]
        timeline.extend(
            ClientTimelineEvent(
                kind="project",
                title=f"Project {item.project_number}",
                subtitle=f"{item.name} · {item.status.title()} · {item.progress_percent}%",
                occurred_at=item.created_at,
                href=f"/dashboard/projects/{item.id}",
            )
            for item in project_rows[:10]
        )

    if access.finance:
        today = _tenant_today(tenant.organization.timezone)
        invoice_count, overdue_count = db.execute(
            select(
                func.count(Invoice.id),
                func.count(Invoice.id).filter(
                    Invoice.status.notin_(["draft", "cancelled", "paid"]),
                    Invoice.balance_due > 0,
                    Invoice.due_date.is_not(None),
                    Invoice.due_date < today,
                ),
            ).where(Invoice.organization_id == organization_id, Invoice.client_id == client_id)
        ).one()
        counts.invoices = invoice_count or 0
        counts.overdue_invoices = overdue_count or 0

        invoice_rows = db.scalars(
            select(Invoice)
            .where(Invoice.organization_id == organization_id, Invoice.client_id == client_id)
            .order_by(Invoice.created_at.desc())
            .limit(limit)
        ).all()
        invoices = [
            ClientInvoiceSummary(
                id=item.id,
                invoice_number=item.invoice_number,
                order_id=item.order_id,
                project_id=item.project_id,
                status=item.status,
                display_status=_invoice_display_status(item, today),
                subject=item.subject,
                issue_date=item.issue_date,
                due_date=item.due_date,
                currency=item.currency,
                total=item.total,
                amount_paid=item.amount_paid,
                balance_due=item.balance_due,
                created_at=item.created_at,
            )
            for item in invoice_rows
        ]

        summary_rows = db.execute(
            select(
                Invoice.currency,
                func.coalesce(func.sum(Invoice.total), 0),
                func.coalesce(func.sum(Invoice.amount_paid), 0),
                func.coalesce(func.sum(Invoice.balance_due), 0),
            )
            .where(
                Invoice.organization_id == organization_id,
                Invoice.client_id == client_id,
                Invoice.status.notin_(["draft", "cancelled"]),
            )
            .group_by(Invoice.currency)
            .order_by(Invoice.currency.asc())
        ).all()
        invoice_summary = [
            ClientInvoiceCurrencySummary(
                currency=currency,
                invoiced=Decimal(invoiced or 0),
                paid=Decimal(paid or 0),
                outstanding=Decimal(outstanding or 0),
            )
            for currency, invoiced, paid, outstanding in summary_rows
        ]

        payment_rows = db.execute(
            select(Payment, Invoice.invoice_number)
            .join(Invoice, Invoice.id == Payment.invoice_id)
            .where(
                Payment.organization_id == organization_id,
                Invoice.organization_id == organization_id,
                Invoice.client_id == client_id,
            )
            .order_by(Payment.created_at.desc())
            .limit(limit)
        ).all()
        payments = [
            ClientPaymentSummary(
                id=payment.id,
                payment_number=payment.payment_number,
                invoice_id=payment.invoice_id,
                invoice_number=invoice_number,
                payment_date=payment.payment_date,
                invoice_currency=payment.invoice_currency,
                invoice_amount=payment.invoice_amount,
                account_currency=payment.account_currency,
                account_amount=payment.account_amount,
                method=payment.method,
                reference=payment.reference,
                created_at=payment.created_at,
            )
            for payment, invoice_number in payment_rows
        ]
        timeline.extend(
            ClientTimelineEvent(
                kind="invoice",
                title=f"Invoice {item.invoice_number}",
                subtitle=f"{_invoice_display_status(item, today).title()} · {item.currency} {item.total:,.2f}",
                occurred_at=item.created_at,
                href=f"/dashboard/finance/invoices/{item.id}",
            )
            for item in invoice_rows[:10]
        )
        timeline.extend(
            ClientTimelineEvent(
                kind="payment",
                title=f"Payment {payment.payment_number}",
                subtitle=f"{payment.invoice_currency} {payment.invoice_amount:,.2f} · {invoice_number}",
                occurred_at=payment.created_at,
                href=f"/dashboard/finance/invoices/{payment.invoice_id}",
            )
            for payment, invoice_number in payment_rows[:10]
        )

    timeline.sort(key=lambda item: item.occurred_at, reverse=True)

    return ClientWorkspaceRead(
        client=client,
        access=access,
        counts=counts,
        business_value=business_value,
        invoice_summary=invoice_summary,
        quotations=quotations,
        orders=orders,
        projects=projects,
        invoices=invoices,
        payments=payments,
        timeline=timeline[:40],
    )
