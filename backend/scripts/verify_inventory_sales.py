from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.inventory import create_product, create_warehouse, receive_purchase
from app.api.v1.inventory_fulfillment import fulfill_order
from app.api.v1.manual_orders import create_manual_order
from app.api.v1.orders import change_order_status
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.inventory import InventoryBalance, StockMovement
from app.models.inventory_sales import OrderFulfillmentItem
from app.schemas.inventory import ProductCreate, PurchaseLineInput, PurchaseReceiptCreate, WarehouseCreate
from app.schemas.orders import FulfillmentLineInput, ManualOrderCreate, OrderFulfillmentCreate, OrderItemInput, OrderStatusChange


@dataclass(frozen=True)
class Org:
    id: str
    currency: str
    timezone: str = "UTC"
    name: str = "Existing Tenant Fixture"

@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    organization: Org
    role: str = "admin"


def req(method: str, path: str) -> Request:
    return Request({"type":"http","method":method,"path":path,"raw_path":path.encode(),"headers":[],"query_string":b"","scheme":"https","server":("testserver",443),"client":("127.0.0.1",50000)})


def expect(status: int, fn):
    try: fn()
    except HTTPException as exc:
        if exc.status_code != status: raise AssertionError(f"Expected {status}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {status}")


def main():
    with engine.begin() as conn:
        row=conn.execute(text("""SELECT o.id organization_id,o.created_by_user_id user_id,o.currency,o.timezone,m.id membership_id FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1""")).mappings().one()
        client_id=conn.execute(text("SELECT id FROM clients WHERE organization_id=:o AND display_name='CI Converted Client' ORDER BY created_at DESC LIMIT 1"),{"o":row["organization_id"]}).scalar_one()
    tenant=Tenant(str(row["organization_id"]),str(row["user_id"]),str(row["membership_id"]),Org(str(row["organization_id"]),str(row["currency"] or "BDT"),str(row["timezone"] or "UTC")))
    db=SessionLocal(); marker=uuid4().hex[:8]
    try:
        warehouse=create_warehouse(WarehouseCreate(code=f"S{marker[:5]}",name=f"Sales Warehouse {marker}"),req("POST","/inventory/warehouses"),db,tenant)  # type: ignore[arg-type]
        product=create_product(ProductCreate(sku=f"SALE-{marker}",name="CI Sale Product",item_type="stock_item",unit="pcs",currency=tenant.organization.currency,selling_price=Decimal("180"),reorder_level=Decimal("1")),req("POST","/inventory/products"),db,tenant)  # type: ignore[arg-type]
        receive_purchase(PurchaseReceiptCreate(supplier_name="Sales Supplier",warehouse_id=warehouse.id,receipt_date=date(2099,2,1),currency=tenant.organization.currency,items=[PurchaseLineInput(product_id=product["id"],quantity=Decimal("10"),unit_cost=Decimal("100"))]),req("POST","/inventory/purchases"),db,tenant)  # type: ignore[arg-type]
        order=create_manual_order(ManualOrderCreate(client_id=str(client_id),subject="Product order",order_date=date(2099,2,2),currency=tenant.organization.currency,items=[OrderItemInput(product_id=product["id"],description="CI Sale Product",quantity=Decimal("4"),unit_price=Decimal("180"))]),req("POST","/sales/orders"),db,tenant)  # type: ignore[arg-type]
        line=order.items[0]
        if line.product_id!=product["id"] or line.item_type_snapshot!="stock_item" or line.remaining_quantity!=Decimal("4"):
            raise AssertionError("product order snapshot/remaining quantity failed")
        first=fulfill_order(order.id,OrderFulfillmentCreate(warehouse_id=warehouse.id,fulfillment_date=date(2099,2,3),items=[FulfillmentLineInput(order_item_id=line.id,quantity=Decimal("2"))]),req("POST","/fulfill"),db,tenant)  # type: ignore[arg-type]
        if Decimal(first["total_cogs"])!=Decimal("200.00"): raise AssertionError(f"unexpected COGS {first['total_cogs']}")
        balance=db.scalar(select(InventoryBalance).where(InventoryBalance.product_id==product["id"],InventoryBalance.warehouse_id==warehouse.id))
        if balance is None or Decimal(balance.on_hand_quantity)!=Decimal("8.0000") or Decimal(balance.inventory_value)!=Decimal("800.0000"): raise AssertionError("partial fulfillment stock deduction failed")
        journal=db.scalar(select(JournalEntry).where(JournalEntry.organization_id==tenant.organization_id,JournalEntry.source_type=="inventory_order_fulfillment",JournalEntry.source_id==first["id"]))
        if journal is None: raise AssertionError("COGS journal missing")
        lines=db.scalars(select(JournalLine).where(JournalLine.journal_entry_id==journal.id)).all()
        cogs=db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id==tenant.organization_id,LedgerAccount.system_key=="cost_of_sales")); inventory=db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id==tenant.organization_id,LedgerAccount.system_key=="inventory_asset"))
        if not any(x.ledger_account_id==cogs.id and Decimal(x.debit)==Decimal("200.00") for x in lines) or not any(x.ledger_account_id==inventory.id and Decimal(x.credit)==Decimal("200.00") for x in lines): raise AssertionError("COGS/inventory journal classification failed")
        expect(409,lambda: fulfill_order(order.id,OrderFulfillmentCreate(warehouse_id=warehouse.id,fulfillment_date=date(2099,2,3),items=[FulfillmentLineInput(order_item_id=line.id,quantity=Decimal("3"))]),req("POST","/fulfill"),db,tenant))  # type: ignore[arg-type]
        db.rollback()
        second=fulfill_order(order.id,OrderFulfillmentCreate(warehouse_id=warehouse.id,fulfillment_date=date(2099,2,4),items=[FulfillmentLineInput(order_item_id=line.id,quantity=Decimal("2"))]),req("POST","/fulfill"),db,tenant)  # type: ignore[arg-type]
        completed=change_order_status(order.id,OrderStatusChange(status="completed"),req("PATCH","/status"),db,tenant)  # type: ignore[arg-type]
        if completed.status!="completed": raise AssertionError("fully fulfilled order did not complete")
        balance=db.scalar(select(InventoryBalance).where(InventoryBalance.product_id==product["id"],InventoryBalance.warehouse_id==warehouse.id))
        if Decimal(balance.on_hand_quantity)!=Decimal("6.0000"): raise AssertionError("final stock quantity failed")
        movements=db.scalars(select(StockMovement).where(StockMovement.organization_id==tenant.organization_id,StockMovement.product_id==product["id"],StockMovement.movement_type=="sale")).all()
        fulfillment_items=db.scalars(select(OrderFulfillmentItem).where(OrderFulfillmentItem.organization_id==tenant.organization_id,OrderFulfillmentItem.order_item_id==line.id)).all()
        if len(movements)!=2 or sum(Decimal(x.quantity) for x in fulfillment_items)!=Decimal("4"): raise AssertionError("fulfillment history failed")
    finally: db.close()
    print("inventory sales verification passed: product order -> partial fulfillment -> weighted-average COGS -> stock deduction -> completion")

if __name__=="__main__": main()
