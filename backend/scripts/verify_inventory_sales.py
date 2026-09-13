from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.inventory import create_product, create_warehouse, receive_purchase
from app.api.v1.inventory_fulfillment import fulfill_order, reverse_fulfillment
from app.api.v1.inventory_management import update_product
from app.api.v1.manual_orders import create_manual_order
from app.api.v1.orders import change_order_status, get_order
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.company_defaults import OrganizationExchangeRate
from app.models.inventory import InventoryBalance, StockMovement
from app.models.inventory_sales import OrderFulfillment, OrderFulfillmentItem
from app.schemas.inventory import ProductCreate, PurchaseLineInput, PurchaseReceiptCreate, WarehouseCreate
from app.schemas.inventory_management import ProductUpdate
from app.schemas.orders import FulfillmentCreate, FulfillmentLineInput, FulfillmentReverse, ManualOrderCreate, OrderItemInput, OrderStatusChange
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


def req(method: str, path: str, *, idempotency_key: str | None = None) -> Request:
    headers = []
    if idempotency_key:
        headers.append((b"idempotency-key", idempotency_key.encode()))
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "headers": headers, "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def expect(status_code: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != status_code:
            raise AssertionError(f"Expected HTTP {status_code}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {status_code}, but request succeeded")


def alternate_currency(base_currency: str) -> str:
    return "USD" if base_currency.upper() != "USD" else "EUR"


def upsert_direct_rate(db, organization_id: str, user_id: str, source_currency: str, base_currency: str, rate: Decimal) -> None:
    row = db.scalar(select(OrganizationExchangeRate).where(
        OrganizationExchangeRate.organization_id == organization_id,
        OrganizationExchangeRate.base_currency == source_currency,
        OrganizationExchangeRate.quote_currency == base_currency,
    ))
    before = None
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
        db.add(row); db.flush()
        action = "company.exchange_rate.created"; method = "POST"
    else:
        before = {
            "base_currency": row.base_currency,
            "quote_currency": row.quote_currency,
            "reference_rate": str(row.reference_rate) if row.reference_rate is not None else None,
            "manual_rate": str(row.manual_rate) if row.manual_rate is not None else None,
            "effective_rate": str(row.effective_rate),
            "source": row.source,
        }
        row.reference_rate = rate; row.manual_rate = rate; row.effective_rate = rate
        row.source = "manual"; row.synced_at = datetime.now(timezone.utc)
        action = "company.exchange_rate.updated"; method = "PATCH"
    record_activity(
        db,
        action=action,
        scope="tenant",
        actor_user_id=user_id,
        organization_id=organization_id,
        entity_type="organization_exchange_rate",
        entity_id=row.id,
        before=before,
        after={
            "base_currency": row.base_currency,
            "quote_currency": row.quote_currency,
            "reference_rate": str(row.reference_rate) if row.reference_rate is not None else None,
            "manual_rate": str(row.manual_rate) if row.manual_rate is not None else None,
            "effective_rate": str(row.effective_rate),
            "source": row.source,
        },
        message=f"Verification exchange rate {source_currency}/{base_currency} set to {rate}",
        request=req(method, "/company-settings/exchange-rates"),
    )
    db.commit()


def balance_for(db, organization_id: str, product_id: str, warehouse_id: str) -> InventoryBalance:
    balance = db.scalar(select(InventoryBalance).where(
        InventoryBalance.organization_id == organization_id,
        InventoryBalance.product_id == product_id,
        InventoryBalance.warehouse_id == warehouse_id,
    ))
    if balance is None:
        raise AssertionError("inventory balance missing")
    return balance


def source_journal(db, organization_id: str, source_type: str, source_id: str) -> JournalEntry:
    journal = db.scalar(select(JournalEntry).where(
        JournalEntry.organization_id == organization_id,
        JournalEntry.source_type == source_type,
        JournalEntry.source_id == source_id,
        JournalEntry.status == "posted",
    ))
    if journal is None:
        raise AssertionError(f"journal missing for {source_type}:{source_id}")
    return journal


def journal_by_key(db, journal_id: str) -> dict[str, tuple[Decimal, Decimal]]:
    rows = db.execute(
        select(LedgerAccount.system_key, JournalLine.debit, JournalLine.credit)
        .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
        .where(JournalLine.journal_entry_id == journal_id)
    ).all()
    return {key: (Decimal(debit), Decimal(credit)) for key, debit, credit in rows}


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT o.id organization_id,o.created_by_user_id user_id,o.currency,o.timezone,m.id membership_id
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()
        client_id = connection.execute(text("""
            SELECT id FROM clients
            WHERE organization_id=:organization_id AND status='active'
            ORDER BY created_at DESC LIMIT 1
        """), {"organization_id": fixture["organization_id"]}).scalar_one()

    base_currency = str(fixture["currency"] or "BDT").upper()
    foreign_currency = alternate_currency(base_currency)
    tenant = Tenant(
        str(fixture["organization_id"]),
        str(fixture["user_id"]),
        str(fixture["membership_id"]),
        Org(str(fixture["organization_id"]), base_currency, str(fixture["timezone"] or "UTC")),
    )
    marker = uuid4().hex[:8].upper()
    db = SessionLocal()
    try:
        warehouse = create_warehouse(
            WarehouseCreate(code=f"SF{marker[:5]}", name=f"Sales Fulfillment {marker}"),
            req("POST", "/inventory/warehouses"), db, tenant,  # type: ignore[arg-type]
        )
        product = create_product(
            ProductCreate(
                sku=f"SALE-{marker}", name=f"CI Sale Product {marker}", item_type="stock_item",
                unit="pcs", currency=base_currency, selling_price=Decimal("180"), reorder_level=Decimal("1"),
            ),
            req("POST", "/inventory/products"), db, tenant,  # type: ignore[arg-type]
        )
        receive_purchase(
            PurchaseReceiptCreate(
                supplier_name="Sales Supplier", warehouse_id=warehouse.id, receipt_date=date(2099, 2, 1),
                currency=base_currency,
                items=[PurchaseLineInput(product_id=product["id"], quantity=Decimal("10"), unit_cost=Decimal("100"))],
            ),
            req("POST", "/inventory/purchases"), db, tenant,  # type: ignore[arg-type]
        )
        opening = balance_for(db, tenant.organization_id, product["id"], warehouse.id)
        if (Decimal(opening.on_hand_quantity), Decimal(opening.inventory_value), Decimal(opening.inventory_value_base or 0)) != (Decimal("10"), Decimal("1000"), Decimal("1000")):
            raise AssertionError("same-currency purchase carrying value failed")

        expect(409, lambda: update_product(
            product["id"], ProductUpdate(currency=foreign_currency),
            req("PATCH", f"/inventory/products/{product['id']}"), db, tenant,  # type: ignore[arg-type]
        ))
        db.rollback()
        expect(409, lambda: update_product(
            product["id"], ProductUpdate(item_type="non_stock_item"),
            req("PATCH", f"/inventory/products/{product['id']}"), db, tenant,  # type: ignore[arg-type]
        ))
        db.rollback()

        order = create_manual_order(
            ManualOrderCreate(
                client_id=str(client_id), subject="Product order", order_date=date(2099, 2, 2), currency=base_currency,
                items=[OrderItemInput(product_id=product["id"], description="CI Sale Product", quantity=Decimal("4"), unit_price=Decimal("180"))],
            ),
            req("POST", "/sales/orders"), db, tenant,  # type: ignore[arg-type]
        )
        line = order.items[0]
        if line.item_type_snapshot != "stock_item" or Decimal(line.remaining_quantity) != Decimal("4"):
            raise AssertionError("stock order did not preserve fulfillment requirement")
        expect(409, lambda: change_order_status(
            order.id, OrderStatusChange(status="completed"),
            req("PATCH", f"/sales/orders/{order.id}/status"), db, tenant,  # type: ignore[arg-type]
        ))
        db.rollback()

        first_key = f"fulfill-{marker}-first"
        first_payload = FulfillmentCreate(
            warehouse_id=warehouse.id, fulfillment_date=date(2099, 2, 3),
            items=[FulfillmentLineInput(order_item_id=line.id, quantity=Decimal("2"))],
        )
        first = fulfill_order(
            order.id, first_payload,
            req("POST", f"/sales/orders/{order.id}/fulfillments", idempotency_key=first_key), db, tenant,  # type: ignore[arg-type]
        )
        if (Decimal(first.total_cogs), Decimal(first.total_cogs_base)) != (Decimal("200"), Decimal("200")):
            raise AssertionError("same-currency fulfillment COGS failed")
        after_first = balance_for(db, tenant.organization_id, product["id"], warehouse.id)
        if (Decimal(after_first.on_hand_quantity), Decimal(after_first.inventory_value_base or 0)) != (Decimal("8"), Decimal("800")):
            raise AssertionError("partial fulfillment stock deduction failed")
        original_cogs = source_journal(db, tenant.organization_id, "inventory_sale_cogs", first.id)
        original_lines = journal_by_key(db, original_cogs.id)
        if original_lines.get("cost_of_sales") != (Decimal("200.00"), Decimal("0.00")) or original_lines.get("inventory_asset") != (Decimal("0.00"), Decimal("200.00")):
            raise AssertionError(f"COGS journal classification failed: {original_lines}")

        replay = fulfill_order(
            order.id, first_payload,
            req("POST", f"/sales/orders/{order.id}/fulfillments", idempotency_key=first_key), db, tenant,  # type: ignore[arg-type]
        )
        if replay.id != first.id or Decimal(balance_for(db, tenant.organization_id, product["id"], warehouse.id).on_hand_quantity) != Decimal("8"):
            raise AssertionError("idempotent fulfillment deducted stock twice")
        expect(409, lambda: fulfill_order(
            order.id,
            FulfillmentCreate(warehouse_id=warehouse.id, fulfillment_date=date(2099, 2, 3), items=[FulfillmentLineInput(order_item_id=line.id, quantity=Decimal("3"))]),
            req("POST", f"/sales/orders/{order.id}/fulfillments", idempotency_key=f"fulfill-{marker}-over"), db, tenant,  # type: ignore[arg-type]
        ))
        db.rollback()
        expect(409, lambda: change_order_status(
            order.id, OrderStatusChange(status="cancelled", reason="Verify posted fulfillment cancellation guard"),
            req("PATCH", f"/sales/orders/{order.id}/status"), db, tenant,  # type: ignore[arg-type]
        ))
        db.rollback()

        reverse_key = f"reverse-{marker}-first"
        reversed_first = reverse_fulfillment(
            order.id, first.id,
            FulfillmentReverse(reversal_date=date(2099, 2, 4), reason="Customer changed dispatch plan"),
            req("POST", f"/sales/orders/{order.id}/fulfillments/{first.id}/reverse", idempotency_key=reverse_key), db, tenant,  # type: ignore[arg-type]
        )
        if reversed_first.status != "reversed" or reversed_first.reversal_date != date(2099, 2, 4):
            raise AssertionError("fulfillment reversal state was not persisted")
        restored = balance_for(db, tenant.organization_id, product["id"], warehouse.id)
        if (Decimal(restored.on_hand_quantity), Decimal(restored.inventory_value), Decimal(restored.inventory_value_base or 0)) != (Decimal("10"), Decimal("1000"), Decimal("1000")):
            raise AssertionError("fulfillment reversal did not restore exact inventory carrying value")
        reversal = db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.reversed_entry_id == original_cogs.id,
            JournalEntry.status == "posted",
        ))
        if reversal is None:
            raise AssertionError("COGS reversal journal missing")
        reversal_lines = journal_by_key(db, reversal.id)
        if reversal_lines.get("inventory_asset") != (Decimal("200.00"), Decimal("0.00")) or reversal_lines.get("cost_of_sales") != (Decimal("0.00"), Decimal("200.00")):
            raise AssertionError(f"COGS reversal journal is incorrect: {reversal_lines}")
        reversal_replay = reverse_fulfillment(
            order.id, first.id,
            FulfillmentReverse(reversal_date=date(2099, 2, 4), reason="Customer changed dispatch plan"),
            req("POST", f"/sales/orders/{order.id}/fulfillments/{first.id}/reverse", idempotency_key=reverse_key), db, tenant,  # type: ignore[arg-type]
        )
        if reversal_replay.id != first.id or Decimal(balance_for(db, tenant.organization_id, product["id"], warehouse.id).on_hand_quantity) != Decimal("10"):
            raise AssertionError("idempotent reversal restored stock twice")
        reopened = get_order(order.id, db, tenant)  # type: ignore[arg-type]
        if Decimal(reopened.items[0].fulfilled_quantity) != 0 or Decimal(reopened.items[0].remaining_quantity) != Decimal("4"):
            raise AssertionError("reversed fulfillment still counted against order quantity")
        reversal_movements = db.scalar(select(func.count()).select_from(StockMovement).where(
            StockMovement.organization_id == tenant.organization_id,
            StockMovement.product_id == product["id"],
            StockMovement.movement_type == "sale_reversal",
        )) or 0
        if reversal_movements != 1:
            raise AssertionError("fulfillment reversal stock movement missing or duplicated")

        second = fulfill_order(
            order.id,
            FulfillmentCreate(warehouse_id=warehouse.id, fulfillment_date=date(2099, 2, 5), items=[FulfillmentLineInput(order_item_id=line.id, quantity=Decimal("4"))]),
            req("POST", f"/sales/orders/{order.id}/fulfillments", idempotency_key=f"fulfill-{marker}-second"), db, tenant,  # type: ignore[arg-type]
        )
        completed = change_order_status(
            order.id, OrderStatusChange(status="completed"),
            req("PATCH", f"/sales/orders/{order.id}/status"), db, tenant,  # type: ignore[arg-type]
        )
        if completed.status != "completed" or Decimal(completed.items[0].remaining_quantity) != 0:
            raise AssertionError("fully fulfilled order did not complete")
        final_balance = balance_for(db, tenant.organization_id, product["id"], warehouse.id)
        if (Decimal(final_balance.on_hand_quantity), Decimal(final_balance.inventory_value_base or 0)) != (Decimal("6"), Decimal("600")):
            raise AssertionError("final inventory balance after reversal/refill is incorrect")
        posted_quantity = db.scalar(
            select(func.coalesce(func.sum(OrderFulfillmentItem.quantity), 0))
            .join(OrderFulfillment, OrderFulfillment.id == OrderFulfillmentItem.fulfillment_id)
            .where(
                OrderFulfillmentItem.organization_id == tenant.organization_id,
                OrderFulfillmentItem.order_item_id == line.id,
                OrderFulfillment.status == "posted",
            )
        ) or 0
        if Decimal(posted_quantity) != Decimal("4") or second.id == first.id:
            raise AssertionError("posted fulfillment quantity/history is incorrect")

        upsert_direct_rate(db, tenant.organization_id, tenant.user_id, foreign_currency, base_currency, Decimal("120"))
        fx_product = create_product(
            ProductCreate(
                sku=f"FX-{marker}", name=f"FX Sale Product {marker}", item_type="stock_item",
                unit="pcs", currency=foreign_currency, selling_price=Decimal("180"), reorder_level=Decimal("1"),
            ),
            req("POST", "/inventory/products"), db, tenant,  # type: ignore[arg-type]
        )
        receive_purchase(
            PurchaseReceiptCreate(
                supplier_name="FX Supplier", warehouse_id=warehouse.id, receipt_date=date(2099, 3, 1), currency=foreign_currency,
                items=[PurchaseLineInput(product_id=fx_product["id"], quantity=Decimal("10"), unit_cost=Decimal("100"))],
            ),
            req("POST", "/inventory/purchases"), db, tenant,  # type: ignore[arg-type]
        )
        fx_open = balance_for(db, tenant.organization_id, fx_product["id"], warehouse.id)
        if (Decimal(fx_open.inventory_value), Decimal(fx_open.inventory_value_base or 0)) != (Decimal("1000"), Decimal("120000")):
            raise AssertionError("foreign purchase carrying value failed")
        fx_order = create_manual_order(
            ManualOrderCreate(
                client_id=str(client_id), subject="Foreign product order", order_date=date(2099, 3, 2), currency=foreign_currency,
                items=[OrderItemInput(product_id=fx_product["id"], description="FX Sale Product", quantity=Decimal("2"), unit_price=Decimal("180"))],
            ),
            req("POST", "/sales/orders"), db, tenant,  # type: ignore[arg-type]
        )
        upsert_direct_rate(db, tenant.organization_id, tenant.user_id, foreign_currency, base_currency, Decimal("130"))
        fx_fulfillment = fulfill_order(
            fx_order.id,
            FulfillmentCreate(warehouse_id=warehouse.id, fulfillment_date=date(2099, 3, 3), items=[FulfillmentLineInput(order_item_id=fx_order.items[0].id, quantity=Decimal("2"))]),
            req("POST", f"/sales/orders/{fx_order.id}/fulfillments", idempotency_key=f"fulfill-{marker}-fx"), db, tenant,  # type: ignore[arg-type]
        )
        if (Decimal(fx_fulfillment.total_cogs), Decimal(fx_fulfillment.total_cogs_base)) != (Decimal("200"), Decimal("24000")):
            raise AssertionError("foreign fulfillment used current FX instead of historical carrying value")
        if Decimal(fx_fulfillment.items[0].effective_rate_to_base) != Decimal("120.0000000000"):
            raise AssertionError("historical effective rate was not preserved")
        fx_final = balance_for(db, tenant.organization_id, fx_product["id"], warehouse.id)
        if (Decimal(fx_final.on_hand_quantity), Decimal(fx_final.inventory_value), Decimal(fx_final.inventory_value_base or 0)) != (Decimal("8"), Decimal("800"), Decimal("96000")):
            raise AssertionError("foreign fulfillment did not relieve source/base carrying value correctly")
        fx_cogs = source_journal(db, tenant.organization_id, "inventory_sale_cogs", fx_fulfillment.id)
        fx_lines = journal_by_key(db, fx_cogs.id)
        if fx_lines.get("cost_of_sales") != (Decimal("24000.00"), Decimal("0.00")) or fx_lines.get("inventory_asset") != (Decimal("0.00"), Decimal("24000.00")):
            raise AssertionError(f"foreign COGS journal is incorrect: {fx_lines}")
    finally:
        db.close()

    print("inventory sales verification passed: history guard -> partial/idempotent fulfillment -> reversal -> stock/COGS integrity -> historical FX")


if __name__ == "__main__":
    main()