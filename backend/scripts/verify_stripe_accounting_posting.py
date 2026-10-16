"""No-network Stripe accounting engine regression.

Creates isolated fixtures in one DB transaction and always rolls back.
No public API routes or live Stripe transactions are enabled by this test.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.requests import Request

from app.api.v1.finance import _account_balance
from app.db.session import SessionLocal
from app.models.accounting import JournalEntry, JournalLine
from app.models.crm import Client
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, Payment
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_accounting import StripeAccountingPosting
from app.models.stripe_checkout import StripeCheckoutAttempt
from app.models.stripe_settlement import StripeSettlementSnapshot
from app.models.user import User
from app.services.stripe_accounting import post_verified_live_stripe_settlement
from app.tenancy.context import TenantContext


def req():
    return Request({
        "type": "http", "method": "POST",
        "path": "/ci/stripe-accounting",
        "headers": [], "query_string": b"", "scheme": "https",
        "client": ("127.0.0.1", 54321), "server": ("testserver", 443),
    })


def must_reject(status, operation):
    try:
        operation()
    except HTTPException as exc:
        assert exc.status_code == status, (exc.status_code, exc.detail)
    else:
        raise AssertionError(f"Expected HTTP {status}")


def main():
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
        actor = TenantContext(organization=org, membership=membership, user=user)
        connection = PaymentGatewayConnection(
            organization_id=org.id, provider="stripe", mode="live",
            provider_account_id="acct_CI_" + uuid4().hex[:13],
            connection_method="api_key", charges_enabled=True,
            connected_by_user_id=user.id, is_active=True,
        )
        db.add(connection)
        db.flush()
        account = FinancialAccount(
            organization_id=org.id, name="CI Stripe Live Clearing " + uuid4().hex[:8],
            account_type="payment_gateway", provider_name="Stripe",
            currency="USD", gateway_connection_id=connection.id,
            created_by_user_id=user.id, opening_balance=Decimal("0"),
        )
        db.add(account)
        db.flush()
        invoice = Invoice(
            organization_id=org.id, invoice_number="CI-STRIPE-LIVE-" + uuid4().hex[:8],
            client_id=client.id, created_by_user_id=user.id, status="sent",
            payment_method="stripe", payment_account_id=account.id,
            issue_date=date.today(), currency="USD",
            seller_name_snapshot=org.name, client_name_snapshot="CI Client",
            subject="CI Stripe Live Posting",
            subtotal=Decimal("10"), total=Decimal("10"),
            amount_paid=Decimal("0"), balance_due=Decimal("10"),
        )
        db.add(invoice)
        db.flush()
        intent_id = "pi_" + uuid4().hex
        attempt = StripeCheckoutAttempt(
            organization_id=org.id, invoice_id=invoice.id, connection_id=connection.id,
            mode="live", currency="USD", amount_minor=1000,
            stripe_session_id="cs_live_" + uuid4().hex,
            stripe_payment_intent_id=intent_id,
            status="live_paid", completed_at=datetime.now(timezone.utc),
            created_by_user_id=user.id,
        )
        db.add(attempt)
        db.flush()
        snapshot = StripeSettlementSnapshot(
            organization_id=org.id,
            attempt_id=attempt.id, connection_id=connection.id,
            stripe_payment_intent_id=intent_id,
            stripe_charge_id="ch_" + uuid4().hex,
            stripe_balance_transaction_id="txn_" + uuid4().hex,
            currency="USD", gross_minor=1000, fee_minor=59, net_minor=941,
            availability_status="pending",
        )
        db.add(snapshot)
        db.flush()
        sandbox = StripeCheckoutAttempt(
            organization_id=org.id, invoice_id=invoice.id, connection_id=connection.id,
            mode="test", currency="USD", amount_minor=1000,
            stripe_session_id="cs_test_" + uuid4().hex,
            stripe_payment_intent_id="pi_" + uuid4().hex,
            status="sandbox_paid", created_by_user_id=user.id,
        )
        db.add(sandbox)
        db.flush()
        sandbox_snapshot = StripeSettlementSnapshot(
            organization_id=org.id, attempt_id=sandbox.id, connection_id=connection.id,
            stripe_payment_intent_id=sandbox.stripe_payment_intent_id,
            stripe_charge_id="ch_" + uuid4().hex,
            stripe_balance_transaction_id="txn_" + uuid4().hex,
            currency="USD", gross_minor=1000, fee_minor=59, net_minor=941,
            availability_status="available",
        )
        db.add(sandbox_snapshot)
        db.flush()
        must_reject(403, lambda: post_verified_live_stripe_settlement(
            db, organization_id=str(uuid4()), actor=actor,
            snapshot_id=snapshot.id, request=req(),
        ))
        must_reject(409, lambda: post_verified_live_stripe_settlement(
            db, organization_id=org.id, actor=actor,
            snapshot_id=sandbox_snapshot.id, request=req(),
        ))
        assert invoice.balance_due == Decimal("10") and invoice.amount_paid == Decimal("0")

        with patch.object(db, "commit", db.flush):
            posted = post_verified_live_stripe_settlement(
                db, organization_id=org.id, actor=actor,
                snapshot_id=snapshot.id, request=req(),
            )
            assert posted.snapshot_id == snapshot.id
            payment = db.get(Payment, posted.payment_id)
            assert payment is not None
            assert payment.method == "stripe"
            assert Decimal(payment.invoice_amount) == Decimal("10.00")
            assert invoice.status == "paid" and Decimal(invoice.balance_due) == 0
            assert Decimal(invoice.amount_paid) == Decimal("10.00")
            assert _account_balance(db, account) == Decimal("9.41")

            payment_gl = db.scalar(select(JournalEntry).where(
                JournalEntry.organization_id == org.id,
                JournalEntry.source_type == "invoice_payment",
                JournalEntry.source_id == payment.id,
            ))
            fee_gl = db.scalar(select(JournalEntry).where(
                JournalEntry.organization_id == org.id,
                JournalEntry.source_type == "stripe_processing_fee",
                JournalEntry.source_id == snapshot.id,
            ))
            assert payment_gl is not None and fee_gl is not None
            assert posted.fee_journal_entry_id == fee_gl.id
            lines = db.scalars(select(JournalLine).where(
                JournalLine.organization_id == org.id, JournalLine.journal_entry_id == fee_gl.id,
            )).all()
            assert len(lines) == 2
            assert sum((Decimal(x.debit) for x in lines), Decimal(0)) == sum((Decimal(x.credit) for x in lines), Decimal(0))
            assert db.scalar(select(func.count()).select_from(FinancialTransaction).where(
                FinancialTransaction.organization_id == org.id,
                FinancialTransaction.account_id == account.id,
                FinancialTransaction.source_type == "stripe_processing_fee",
            )) == 1
            again = post_verified_live_stripe_settlement(
                db, organization_id=org.id, actor=actor,
                snapshot_id=snapshot.id, request=req(),
            )
            assert again.id == posted.id
            assert db.scalar(select(func.count()).select_from(StripeAccountingPosting).where(
                StripeAccountingPosting.organization_id == org.id,
                StripeAccountingPosting.snapshot_id == snapshot.id,
            )) == 1
            assert _account_balance(db, account) == Decimal("9.41")
    finally:
        db.rollback()
        db.close()
    print("Stripe atomic posting engine verified: sandbox blocked, gross/AR, fee, net, GL balance, idempotency, tenant isolation")


if __name__ == "__main__":
    main()
