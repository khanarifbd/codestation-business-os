from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.inventory import create_product, create_warehouse, receive_purchase
from app.api.v1.inventory_fulfillment import fulfill_order
from app.api.v1.manual_orders import create_manual_order
from app.api.v1.orders import change_order_status
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.company_defaults import OrganizationExchangeRate
from app.models.inventory import InventoryBalance, StockMovement
from app.models.inventory_sales import OrderFulfillment, OrderFulfillmentItem
from app.schemas.inventory import ProductCreate, PurchaseLineInput, PurchaseReceiptCreate, WarehouseCreate
from app.schemas.orders import FulfillmentCreate, FulfillmentLineInput, ManualOrderCreate, OrderItemInput, OrderStatusChange


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


def req(method: str, path: str, *, idempotency_key: str | None = None) -> Request:
    headers = []
    if idempotency_key:
        headers.append((b"idempotency-key", idempotency_key.encode()))
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "headers": headers,
            "query_string": b"",
            "scheme": "https",
            "server": ("testserver", 443),
            "client": ("127.0.0.1", 50000),
        }
    )


def expect(status_code: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != status_code:
            raise AssertionError(f"Expected HTTP {status_code}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {status_code}, but request succeeded")


def journal_amounts(db, organization_id: str, fulfillment_id: str) -> tuple[Decimal, Decimal]:
    journal = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == "inventory_sale_cogs",
            JournalEntry.source_id == fulfillment_id,
            JournalEntry.status == "posted",
        )
    )
    if journal is None:
        raise AssertionError("COGS journal missing")
    cogs = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == organization_id,
            LedgerAccount.system_key == "cost_of_sales",
        )
    )
    inventory = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == organization_id,
            LedgerAccount.system_key == "inventory_asset",
        )
    )
    if cogs is None or inventory is None:
        raise AssertionError("COGS/inventory ledger account missing")
    debit = db.scalar(
        select(func.coalesce(func.sum(JournalLine.debit), 0)).where(
            JournalLine.journal_entry_id == journal.id,
            JournalLine.ledger_account_id == cogs.id,
        )
    ) or Decimal("0")
    credit = db.scalar(
        select(func.coalesce(func.sum(JournalLine.credit), 0)).where(
            JournalLine.journal_entry_id == journal.id,
            JournalLine.ledger_account_id == inventory.id,
        )
    ) or Decimal("0")
    return Decimal(debit), Decimal(credit)


def upsert_direct_rate(db, organization_id: str, source_currency: str, base_currency: str, rate: Decimal) -> None:
    row = db.scalar(
        select(OrganizationExchangeRate).where(
            OrganizationExchangeRate.organization_id == organization_id,
            OrganizationExchangeRate.base_currency == source_currency,
            OrganizationExchangeRate.quote_currency == base_currency,
        )
    )
    if row is None:
        row = OrganizationExchangeRate(
            organization_id=organization_id,
            base_currency=source_currency,
            quote_currency=base_currency,
            reference_rate=rate,
            manual_rate=rate,
            effective_rate=rate,
            source="manual",
            synced_at=datetime.now(timezone.utc),
        )
        db.add(row)
    else:
        row.reference_rate = rate
        row.manual_rate = rate
        row.effective_rate = rate
        row.source = "manual"
        row.synced_at = datetime.now(timezone.utc)
    db.commit()


def alternate_currency(base_currency: str) -> str:
    return "USD" if base_currency.upper() != "USD" else "EUR"


def main() -> None:
    with engine.begin() as connection:
        row = connection.execute(
            text(
                """
                SELECT o.id organization_id, o.created_by_user_id user_id, o.currency, o.timezone, m.id membership_id
                FROM organizations o
                JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
                WHERE o.name='Existing Tenant Fixture'
                ORDER BY o.created_at DESC LIMIT 1
                """
            )
        ).mappings().one()
        client_id = connection.execute(
            text(
                """
                SELECT id FROM clients
                WHERE organization_id=:organization_id AND status='active'
                ORDER BY created_at DESC LIMIT 1
                """
            ),
            {"organization_id": row["organization_id"]},
        ).scalar_one()

    base_currency = str(row["currency"] or "BDT").upper()
    tenant = Tenant(
        str(row["organization_id"]),
        str(row["user_id"]),
        str(row["membership_id"]),
        Org(str(row["organization_id"]), base_currency, str(row["timezone"] or "UTC")),
    )
    db = SessionLocal()
    marker = uuid4().hex[:8].upper()
    try:
        warehouse = create_warehouse(
            WarehouseCreate(code=f"SF{marker[:5]}", name=f"Sales Fulfillment {marker}"),
            req("POST", "/inventory/warehouses"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        product = create_product(
            ProductCreate(
                sku=f"SALE-{marker}",
                name=f"CI Sale Product {marker}",
                item_type="stock_item",
                unit="pcs",
                currency=base_currency,
                selling_price=Decimal("180"),
                reorder_level=Decimal("1"),
            ),
            req("POST", "/inventory/products"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        receive_purchase(
            PurchaseReceiptCreate(
                supplier_name="Sales Supplier",
                warehouse_id=warehouse.id,
                receipt_date=date(2099, 2, 1),
                currency=base_currency,
                items=[PurchaseLineInput(product_id=product["id"], quantity=Decimal("10"), unit_cost=Decimal("100"))],
            ),
            req("POST", "/inventory/purchases"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        order = create_manual_order(
            ManualOrderCreate(
                client_id=str(client_id),
                subject="Product order",
                order_date=date(2099, 2, 2),
                currency=base_currency,
                items=[OrderItemInput(product_id=product["id"], description="CI Sale Product", quantity=Decimal("4"), unit_price=Decimal("180"))],
            ),
            req("POST", "/sales/orders"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        line = order.items[0]
        if line.product_id != product["id"] or line.item_type_snapshot != "stock_item" or Decimal(line.remaining_quantity) != Decimal("4"):
            raise AssertionError("product order snapshot/remaining quantity failed")

        expect(
            409,
            lambda: change_order_status(
                order.id,
                OrderStatusChange(status="completed"),
                req("PATCH", f"/sales/orders/{order.id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        first_key = f"fulfill-{marker}-first"
        first_payload = FulfillmentCreate(
            warehouse_id=warehouse.id,
            fulfillment_date=date(2099, 2, 3),
            items=[FulfillmentLineInput(order_item_id=line.id, quantity=Decimal("2"))],
        )
        first = fulfill_order(
            order.id,
            first_payload,
            req("POST", f"/sales/orders/{order.id}/fulfillments", idempotency_key=first_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if Decimal(first.total_cogs) != Decimal("200.0000") or Decimal(first.total_cogs_base) != Decimal("200.0000"):
            raise AssertionError(f"unexpected same-currency COGS {first.total_cogs}/{first.total_cogs_base}")
        balance = db.scalar(
            select(InventoryBalance).where(
                InventoryBalance.organization_id == tenant.organization_id,
                InventoryBalance.product_id == product["id"],
                InventoryBalance.warehouse_id == warehouse.id,
            )
        )
        if balance is None or Decimal(balance.on_hand_quantity) != Decimal("8.0000") or Decimal(balance.inventory_value) != Decimal("800.0000") or Decimal(balance.inventory_value_base or 0) != Decimal("800.0000"):
            raise AssertionError("partial fulfillment stock/base carrying value deduction failed")
        debit, credit = journal_amounts(db, tenant.organization_id, first.id)
        if debit != Decimal("200.00") or credit != Decimal("200.00"):
            raise AssertionError(f"COGS/inventory journal classification failed: {debit}/{credit}")

        replay = fulfill_order(
            order.id,
            first_payload,
            req("POST", f"/sales/orders/{order.id}/fulfillments", idempotency_key=first_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if replay.id != first.id:
            raise AssertionError("idempotent fulfillment retry created another resource")
        balance = db.scalar(
            select(InventoryBalance).where(
                InventoryBalance.organization_id == tenant.organization_id,
                InventoryBalance.product_id == product["id"],
                InventoryBalance.warehouse_id == warehouse.id,
            )
        )
        if Decimal(balance.on_hand_quantity) != Decimal("8.0000"):
            raise AssertionError("idempotent retry deducted stock twice")

        expect(
            409,
            lambda: fulfill_order(
                order.id,
                FulfillmentCreate(
                    warehouse_id=warehouse.id,
                    fulfillment_date=date(2099, 2, 3),
                    items=[FulfillmentLineInput(order_item_id=line.id, quantity=Decimal("3"))],
                ),
                req("POST", f"/sales/orders/{order.id}/fulfillments", idempotency_key=f"fulfill-{marker}-over"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        expect(
            409,
            lambda: change_order_status(
                order.id,
                OrderStatusChange(status="cancelled"),
                req("PATCH", f"/sales/orders/{order.id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        second = fulfill_order(
            order.id,
            FulfillmentCreate(
                warehouse_id=warehouse.id,
                fulfillment_date=date(2099, 2, 4),
                items=[FulfillmentLineInput(order_item_id=line.id, quantity=Decimal("2"))],
            ),
            req("POST", f"/sales/orders/{order.id}/fulfillments", idempotency_key=f"fulfill-{marker}-second"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        completed = change_order_status(
            order.id,
            OrderStatusChange(status="completed"),
            req("PATCH", f"/sales/orders/{order.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if completed.status != "completed" or Decimal(completed.items[0].remaining_quantity) != 0:
            raise AssertionError("fully fulfilled order did not complete")
        balance = db.scalar(
            select(InventoryBalance).where(
                InventoryBalance.organization_id == tenant.organization_id,
                InventoryBalance.product_id == product["id"],
                InventoryBalance.warehouse_id == warehouse.id,
            )
        )
        if Decimal(balance.on_hand_quantity) != Decimal("6.0000") or Decimal(balance.inventory_value_base or 0) != Decimal("600.0000"):
            raise AssertionError("final same-currency stock/base value failed")
        movements = db.scalars(
            select(StockMovement).where(
                StockMovement.organization_id == tenant.organization_id,
                StockMovement.product_id == product["id"],
                StockMovement.movement_type == "sale",
            )
        ).all()
        fulfillment_items = db.scalars(
            select(OrderFulfillmentItem).where(
                OrderFulfillmentItem.organization_id == tenant.organization_id,
                OrderFulfillmentItem.order_item_id == line.id,
            )
        ).all()
        if len(movements) != 2 or sum(Decimal(item.quantity) for item in fulfillment_items) != Decimal("4"):
            raise AssertionError("same-currency fulfillment history failed")
        if second.id == first.id:
            raise AssertionError("separate fulfillment should create a separate resource")

        # Cross-currency historical carrying cost verification. Purchase at 120 base
        # units per foreign currency, then change current settings to 130. Fulfillment
        # must relieve inventory/COGS at the stored historical 120 rate.
        foreign_currency = alternate_currency(base_currency)
        upsert_direct_rate(db, tenant.organization_id, foreign_currency, base_currency, Decimal("120"))
        fx_product = create_product(
            ProductCreate(
                sku=f"FX-{marker}",
                name=f"FX Sale Product {marker}",
                item_type="stock_item",
                unit="pcs",
                currency=foreign_currency,
                selling_price=Decimal("180"),
                reorder_level=Decimal("1"),
            ),
            req("POST", "/inventory/products"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        receive_purchase(
            PurchaseReceiptCreate(
                supplier_name="FX Supplier",
                warehouse_id=warehouse.id,
                receipt_date=date(2099, 3, 1),
                currency=foreign_currency,
                items=[PurchaseLineInput(product_id=fx_product["id"], quantity=Decimal("10"), unit_cost=Decimal("100"))],
            ),
            req("POST", "/inventory/purchases"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        fx_balance = db.scalar(
            select(InventoryBalance).where(
                InventoryBalance.organization_id == tenant.organization_id,
                InventoryBalance.product_id == fx_product["id"],
                InventoryBalance.warehouse_id == warehouse.id,
            )
        )
        if fx_balance is None or Decimal(fx_balance.inventory_value) != Decimal("1000.0000") or Decimal(fx_balance.inventory_value_base or 0) != Decimal("120000.0000"):
            raise AssertionError(f"foreign purchase carrying value failed: {fx_balance.inventory_value if fx_balance else None}/{fx_balance.inventory_value_base if fx_balance else None}")

        fx_order = create_manual_order(
            ManualOrderCreate(
                client_id=str(client_id),
                subject="Foreign product order",
                order_date=date(2099, 3, 2),
                currency=foreign_currency,
                items=[OrderItemInput(product_id=fx_product["id"], description="FX Sale Product", quantity=Decimal("2"), unit_price=Decimal("180"))],
            ),
            req("POST", "/sales/orders"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        upsert_direct_rate(db, tenant.organization_id, foreign_currency, base_currency, Decimal("130"))
        fx_fulfillment = fulfill_order(
            fx_order.id,
            FulfillmentCreate(
                warehouse_id=warehouse.id,
                fulfillment_date=date(2099, 3, 3),
                items=[FulfillmentLineInput(order_item_id=fx_order.items[0].id, quantity=Decimal("2"))],
            ),
            req("POST", f"/sales/orders/{fx_order.id}/fulfillments", idempotency_key=f"fulfill-{marker}-fx"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if Decimal(fx_fulfillment.total_cogs) != Decimal("200.0000") or Decimal(fx_fulfillment.total_cogs_base) != Decimal("24000.0000"):
            raise AssertionError(f"historical FX COGS failed: {fx_fulfillment.total_cogs}/{fx_fulfillment.total_cogs_base}")
        fx_debit, fx_credit = journal_amounts(db, tenant.organization_id, fx_fulfillment.id)
        if fx_debit != Decimal("24000.00") or fx_credit != Decimal("24000.00"):
            raise AssertionError(f"foreign COGS journal used current FX instead of historical carrying value: {fx_debit}/{fx_credit}")
        fx_item = db.scalar(
            select(OrderFulfillmentItem).where(
                OrderFulfillmentItem.organization_id == tenant.organization_id,
                OrderFulfillmentItem.fulfillment_id == fx_fulfillment.id,
            )
        )
        if fx_item is None or Decimal(fx_item.effective_rate_to_base) != Decimal("120.0000000000"):
            raise AssertionError(f"fulfillment did not preserve historical effective rate: {fx_item.effective_rate_to_base if fx_item else None}")
        fx_balance = db.scalar(
            select(InventoryBalance).where(
                InventoryBalance.organization_id == tenant.organization_id,
                InventoryBalance.product_id == fx_product["id"],
                InventoryBalance.warehouse_id == warehouse.id,
            )
        )
        if Decimal(fx_balance.on_hand_quantity) != Decimal("8.0000") or Decimal(fx_balance.inventory_value) != Decimal("800.0000") or Decimal(fx_balance.inventory_value_base or 0) != Decimal("96000.0000"):
            raise AssertionError("foreign fulfillment did not relieve original/base inventory carrying values correctly")

        fulfillment_count = db.scalar(
            select(func.count()).select_from(OrderFulfillment).where(
                OrderFulfillment.organization_id == tenant.organization_id,
                OrderFulfillment.id.in_([first.id, second.id, fx_fulfillment.id]),
            )
        ) or 0
        if fulfillment_count != 3:
            raise AssertionError("fulfillment resources were not persisted correctly")
    finally:
        db.close()

    print("inventory sales verification passed: partial/idempotent fulfillment -> stock out -> historical base-cost COGS -> completion guard")


if __name__ == "__main__":
    main()
