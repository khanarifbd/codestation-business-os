from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.finance import (
    change_invoice_status,
    create_account,
    create_invoice_from_order,
    finance_summary,
    record_payment,
)
from app.db.session import SessionLocal, engine
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice
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


def make_request(method: str, path: str) -> Request:
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "headers": [], "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def expect_http_error(expected_status: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != expected_status:
            raise AssertionError(f"Expected HTTP {expected_status}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {expected_status}, but request succeeded")


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id, timezone, currency, name
            FROM organizations
            WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()
        for table_name in ("financial_accounts", "invoices", "invoice_items", "payments", "financial_transactions"):
            if connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table_name}"}).scalar_one() is None:
                raise AssertionError(f"missing finance table: {table_name}")
        payment_prefix = connection.execute(text("""
            SELECT prefix FROM organization_document_sequences
            WHERE organization_id=:organization_id AND document_type='payment'
        """), {"organization_id": fixture["organization_id"]}).scalar_one()
        if payment_prefix != "PAY":
            raise AssertionError("payment sequence was not backfilled")

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
            raise AssertionError("finance verification requires an order fixture")

        usd_account = create_account(
            FinancialAccountCreate(name="CI USD Bank", account_type="bank", currency=order.currency, opening_balance=Decimal("10.00")),
            make_request("POST", "/api/v1/finance/accounts"), db, tenant,  # type: ignore[arg-type]
        )
        cross_currency = "BDT" if order.currency != "BDT" else "USD"
        fx_account = create_account(
            FinancialAccountCreate(name=f"CI {cross_currency} Wallet", account_type="wallet", provider_name="CI Wallet", currency=cross_currency),
            make_request("POST", "/api/v1/finance/accounts"), db, tenant,  # type: ignore[arg-type]
        )

        invoice = create_invoice_from_order(
            order.id, make_request("POST", f"/api/v1/finance/invoices/from-order/{order.id}"), db, tenant,  # type: ignore[arg-type]
        )
        if invoice.status != "draft" or invoice.balance_due != invoice.total or not invoice.invoice_number.startswith("INV-"):
            raise AssertionError("order invoice draft/balance/numbering is incorrect")

        expect_http_error(409, lambda: record_payment(
            PaymentCreate(invoice_id=invoice.id, account_id=usd_account.id, invoice_amount=Decimal("1.00")),
            make_request("POST", "/api/v1/finance/payments"), db, tenant,  # type: ignore[arg-type]
        ))
        db.rollback()

        sent = change_invoice_status(
            invoice.id, InvoiceStatusAction(action="send"),
            make_request("PATCH", f"/api/v1/finance/invoices/{invoice.id}/status"), db, tenant,  # type: ignore[arg-type]
        )
        if sent.status != "sent" or sent.sent_at is None:
            raise AssertionError("draft invoice did not send")

        half = (Decimal(sent.total) / Decimal("2")).quantize(Decimal("0.01"))
        first = record_payment(
            PaymentCreate(invoice_id=sent.id, account_id=usd_account.id, invoice_amount=half, method="bank_transfer", reference="CI-PARTIAL"),
            make_request("POST", "/api/v1/finance/payments"), db, tenant,  # type: ignore[arg-type]
        )
        if first.invoice_amount != half or first.account_amount != half or first.exchange_rate != Decimal("1.00000000"):
            raise AssertionError("same-currency payment posting is incorrect")
        persisted = db.scalar(select(Invoice).where(Invoice.id == sent.id))
        if persisted is None or persisted.status != "partially_paid" or persisted.amount_paid != half:
            raise AssertionError("partial payment did not update invoice status/balance")

        remaining = Decimal(persisted.balance_due)
        fx_rate = Decimal("122.50000000")
        second = record_payment(
            PaymentCreate(invoice_id=sent.id, account_id=fx_account.id, invoice_amount=remaining, exchange_rate=fx_rate, method="other", reference="CI-FX-FINAL"),
            make_request("POST", "/api/v1/finance/payments"), db, tenant,  # type: ignore[arg-type]
        )
        expected_account_amount = (remaining * fx_rate).quantize(Decimal("0.01"))
        if second.account_amount != expected_account_amount or second.account_currency != cross_currency:
            raise AssertionError("cross-currency payment did not post account amount correctly")
        db.expire_all()
        paid = db.scalar(select(Invoice).where(Invoice.id == sent.id))
        if paid is None or paid.status != "paid" or paid.balance_due != Decimal("0.00") or paid.paid_at is None:
            raise AssertionError("final payment did not fully settle invoice")

        expect_http_error(409, lambda: record_payment(
            PaymentCreate(invoice_id=sent.id, account_id=usd_account.id, invoice_amount=Decimal("1.00")),
            make_request("POST", "/api/v1/finance/payments"), db, tenant,  # type: ignore[arg-type]
        ))
        db.rollback()

        usd_row = db.scalar(select(FinancialAccount).where(FinancialAccount.id == usd_account.id))
        fx_row = db.scalar(select(FinancialAccount).where(FinancialAccount.id == fx_account.id))
        if usd_row is None or fx_row is None:
            raise AssertionError("financial account was not persisted")
        usd_credit = db.scalar(select(Decimal if False else FinancialTransaction.amount).where(FinancialTransaction.account_id == usd_row.id, FinancialTransaction.source_type == "payment"))
        fx_credit = db.scalar(select(FinancialTransaction.amount).where(FinancialTransaction.account_id == fx_row.id, FinancialTransaction.source_type == "payment"))
        if usd_credit != half or fx_credit != expected_account_amount:
            raise AssertionError("payment ledger credits do not match payment amounts")

        summary = finance_summary(db, tenant)  # type: ignore[arg-type]
        if summary.paid_count < 1 or summary.payment_count < 2 or summary.account_count < 2:
            raise AssertionError("finance summary did not include settled invoice/payments/accounts")
    finally:
        db.close()

    print("finance invoice payment account ledger verification passed")


if __name__ == "__main__":
    main()
