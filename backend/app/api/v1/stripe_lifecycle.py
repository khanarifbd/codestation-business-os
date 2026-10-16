"""Signed Stripe LIVE lifecycle events: retained for finance review, never silently posted.

Disputes, chargebacks, partial refunds, and failed payouts have different
accounting consequences. Until reversal allocation and bank settlement
verification are implemented, these events must NOT mutate Invoice, Payment
or GL. Only a human-auditable review record is created.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from datetime import datetime, timezone
from app.db.session import defer_commits
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User
from app.models.finance import Invoice, Payment
from app.models.stripe_checkout import StripeCheckoutAttempt
from app.models.stripe_settlement import StripeSettlementSnapshot
from app.models.stripe_accounting import StripeAccountingPosting
from app.services.stripe_settlement import verified_sandbox_settlement, stripe_retrieve
from app.services.stripe_accounting import post_verified_live_stripe_settlement
from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.tenancy.context import TenantContext

from app.api.dependencies import DbSession, require_tenant_permission
from app.core.config import settings
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_checkout import StripeWebhookEvent
from app.services.activity_log import record_activity
from app.services.payment_gateway_secrets import decrypt_gateway_secret
from app.services.stripe_checkout import verify_stripe_signature
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance/stripe-lifecycle", tags=["Stripe Lifecycle"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]

REVIEW_TYPES = {
    "charge.refunded", "refund.created", "refund.updated", "refund.failed",
    "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
    "payout.paid", "payout.failed", "payout.canceled",
    "checkout.session.completed", "checkout.session.async_payment_succeeded",
    "charge.succeeded", "payment_intent.succeeded",
}


@router.get("/events")
def list_lifecycle_events(db: DbSession, tenant: Viewer, limit: int = 50):
    rows = db.scalars(select(StripeWebhookEvent)
        .join(PaymentGatewayConnection, PaymentGatewayConnection.id == StripeWebhookEvent.connection_id)
        .where(
            StripeWebhookEvent.organization_id == tenant.organization_id,
            PaymentGatewayConnection.organization_id == tenant.organization_id,
            PaymentGatewayConnection.mode == "live",
        )
        .order_by(StripeWebhookEvent.received_at.desc())
        .limit(max(1, min(limit, 100)))
    ).all()
    return [
        {"id": row.id, "event_id": row.stripe_event_id, "event_type": row.event_type,
         "result": row.result, "received_at": row.received_at, "connection_id": row.connection_id}
        for row in rows
    ]


@router.get("/webhook-url/{connection_id}")
def live_webhook_url(connection_id: str, db: DbSession, tenant: Manager):
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.id == connection_id,
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe", PaymentGatewayConnection.mode == "live",
    ))
    if connection is None:
        raise HTTPException(status_code=404, detail="Live Stripe connection not found")
    return {
        "url": settings.public_api_url.rstrip("/") + f"/api/v1/finance/stripe-lifecycle/webhook/{connection.id}",
        "webhook_configured": bool(connection.webhook_secret_ciphertext),
        "accounting_auto_post_enabled": False,
        "events": sorted(REVIEW_TYPES),
    }



def _system_tenant(db: DbSession, connection: PaymentGatewayConnection) -> TenantContext:
    """Post as gateway's connected active organization member, never an unknown user."""
    organization = db.get(Organization, connection.organization_id)
    member = db.scalar(select(Membership).where(
        Membership.organization_id == connection.organization_id,
        Membership.user_id == connection.connected_by_user_id,
        Membership.status == "active",
    ))
    user = db.get(User, connection.connected_by_user_id)
    if organization is None or organization.status != "active" or member is None or user is None or not user.is_active:
        raise HTTPException(status_code=409, detail="Stripe gateway billing actor needs an active tenant membership")
    return TenantContext(organization=organization, membership=member, user=user)


def _verify_live_checkout_and_post(db: DbSession, connection: PaymentGatewayConnection, obj: dict) -> tuple[str, str]:
    """Signed Checkout event + authoritative Stripe reads + GL posting in one transaction."""
    if not settings.stripe_live_collection_enabled:
        return "review_required", ""
    checkout_id = obj.get("id")
    if not isinstance(checkout_id, str) or not checkout_id.startswith("cs_live_"):
        raise HTTPException(status_code=409, detail="Invalid Stripe Live Checkout Session")
    attempt = db.scalar(select(StripeCheckoutAttempt).where(
        StripeCheckoutAttempt.organization_id == connection.organization_id,
        StripeCheckoutAttempt.connection_id == connection.id,
        StripeCheckoutAttempt.mode == "live",
        StripeCheckoutAttempt.stripe_session_id == checkout_id,
    ).with_for_update())
    if attempt is None:
        raise HTTPException(status_code=409, detail="Unknown Live Checkout for this merchant")
    if (obj.get("livemode") is not True
            or obj.get("currency") != attempt.currency.lower()
            or obj.get("amount_total") != attempt.amount_minor
            or obj.get("client_reference_id") != attempt.id
            or (obj.get("metadata") or {}).get("checkout_attempt_id") != attempt.id):
        raise HTTPException(status_code=409, detail="Stripe Live Checkout identity or amount mismatch")
    if obj.get("payment_status") != "paid" or obj.get("status") != "complete":
        return "pending_payment", attempt.id
    pi_id = obj.get("payment_intent")
    if isinstance(pi_id, dict):
        pi_id = pi_id.get("id")
    if not isinstance(pi_id, str) or not pi_id.startswith("pi_"):
        raise HTTPException(status_code=409, detail="Live PaymentIntent missing")

    existing = db.scalar(select(StripeSettlementSnapshot).where(
        StripeSettlementSnapshot.organization_id == connection.organization_id,
        StripeSettlementSnapshot.attempt_id == attempt.id,
    ))
    if existing:
        if existing.stripe_payment_intent_id != pi_id:
            raise HTTPException(status_code=409, detail="Checkout payment intent changed")
        posted = db.scalar(select(StripeAccountingPosting).where(
            StripeAccountingPosting.organization_id == connection.organization_id,
            StripeAccountingPosting.snapshot_id == existing.id,
        ))
        if posted:
            return "live_paid_posted", attempt.id

    if not connection.secret_key_ciphertext or connection.connection_method != "api_key":
        raise HTTPException(status_code=409, detail="Live Stripe API key is required")
    facts = verified_sandbox_settlement(
        api_key=decrypt_gateway_secret(connection.secret_key_ciphertext),
        payment_intent_id=pi_id,
        currency=attempt.currency, amount_minor=attempt.amount_minor, mode="live",
    )
    if existing is None:
        existing = StripeSettlementSnapshot(
            organization_id=connection.organization_id,
            attempt_id=attempt.id, connection_id=connection.id,
            stripe_payment_intent_id=facts.payment_intent_id,
            stripe_charge_id=facts.charge_id,
            stripe_balance_transaction_id=facts.balance_transaction_id,
            currency=facts.currency, gross_minor=facts.gross_minor,
            fee_minor=facts.fee_minor, net_minor=facts.net_minor,
            availability_status=facts.availability_status,
        )
        db.add(existing)
        db.flush()
    else:
        if (existing.stripe_charge_id != facts.charge_id
                or existing.stripe_balance_transaction_id != facts.balance_transaction_id
                or existing.gross_minor != facts.gross_minor
                or existing.fee_minor != facts.fee_minor
                or existing.net_minor != facts.net_minor):
            raise HTTPException(status_code=409, detail="Stripe verified settlement changed; needs review")
    attempt.status = "live_paid"
    attempt.stripe_payment_intent_id = pi_id
    attempt.completed_at = datetime.now(timezone.utc)
    actor = _system_tenant(db, connection)
    # The posting service uses existing Finance and Journal APIs.
    post_verified_live_stripe_settlement(
        db, organization_id=connection.organization_id, actor=actor,
        snapshot_id=existing.id, request=None,
    )
    return "live_paid_posted", attempt.id


def _review_full_refund(db: DbSession, connection: PaymentGatewayConnection, event_type: str, obj: dict) -> str:
    """Reverse full successful refunds/lost disputes; partials remain manual-review.

    Existing financial corrections preserve journal source references, FX
    posting-period guards, and the source payment reversal semantics.
    """
    if not settings.stripe_live_collection_enabled:
        return "review_required"
    charge_id = obj.get("id") if event_type == "charge.refunded" else obj.get("charge")
    if isinstance(charge_id, dict):
        charge_id = charge_id.get("id")
    if not isinstance(charge_id, str) or not charge_id.startswith("ch_"):
        return "review_required"
    snapshot = db.scalar(select(StripeSettlementSnapshot).where(
        StripeSettlementSnapshot.organization_id == connection.organization_id,
        StripeSettlementSnapshot.connection_id == connection.id,
        StripeSettlementSnapshot.stripe_charge_id == charge_id,
    ).with_for_update())
    if snapshot is None:
        return "review_required"
    linked = db.scalar(select(StripeAccountingPosting).where(
        StripeAccountingPosting.organization_id == connection.organization_id,
        StripeAccountingPosting.snapshot_id == snapshot.id,
    ))
    if linked is None:
        return "review_required"
    if not connection.secret_key_ciphertext or connection.connection_method != "api_key":
        return "review_required"
    key = decrypt_gateway_secret(connection.secret_key_ciphertext)
    charge = stripe_retrieve(key, "charge", charge_id)
    if charge.get("livemode") is not True or charge.get("currency") != snapshot.currency.lower():
        raise HTTPException(status_code=409, detail="Stripe Charge ownership or currency mismatch")
    reversed_minor = charge.get("amount_refunded")
    if event_type == "charge.refunded":
        if charge.get("refunded") is not True or reversed_minor != snapshot.gross_minor:
            return "review_required"
    else:
        dispute_id = obj.get("id")
        if not isinstance(dispute_id, str) or not dispute_id.startswith("dp_"):
            return "review_required"
        dispute = stripe_retrieve(key, "dispute", dispute_id)
        if (dispute.get("status") != "lost" or dispute.get("currency") != snapshot.currency.lower()
                or dispute.get("amount") != snapshot.gross_minor
                or dispute.get("charge") not in (charge_id, {"id": charge_id})):
            return "review_required"
    payment = db.scalar(select(Payment).where(
        Payment.organization_id == connection.organization_id, Payment.id == linked.payment_id,
    ).with_for_update())
    if payment is None:
        raise HTTPException(status_code=409, detail="Stripe Payment accounting record missing")
    if payment.status == "reversed":
        return "already_reversed"
    actor = _system_tenant(db, connection)
    # Fee expense remains in place: Stripe does not promise processing-fee reimbursement.
    reverse_business_transaction(
        CorrectionRequest(
            source_type="payment", source_id=payment.id,
            reason="Verified Stripe full refund" if event_type == "charge.refunded" else "Verified Stripe lost chargeback",
        ), None, db, actor,
    )
    return "full_payment_reversed"


@router.post("/webhook/{connection_id}", include_in_schema=False)
async def review_live_stripe_event(connection_id: str, request: Request, db: DbSession):
    # Signed webhook processing is distinct from authenticated tenant APIs.
    # Locking the connection prevents duplicate insert races for this gateway.
    conn = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.id == connection_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == "live",
        PaymentGatewayConnection.is_active.is_(True),
    ).with_for_update())
    if conn is None or not conn.webhook_secret_ciphertext:
        raise HTTPException(status_code=404, detail="Live Stripe webhook is unavailable")
    body = await request.body()
    if len(body) > 256 * 1024:
        raise HTTPException(status_code=413, detail="Stripe webhook request too large")
    event = verify_stripe_signature(
        body, request.headers.get("stripe-signature"),
        decrypt_gateway_secret(conn.webhook_secret_ciphertext),
    )
    if event.get("livemode") is not True:
        raise HTTPException(status_code=400, detail="Sandbox events must not enter live lifecycle")
    event_id = event.get("id")
    event_type = event.get("type")
    obj = (event.get("data") or {}).get("object")
    if (not isinstance(event_id, str) or not event_id.startswith("evt_") or len(event_id) > 140
            or not isinstance(event_type, str) or len(event_type) > 100
            or not isinstance(obj, dict)):
        raise HTTPException(status_code=400, detail="Malformed Stripe lifecycle event")
    prior = db.scalar(select(StripeWebhookEvent).where(
        StripeWebhookEvent.organization_id == conn.organization_id,
        StripeWebhookEvent.connection_id == conn.id,
        StripeWebhookEvent.stripe_event_id == event_id,
    ))
    if prior is not None:
        return {"received": True, "duplicate": True}
    result = "review_required" if event_type in REVIEW_TYPES else "ignored"
    attempt_id = None
    # Only successfully verified, paid Live Checkout gets a real accounting posting.
    # All other events remain reviewable and cannot mutate the invoice.
    with defer_commits(db):
        if event_type in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
            result, attempt_id = _verify_live_checkout_and_post(db, conn, obj)
        elif event_type in {"charge.refunded", "charge.dispute.closed"}:
            result = _review_full_refund(db, conn, event_type, obj)
    row = StripeWebhookEvent(
        organization_id=conn.organization_id, connection_id=conn.id,
        stripe_event_id=event_id, event_type=event_type, attempt_id=attempt_id,
        result=result,
    )
    db.add(row)
    record_activity(
        db, action="stripe.live_lifecycle_event_received", scope="tenant",
        organization_id=conn.organization_id, actor_user_id=None, actor_type="system",
        entity_type="stripe_webhook_event", entity_id=row.id,
        after={"event_id": event_id, "event_type": event_type,
               "result": result, "accounting_posted": result == "live_paid_posted"},
        request=None,
    )
    db.commit()
    # Stripe retry is inappropriate for intentionally quarantined, valid events.
    return {"received": True, "duplicate": False, "review_required": result == "review_required", "result": result}
