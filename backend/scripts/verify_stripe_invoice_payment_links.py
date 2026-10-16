"""No-network tests: stable signed Stripe invoice QR links, tenant isolation, expiry.

Uses rollback-only CI data. Never charges any live Stripe account.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1 import stripe_checkout
from app.api.v1.finance_invoice_payments import _invoice_payment_read
from app.api.v1.client_portal import ClientPortalInvoiceDetail
from app.db.session import SessionLocal
from app.models.crm import Client
from app.models.finance import FinancialAccount, Invoice
from app.models.organization import Organization
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_checkout import StripeCheckoutAttempt
from app.services.invoice_stripe_payment_link import (
    effective_invoice_payment_url, verify_public_invoice_link,
)
from app.core.config import settings


def request():
    return Request({
        "type": "http", "method": "GET", "path": "/api/v1/finance/stripe-checkout/pay",
        "headers": [], "query_string": b"", "scheme": "https",
        "client": ("127.0.0.1", 51234), "server": ("testserver", 443),
    })


def reject(code, fn):
    try:
        fn()
    except HTTPException as exc:
        assert exc.status_code == code, (exc.status_code, exc.detail)
    else:
        raise AssertionError(f"Expected HTTP {code}")


def main():
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).where(Organization.name == "Existing Tenant Fixture"))
        assert org is not None
        client = db.scalar(select(Client).where(Client.organization_id == org.id))
        assert client is not None
        gateway = PaymentGatewayConnection(
            organization_id=org.id, provider="stripe", mode="live",
            provider_account_id="acct_CI_" + uuid4().hex,
            connection_method="api_key", connected_by_user_id=org.created_by_user_id,
            secret_key_ciphertext="ci-test-only-key", webhook_secret_ciphertext="ci-test-only-webhook",
            charges_enabled=True, is_active=True,
        )
        db.add(gateway); db.flush()
        account = FinancialAccount(
            organization_id=org.id, name="CI Live Clearing " + uuid4().hex[:8],
            account_type="payment_gateway", currency="USD", gateway_connection_id=gateway.id,
            created_by_user_id=org.created_by_user_id, opening_balance=Decimal("0"),
        )
        db.add(account); db.flush()
        invoice = Invoice(
            organization_id=org.id, invoice_number="CI-LINK-" + uuid4().hex[:9],
            client_id=client.id, created_by_user_id=org.created_by_user_id,
            status="draft", payment_method="stripe", payment_account_id=account.id,
            issue_date=date.today(), currency="USD",
            seller_name_snapshot=org.name, client_name_snapshot="CI Client",
            subtotal=Decimal("4"), total=Decimal("4"),
            amount_paid=Decimal("0"), balance_due=Decimal("4"),
        )
        db.add(invoice); db.flush()

        with (
            patch.object(settings, "stripe_live_collection_enabled", True),
            patch.object(settings, "payment_gateway_encryption_key", "CI-ONLY-not-a-production-secret-" + "X" * 45),
            patch.object(settings, "public_api_url", "https://api-ci.example.net"),
            patch.object(settings, "public_app_url", "https://os-ci.example.net"),
        ):
            assert effective_invoice_payment_url(db, invoice) is None
            invoice.status = "sent"
            stable = effective_invoice_payment_url(db, invoice)
            assert stable and stable.startswith("https://api-ci.example.net/api/v1/finance/stripe-checkout/pay/")
            assert stable == effective_invoice_payment_url(db, invoice)
            assert _invoice_payment_read(db, invoice).payment_url == stable
            org_id, inv_id, mac = stable.rsplit("/", 3)[-3:]
            assert (org_id, inv_id) == (org.id, invoice.id)
            verify_public_invoice_link(org_id, inv_id, mac)
            reject(404, lambda: verify_public_invoice_link(org_id, inv_id, mac[:-1] + ("0" if mac[-1] != "0" else "1")))
            reject(404, lambda: verify_public_invoice_link(org_id, str(uuid4()), mac))
            reject(404, lambda: verify_public_invoice_link(str(uuid4()), inv_id, mac))

            # First click: creates session; next click reuses it. No second charge.
            count = 0
            def fake_checkout(**kwargs):
                nonlocal count
                count += 1
                assert kwargs["mode"] == "live" and kwargs["amount_minor"] == 400
                assert kwargs["invoice_number"] == invoice.invoice_number
                return {
                    "id": "cs_live_" + uuid4().hex,
                    "url": "https://checkout.stripe.com/c/pay/ci_" + uuid4().hex,
                    "expires_at": int((datetime.now(timezone.utc) + timedelta(minutes=50)).timestamp()),
                }
            with (
                patch.object(db, "commit", db.flush),
                patch("app.api.v1.stripe_checkout.decrypt_gateway_secret", return_value="rk_live_ci_only"),
                patch("app.api.v1.stripe_checkout.stripe_checkout_request", side_effect=fake_checkout),
            ):
                first = stripe_checkout.open_public_live_invoice_checkout(org_id, inv_id, mac, request(), db)
                second = stripe_checkout.open_public_live_invoice_checkout(org_id, inv_id, mac, request(), db)
                assert first.status_code == 303 and second.status_code == 303
                assert first.headers["location"] == second.headers["location"]
                assert count == 1
                # Fake an expired Stripe session; permanent PDF link stays stable
                session = db.scalar(select(StripeCheckoutAttempt).where(
                    StripeCheckoutAttempt.organization_id == org.id,
                    StripeCheckoutAttempt.invoice_id == invoice.id,
                ))
                session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=2)
                third = stripe_checkout.open_public_live_invoice_checkout(org_id, inv_id, mac, request(), db)
                assert count == 2 and third.headers["location"] != first.headers["location"]
                assert effective_invoice_payment_url(db, invoice) == stable

                invoice.status = "paid"; invoice.balance_due = Decimal("0")
                assert effective_invoice_payment_url(db, invoice) is None
                reject(409, lambda: stripe_checkout.open_public_live_invoice_checkout(
                    org_id, inv_id, mac, request(), db,
                ))
                invoice.status = "cancelled"
                reject(409, lambda: stripe_checkout.open_public_live_invoice_checkout(
                    org_id, inv_id, mac, request(), db,
                ))
            with patch.object(settings, "stripe_live_collection_enabled", False):
                assert effective_invoice_payment_url(db, invoice) is None
                reject(503, lambda: stripe_checkout.open_public_live_invoice_checkout(
                    org_id, inv_id, mac, request(), db,
                ))
    finally:
        db.rollback(); db.close()
    print("Stripe invoice pay links verified: signed + tenant-safe, draft blocked, auto QR URL, expiry renewal, reused checkout, paid/cancelled blocked")


if __name__ == "__main__":
    main()
