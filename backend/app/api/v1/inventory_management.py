from __future__ import annotations

from decimal import Decimal
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.expenses import Vendor
from app.models.inventory import InventoryBalance, Product, ProductCategory, PurchaseReceipt, Warehouse
from app.models.tax import TaxCode
from app.schemas.inventory_management import CategoryUpdate, ProductUpdate, SupplierCreate, SupplierUpdate, WarehouseUpdate
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/inventory", tags=["Inventory Management"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def product_read(db: DbSession, organization_id: str, item: Product):
    on_hand = db.scalar(select(func.coalesce(func.sum(InventoryBalance.on_hand_quantity), 0)).where(InventoryBalance.organization_id == organization_id, InventoryBalance.product_id == item.id)) or 0
    inventory_value = db.scalar(select(func.coalesce(func.sum(InventoryBalance.inventory_value), 0)).where(InventoryBalance.organization_id == organization_id, InventoryBalance.product_id == item.id)) or 0
    category_name = db.scalar(select(ProductCategory.name).where(ProductCategory.id == item.category_id, ProductCategory.organization_id == organization_id)) if item.category_id else None
    return {
        "id": item.id, "sku": item.sku, "barcode": item.barcode, "name": item.name, "description": item.description,
        "item_type": item.item_type, "category_id": item.category_id, "category_name": category_name, "unit": item.unit,
        "currency": item.currency, "selling_price": item.selling_price, "standard_cost": item.standard_cost,
        "last_purchase_cost": item.last_purchase_cost, "reorder_level": item.reorder_level, "tax_code_id": item.tax_code_id,
        "track_inventory": item.track_inventory, "allow_negative_stock": item.allow_negative_stock, "is_active": item.is_active,
        "on_hand": on_hand, "inventory_value": inventory_value,
    }


@router.patch("/categories/{category_id}")
def update_category(category_id: str, payload: CategoryUpdate, request: Request, db: DbSession, tenant: Manager):
    row = db.scalar(select(ProductCategory).where(ProductCategory.id == category_id, ProductCategory.organization_id == tenant.organization_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Category not found")
    before = {"name": row.name, "description": row.description, "is_active": row.is_active}
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        name = data["name"].strip()
        duplicate = db.scalar(select(ProductCategory.id).where(ProductCategory.organization_id == tenant.organization_id, func.lower(ProductCategory.name) == name.lower(), ProductCategory.id != row.id))
        if duplicate:
            raise HTTPException(status_code=409, detail="Category already exists")
        row.name = name
    if "description" in data:
        row.description = clean(data["description"])
    if "is_active" in data:
        row.is_active = bool(data["is_active"])
    record_activity(db, action="inventory.category.updated", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="product_category", entity_id=row.id, before=before, after={"name": row.name, "description": row.description, "is_active": row.is_active}, message=f"Inventory category updated: {row.name}", request=request)
    db.commit(); db.refresh(row); return row


@router.patch("/warehouses/{warehouse_id}")
def update_warehouse(warehouse_id: str, payload: WarehouseUpdate, request: Request, db: DbSession, tenant: Manager):
    row = db.scalar(select(Warehouse).where(Warehouse.id == warehouse_id, Warehouse.organization_id == tenant.organization_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    before = {"code": row.code, "name": row.name, "address": row.address, "is_default": row.is_default, "is_active": row.is_active}
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_active") is False:
        quantity = db.scalar(select(func.coalesce(func.sum(InventoryBalance.on_hand_quantity), 0)).where(InventoryBalance.organization_id == tenant.organization_id, InventoryBalance.warehouse_id == row.id)) or 0
        if Decimal(quantity) != 0:
            raise HTTPException(status_code=409, detail="Move or adjust all stock out of this warehouse before deactivating it")
        if row.is_default:
            raise HTTPException(status_code=409, detail="Choose another default warehouse before deactivating this warehouse")
    if "code" in data:
        code = data["code"].strip().upper()
        duplicate = db.scalar(select(Warehouse.id).where(Warehouse.organization_id == tenant.organization_id, func.lower(Warehouse.code) == code.lower(), Warehouse.id != row.id))
        if duplicate:
            raise HTTPException(status_code=409, detail="Warehouse code already exists")
        row.code = code
    if "name" in data: row.name = data["name"].strip()
    if "address" in data: row.address = clean(data["address"])
    if data.get("is_default") is True:
        for other in db.scalars(select(Warehouse).where(Warehouse.organization_id == tenant.organization_id, Warehouse.is_default.is_(True), Warehouse.id != row.id)).all():
            other.is_default = False
        row.is_default = True
        row.is_active = True
    elif "is_default" in data:
        row.is_default = bool(data["is_default"])
    if "is_active" in data: row.is_active = bool(data["is_active"])
    record_activity(db, action="inventory.warehouse.updated", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="warehouse", entity_id=row.id, before=before, after={"code": row.code, "name": row.name, "address": row.address, "is_default": row.is_default, "is_active": row.is_active}, message=f"Warehouse updated: {row.name}", request=request)
    db.commit(); db.refresh(row); return row


@router.patch("/products/{product_id}")
def update_product(product_id: str, payload: ProductUpdate, request: Request, db: DbSession, tenant: Manager):
    row = db.scalar(select(Product).where(Product.id == product_id, Product.organization_id == tenant.organization_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Product or service not found")
    before = {"sku": row.sku, "name": row.name, "item_type": row.item_type, "selling_price": str(row.selling_price), "reorder_level": str(row.reorder_level), "is_active": row.is_active}
    data = payload.model_dump(exclude_unset=True)
    new_type = data.get("item_type", row.item_type)
    if new_type != "stock_item" and row.item_type == "stock_item":
        on_hand = db.scalar(select(func.coalesce(func.sum(InventoryBalance.on_hand_quantity), 0)).where(InventoryBalance.organization_id == tenant.organization_id, InventoryBalance.product_id == row.id)) or 0
        if Decimal(on_hand) != 0:
            raise HTTPException(status_code=409, detail="Stock items with quantity on hand cannot be changed to a service/non-stock item")
    if "sku" in data:
        sku = data["sku"].strip().upper()
        duplicate = db.scalar(select(Product.id).where(Product.organization_id == tenant.organization_id, func.lower(Product.sku) == sku.lower(), Product.id != row.id))
        if duplicate: raise HTTPException(status_code=409, detail="SKU already exists")
        row.sku = sku
    if "category_id" in data and data["category_id"]:
        if not db.scalar(select(ProductCategory.id).where(ProductCategory.id == data["category_id"], ProductCategory.organization_id == tenant.organization_id)):
            raise HTTPException(status_code=404, detail="Category not found")
    if "tax_code_id" in data and data["tax_code_id"]:
        if not db.scalar(select(TaxCode.id).where(TaxCode.id == data["tax_code_id"], TaxCode.organization_id == tenant.organization_id, TaxCode.tax_kind == "sales")):
            raise HTTPException(status_code=404, detail="Sales tax code not found")
    string_fields = {"barcode", "description"}
    for field, value in data.items():
        if field == "sku": continue
        if field in string_fields: value = clean(value)
        elif field in {"name", "unit"} and value is not None: value = value.strip()
        elif field == "currency" and value is not None: value = value.upper()
        setattr(row, field, value)
    if row.item_type != "stock_item":
        row.track_inventory = False
        row.allow_negative_stock = False
        row.reorder_level = Decimal("0")
    record_activity(db, action="inventory.product.updated", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="product", entity_id=row.id, before=before, after={"sku": row.sku, "name": row.name, "item_type": row.item_type, "selling_price": str(row.selling_price), "reorder_level": str(row.reorder_level), "is_active": row.is_active}, message=f"Inventory item updated: {row.sku} · {row.name}", request=request)
    db.commit(); db.refresh(row); return product_read(db, tenant.organization_id, row)


def supplier_read(db: DbSession, organization_id: str, row: Vendor):
    purchase_count = db.scalar(select(func.count(PurchaseReceipt.id)).where(PurchaseReceipt.organization_id == organization_id, PurchaseReceipt.vendor_id == row.id)) or 0
    purchased = db.scalar(select(func.coalesce(func.sum(PurchaseReceipt.total), 0)).where(PurchaseReceipt.organization_id == organization_id, PurchaseReceipt.vendor_id == row.id)) or 0
    outstanding = db.scalar(select(func.coalesce(func.sum(PurchaseReceipt.balance_due), 0)).where(PurchaseReceipt.organization_id == organization_id, PurchaseReceipt.vendor_id == row.id)) or 0
    return {"id": row.id, "vendor_code": row.vendor_code, "name": row.name, "contact_name": row.contact_name, "email": row.email, "phone": row.phone, "website": row.website, "tax_identifier": row.tax_identifier, "country_code": row.country_code, "currency": row.currency, "notes": row.notes, "is_active": row.is_active, "purchase_count": purchase_count, "purchased_total": purchased, "outstanding_total": outstanding}


@router.get("/suppliers")
def list_suppliers(db: DbSession, tenant: Viewer, include_inactive: bool = True):
    query = select(Vendor).where(Vendor.organization_id == tenant.organization_id)
    if not include_inactive: query = query.where(Vendor.is_active.is_(True))
    return [supplier_read(db, tenant.organization_id, row) for row in db.scalars(query.order_by(Vendor.is_active.desc(), Vendor.name.asc())).all()]


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
def create_supplier(payload: SupplierCreate, request: Request, db: DbSession, tenant: Manager):
    name = payload.name.strip()
    if db.scalar(select(Vendor.id).where(Vendor.organization_id == tenant.organization_id, func.lower(Vendor.name) == name.lower(), Vendor.is_active.is_(True))):
        raise HTTPException(status_code=409, detail="An active supplier with this name already exists")
    row = Vendor(organization_id=tenant.organization_id, vendor_code=f"SUP-{uuid4().hex[:8].upper()}", name=name, contact_name=clean(payload.contact_name), email=clean(payload.email), phone=clean(payload.phone), website=clean(payload.website), tax_identifier=clean(payload.tax_identifier), country_code=payload.country_code.upper() if payload.country_code else None, currency=payload.currency.upper() if payload.currency else tenant.organization.currency, notes=clean(payload.notes), is_active=True, created_by_user_id=tenant.user_id)
    db.add(row); db.flush()
    record_activity(db, action="inventory.supplier.created", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="vendor", entity_id=row.id, after={"vendor_code": row.vendor_code, "name": row.name, "currency": row.currency}, message=f"Supplier created: {row.name}", request=request)
    db.commit(); db.refresh(row); return supplier_read(db, tenant.organization_id, row)


@router.patch("/suppliers/{supplier_id}")
def update_supplier(supplier_id: str, payload: SupplierUpdate, request: Request, db: DbSession, tenant: Manager):
    row = db.scalar(select(Vendor).where(Vendor.id == supplier_id, Vendor.organization_id == tenant.organization_id).with_for_update())
    if row is None: raise HTTPException(status_code=404, detail="Supplier not found")
    before = {"name": row.name, "email": row.email, "phone": row.phone, "currency": row.currency, "is_active": row.is_active}
    data = payload.model_dump(exclude_unset=True)
    if "name" in data: row.name = data["name"].strip()
    for field in ["contact_name", "email", "phone", "website", "tax_identifier", "notes"]:
        if field in data: setattr(row, field, clean(data[field]))
    if "country_code" in data: row.country_code = data["country_code"].upper() if data["country_code"] else None
    if "currency" in data: row.currency = data["currency"].upper() if data["currency"] else None
    if "is_active" in data: row.is_active = bool(data["is_active"])
    record_activity(db, action="inventory.supplier.updated", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="vendor", entity_id=row.id, before=before, after={"name": row.name, "email": row.email, "phone": row.phone, "currency": row.currency, "is_active": row.is_active}, message=f"Supplier updated: {row.name}", request=request)
    db.commit(); db.refresh(row); return supplier_read(db, tenant.organization_id, row)
