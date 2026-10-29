"""Rollback-safe, no-network Stripe Live payout accounting & signed lifecycle tests."""
import asyncio
import hashlib
import hmac
import json
import time
from datetime import date
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.requests import Request

from app.api.v1 import stripe_lifecycle, stripe_payouts
from app.api.v1.finance import _account_balance
from app.db.session import SessionLocal
from app.models.accounting import JournalEntry
from app.models.crm import Client
from app.models.finance import AccountTransfer, FinancialAccount, FinancialTransaction
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_checkout import StripeWebhookEvent
from app.models.stripe_payout import StripePayoutReconciliation
from app.models.user import User
from app.services.exchange_rates import record_rate_snapshot
from app.services.accounting_period_gate import acquire_accounting_period_gate
from app.services.operational_posting import post_financial_account_opening
from app.tenancy.context import TenantContext

def request(body: bytes = b"", signature: str | None = None):
    headers = [(b"stripe-signature", signature.encode())] if signature else []
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}
    return Request({
        "type": "http", "method": "POST", "path": "/ci/stripe-payout",
        "headers": headers, "query_string": b"", "scheme": "https",
        "client": ("127.0.0.1", 59999), "server": ("testserver", 443),
    }, receive)

def denied(code, fn):
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
        member = db.scalar(select(Membership).where(
            Membership.organization_id == org.id, Membership.user_id == org.created_by_user_id,
            Membership.status == "active",
        ))
        assert member is not None
        user = db.get(User, member.user_id)
        actor = TenantContext(organization=org, membership=member, user=user)
        record_rate_snapshot(
            db, organization_id=org.id,
            base_currency="USD", quote_currency="BDT",
            effective_date=date.today(), effective_rate=Decimal("120"),
            reference_rate=None, source="ci_test_only", user_id=user.id,
        )
        conn = PaymentGatewayConnection(
            organization_id=org.id, provider="stripe", mode="live",
            provider_account_id="acct_CI_" + uuid4().hex[:13],
            connected_by_user_id=user.id, is_active=True, connection_method="api_key",
            payouts_enabled=True, charges_enabled=True,
            secret_key_ciphertext="ci-only-mocked-secret",
            webhook_secret_ciphertext="ci-only-mocked-webhook",
        )
        db.add(conn)
        db.flush()
        source = FinancialAccount(
            organization_id=org.id, name="CI Stripe Clearing " + uuid4().hex[:8],
            account_type="payment_gateway", currency="USD",
            gateway_connection_id=conn.id, opening_balance=Decimal("20"),
            created_by_user_id=user.id,
        )
        bank = FinancialAccount(
            organization_id=org.id, name="CI Bank " + uuid4().hex[:8],
            account_type="bank", currency="USD", opening_balance=Decimal("0"),
            created_by_user_id=user.id,
        )
        db.add_all([source, bank]);db.flush()
        acquire_accounting_period_gate(db, org.id)
        post_financial_account_opening(
            db, organization_id=org.id, user_id=user.id,
            account=source, entry_date=date.today(),
        )
        payout_id = "po_" + uuid4().hex
        payload = stripe_payouts.PayoutConfirm(
            stripe_payout_id=payout_id, source_account_id=source.id,
            bank_account_id=bank.id, bank_statement_reference="CI-BANK-STATEMENT-0001",
        )
        def stripe_data(_, kind, identifier):
            assert kind == "payout" and identifier == payout_id
            return {"id": payout_id, "object": "payout", "livemode": True,
                    "status": "paid", "currency": "usd", "amount": 941}
        def bad_data(status):
            return {"id": payout_id, "livemode": True, "status": status,
                    "currency": "usd", "amount": 941}
        with (
            patch("app.api.v1.stripe_payouts.decrypt_gateway_secret", return_value="sk_live_ci"),
            patch("app.api.v1.stripe_payouts.stripe_retrieve", side_effect=lambda *args: bad_data("pending")),
        ):
            denied(409, lambda: stripe_payouts.confirm_live_payout(payload, request(), db, actor))
        assert db.scalar(select(func.count()).select_from(StripePayoutReconciliation).where(
            StripePayoutReconciliation.organization_id == org.id)) == 0

        with patch.object(db, "commit", db.flush), patch("app.api.v1.stripe_payouts.decrypt_gateway_secret", return_value="sk_live_ci"), patch("app.api.v1.stripe_payouts.stripe_retrieve", side_effect=stripe_data):
            result = stripe_payouts.confirm_live_payout(payload, request(), db, actor)
            assert result["amount"] == "9.41" and result["income_recognized"] is False
            assert _account_balance(db, source) == Decimal("10.59")
            assert _account_balance(db, bank) == Decimal("9.41")
            transfer_id = result["transfer_id"]
            transfer = db.get(AccountTransfer, transfer_id)
            assert transfer is not None and transfer.source_amount == Decimal("9.41")
            journal = db.scalar(select(JournalEntry).where(
                JournalEntry.organization_id == org.id,
                JournalEntry.source_type == "account_transfer",
                JournalEntry.source_id == transfer_id,
            ))
            assert journal is not None
            again = stripe_payouts.confirm_live_payout(payload, request(), db, actor)
            assert again["transfer_id"] == transfer_id
            assert db.scalar(select(func.count()).select_from(StripePayoutReconciliation).where(
                StripePayoutReconciliation.organization_id == org.id,
                StripePayoutReconciliation.stripe_payout_id == payout_id,
            )) == 1
            assert db.scalar(select(func.count()).select_from(AccountTransfer).where(
                AccountTransfer.organization_id == org.id,
                AccountTransfer.id == transfer_id,
            )) == 1
            assert db.scalar(select(func.count()).select_from(StripePayoutReconciliation).where(
                StripePayoutReconciliation.organization_id == str(uuid4()),
            )) == 0
            denied(409, lambda: stripe_payouts.confirm_live_payout(
                payload.model_copy(update={"bank_statement_reference": "DIFFERENT-STATEMENT"}),
                request(), db, actor,
            ))
            assert stripe_payouts.list_payouts(db, actor)[0]["transfer_id"] == transfer_id

        # Test signed Live refund/dispute event is accepted into review queue,
        # but does not post to any real financial account or journal.
        secret = "whsec_ci_lifecycle_test_only"
        event_id = "evt_" + uuid4().hex
        body = json.dumps({
            "id": event_id, "type": "charge.dispute.created", "livemode": True,
            "data": {"object": {"id": "dp_" + uuid4().hex}},
        }, separators=(",", ":")).encode()
        timestamp = int(time.time())
        digest = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
        header = f"t={timestamp},v1={digest}"
        before_count = db.scalar(select(func.count()).select_from(FinancialTransaction).where(
            FinancialTransaction.organization_id == org.id,
        ))
        with patch.object(db, "commit", db.flush), patch("app.api.v1.stripe_lifecycle.decrypt_gateway_secret", return_value=secret):
            response = asyncio.run(stripe_lifecycle.review_live_stripe_event(
                conn.id, request(body, header), db,
            ))
            assert response["review_required"] is True
            replay = asyncio.run(stripe_lifecycle.review_live_stripe_event(
                conn.id, request(body, header), db,
            ))
            assert replay["duplicate"] is True
            row = db.scalar(select(StripeWebhookEvent).where(
                StripeWebhookEvent.organization_id == org.id,
                StripeWebhookEvent.stripe_event_id == event_id,
            ))
            assert row is not None and row.result == "review_required"
            assert stripe_lifecycle.list_lifecycle_events(db, actor)[0]["event_id"] == event_id
            assert stripe_lifecycle.list_lifecycle_events(db, TenantContext(
                organization=org, membership=member, user=user,
            ))[0]["event_id"] == event_id
            assert db.scalar(select(func.count()).select_from(FinancialTransaction).where(
                FinancialTransaction.organization_id == org.id,
            )) == before_count
            assert db.scalar(select(func.count()).select_from(StripeWebhookEvent).where(
                StripeWebhookEvent.stripe_event_id == event_id,
            )) == 1
    finally:
        db.rollback()
        db.close()
    print("Verified Stripe payout bank transfer, duplicate protection, signed live review, financial isolation")


if __name__ == "__main__":
    main()
