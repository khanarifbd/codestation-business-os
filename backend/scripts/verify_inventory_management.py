from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.inventory import create_category, create_product, create_warehouse
from app.api.v1.inventory_management import create_supplier, update_category, update_product, update_supplier, update_warehouse
from app.db.session import SessionLocal, engine
from app.models.expenses import Vendor
from app.models.inventory import Product, ProductCategory, Warehouse
from app.schemas.inventory import CategoryCreate, ProductCreate, WarehouseCreate
from app.schemas.inventory_management import CategoryUpdate, ProductUpdate, SupplierCreate, SupplierUpdate, WarehouseUpdate


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


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""SELECT o.id organization_id,o.created_by_user_id user_id,o.currency,m.id membership_id FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1""")).mappings().one()
    tenant = Tenant(str(row["organization_id"]), str(row["user_id"]), str(row["membership_id"]), Org(str(row["organization_id"]), str(row["currency"] or "BDT")))
    db = SessionLocal(); marker = uuid4().hex[:7].upper()
    try:
        category = create_category(CategoryCreate(name=f"UX Category {marker}"), req("POST", "/inventory/categories"), db, tenant)  # type: ignore[arg-type]
        updated_category = update_category(category.id, CategoryUpdate(name=f"UX Category Updated {marker}"), req("PATCH", "/inventory/categories/x"), db, tenant)  # type: ignore[arg-type]
        if "Updated" not in updated_category.name: raise AssertionError("category update failed")

        warehouse = create_warehouse(WarehouseCreate(code=f"UX{marker[:5]}", name=f"UX Warehouse {marker}"), req("POST", "/inventory/warehouses"), db, tenant)  # type: ignore[arg-type]
        updated_warehouse = update_warehouse(warehouse.id, WarehouseUpdate(name=f"UX Warehouse Updated {marker}", is_default=True), req("PATCH", "/inventory/warehouses/x"), db, tenant)  # type: ignore[arg-type]
        if not updated_warehouse.is_default or "Updated" not in updated_warehouse.name: raise AssertionError("warehouse update/default failed")

        product = create_product(ProductCreate(sku=f"UX-{marker}", name="UX Service", item_type="service", currency=tenant.organization.currency, selling_price=Decimal("250")), req("POST", "/inventory/products"), db, tenant)  # type: ignore[arg-type]
        updated_product = update_product(product["id"], ProductUpdate(name="UX Service Updated", selling_price=Decimal("300"), category_id=category.id), req("PATCH", "/inventory/products/x"), db, tenant)  # type: ignore[arg-type]
        if updated_product["name"] != "UX Service Updated" or Decimal(updated_product["selling_price"]) != Decimal("300"): raise AssertionError("product/service update failed")

        supplier = create_supplier(SupplierCreate(name=f"UX Supplier {marker}", email="supplier@example.com", currency=tenant.organization.currency), req("POST", "/inventory/suppliers"), db, tenant)  # type: ignore[arg-type]
        updated_supplier = update_supplier(supplier["id"], SupplierUpdate(contact_name="Test Contact", phone="+8801000000000", is_active=False), req("PATCH", "/inventory/suppliers/x"), db, tenant)  # type: ignore[arg-type]
        if updated_supplier["contact_name"] != "Test Contact" or updated_supplier["is_active"] is not False: raise AssertionError("supplier update/disable failed")

        if db.scalar(select(ProductCategory.id).where(ProductCategory.id == category.id)) is None: raise AssertionError("category persistence failed")
        if db.scalar(select(Warehouse.id).where(Warehouse.id == warehouse.id)) is None: raise AssertionError("warehouse persistence failed")
        if db.scalar(select(Product.id).where(Product.id == product["id"])) is None: raise AssertionError("product persistence failed")
        if db.scalar(select(Vendor.id).where(Vendor.id == supplier["id"])) is None: raise AssertionError("supplier persistence failed")
    finally:
        db.close()
    print("inventory management verification passed: category, warehouse, item and supplier CRUD")


if __name__ == "__main__":
    main()
