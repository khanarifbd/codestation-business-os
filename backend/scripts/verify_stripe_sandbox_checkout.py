"""Sandbox Stripe invoice Checkout and signed webhook regression with no network.

Run with the standard CI tenant fixture. All inserted records are rolled back.
"""
import asyncio
import hashlib
import hmac
import json
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1 import stripe_checkout as api
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.crm import Client
from app.models.finance import FinancialAccount, Invoice, Payment
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_checkout import StripeCheckoutAttempt, StripeWebhookEvent
from app.models.user import User
from app.services.payment_gateway_secrets import encrypt_gateway_secret
from app.services.stripe_checkout import to_usd_minor_units, verify_stripe_signature
from app.tenancy.context import TenantContext


def _request(path: str, *, body: bytes = b"", signature: str = "") -> Request:
    headers = [(b"stripe-signature", signature.encode())] if signature else []
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}
    return Request({
        "type": "http", "method": "POST", "path": path,
        "raw_path": path.encode(), "headers": headers, "query_string": b"",
        "scheme": "https", "server": ("testserver", 443),
        "client": ("127.0.0.1", 50001),
    }, receive)


def _stripe_event(event_id: str, session: StripeCheckoutAttempt, *, amount: int | None = None) -> dict:
    return {
        "id": event_id, "type": "checkout.session.completed", "livemode": False,
        "data": {"object": {
            "id": session.stripe_session_id,
            "livemode": False,
            "amount_total": session.amount_minor if amount is None else amount,
            "currency": session.currency.lower(),
            "payment_status": "paid",
            "client_reference_id": session.id,
            "metadata": {"checkout_attempt_id": session.id},
            "payment_intent": "pi_test_ci_1234",
        }},
    }


def _signed_request(event: dict, *, secret: str) -> Request:
    body = json.dumps(event, sort_keys=True).encode()
    timestamp = int(time.time())
    signed = str(timestamp).encode() + b"." + body
    sig = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return _request("/api/v1/finance/stripe-checkout/webhook/ci",
                    body=body, signature=f"t={timestamp},v1={sig}")


def _expect(status: int, action):
    try:
        action()
    except HTTPException as exc:
        assert exc.status_code == status, (status, exc.status_code, exc.detail)
    else:
        raise AssertionError(f"Expected HTTP {status}")


def main():
    assert to_usd_minor_units(Decimal("1.00"), "USD") == 100
    _expect(422, lambda: to_usd_minor_units(Decimal("100"), "BDT"))
    _expect(422, lambda: to_usd_minor_units(Decimal("0.00"), "USD"))
    signed = _signed_request({"id": "evt_ci", "type": "test"}, secret="whsec_CI")
    raw = json.dumps({"id": "evt_ci", "type": "test"}, sort_keys=True).encode()
    assert verify_stripe_signature(raw, signed.headers["stripe-signature"], "whsec_CI")["id"] == "evt_ci"
    _expect(400, lambda: verify_stripe_signature(raw, signed.headers["stripe-signature"], "whsec_wrong"))
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).where(Organization.name == "Existing Tenant Fixture"))
        assert org is not None
        membership = db.scalar(select(Membership).where(
            Membership.organization_id == org.id,
            Membership.user_id == org.created_by_user_id,
            Membership.status == "active",
        ))
        assert membership is not None
        user = db.get(User, membership.user_id)
        client = db.scalar(select(Client).where(Client.organization_id == org.id))
        assert user is not None and client is not None
        tenant = TenantContext(organization=org, membership=membership, user=user)

        stripe_secret = "sk_test_" + "Z" * 48
        webhook_secret = "whsec_" + "X" * 45
        with patch.object(settings, "payment_gateway_encryption_key", Fernet.generate_key().decode()):
            connection = PaymentGatewayConnection(
                organization_id=org.id, provider="stripe", mode="test",
                provider_account_id="acct_CI_checkout_" + uuid4().hex[:9],
                connection_method="api_key",
                secret_key_ciphertext=encrypt_gateway_secret(stripe_secret),
                webhook_secret_ciphertext=encrypt_gateway_secret(webhook_secret),
                charges_enabled=True, connected_by_user_id=user.id,
            )
            db.add(connection)
            db.flush()
            financial_account = FinancialAccount(
                organization_id=org.id,
                name="CI Stripe Sandbox " + uuid4().hex[:8],
                account_type="payment_gateway", provider_name="Stripe",
                currency="USD", opening_balance=Decimal("0.00"),
                gateway_connection_id=connection.id, created_by_user_id=user.id,
            )
            db.add(financial_account)
            db.flush()
            invoice = Invoice(
                organization_id=org.id, invoice_number="CI-STRIPE-" + uuid4().hex[:8],
                client_id=client.id, created_by_user_id=user.id, status="sent",
                payment_method="stripe", payment_account_id=financial_account.id,
                issue_date=date.today(), currency="USD",
                seller_name_snapshot=org.name, client_name_snapshot="Sandbox Client",
                subtotal=Decimal("1.00"), total=Decimal("1.00"),
                amount_paid=Decimal("0.00"), balance_due=Decimal("1.00"),
            )
            db.add(invoice)
            db.flush()
            _expect(404, lambda: api.stripe_checkout_status("another-tenant-invoice", db, tenant))

            def fake_checkout(**values):
                assert values["api_key"] == stripe_secret
                assert values["amount_minor"] == 100
                return {
                    "id": "cs_test_CI_" + uuid4().hex,
                    "url": "https://checkout.stripe.com/c/pay/ci-fixture",
                    "expires_at": int(time.time() + 3600),
                }

            with patch.object(db, "commit", db.flush), patch.object(api, "stripe_checkout_request", fake_checkout):
                before = api.stripe_checkout_status(invoice.id, db, tenant)
                assert before["checkout_available"] and before["webhook_configured"]
                assert before["financial_account_linked"]
                invoice.payment_account_id = None
                _expect(409, lambda: api.create_sandbox_checkout(invoice.id, _request("/sandbox/create"), db, tenant))
                invoice.payment_account_id = financial_account.id
                result = api.create_sandbox_checkout(invoice.id, _request("/sandbox/create"), db, tenant)
                assert result["currency"] == "USD" and result["status"] == "open"
                again = api.create_sandbox_checkout(invoice.id, _request("/sandbox/create"), db, tenant)
                assert again["id"] == result["id"], "Retries must reuse a still-open Checkout link"
                attempt = db.scalar(select(StripeCheckoutAttempt).where(
                    StripeCheckoutAttempt.organization_id == org.id,
                    StripeCheckoutAttempt.id == result["id"],
                ))
                assert attempt is not None
                webhook_path = f"/api/v1/finance/stripe-checkout/webhook/{connection.id}"
                # Invalid or mismatched Stripe events must never mark even test sessions paid.
                bad = _signed_request(_stripe_event("evt_ci_bad_" + uuid4().hex, attempt, amount=101),
                                      secret=webhook_secret)
                _expect(409, lambda: asyncio.run(api.stripe_sandbox_webhook(
                    connection.id, bad, db
                )))
                assert attempt.status == "open"
                success = _signed_request(_stripe_event("evt_ci_good_" + uuid4().hex, attempt),
                                          secret=webhook_secret)
                accepted = asyncio.run(api.stripe_sandbox_webhook(connection.id, success, db))
                assert accepted == {"received": True, "duplicate": False}
                repeat = asyncio.run(api.stripe_sandbox_webhook(connection.id, success, db))
                assert repeat == {"received": True, "duplicate": True}
                assert attempt.status == "sandbox_paid"
                assert invoice.status == "sent" and invoice.balance_due == Decimal("1.00")
                assert invoice.amount_paid == Decimal("0.00")
                assert db.scalar(select(Payment.id).where(
                    Payment.organization_id == org.id, Payment.invoice_id == invoice.id,
                )) is None
                assert db.scalar(select(StripeWebhookEvent.id).where(
                    StripeWebhookEvent.organization_id == org.id,
                    StripeWebhookEvent.attempt_id == attempt.id,
                )) is not None
    finally:
        db.rollback()
        db.close()
    print("Stripe Sandbox Checkout verified: signed webhook, amount match, idempotency, tenant isolation, no accounting mutation")


if __name__ == "__main__":
    main()
