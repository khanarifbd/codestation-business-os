from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.inventory import create_product, create_warehouse, receive_purchase
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.inventory import InventoryBalance, Product, StockMovement
from app.schemas.inventory import ProductCreate, PurchaseLineInput, PurchaseReceiptCreate, WarehouseCreate


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


def request(method: str, path: str) -> Request:
    return Request({"type":"http","method":method,"path":path,"raw_path":path.encode(),"headers":[],"query_string":b"","scheme":"https","server":("testserver",443),"client":("127.0.0.1",50000)})


def main() -> None:
    with engine.begin() as conn:
        row=conn.execute(text("""SELECT o.id organization_id,o.created_by_user_id user_id,o.currency,m.id membership_id FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1""")).mappings().one()
    tenant=Tenant(str(row["organization_id"]),str(row["user_id"]),str(row["membership_id"]),Org(str(row["organization_id"]),str(row["currency"] or "BDT")))
    db=SessionLocal(); marker=uuid4().hex[:8]
    try:
        warehouse=create_warehouse(WarehouseCreate(code=f"W{marker[:5]}",name=f"CI Warehouse {marker}",is_default=False),request("POST","/inventory/warehouses"),db,tenant)  # type: ignore[arg-type]
        product=create_product(ProductCreate(sku=f"SKU-{marker}",name="CI Inventory Product",item_type="stock_item",unit="pcs",currency=tenant.organization.currency,selling_price=Decimal("200"),standard_cost=Decimal("0"),reorder_level=Decimal("2")),request("POST","/inventory/products"),db,tenant)  # type: ignore[arg-type]
        p1=receive_purchase(PurchaseReceiptCreate(supplier_name="CI Supplier",warehouse_id=warehouse.id,receipt_date=date(2099,1,2),currency=tenant.organization.currency,items=[PurchaseLineInput(product_id=product["id"],quantity=Decimal("10"),unit_cost=Decimal("100"))]),request("POST","/inventory/purchases"),db,tenant)  # type: ignore[arg-type]
        p2=receive_purchase(PurchaseReceiptCreate(supplier_name="CI Supplier",warehouse_id=warehouse.id,receipt_date=date(2099,1,3),currency=tenant.organization.currency,items=[PurchaseLineInput(product_id=product["id"],quantity=Decimal("10"),unit_cost=Decimal("120"))]),request("POST","/inventory/purchases"),db,tenant)  # type: ignore[arg-type]
        bal=db.scalar(select(InventoryBalance).where(InventoryBalance.organization_id==tenant.organization_id,InventoryBalance.product_id==product["id"],InventoryBalance.warehouse_id==warehouse.id))
        if bal is None or Decimal(bal.on_hand_quantity)!=Decimal("20.0000") or Decimal(bal.average_unit_cost)!=Decimal("110.0000") or Decimal(bal.inventory_value)!=Decimal("2200.0000"):
            raise AssertionError(f"weighted-average inventory failed: {bal.on_hand_quantity if bal else None}, {bal.average_unit_cost if bal else None}, {bal.inventory_value if bal else None}")
        count=db.scalar(select(func.count()).select_from(StockMovement).where(StockMovement.organization_id==tenant.organization_id,StockMovement.product_id==product["id"],StockMovement.source_type=="purchase_receipt"))
        if count!=2: raise AssertionError(f"expected 2 purchase movements, got {count}")
        for purchase_id in [p1["id"],p2["id"]]:
            journal=db.scalar(select(JournalEntry).where(JournalEntry.organization_id==tenant.organization_id,JournalEntry.source_type=="inventory_purchase_receipt",JournalEntry.source_id==purchase_id,JournalEntry.status=="posted"))
            if journal is None: raise AssertionError("inventory purchase journal missing")
            lines=db.scalars(select(JournalLine).where(JournalLine.journal_entry_id==journal.id)).all()
            if sum(Decimal(x.debit) for x in lines)!=sum(Decimal(x.credit) for x in lines): raise AssertionError("inventory purchase journal is not balanced")
        inventory_ledger=db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id==tenant.organization_id,LedgerAccount.system_key=="inventory_asset"))
        payable=db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id==tenant.organization_id,LedgerAccount.system_key=="accounts_payable"))
        if inventory_ledger is None or payable is None: raise AssertionError("inventory/AP system ledgers missing")
        stored=db.scalar(select(Product).where(Product.id==product["id"]))
        if stored is None or Decimal(stored.last_purchase_cost)!=Decimal("120.0000"): raise AssertionError("last purchase cost not updated")
    finally: db.close()
    print("inventory verification passed: catalog -> warehouse -> purchases -> weighted average -> stock ledger -> balanced accounting")

if __name__=="__main__": main()
