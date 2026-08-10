from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.inventory import _stock_out
from app.models.accounting import LedgerAccount
from app.models.inventory import Product, Warehouse
from app.models.inventory_sales import OrderFulfillment, OrderFulfillmentItem
from app.models.orders import Order, OrderItem
from app.schemas.orders import OrderFulfillmentCreate
from app.services.accounting_posting import PostingLine, post_journal, system_account, to_base_amount
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Orders - Fulfillment"])
Manager = Annotated[TenantContext, Depends(require_tenant_permission("orders.manage"))]
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("orders.view"))]
MONEY=Decimal("0.01")


def money(v) -> Decimal: return Decimal(v or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _inventory_ledger(db: DbSession, organization_id: str, user_id: str) -> LedgerAccount:
    row=db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id==organization_id,LedgerAccount.system_key=="inventory_asset",LedgerAccount.is_active.is_(True)))
    if row is not None: return row
    row=LedgerAccount(organization_id=organization_id,code="1450",name="Inventory Asset",category="asset",subtype="inventory_asset",normal_balance="debit",system_key="inventory_asset",is_system=True,is_active=True,allow_manual_posting=False,notes="Inventory system account",created_by_user_id=user_id)
    db.add(row);db.flush();return row


@router.get("/orders/{order_id}/fulfillments")
def list_fulfillments(order_id: str, db: DbSession, tenant: Viewer):
    if db.scalar(select(Order.id).where(Order.id==order_id,Order.organization_id==tenant.organization_id)) is None: raise HTTPException(404,"Order not found")
    rows=db.execute(select(OrderFulfillment,Warehouse.name).join(Warehouse,Warehouse.id==OrderFulfillment.warehouse_id).where(OrderFulfillment.organization_id==tenant.organization_id,OrderFulfillment.order_id==order_id).order_by(OrderFulfillment.fulfillment_date.desc(),OrderFulfillment.created_at.desc())).all()
    result=[]
    for f,warehouse_name in rows:
        items=db.execute(select(OrderFulfillmentItem,Product.sku,Product.name).join(Product,Product.id==OrderFulfillmentItem.product_id).where(OrderFulfillmentItem.organization_id==tenant.organization_id,OrderFulfillmentItem.fulfillment_id==f.id)).all()
        result.append({"id":f.id,"fulfillment_number":f.fulfillment_number,"fulfillment_date":f.fulfillment_date,"warehouse_id":f.warehouse_id,"warehouse_name":warehouse_name,"reference":f.reference,"status":f.status,"total_cogs":money(sum((Decimal(i.total_cost) for i,_,_ in items),Decimal("0"))),"items":[{"order_item_id":i.order_item_id,"product_id":i.product_id,"sku":sku,"name":name,"quantity":i.quantity,"unit_cost":i.unit_cost,"total_cost":i.total_cost} for i,sku,name in items]})
    return result


@router.post("/orders/{order_id}/fulfillments", status_code=status.HTTP_201_CREATED)
def fulfill_order(order_id: str, payload: OrderFulfillmentCreate, request: Request, db: DbSession, tenant: Manager):
    order=db.scalar(select(Order).where(Order.id==order_id,Order.organization_id==tenant.organization_id).with_for_update())
    if order is None: raise HTTPException(404,"Order not found")
    if order.status in {"cancelled","completed"}: raise HTTPException(409,f"Cannot fulfill a {order.status} order")
    warehouse=db.scalar(select(Warehouse).where(Warehouse.id==payload.warehouse_id,Warehouse.organization_id==tenant.organization_id,Warehouse.is_active.is_(True)))
    if warehouse is None: raise HTTPException(404,"Active warehouse not found")
    ids=[x.order_item_id for x in payload.items]
    if len(ids)!=len(set(ids)): raise HTTPException(400,"Each order item may appear only once per fulfillment")
    order_items={x.id:x for x in db.scalars(select(OrderItem).where(OrderItem.organization_id==tenant.organization_id,OrderItem.order_id==order.id,OrderItem.id.in_(ids))).all()}
    if len(order_items)!=len(ids): raise HTTPException(404,"One or more order items were not found")
    fulfillment=OrderFulfillment(organization_id=tenant.organization_id,fulfillment_number=f"FUL-{payload.fulfillment_date.strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}",order_id=order.id,warehouse_id=warehouse.id,fulfillment_date=payload.fulfillment_date,status="posted",reference=payload.reference.strip() if payload.reference and payload.reference.strip() else None,created_by_user_id=tenant.user_id)
    db.add(fulfillment);db.flush();total_cogs_original=Decimal("0")
    for line in payload.items:
        item=order_items[line.order_item_id]
        if item.product_id is None or item.item_type_snapshot!="stock_item": raise HTTPException(400,"Only tracked stock-item order lines can be fulfilled")
        product=db.scalar(select(Product).where(Product.id==item.product_id,Product.organization_id==tenant.organization_id,Product.item_type=="stock_item",Product.track_inventory.is_(True),Product.is_active.is_(True)))
        if product is None: raise HTTPException(409,f"Product {item.sku_snapshot or item.product_id} is not an active tracked stock item")
        fulfilled_before=Decimal(db.scalar(select(func.coalesce(func.sum(OrderFulfillmentItem.quantity),0)).where(OrderFulfillmentItem.organization_id==tenant.organization_id,OrderFulfillmentItem.order_item_id==item.id)) or 0)
        remaining=Decimal(item.quantity)-fulfilled_before; quantity=Decimal(line.quantity)
        if quantity>remaining: raise HTTPException(409,f"Fulfillment exceeds remaining quantity for {item.sku_snapshot or item.description}. Remaining {remaining}")
        movement=_stock_out(db,organization_id=tenant.organization_id,user_id=tenant.user_id,product=product,warehouse=warehouse,movement_date=payload.fulfillment_date,quantity=quantity,source_type="order_fulfillment",source_id=fulfillment.id,reference=fulfillment.reference,reason=f"Fulfilled order {order.order_number}")
        movement.movement_type="sale"; line_cost=abs(Decimal(movement.total_cost));total_cogs_original+=line_cost
        db.add(OrderFulfillmentItem(organization_id=tenant.organization_id,fulfillment_id=fulfillment.id,order_item_id=item.id,product_id=product.id,quantity=quantity,unit_cost=movement.unit_cost,total_cost=line_cost))
    total_cogs_original=money(total_cogs_original)
    if total_cogs_original>0:
        cogs=system_account(db,tenant.organization_id,"cost_of_sales");inventory=_inventory_ledger(db,tenant.organization_id,tenant.user_id)
        base_amount,rate=to_base_amount(db,tenant.organization_id,tenant.organization.currency,total_cogs_original,order.currency)
        post_journal(db,organization_id=tenant.organization_id,user_id=tenant.user_id,entry_date=fulfillment.fulfillment_date,source_type="inventory_order_fulfillment",source_id=fulfillment.id,lines=[PostingLine(ledger_account_id=cogs.id,debit=base_amount,currency=order.currency,exchange_rate_to_base=rate,original_amount=total_cogs_original,description=f"COGS for {order.order_number}"),PostingLine(ledger_account_id=inventory.id,credit=base_amount,currency=order.currency,exchange_rate_to_base=rate,original_amount=total_cogs_original,description=f"Inventory issued for {order.order_number}")],reference=fulfillment.reference,memo=f"Fulfillment {fulfillment.fulfillment_number} · {order.order_number}")
    if order.status=="confirmed": order.status="in_progress"
    record_activity(db,action="inventory.order.fulfilled",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="order_fulfillment",entity_id=fulfillment.id,after={"order_id":order.id,"order_number":order.order_number,"warehouse_id":warehouse.id,"line_count":len(payload.items),"total_cogs":str(total_cogs_original),"currency":order.currency},message=f"Fulfillment {fulfillment.fulfillment_number} posted for order {order.order_number}",request=request)
    db.commit();return {"id":fulfillment.id,"fulfillment_number":fulfillment.fulfillment_number,"status":fulfillment.status,"total_cogs":total_cogs_original,"currency":order.currency}
