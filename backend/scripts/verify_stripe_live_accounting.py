"""No-network Live Stripe signed webhook + full refund regression; rollback-only."""
import asyncio
import hashlib
import hmac
import json
import time
from datetime import date
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import func, select
from starlette.requests import Request

from app.api.v1 import stripe_lifecycle
from app.api.v1.finance import _account_balance
from app.db.session import SessionLocal
from app.models.crm import Client
from app.models.accounting import JournalEntry
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, Payment
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_accounting import StripeAccountingPosting
from app.models.stripe_checkout import StripeCheckoutAttempt, StripeWebhookEvent
from app.models.stripe_settlement import StripeSettlementSnapshot
from app.models.user import User
from app.services.exchange_rates import record_rate_snapshot


def make_request(event: dict, secret="whsec_test_ci_live_events"):
    body = json.dumps(event, separators=(",", ":")).encode()
    stamp = int(time.time())
    digest = hmac.new(secret.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()
    signature = f"t={stamp},v1={digest}"
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}
    return Request({
        "type": "http", "method": "POST",
        "path": "/api/v1/finance/stripe-lifecycle/webhook/test",
        "headers": [(b"stripe-signature", signature.encode())],
        "query_string": b"", "scheme": "https",
        "client": ("127.0.0.1", 40000), "server": ("testserver", 443),
    }, receive)


def fake_stripe(_, kind, object_id, *, intent, charge, balance, refunded=False, refunded_minor=0):
    if kind == "intent":
        assert object_id == intent
        return {
            "id": intent, "livemode": True, "currency": "usd",
            "status": "succeeded", "amount_received": 1000,
            "latest_charge": charge,
        }
    if kind == "charge":
        assert object_id == charge
        return {
            "id": charge, "livemode": True, "currency": "usd",
            "status": "succeeded", "paid": True, "captured": True,
            "refunded": refunded, "disputed": False,
            "amount_refunded": refunded_minor, "amount_captured": 1000,
            "payment_intent": intent, "balance_transaction": balance,
        }
    assert kind == "transaction" and object_id == balance
    return {"id": balance, "currency": "usd", "amount": 1000,
            "fee": 59, "net": 941, "source": charge, "status": "available"}


def main():
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).where(Organization.name == "Existing Tenant Fixture"))
        assert org
        member = db.scalar(select(Membership).where(
            Membership.organization_id == org.id, Membership.user_id == org.created_by_user_id,
            Membership.status == "active",
        ))
        user = db.get(User, member.user_id)
        client = db.scalar(select(Client).where(Client.organization_id == org.id))
        assert user and client
        record_rate_snapshot(
            db, organization_id=org.id,
            base_currency="USD", quote_currency="BDT",
            effective_date=date.today(), effective_rate=Decimal("120"),
            reference_rate=None, source="ci_test_only", user_id=user.id,
        )
        connection = PaymentGatewayConnection(
            organization_id=org.id, provider="stripe", mode="live",
            provider_account_id="acct_ci_" + uuid4().hex,
            connected_by_user_id=user.id, connection_method="api_key",
            is_active=True, charges_enabled=True,
            secret_key_ciphertext="ci-mocked-key",
            webhook_secret_ciphertext="ci-mocked-webhook",
        )
        db.add(connection);db.flush()
        account = FinancialAccount(
            organization_id=org.id, name="CI Live Clearing " + uuid4().hex[:8],
            account_type="payment_gateway", currency="USD", gateway_connection_id=connection.id,
            opening_balance=Decimal("0"), created_by_user_id=user.id,
        )
        db.add(account);db.flush()
        invoice = Invoice(
            organization_id=org.id, invoice_number="CI-LIVE-" + uuid4().hex[:8],
            client_id=client.id, created_by_user_id=user.id, status="sent",
            payment_method="stripe", payment_account_id=account.id,
            issue_date=date.today(), currency="USD",
            seller_name_snapshot=org.name, client_name_snapshot="CI Client",
            subtotal=Decimal("10"), total=Decimal("10"),
            amount_paid=Decimal("0"), balance_due=Decimal("10"),
        )
        db.add(invoice);db.flush()
        session_id="cs_live_"+uuid4().hex
        intent="pi_"+uuid4().hex
        charge="ch_"+uuid4().hex
        balance="txn_"+uuid4().hex
        attempt=StripeCheckoutAttempt(
            organization_id=org.id, invoice_id=invoice.id, connection_id=connection.id,
            mode="live", currency="USD", amount_minor=1000, stripe_session_id=session_id,
            status="open", created_by_user_id=user.id,
        )
        db.add(attempt);db.flush()

        checkout_event = {
            "id": "evt_"+uuid4().hex, "type": "checkout.session.completed",
            "livemode": True, "data": {"object": {
                "id": session_id, "livemode": True, "status": "complete",
                "currency": "usd", "amount_total": 1000,
                "payment_status": "paid", "client_reference_id": attempt.id,
                "metadata": {"checkout_attempt_id": attempt.id},
                "payment_intent": intent,
            }},
        }
        def retrieved(*args, refunded=False, refunded_minor=0):
            return fake_stripe(*args, intent=intent, charge=charge, balance=balance,
                               refunded=refunded, refunded_minor=refunded_minor)

        with (patch.object(db,"commit",db.flush),
              patch("app.api.v1.stripe_lifecycle.settings.stripe_live_collection_enabled",True),
              patch("app.api.v1.stripe_lifecycle.decrypt_gateway_secret",return_value="whsec_test_ci_live_events"),
              patch("app.api.v1.stripe_lifecycle.verified_sandbox_settlement",
                    side_effect=lambda **_: __import__("app.services.stripe_settlement", fromlist=["verified_sandbox_settlement"]).verified_sandbox_settlement(
                        api_key="mock",payment_intent_id=intent,currency="USD",amount_minor=1000,mode="live")),
              patch("app.services.stripe_settlement.stripe_retrieve",side_effect=retrieved)):
            result=asyncio.run(stripe_lifecycle.review_live_stripe_event(
                connection.id,make_request(checkout_event),db))
            assert result["result"] == "live_paid_posted", result
            assert invoice.status == "paid" and Decimal(invoice.balance_due) == 0
            assert _account_balance(db,account) == Decimal("9.41")
            snapshot=db.scalar(select(StripeSettlementSnapshot).where(
                StripeSettlementSnapshot.organization_id == org.id,
                StripeSettlementSnapshot.attempt_id == attempt.id))
            link=db.scalar(select(StripeAccountingPosting).where(
                StripeAccountingPosting.organization_id == org.id,
                StripeAccountingPosting.snapshot_id == snapshot.id))
            payment=db.get(Payment,link.payment_id)
            assert payment and payment.status == "confirmed"
            again=asyncio.run(stripe_lifecycle.review_live_stripe_event(
                connection.id,make_request(checkout_event),db))
            assert again["duplicate"] is True
            assert db.scalar(select(func.count()).select_from(Payment).where(
                Payment.organization_id == org.id,Payment.id == link.payment_id)) == 1

            refund_event={
                "id": "evt_"+uuid4().hex, "type": "charge.refunded", "livemode": True,
                "data": {"object": {"id":charge}},
            }
            # A partial refund cannot silently reverse an entire invoice.
            with patch("app.api.v1.stripe_lifecycle.stripe_retrieve",
                       side_effect=lambda *args: retrieved(*args,refunded=True,refunded_minor=300)):
                partial=asyncio.run(stripe_lifecycle.review_live_stripe_event(
                    connection.id,make_request(refund_event),db))
                assert partial["result"] == "review_required"
            assert invoice.status == "paid"
            assert _account_balance(db,account) == Decimal("9.41")

            refund_event["id"]="evt_"+uuid4().hex
            with patch("app.api.v1.stripe_lifecycle.stripe_retrieve",
                       side_effect=lambda *args: retrieved(*args,refunded=True,refunded_minor=1000)):
                done=asyncio.run(stripe_lifecycle.review_live_stripe_event(
                    connection.id,make_request(refund_event),db))
                assert done["result"] == "full_payment_reversed", done
            assert payment.status == "reversed"
            assert invoice.status == "sent"
            assert Decimal(invoice.balance_due) == Decimal("10")
            assert _account_balance(db,account) == Decimal("-0.59")
            assert db.scalar(select(JournalEntry).where(
                JournalEntry.organization_id == org.id,
                JournalEntry.source_type == "reversal",
            )) is not None
    finally:
        db.rollback();db.close()
    print("Signed Live paid Checkout -> gross/fee Journal -> idempotent replay -> guarded partial -> full refund reversal passed")


if __name__=="__main__":
    main()
