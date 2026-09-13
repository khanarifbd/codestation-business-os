from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.inventory import create_product, create_warehouse, receive_purchase
from app.api.v1.inventory_workflows import dashboard_summary, transfer_stock
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry
from app.models.inventory import InventoryBalance, StockMovement
from app.schemas.inventory import ProductCreate, PurchaseLineInput, PurchaseReceiptCreate, WarehouseCreate
from app.schemas.inventory_workflows import InventoryTransferCreate
from app.services.activity_log import record_activity


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
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "headers": [],
        "query_string": b"",
        "scheme": "https",
        "server": ("testserver", 443),
        "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id,o.created_by_user_id user_id,o.currency,m.id membership_id
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()

    tenant = Tenant(
        str(row["organization_id"]),
        str(row["user_id"]),
        str(row["membership_id"]),
        Org(str(row["organization_id"]), str(row["currency"] or "BDT")),
    )
    db = SessionLocal()
    marker = uuid4().hex[:7].upper()
    try:
        source = create_warehouse(
            WarehouseCreate(code=f"TS{marker[:5]}", name=f"Transfer Source {marker}"),
            request("POST", "/inventory/warehouses"), db, tenant,  # type: ignore[arg-type]
        )
        destination = create_warehouse(
            WarehouseCreate(code=f"TD{marker[:5]}", name=f"Transfer Destination {marker}"),
            request("POST", "/inventory/warehouses"), db, tenant,  # type: ignore[arg-type]
        )
        product = create_product(
            ProductCreate(
                sku=f"TR-{marker}",
                name="Transfer Product",
                item_type="stock_item",
                unit="pcs",
                currency=tenant.organization.currency,
                selling_price=Decimal("150"),
                reorder_level=Decimal("2"),
            ),
            request("POST", "/inventory/products"), db, tenant,  # type: ignore[arg-type]
        )
        receive_purchase(
            PurchaseReceiptCreate(
                supplier_name="Transfer Fixture Supplier",
                warehouse_id=source.id,
                receipt_date=date(2099, 3, 1),
                currency=tenant.organization.currency,
                items=[PurchaseLineInput(product_id=product["id"], quantity=Decimal("10"), unit_cost=Decimal("100"))],
            ),
            request("POST", "/inventory/purchases"), db, tenant,  # type: ignore[arg-type]
        )

        result = transfer_stock(
            InventoryTransferCreate(
                product_id=product["id"],
                from_warehouse_id=source.id,
                to_warehouse_id=destination.id,
                transfer_date=date(2099, 3, 2),
                quantity=Decimal("4"),
                reason="Move stock for fulfillment",
                reference=f"MOVE-{marker}",
            ),
            request("POST", "/inventory/transfers"), db, tenant,  # type: ignore[arg-type]
        )

        source_balance = db.scalar(select(InventoryBalance).where(
            InventoryBalance.organization_id == tenant.organization_id,
            InventoryBalance.product_id == product["id"],
            InventoryBalance.warehouse_id == source.id,
        ))
        destination_balance = db.scalar(select(InventoryBalance).where(
            InventoryBalance.organization_id == tenant.organization_id,
            InventoryBalance.product_id == product["id"],
            InventoryBalance.warehouse_id == destination.id,
        ))
        if source_balance is None or destination_balance is None:
            raise AssertionError("warehouse transfer balances missing")
        if Decimal(source_balance.on_hand_quantity) != Decimal("6.0000"):
            raise AssertionError(f"source quantity incorrect: {source_balance.on_hand_quantity}")
        if Decimal(destination_balance.on_hand_quantity) != Decimal("4.0000"):
            raise AssertionError(f"destination quantity incorrect: {destination_balance.on_hand_quantity}")
        if Decimal(source_balance.inventory_value) + Decimal(destination_balance.inventory_value) != Decimal("1000.0000"):
            raise AssertionError("warehouse transfer changed total inventory value")

        movement_types = set(db.scalars(select(StockMovement.movement_type).where(
            StockMovement.organization_id == tenant.organization_id,
            StockMovement.source_type == "warehouse_transfer",
            StockMovement.source_id == result["id"],
        )).all())
        if movement_types != {"transfer_out", "transfer_in"}:
            raise AssertionError(f"transfer movements incorrect: {movement_types}")
        journal_count = db.scalar(select(func.count()).select_from(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.source_type == "warehouse_transfer",
            JournalEntry.source_id == result["id"],
        )) or 0
        if journal_count != 0:
            raise AssertionError("internal warehouse transfer must not create an accounting journal")

        foreign_currency = "USD" if tenant.organization.currency.upper() != "USD" else "EUR"
        foreign_product = create_product(
            ProductCreate(
                sku=f"FX-{marker}",
                name="Foreign Currency Stock",
                item_type="stock_item",
                currency=foreign_currency,
                selling_price=Decimal("20"),
                reorder_level=Decimal("1"),
            ),
            request("POST", "/inventory/products"), db, tenant,  # type: ignore[arg-type]
        )
        foreign_balance = InventoryBalance(
            organization_id=tenant.organization_id,
            product_id=foreign_product["id"],
            warehouse_id=destination.id,
            on_hand_quantity=Decimal("5"),
            average_unit_cost=Decimal("10"),
            inventory_value=Decimal("50"),
        )
        db.add(foreign_balance)
        db.flush()
        record_activity(
            db,
            action="inventory.fixture.foreign_balance",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="inventory_balance",
            entity_id=foreign_balance.id,
            after={"currency": foreign_currency, "inventory_value": "50.0000"},
            request=request("POST", "/inventory/test-fixture"),
        )
        db.commit()

        summary = dashboard_summary(db, tenant)  # type: ignore[arg-type]
        values = {item["currency"]: Decimal(item["value"]) for item in summary["inventory_values"]}
        if tenant.organization.currency.upper() not in values or foreign_currency not in values:
            raise AssertionError(f"inventory values were not separated by currency: {values}")
        if values[foreign_currency] != Decimal("50.0000"):
            raise AssertionError(f"foreign inventory value incorrect: {values[foreign_currency]}")
    finally:
        db.close()

    print("inventory workflow verification passed: currency-separated overview and warehouse transfer integrity")


if __name__ == "__main__":
    main()
