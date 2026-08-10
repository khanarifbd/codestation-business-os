from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.company_settings import OrganizationAddress, OrganizationFinancialSettings, OrganizationIdentifier, OrganizationProfile
from app.models.crm import Client
from app.models.inventory import Product
from app.models.orders import Order, OrderItem
from app.models.team import Employee
from app.schemas.orders import ManualOrderCreate, OrderDetail
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.services.sales import calculate_line, calculate_totals
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Orders"])
OrderManager = Annotated[TenantContext, Depends(require_tenant_permission("orders.manage"))]


def _clean(value: str | None) -> str | None:
    if value is None: return None
    value=value.strip(); return value or None

def _address_text(address: OrganizationAddress | None) -> str | None:
    if address is None: return None
    parts=[address.line1,address.line2,address.city,address.state_region,address.postal_code,address.country_code]
    value=", ".join(str(part).strip() for part in parts if part and str(part).strip()); return value or None

def _client_address_text(client: Client) -> str | None:
    parts=[client.address_line1,client.address_line2,client.city,client.state_region,client.postal_code,client.country_code]
    value=", ".join(str(part).strip() for part in parts if part and str(part).strip()); return value or None


@router.post("/orders", response_model=OrderDetail, status_code=status.HTTP_201_CREATED)
def create_manual_order(payload: ManualOrderCreate, request: Request, db: DbSession, tenant: OrderManager) -> OrderDetail:
    from app.api.v1.orders import _detail
    client=db.scalar(select(Client).where(Client.id==payload.client_id,Client.organization_id==tenant.organization_id,Client.status=="active"))
    if client is None: raise HTTPException(400,"Active client not found in this company")
    if payload.assigned_employee_id and db.scalar(select(Employee.id).where(Employee.id==payload.assigned_employee_id,Employee.organization_id==tenant.organization_id,Employee.employment_status=="active")) is None:
        raise HTTPException(400,"Assigned employee is not active in this company")
    financial=db.scalar(select(OrganizationFinancialSettings).where(OrganizationFinancialSettings.organization_id==tenant.organization_id))
    profile=db.scalar(select(OrganizationProfile).where(OrganizationProfile.organization_id==tenant.organization_id))
    address=db.scalar(select(OrganizationAddress).where(OrganizationAddress.organization_id==tenant.organization_id).order_by(OrganizationAddress.address_type.asc()).limit(1))
    identifier=db.scalar(select(OrganizationIdentifier).where(OrganizationIdentifier.organization_id==tenant.organization_id).order_by(OrganizationIdentifier.is_primary.desc(),OrganizationIdentifier.created_at.asc()).limit(1))
    currency=(payload.currency or client.currency or (financial.accounting_currency if financial else tenant.organization.currency)).upper()
    tax_mode=payload.tax_calculation_mode or (financial.tax_calculation_mode if financial else "exclusive")
    prepared=[]; calculated_lines=[]
    for item in payload.items:
        product=None
        if item.product_id:
            product=db.scalar(select(Product).where(Product.id==item.product_id,Product.organization_id==tenant.organization_id,Product.is_active.is_(True)))
            if product is None: raise HTTPException(404,"Active product or service not found")
            if product.currency!=currency: raise HTTPException(400,f"Product {product.sku} uses {product.currency}; order uses {currency}")
        calculated=calculate_line(quantity=item.quantity,unit_price=item.unit_price,discount_percent=item.discount_percent,tax_rate=item.tax_rate,tax_calculation_mode=tax_mode)
        calculated_lines.append(calculated); prepared.append((item,product,calculated))
    totals=calculate_totals(calculated_lines); now=datetime.now(timezone.utc)
    order=Order(organization_id=tenant.organization_id,order_number=next_sequence_code(db,tenant.organization_id,"order"),quotation_id=None,client_id=client.id,source_lead_id=None,assigned_employee_id=payload.assigned_employee_id,created_by_user_id=tenant.user_id,status="confirmed",subject=_clean(payload.subject),order_date=payload.order_date,currency=currency,tax_calculation_mode=tax_mode,seller_name_snapshot=(profile.legal_name if profile and profile.legal_name else tenant.organization.name),seller_email_snapshot=((profile.billing_email or profile.primary_email) if profile else None),seller_address_snapshot=_address_text(address),seller_tax_identifier_snapshot=(identifier.value if identifier else None),client_name_snapshot=client.display_name,client_contact_snapshot=client.contact_name,client_email_snapshot=(client.billing_email or client.email),client_address_snapshot=_client_address_text(client),client_tax_identifier_snapshot=client.tax_identifier,subtotal=totals.subtotal,discount_total=totals.discount_total,tax_total=totals.tax_total,total=totals.total,notes=_clean(payload.notes),terms_conditions=_clean(payload.terms_conditions),internal_notes=_clean(payload.internal_notes),confirmed_at=now)
    db.add(order);db.flush()
    for index,(item,product,calculated) in enumerate(prepared):
        db.add(OrderItem(organization_id=tenant.organization_id,order_id=order.id,quotation_item_id=None,product_id=product.id if product else None,sku_snapshot=product.sku if product else None,item_type_snapshot=product.item_type if product else "service",sort_order=index,description=item.description.strip(),quantity=item.quantity,unit_price=item.unit_price,discount_percent=item.discount_percent,tax_rate=item.tax_rate,line_subtotal=calculated.line_subtotal,discount_amount=calculated.discount_amount,taxable_amount=calculated.taxable_amount,tax_amount=calculated.tax_amount,line_total=calculated.line_total))
    db.flush();record_activity(db,action="sales.order.created_manual",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="order",entity_id=order.id,after={"order_number":order.order_number,"source":"manual","client_id":order.client_id,"status":order.status,"currency":order.currency,"total":str(order.total),"item_count":len(payload.items),"product_lines":sum(1 for _,p,_ in prepared if p)},metadata={"source":"manual"},message=f"Manual order {order.order_number} created for {client.display_name}",request=request);db.commit();return _detail(db,tenant.organization_id,order.id)
