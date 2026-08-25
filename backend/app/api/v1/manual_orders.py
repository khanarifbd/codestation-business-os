from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.company_settings import (
    OrganizationAddress,
    OrganizationFinancialSettings,
    OrganizationIdentifier,
    OrganizationProfile,
)
from app.models.crm import Client, Lead
from app.models.orders import Order, OrderItem
from app.models.team import Employee
from app.schemas.orders import ManualOrderCreate, OrderDetail
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.services.sales import calculate_line, calculate_totals
from app.services.sales_catalog import resolve_sales_line
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Orders"])
OrderManager = Annotated[TenantContext, Depends(require_tenant_permission("orders.manage"))]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _address_text(address: OrganizationAddress | None) -> str | None:
    if address is None:
        return None
    parts = [address.line1, address.line2, address.city, address.state_region, address.postal_code, address.country_code]
    value = ", ".join(str(part).strip() for part in parts if part and str(part).strip())
    return value or None


def _client_address_text(client: Client) -> str | None:
    parts = [client.address_line1, client.address_line2, client.city, client.state_region, client.postal_code, client.country_code]
    value = ", ".join(str(part).strip() for part in parts if part and str(part).strip())
    return value or None


def _resolve_source_lead(
    db: DbSession,
    *,
    organization_id: str,
    client_id: str,
    requested_lead_id: str | None,
) -> Lead | None:
    if requested_lead_id:
        lead = db.scalar(
            select(Lead).where(
                Lead.id == requested_lead_id,
                Lead.organization_id == organization_id,
                Lead.converted_client_id == client_id,
            )
        )
        if lead is None:
            raise HTTPException(
                status_code=400,
                detail="Source lead must belong to this company and be converted to the selected client",
            )
        return lead

    candidates = db.scalars(
        select(Lead)
        .where(
            Lead.organization_id == organization_id,
            Lead.converted_client_id == client_id,
        )
        .order_by(Lead.converted_at.desc().nullslast(), Lead.created_at.desc())
        .limit(2)
    ).all()
    return candidates[0] if len(candidates) == 1 else None


@router.post("/orders", response_model=OrderDetail, status_code=status.HTTP_201_CREATED)
def create_manual_order(
    payload: ManualOrderCreate,
    request: Request,
    db: DbSession,
    tenant: OrderManager,
) -> OrderDetail:
    from app.api.v1.orders import _detail

    client = db.scalar(
        select(Client).where(
            Client.id == payload.client_id,
            Client.organization_id == tenant.organization_id,
            Client.status == "active",
        )
    )
    if client is None:
        raise HTTPException(status_code=400, detail="Active client not found in this company")

    source_lead = _resolve_source_lead(
        db,
        organization_id=tenant.organization_id,
        client_id=client.id,
        requested_lead_id=payload.source_lead_id,
    )

    if payload.assigned_employee_id:
        employee = db.scalar(
            select(Employee).where(
                Employee.id == payload.assigned_employee_id,
                Employee.organization_id == tenant.organization_id,
                Employee.employment_status == "active",
            )
        )
        if employee is None:
            raise HTTPException(status_code=400, detail="Assigned employee is not active in this company")

    source = _clean(payload.source)
    source = source.casefold() if source else None
    external_order_id = _clean(payload.external_order_id)
    if source and external_order_id:
        existing_order_number = db.scalar(
            select(Order.order_number).where(
                Order.organization_id == tenant.organization_id,
                Order.source == source,
                Order.external_order_id == external_order_id,
            )
        )
        if existing_order_number:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{source.title()} order/reference {external_order_id} is already linked to {existing_order_number}",
            )

    financial = db.scalar(
        select(OrganizationFinancialSettings).where(
            OrganizationFinancialSettings.organization_id == tenant.organization_id
        )
    )
    profile = db.scalar(select(OrganizationProfile).where(OrganizationProfile.organization_id == tenant.organization_id))
    address = db.scalar(
        select(OrganizationAddress)
        .where(OrganizationAddress.organization_id == tenant.organization_id)
        .order_by(OrganizationAddress.address_type.asc())
        .limit(1)
    )
    identifier = db.scalar(
        select(OrganizationIdentifier)
        .where(OrganizationIdentifier.organization_id == tenant.organization_id)
        .order_by(OrganizationIdentifier.is_primary.desc(), OrganizationIdentifier.created_at.asc())
        .limit(1)
    )

    currency = (payload.currency or client.currency or (financial.accounting_currency if financial else tenant.organization.currency)).upper()
    tax_mode = payload.tax_calculation_mode or (financial.tax_calculation_mode if financial else "exclusive")

    prepared = []
    calculated_lines = []
    for item in payload.items:
        snapshot = resolve_sales_line(
            db,
            organization_id=tenant.organization_id,
            currency=currency,
            product_id=item.product_id,
            item_name=item.item_name,
            item_type=item.item_type,
            unit=item.unit,
            description=item.description,
        )
        calculated = calculate_line(
            quantity=item.quantity,
            unit_price=item.unit_price,
            discount_percent=item.discount_percent,
            tax_rate=item.tax_rate,
            tax_calculation_mode=tax_mode,
        )
        prepared.append((item, snapshot, calculated))
        calculated_lines.append(calculated)
    totals = calculate_totals(calculated_lines)
    now = datetime.now(timezone.utc)

    order = Order(
        organization_id=tenant.organization_id,
        order_number=next_sequence_code(db, tenant.organization_id, "order"),
        quotation_id=None,
        client_id=client.id,
        source_lead_id=source_lead.id if source_lead else None,
        assigned_employee_id=payload.assigned_employee_id,
        created_by_user_id=tenant.user_id,
        source=source,
        external_order_id=external_order_id,
        status="confirmed",
        subject=_clean(payload.subject),
        order_date=payload.order_date,
        currency=currency,
        tax_calculation_mode=tax_mode,
        seller_name_snapshot=(profile.legal_name if profile and profile.legal_name else tenant.organization.name),
        seller_email_snapshot=((profile.billing_email or profile.primary_email) if profile else None),
        seller_address_snapshot=_address_text(address),
        seller_tax_identifier_snapshot=(identifier.value if identifier else None),
        client_name_snapshot=client.display_name,
        client_contact_snapshot=client.contact_name,
        client_email_snapshot=(client.billing_email or client.email),
        client_address_snapshot=_client_address_text(client),
        client_tax_identifier_snapshot=client.tax_identifier,
        subtotal=totals.subtotal,
        discount_total=totals.discount_total,
        tax_total=totals.tax_total,
        total=totals.total,
        notes=_clean(payload.notes),
        terms_conditions=_clean(payload.terms_conditions),
        internal_notes=_clean(payload.internal_notes),
        confirmed_at=now,
    )
    db.add(order)
    db.flush()

    for index, (item, snapshot, calculated) in enumerate(prepared):
        db.add(
            OrderItem(
                organization_id=tenant.organization_id,
                order_id=order.id,
                quotation_item_id=None,
                product_id=snapshot.product_id,
                sort_order=index,
                item_name_snapshot=snapshot.item_name,
                sku_snapshot=snapshot.sku,
                item_type_snapshot=snapshot.item_type,
                unit_snapshot=snapshot.unit,
                description=snapshot.description,
                quantity=item.quantity,
                unit_price=item.unit_price,
                discount_percent=item.discount_percent,
                tax_rate=item.tax_rate,
                line_subtotal=calculated.line_subtotal,
                discount_amount=calculated.discount_amount,
                taxable_amount=calculated.taxable_amount,
                tax_amount=calculated.tax_amount,
                line_total=calculated.line_total,
            )
        )
    db.flush()

    record_activity(
        db,
        action="sales.order.created_manual",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="order",
        entity_id=order.id,
        after={
            "order_number": order.order_number,
            "source": "manual",
            "order_source": order.source,
            "external_order_id": order.external_order_id,
            "client_id": order.client_id,
            "source_lead_id": order.source_lead_id,
            "status": order.status,
            "currency": order.currency,
            "total": str(order.total),
            "item_count": len(payload.items),
        },
        metadata={
            "source": "manual",
            "order_source": order.source,
            "external_order_id": order.external_order_id,
            "source_lead_id": order.source_lead_id,
        },
        message=f"Manual order {order.order_number} created for {client.display_name}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, order.id)
