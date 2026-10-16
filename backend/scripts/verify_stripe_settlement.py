"""No-network Stripe settlement: verified gross, fee, net, FX safety and idempotency.

Tenant fixtures roll back; real invoice, Payment and Journal tables never change.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.requests import Request

from app.api.v1 import stripe_settlement as api
from app.db.session import SessionLocal
from app.models.crm import Client
from app.models.finance import FinancialAccount, Invoice, Payment, FinancialTransaction
from app.models.accounting import JournalEntry
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_checkout import StripeCheckoutAttempt
from app.models.stripe_settlement import StripeSettlementSnapshot
from app.models.user import User
from app.services.payment_gateway_secrets import encrypt_gateway_secret
from app.services.stripe_settlement import verified_sandbox_settlement
from app.tenancy.context import TenantContext


def _request():
    return Request({
        "type": "http", "method": "POST",
        "path": "/api/v1/finance/stripe-settlement/invoices/ci/attempts/ci/reconcile",
        "headers": [], "query_string": b"", "scheme": "https",
        "client": ("127.0.0.1", 50000), "server": ("testserver", 443),
    })


def fake_stripe(resource, obj_id, *, intent_id, charge_id, transaction_id, amount=1000, fee=29):
    if resource == "intent":
        assert obj_id == intent_id
        return {"id": intent_id, "livemode": False, "currency": "usd",
                "status": "succeeded", "amount_received": amount, "latest_charge": charge_id}
    if resource == "charge":
        assert obj_id == charge_id
        return {"id": charge_id, "livemode": False, "currency": "usd",
                "paid": True, "captured": True, "status": "succeeded",
                "refunded": False, "disputed": False, "amount_refunded": 0,
                "amount_captured": amount, "payment_intent": intent_id,
                "balance_transaction": transaction_id}
    assert resource == "transaction" and obj_id == transaction_id
    return {"id": transaction_id, "currency": "usd", "amount": amount,
            "fee": fee, "net": amount - fee, "source": charge_id,
            "status": "available"}


def expect_reject(status, call):
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == status, (status, exc.status_code, exc.detail)
    else:
        raise AssertionError(f"Expected HTTP {status}")


def main():
    intent_id = "pi_" + uuid4().hex
    charge_id = "ch_" + uuid4().hex
    transaction_id = "txn_" + uuid4().hex

    def retrieval(_, kind, ident):
        return fake_stripe(kind, ident, intent_id=intent_id, charge_id=charge_id,
                           transaction_id=transaction_id)

    with patch("app.services.stripe_settlement.stripe_retrieve", retrieval):
        facts = verified_sandbox_settlement(
            api_key="sk_test_fixture_not_real", payment_intent_id=intent_id,
            currency="USD", amount_minor=1000,
        )
        assert (facts.gross_minor, facts.fee_minor, facts.net_minor) == (1000, 29, 971)

    with patch("app.services.stripe_settlement.stripe_retrieve", lambda _, kind, ident:
               fake_stripe(kind, ident, intent_id=intent_id, charge_id=charge_id,
                           transaction_id=transaction_id, amount=1100)):
        expect_reject(409, lambda: verified_sandbox_settlement(
            api_key="sk_test_fixture", payment_intent_id=intent_id, currency="USD", amount_minor=1000,
        ))
    def invalid_currency(_, kind, ident):
        result = fake_stripe(kind, ident, intent_id=intent_id, charge_id=charge_id,
                             transaction_id=transaction_id)
        if kind == "transaction":
            result["currency"] = "bdt"
        return result
    with patch("app.services.stripe_settlement.stripe_retrieve", invalid_currency):
        expect_reject(409, lambda: verified_sandbox_settlement(
            api_key="sk_test_fixture", payment_intent_id=intent_id, currency="USD", amount_minor=1000,
        ))
    def invalid_fees(_, kind, ident):
        result = fake_stripe(kind, ident, intent_id=intent_id, charge_id=charge_id,
                             transaction_id=transaction_id)
        if kind == "transaction":
            result["net"] = 950
        return result
    with patch("app.services.stripe_settlement.stripe_retrieve", invalid_fees):
        expect_reject(409, lambda: verified_sandbox_settlement(
            api_key="sk_test_fixture", payment_intent_id=intent_id, currency="USD", amount_minor=1000,
        ))
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).where(Organization.name == "Existing Tenant Fixture"))
        assert org is not None
        member = db.scalar(select(Membership).where(
            Membership.organization_id == org.id, Membership.user_id == org.created_by_user_id,
            Membership.status == "active",
        ))
        user = db.get(User, member.user_id)
        client = db.scalar(select(Client).where(Client.organization_id == org.id))
        assert user is not None and client is not None
        tenant = TenantContext(organization=org, membership=member, user=user)

        with patch("app.core.config.settings.payment_gateway_encryption_key", Fernet.generate_key().decode()):
            key = "sk_test_" + "X" * 40
            conn = PaymentGatewayConnection(
                organization_id=org.id, provider="stripe", mode="test",
                provider_account_id="acct_CI_" + uuid4().hex[:12],
                connection_method="api_key", charges_enabled=True,
                connected_by_user_id=user.id, secret_key_ciphertext=encrypt_gateway_secret(key),
            )
            db.add(conn)
            db.flush()
            account = FinancialAccount(
                organization_id=org.id, name="CI Stripe Clearing " + uuid4().hex[:8],
                account_type="payment_gateway", currency="USD", gateway_connection_id=conn.id,
                created_by_user_id=user.id, opening_balance=Decimal("0.00"),
            )
            db.add(account)
            db.flush()
            invoice = Invoice(
                organization_id=org.id, invoice_number="CI-SETTLE-" + uuid4().hex[:8],
                client_id=client.id, created_by_user_id=user.id, status="sent",
                payment_method="stripe", payment_account_id=account.id,
                issue_date=date.today(), currency="USD",
                seller_name_snapshot=org.name, client_name_snapshot="CI Sandbox",
                subtotal=Decimal("10.00"), total=Decimal("10.00"),
                amount_paid=Decimal("0.00"), balance_due=Decimal("10.00"),
            )
            db.add(invoice)
            db.flush()
            attempt = StripeCheckoutAttempt(
                organization_id=org.id, invoice_id=invoice.id, connection_id=conn.id,
                mode="test", currency="USD", amount_minor=1000,
                stripe_session_id="cs_test_" + uuid4().hex,
                stripe_payment_intent_id=intent_id, status="sandbox_paid",
                completed_at=datetime.now(timezone.utc), created_by_user_id=user.id,
            )
            db.add(attempt)
            db.flush()
            before_payment_count = db.scalar(select(func.count()).select_from(Payment).where(Payment.organization_id == org.id))
            before_tx_count = db.scalar(select(func.count()).select_from(FinancialTransaction).where(FinancialTransaction.organization_id == org.id))
            before_journal_count = db.scalar(select(func.count()).select_from(JournalEntry).where(JournalEntry.organization_id == org.id))
            assert api.read_settlement(invoice.id, attempt.id, db, tenant)["reconciled"] is False
            expect_reject(404, lambda: api._attempt(db, str(uuid4()), invoice.id, attempt.id, lock=False))
            expect_reject(404, lambda: api._invoice(db, str(uuid4()), invoice.id))
            with patch.object(db, "commit", db.flush), patch("app.services.stripe_settlement.stripe_retrieve", retrieval):
                result = api.reconcile_stripe_sandbox(invoice.id, attempt.id, _request(), db, tenant)
                assert result["gross"] == "10.00"
                assert result["processing_fee"] == "0.29"
                assert result["net_stripe_balance"] == "9.71"
                assert result["accounting_posted"] is False and result["payout_reconciled"] is False
                assert result["journal_preview"][0]["debit"].startswith(account.name)
                assert result["journal_preview"][1]["amount"] == "0.29"
                repeat = api.reconcile_stripe_sandbox(invoice.id, attempt.id, _request(), db, tenant)
                assert repeat["stripe_balance_transaction_id"] == transaction_id
                assert db.scalar(select(func.count()).select_from(StripeSettlementSnapshot).where(
                    StripeSettlementSnapshot.attempt_id == attempt.id,
                )) == 1
                assert db.scalar(select(func.count()).select_from(Payment).where(Payment.organization_id == org.id)) == before_payment_count
                assert db.scalar(select(func.count()).select_from(FinancialTransaction).where(FinancialTransaction.organization_id == org.id)) == before_tx_count
                assert db.scalar(select(func.count()).select_from(JournalEntry).where(JournalEntry.organization_id == org.id)) == before_journal_count
                assert invoice.status == "sent" and invoice.amount_paid == Decimal("0")
                assert invoice.balance_due == Decimal("10.00")
    finally:
        db.rollback()
        db.close()
    print("Stripe settlement checks passed: verified gross/fees/net, idempotency, tenant isolation, no real journal posting")


if __name__ == "__main__":
    main()
