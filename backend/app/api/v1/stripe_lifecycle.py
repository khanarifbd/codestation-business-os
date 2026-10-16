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
    if event_type in REVIEW_TYPES:
        result = "review_required"
    else:
        result = "ignored"
    row = StripeWebhookEvent(
        organization_id=conn.organization_id, connection_id=conn.id,
        stripe_event_id=event_id, event_type=event_type,
        result=result,
    )
    db.add(row)
    record_activity(
        db, action="stripe.live_lifecycle_event_received", scope="tenant",
        organization_id=conn.organization_id, actor_user_id=None, actor_type="system",
        entity_type="stripe_webhook_event", entity_id=row.id,
        after={"event_id": event_id, "event_type": event_type,
               "result": result, "accounting_posted": False},
        request=None,
    )
    db.commit()
    # Stripe retry is inappropriate for intentionally quarantined, valid events.
    return {"received": True, "duplicate": False, "review_required": result == "review_required"}
