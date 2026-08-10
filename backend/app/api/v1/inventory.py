from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import LedgerAccount
from app.models.expenses import Vendor
from app.models.inventory import InventoryBalance, Product, ProductCategory, PurchaseReceipt, PurchaseReceiptItem, StockMovement, Warehouse
from app.models.tax import TaxCode
from app.schemas.inventory import AdjustmentCreate, CategoryCreate, ProductCreate, PurchaseReceiptCreate, WarehouseCreate
from app.services.accounting_posting import PostingLine, post_journal, system_account
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/inventory", tags=["Inventory"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")
QTY = Decimal("0.0001")
COST = Decimal("0.0001")


def money(v) -> Decimal: return Decimal(v or 0).quantize(MONEY, rounding=ROUND_HALF_UP)
def qty(v) -> Decimal: return Decimal(v or 0).quantize(QTY, rounding=ROUND_HALF_UP)
def cost(v) -> Decimal: return Decimal(v or 0).quantize(COST, rounding=ROUND_HALF_UP)
def clean(v: str | None) -> str | None:
    if v is None: return None
    v=v.strip(); return v or None


def _ledger(db: DbSession, organization_id: str, user_id: str, *, system_key: str, code: str, name: str, category: str, normal_balance: str) -> LedgerAccount:
    row=db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id==organization_id, LedgerAccount.system_key==system_key, LedgerAccount.is_active.is_(True)))
    if row is not None: return row
    row=LedgerAccount(organization_id=organization_id, code=code, name=name, category=category, subtype=system_key, normal_balance=normal_balance, system_key=system_key, is_system=True, is_active=True, allow_manual_posting=False, notes="Inventory system account", created_by_user_id=user_id)
    db.add(row); db.flush(); return row


def _tax(db: DbSession, organization_id: str, tax_code_id: str | None, on_date) -> TaxCode | None:
    if not tax_code_id: return None
    row=db.scalar(select(TaxCode).where(TaxCode.id==tax_code_id, TaxCode.organization_id==organization_id, TaxCode.tax_kind=="purchase", TaxCode.is_active.is_(True)))
    if row is None: raise HTTPException(404, "Active purchase tax code not found")
    if row.effective_from and on_date < row.effective_from: raise HTTPException(400, f"Tax code {row.code} is not effective yet")
    if row.effective_to and on_date > row.effective_to: raise HTTPException(400, f"Tax code {row.code} has expired")
    return row


def _balance(db: DbSession, organization_id: str, product_id: str, warehouse_id: str, lock: bool=True) -> InventoryBalance:
    query=select(InventoryBalance).where(InventoryBalance.organization_id==organization_id, InventoryBalance.product_id==product_id, InventoryBalance.warehouse_id==warehouse_id)
    if lock: query=query.with_for_update()
    row=db.scalar(query)
    if row is None:
        row=InventoryBalance(organization_id=organization_id, product_id=product_id, warehouse_id=warehouse_id, on_hand_quantity=Decimal("0"), average_unit_cost=Decimal("0"), inventory_value=Decimal("0"))
        db.add(row); db.flush()
    return row


def _stock_in(db: DbSession, *, organization_id: str, user_id: str, product: Product, warehouse: Warehouse, movement_date, quantity: Decimal, incoming_total_cost: Decimal, source_type: str, source_id: str, reference: str | None, reason: str | None=None) -> StockMovement:
    bal=_balance(db, organization_id, product.id, warehouse.id)
    old_qty=Decimal(bal.on_hand_quantity); old_value=Decimal(bal.inventory_value)
    new_qty=qty(old_qty + quantity)
    new_value=cost(old_value + incoming_total_cost)
    new_avg=cost(new_value / new_qty) if new_qty > 0 else Decimal("0")
    bal.on_hand_quantity=new_qty; bal.inventory_value=new_value; bal.average_unit_cost=new_avg
    unit_cost=cost(incoming_total_cost / quantity) if quantity else Decimal("0")
    movement=StockMovement(organization_id=organization_id, product_id=product.id, warehouse_id=warehouse.id, movement_date=movement_date, movement_type="purchase" if source_type=="purchase_receipt" else "adjustment_in", quantity=qty(quantity), unit_cost=unit_cost, total_cost=cost(incoming_total_cost), quantity_after=new_qty, average_cost_after=new_avg, source_type=source_type, source_id=source_id, reference=reference, reason=reason, created_by_user_id=user_id)
    db.add(movement)
    product.last_purchase_cost=unit_cost if source_type=="purchase_receipt" else product.last_purchase_cost
    if Decimal(product.standard_cost)==0 and source_type=="purchase_receipt": product.standard_cost=unit_cost
    return movement


def _stock_out(db: DbSession, *, organization_id: str, user_id: str, product: Product, warehouse: Warehouse, movement_date, quantity: Decimal, source_type: str, source_id: str, reference: str | None, reason: str) -> StockMovement:
    bal=_balance(db, organization_id, product.id, warehouse.id)
    old_qty=Decimal(bal.on_hand_quantity)
    if quantity > old_qty and not product.allow_negative_stock:
        raise HTTPException(409, f"Insufficient stock for {product.sku}. Available {old_qty}")
    avg=Decimal(bal.average_unit_cost)
    total=cost(avg * quantity)
    new_qty=qty(old_qty - quantity)
    new_value=cost(Decimal(bal.inventory_value) - total)
    if new_qty == 0: new_value=Decimal("0")
    bal.on_hand_quantity=new_qty; bal.inventory_value=new_value
    movement=StockMovement(organization_id=organization_id, product_id=product.id, warehouse_id=warehouse.id, movement_date=movement_date, movement_type="adjustment_out", quantity=-qty(quantity), unit_cost=cost(avg), total_cost=-total, quantity_after=new_qty, average_cost_after=cost(avg), source_type=source_type, source_id=source_id, reference=reference, reason=reason, created_by_user_id=user_id)
    db.add(movement); return movement


@router.get("/overview")
def overview(db: DbSession, tenant: Viewer):
    stock_products=db.scalar(select(func.count()).select_from(Product).where(Product.organization_id==tenant.organization_id, Product.item_type=="stock_item", Product.is_active.is_(True))) or 0
    service_items=db.scalar(select(func.count()).select_from(Product).where(Product.organization_id==tenant.organization_id, Product.item_type=="service", Product.is_active.is_(True))) or 0
    value=db.scalar(select(func.coalesce(func.sum(InventoryBalance.inventory_value),0)).where(InventoryBalance.organization_id==tenant.organization_id)) or 0
    low=[]
    rows=db.execute(select(Product, func.coalesce(func.sum(InventoryBalance.on_hand_quantity),0)).outerjoin(InventoryBalance, InventoryBalance.product_id==Product.id).where(Product.organization_id==tenant.organization_id, Product.item_type=="stock_item", Product.is_active.is_(True)).group_by(Product.id)).all()
    for p,on_hand in rows:
        if Decimal(on_hand) <= Decimal(p.reorder_level): low.append({"id":p.id,"sku":p.sku,"name":p.name,"on_hand":qty(on_hand),"reorder_level":p.reorder_level})
    return {"stock_products":stock_products,"service_items":service_items,"inventory_value":cost(value),"low_stock_count":len(low),"low_stock":low[:20]}


@router.get("/categories")
def categories(db: DbSession, tenant: Viewer):
    return db.scalars(select(ProductCategory).where(ProductCategory.organization_id==tenant.organization_id).order_by(ProductCategory.name)).all()


@router.post("/categories", status_code=201)
def create_category(payload: CategoryCreate, request: Request, db: DbSession, tenant: Manager):
    name=payload.name.strip()
    if db.scalar(select(ProductCategory.id).where(ProductCategory.organization_id==tenant.organization_id, func.lower(ProductCategory.name)==name.lower())): raise HTTPException(409,"Category already exists")
    row=ProductCategory(organization_id=tenant.organization_id,name=name,description=clean(payload.description),created_by_user_id=tenant.user_id)
    db.add(row);db.flush();record_activity(db,action="inventory.category.created",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="product_category",entity_id=row.id,after={"name":row.name},request=request);db.commit();return row


@router.get("/warehouses")
def warehouses(db: DbSession, tenant: Viewer):
    return db.scalars(select(Warehouse).where(Warehouse.organization_id==tenant.organization_id).order_by(Warehouse.is_default.desc(),Warehouse.name)).all()


@router.post("/warehouses", status_code=201)
def create_warehouse(payload: WarehouseCreate, request: Request, db: DbSession, tenant: Manager):
    code=payload.code.strip().upper()
    if db.scalar(select(Warehouse.id).where(Warehouse.organization_id==tenant.organization_id, func.lower(Warehouse.code)==code.lower())): raise HTTPException(409,"Warehouse code already exists")
    if payload.is_default:
        for item in db.scalars(select(Warehouse).where(Warehouse.organization_id==tenant.organization_id,Warehouse.is_default.is_(True))).all(): item.is_default=False
    row=Warehouse(organization_id=tenant.organization_id,code=code,name=payload.name.strip(),address=clean(payload.address),is_default=payload.is_default,created_by_user_id=tenant.user_id)
    db.add(row);db.flush();record_activity(db,action="inventory.warehouse.created",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="warehouse",entity_id=row.id,after={"code":row.code,"name":row.name,"is_default":row.is_default},request=request);db.commit();return row


@router.get("/products")
def products(db: DbSession, tenant: Viewer, include_inactive: bool=False):
    query=select(Product).where(Product.organization_id==tenant.organization_id)
    if not include_inactive: query=query.where(Product.is_active.is_(True))
    result=[]
    for p in db.scalars(query.order_by(Product.name)).all():
        on_hand=db.scalar(select(func.coalesce(func.sum(InventoryBalance.on_hand_quantity),0)).where(InventoryBalance.organization_id==tenant.organization_id,InventoryBalance.product_id==p.id)) or 0
        value=db.scalar(select(func.coalesce(func.sum(InventoryBalance.inventory_value),0)).where(InventoryBalance.organization_id==tenant.organization_id,InventoryBalance.product_id==p.id)) or 0
        result.append({"id":p.id,"sku":p.sku,"barcode":p.barcode,"name":p.name,"description":p.description,"item_type":p.item_type,"category_id":p.category_id,"unit":p.unit,"currency":p.currency,"selling_price":p.selling_price,"standard_cost":p.standard_cost,"last_purchase_cost":p.last_purchase_cost,"reorder_level":p.reorder_level,"tax_code_id":p.tax_code_id,"track_inventory":p.track_inventory,"allow_negative_stock":p.allow_negative_stock,"is_active":p.is_active,"on_hand":qty(on_hand),"inventory_value":cost(value)})
    return result


@router.post("/products", status_code=201)
def create_product(payload: ProductCreate, request: Request, db: DbSession, tenant: Manager):
    sku=payload.sku.strip().upper()
    if db.scalar(select(Product.id).where(Product.organization_id==tenant.organization_id,func.lower(Product.sku)==sku.lower())): raise HTTPException(409,"SKU already exists")
    if payload.category_id and not db.scalar(select(ProductCategory.id).where(ProductCategory.id==payload.category_id,ProductCategory.organization_id==tenant.organization_id)): raise HTTPException(404,"Category not found")
    if payload.tax_code_id and not db.scalar(select(TaxCode.id).where(TaxCode.id==payload.tax_code_id,TaxCode.organization_id==tenant.organization_id,TaxCode.tax_kind=="sales")): raise HTTPException(404,"Sales tax code not found")
    row=Product(organization_id=tenant.organization_id,sku=sku,barcode=clean(payload.barcode),name=payload.name.strip(),description=clean(payload.description),item_type=payload.item_type,category_id=payload.category_id,unit=payload.unit.strip(),currency=payload.currency.upper(),selling_price=payload.selling_price,standard_cost=payload.standard_cost,last_purchase_cost=Decimal("0"),reorder_level=payload.reorder_level,tax_code_id=payload.tax_code_id,track_inventory=bool(payload.track_inventory),allow_negative_stock=payload.allow_negative_stock,is_active=True,created_by_user_id=tenant.user_id)
    db.add(row);db.flush();record_activity(db,action="inventory.product.created",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="product",entity_id=row.id,after={"sku":row.sku,"name":row.name,"item_type":row.item_type},request=request);db.commit();return {"id":row.id,"sku":row.sku,"name":row.name,"item_type":row.item_type}


@router.get("/stock")
def stock(db: DbSession, tenant: Viewer):
    rows=db.execute(select(InventoryBalance,Product,Warehouse).join(Product,Product.id==InventoryBalance.product_id).join(Warehouse,Warehouse.id==InventoryBalance.warehouse_id).where(InventoryBalance.organization_id==tenant.organization_id).order_by(Product.name,Warehouse.name)).all()
    return [{"product_id":p.id,"sku":p.sku,"product_name":p.name,"warehouse_id":w.id,"warehouse_name":w.name,"on_hand":b.on_hand_quantity,"average_unit_cost":b.average_unit_cost,"inventory_value":b.inventory_value,"currency":p.currency,"reorder_level":p.reorder_level} for b,p,w in rows]


@router.get("/movements")
def movements(db: DbSession, tenant: Viewer, limit: int=200):
    rows=db.execute(select(StockMovement,Product,Warehouse).join(Product,Product.id==StockMovement.product_id).join(Warehouse,Warehouse.id==StockMovement.warehouse_id).where(StockMovement.organization_id==tenant.organization_id).order_by(StockMovement.movement_date.desc(),StockMovement.created_at.desc()).limit(min(max(limit,1),500))).all()
    return [{"id":m.id,"movement_date":m.movement_date,"movement_type":m.movement_type,"product_id":p.id,"sku":p.sku,"product_name":p.name,"warehouse_id":w.id,"warehouse_name":w.name,"quantity":m.quantity,"unit_cost":m.unit_cost,"total_cost":m.total_cost,"quantity_after":m.quantity_after,"average_cost_after":m.average_cost_after,"source_type":m.source_type,"source_id":m.source_id,"reference":m.reference,"reason":m.reason} for m,p,w in rows]


@router.post("/adjustments", status_code=201)
def adjustment(payload: AdjustmentCreate, request: Request, db: DbSession, tenant: Manager):
    product=db.scalar(select(Product).where(Product.id==payload.product_id,Product.organization_id==tenant.organization_id,Product.item_type=="stock_item",Product.is_active.is_(True)))
    warehouse=db.scalar(select(Warehouse).where(Warehouse.id==payload.warehouse_id,Warehouse.organization_id==tenant.organization_id,Warehouse.is_active.is_(True)))
    if product is None: raise HTTPException(404,"Active stock product not found")
    if warehouse is None: raise HTTPException(404,"Active warehouse not found")
    source_id=str(uuid4())
    delta=qty(payload.quantity_delta)
    if delta>0:
        bal=_balance(db,tenant.organization_id,product.id,warehouse.id)
        unit=cost(payload.unit_cost if payload.unit_cost is not None else bal.average_unit_cost or product.standard_cost)
        _stock_in(db,organization_id=tenant.organization_id,user_id=tenant.user_id,product=product,warehouse=warehouse,movement_date=payload.adjustment_date,quantity=delta,incoming_total_cost=cost(unit*delta),source_type="stock_adjustment",source_id=source_id,reference=clean(payload.reference),reason=payload.reason.strip())
    else:
        _stock_out(db,organization_id=tenant.organization_id,user_id=tenant.user_id,product=product,warehouse=warehouse,movement_date=payload.adjustment_date,quantity=abs(delta),source_type="stock_adjustment",source_id=source_id,reference=clean(payload.reference),reason=payload.reason.strip())
    record_activity(db,action="inventory.stock.adjusted",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="stock_adjustment",entity_id=source_id,after={"product_id":product.id,"warehouse_id":warehouse.id,"quantity_delta":str(delta),"reason":payload.reason},request=request);db.commit();return {"id":source_id,"status":"posted"}


@router.get("/purchases")
def purchases(db: DbSession, tenant: Viewer, limit:int=200):
    rows=db.execute(select(PurchaseReceipt,Warehouse.name).join(Warehouse,Warehouse.id==PurchaseReceipt.warehouse_id).where(PurchaseReceipt.organization_id==tenant.organization_id).order_by(PurchaseReceipt.receipt_date.desc(),PurchaseReceipt.created_at.desc()).limit(min(max(limit,1),500))).all()
    return [{"id":r.id,"receipt_number":r.receipt_number,"supplier_name":r.supplier_name,"warehouse_id":r.warehouse_id,"warehouse_name":warehouse,"receipt_date":r.receipt_date,"currency":r.currency,"subtotal":r.subtotal,"tax_total":r.tax_total,"recoverable_tax_total":r.recoverable_tax_total,"total":r.total,"balance_due":r.balance_due,"status":r.status,"reference":r.reference} for r,warehouse in rows]


@router.post("/purchases", status_code=status.HTTP_201_CREATED)
def receive_purchase(payload: PurchaseReceiptCreate, request: Request, db: DbSession, tenant: Manager):
    warehouse=db.scalar(select(Warehouse).where(Warehouse.id==payload.warehouse_id,Warehouse.organization_id==tenant.organization_id,Warehouse.is_active.is_(True)))
    if warehouse is None: raise HTTPException(404,"Active warehouse not found")
    if payload.vendor_id and not db.scalar(select(Vendor.id).where(Vendor.id==payload.vendor_id,Vendor.organization_id==tenant.organization_id)): raise HTTPException(404,"Vendor not found")
    currency=payload.currency.upper(); prepared=[]; subtotal=Decimal("0");tax_total=Decimal("0");recoverable_total=Decimal("0");inventory_debit=Decimal("0")
    seen=set()
    for line in payload.items:
        if line.product_id in seen: raise HTTPException(400,"Use one purchase line per product")
        seen.add(line.product_id)
        product=db.scalar(select(Product).where(Product.id==line.product_id,Product.organization_id==tenant.organization_id,Product.item_type=="stock_item",Product.track_inventory.is_(True),Product.is_active.is_(True)))
        if product is None: raise HTTPException(404,"Active tracked stock product not found")
        if product.currency != currency: raise HTTPException(400,f"Product {product.sku} uses {product.currency}; purchase receipt uses {currency}")
        base=money(Decimal(line.quantity)*Decimal(line.unit_cost)); tax_code=_tax(db,tenant.organization_id,line.tax_code_id,payload.receipt_date)
        tax_amount=money(base*Decimal(tax_code.rate)/Decimal("100")) if tax_code else Decimal("0.00")
        recoverable=money(tax_amount*Decimal(tax_code.recoverable_percent)/Decimal("100")) if tax_code else Decimal("0.00")
        nonrecoverable=money(tax_amount-recoverable); inv_cost=cost(base+nonrecoverable); total=money(base+tax_amount)
        subtotal+=base;tax_total+=tax_amount;recoverable_total+=recoverable;inventory_debit+=inv_cost
        prepared.append((product,line,tax_code,base,tax_amount,recoverable,inv_cost,total))
    subtotal=money(subtotal);tax_total=money(tax_total);recoverable_total=money(recoverable_total);total=money(subtotal+tax_total)
    receipt=PurchaseReceipt(organization_id=tenant.organization_id,receipt_number=f"PR-{payload.receipt_date.strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}",supplier_name=payload.supplier_name.strip(),vendor_id=payload.vendor_id,warehouse_id=warehouse.id,receipt_date=payload.receipt_date,currency=currency,subtotal=subtotal,tax_total=tax_total,recoverable_tax_total=recoverable_total,total=total,amount_paid=Decimal("0"),balance_due=total,status="received",reference=clean(payload.reference),notes=clean(payload.notes),created_by_user_id=tenant.user_id)
    db.add(receipt);db.flush()
    for product,line,tax_code,base,tax_amount,recoverable,inv_cost,line_total in prepared:
        item=PurchaseReceiptItem(organization_id=tenant.organization_id,receipt_id=receipt.id,product_id=product.id,quantity=qty(line.quantity),unit_cost=cost(line.unit_cost),tax_code_id=tax_code.id if tax_code else None,tax_rate_snapshot=tax_code.rate if tax_code else Decimal("0"),tax_amount=tax_amount,recoverable_tax_amount=recoverable,inventory_cost=inv_cost,line_total=line_total)
        db.add(item);db.flush();_stock_in(db,organization_id=tenant.organization_id,user_id=tenant.user_id,product=product,warehouse=warehouse,movement_date=receipt.receipt_date,quantity=qty(line.quantity),incoming_total_cost=inv_cost,source_type="purchase_receipt",source_id=receipt.id,reference=receipt.reference)
    inventory_ledger=_ledger(db,tenant.organization_id,tenant.user_id,system_key="inventory_asset",code="1450",name="Inventory Asset",category="asset",normal_balance="debit")
    payable=system_account(db,tenant.organization_id,"accounts_payable")
    lines=[PostingLine(ledger_account_id=inventory_ledger.id,debit=money(inventory_debit),currency=currency,description=f"Inventory received {receipt.receipt_number}")]
    if recoverable_total>0:
        input_tax=_ledger(db,tenant.organization_id,tenant.user_id,system_key="input_tax_receivable",code="1210",name="Input Tax Receivable",category="asset",normal_balance="debit")
        lines.append(PostingLine(ledger_account_id=input_tax.id,debit=recoverable_total,currency=currency,description=f"Recoverable input tax {receipt.receipt_number}"))
    lines.append(PostingLine(ledger_account_id=payable.id,credit=total,currency=currency,description=f"Inventory payable to {receipt.supplier_name}"))
    post_journal(db,organization_id=tenant.organization_id,user_id=tenant.user_id,entry_date=receipt.receipt_date,source_type="inventory_purchase_receipt",source_id=receipt.id,lines=lines,reference=receipt.reference,memo=f"Inventory received from {receipt.supplier_name}")
    record_activity(db,action="inventory.purchase.received",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="purchase_receipt",entity_id=receipt.id,after={"receipt_number":receipt.receipt_number,"supplier":receipt.supplier_name,"warehouse_id":warehouse.id,"subtotal":str(subtotal),"tax":str(tax_total),"total":str(total),"currency":currency},request=request)
    db.commit();return {"id":receipt.id,"receipt_number":receipt.receipt_number,"total":receipt.total,"currency":receipt.currency,"status":receipt.status}
