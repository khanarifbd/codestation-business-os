from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.finance import change_invoice_status, create_account, create_invoice_from_order
from app.api.v1.financial_safety import safe_record_payment
from app.api.v1.router import api_router
from app.db.session import SessionLocal, engine
from app.models.finance import Invoice, Payment
from app.models.orders import Order
from app.schemas.finance import FinancialAccountCreate, InvoiceStatusAction, PaymentCreate


@dataclass(frozen=True)
class FixtureOrganization:
    timezone: str
    currency: str
    name: str


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: FixtureOrganization


def make_request(method: str, path: str, idempotency_key: str | None = None) -> Request:
    headers = []
    if idempotency_key:
        headers.append((b"idempotency-key", idempotency_key.encode()))
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "headers": headers, "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def assert_safety_route_precedence() -> None:
    expected = {
        "/finance/payments": "safe_record_payment",
        "/finance/expenses": "safe_create_expense",
        "/finance/transfers": "safe_record_transfer",
    }
    for path, endpoint_name in expected.items():
        matches = [route for route in api_router.routes if getattr(route, "path", None) == path and "POST" in getattr(route, "methods", set())]
        if not matches:
            raise AssertionError(f"missing POST route: {path}")
        if getattr(matches[0].endpoint, "__name__", "") != endpoint_name:
            raise AssertionError(f"financial safety route is not first for {path}")


def main() -> None:
    assert_safety_route_precedence()
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id, timezone, currency, name
            FROM organizations
            WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()
        if connection.execute(text("SELECT to_regclass('public.posting_idempotency')")).scalar_one() is None:
            raise AssertionError("posting_idempotency table is missing")

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(
            timezone=str(fixture["timezone"] or "UTC"),
            currency=str(fixture["currency"] or "USD"),
            name=str(fixture["name"]),
        ),
    )
    db = SessionLocal()
    try:
        order = db.scalar(
            select(Order)
            .where(Order.organization_id == tenant.organization_id, Order.status != "cancelled")
            .order_by(Order.created_at.desc())
        )
        if order is None:
            raise AssertionError("idempotency verification requires an order fixture")

        suffix = uuid4().hex[:8]
        account = create_account(
            FinancialAccountCreate(name=f"CI Idempotency Bank {suffix}", account_type="bank", currency=order.currency, opening_balance=Decimal("0")),
            make_request("POST", "/api/v1/finance/accounts"), db, tenant,  # type: ignore[arg-type]
        )
        invoice = create_invoice_from_order(
            order.id, make_request("POST", f"/api/v1/finance/invoices/from-order/{order.id}"), db, tenant,  # type: ignore[arg-type]
        )
        sent = change_invoice_status(
            invoice.id,
            InvoiceStatusAction(action="send"),
            make_request("PATCH", f"/api/v1/finance/invoices/{invoice.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        payment_amount = min(Decimal("1.00"), Decimal(sent.balance_due))
        payload = PaymentCreate(
            invoice_id=sent.id,
            account_id=account.id,
            invoice_amount=payment_amount,
            method="bank_transfer",
            reference=f"CI-IDEM-{suffix}",
        )
        key = f"ci-idempotency-{suffix}"
        first = safe_record_payment(
            payload,
            make_request("POST", "/api/v1/finance/payments", key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        second = safe_record_payment(
            payload,
            make_request("POST", "/api/v1/finance/payments", key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if first.id != second.id:
            raise AssertionError("replayed payment created a second resource")
        count = db.scalar(
            select(func.count(Payment.id)).where(
                Payment.organization_id == tenant.organization_id,
                Payment.invoice_id == sent.id,
                Payment.reference == payload.reference,
            )
        )
        if count != 1:
            raise AssertionError(f"expected one idempotent payment, found {count}")
        db.expire_all()
        persisted = db.scalar(select(Invoice).where(Invoice.id == sent.id))
        if persisted is None or Decimal(persisted.amount_paid) != payment_amount:
            raise AssertionError("replayed payment changed invoice balance twice")
    finally:
        db.close()

    print("financial idempotency verification passed")


if __name__ == "__main__":
    main()
