"""Stripe USD Sandbox Checkout for issued invoices and signed webhook receipt.

Every call is tenant-scoped. No sandbox transaction is ever booked as a
financial account movement, customer payment or accounting journal. Live
Checkout is intentionally fail-closed until a verified posting implementation
(including Stripe fees and payouts) has been reviewed.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select

from app.api.dependencies import CurrentTenantAdmin, DbSession, require_tenant_permission
from app.core.config import settings
from app.models.finance import FinancialAccount, Invoice
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_checkout import StripeCheckoutAttempt, StripeWebhookEvent
from app.services.activity_log import record_activity
from app.services.payment_gateway_secrets import decrypt_gateway_secret, encrypt_gateway_secret
from app.services.stripe_checkout import (
    stripe_checkout_request, to_usd_minor_units, verify_stripe_signature,
)
from app.tenancy.context import TenantContext
from app.services.invoice_stripe_payment_link import verify_public_invoice_link

router = APIRouter(prefix="/finance/stripe-checkout", tags=["Stripe Checkout"])
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]


class WebhookSecretRequest(BaseModel):
    mode: str = Field(default="test", pattern="^(test|live)$")
    signing_secret: SecretStr


def _stripe_connection(db: DbSession, organization_id: str, *, mode: str = "test") -> PaymentGatewayConnection:
    connection = db.scalar(
        select(PaymentGatewayConnection).where(
            PaymentGatewayConnection.organization_id == organization_id,
            PaymentGatewayConnection.provider == "stripe",
            PaymentGatewayConnection.mode == mode,
            PaymentGatewayConnection.is_active.is_(True),
        )
    )
    if connection is None:
        raise HTTPException(status_code=409, detail=f"Connect your company's Stripe {mode} account first")
    return connection


def _linked_stripe_account(db: DbSession, invoice: Invoice, connection: PaymentGatewayConnection) -> FinancialAccount | None:
    """Invoice receipt destination must belong to the connected gateway and tenant."""
    if not invoice.payment_account_id or invoice.payment_method != "stripe":
        return None
    return db.scalar(select(FinancialAccount).where(
        FinancialAccount.organization_id == invoice.organization_id,
        FinancialAccount.id == invoice.payment_account_id,
        FinancialAccount.account_type == "payment_gateway",
        FinancialAccount.is_active.is_(True),
        FinancialAccount.currency == invoice.currency,
        FinancialAccount.gateway_connection_id == connection.id,
    ))


def _attempt_json(row: StripeCheckoutAttempt) -> dict:
    return {
        "id": row.id, "invoice_id": row.invoice_id, "mode": row.mode,
        "amount": f"{Decimal(row.amount_minor) / 100:.2f}", "currency": row.currency,
        "status": row.status, "checkout_url": row.checkout_url,
        "expires_at": row.expires_at, "completed_at": row.completed_at,
    }


@router.get("/invoices/{invoice_id}")
def stripe_checkout_status(invoice_id: str, db: DbSession, tenant: FinanceViewer):
    invoice = db.scalar(select(Invoice).where(
        Invoice.organization_id == organization_id, Invoice.id == invoice_id,
    ))
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.mode == "test",
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.is_active.is_(True),
    ))
    linked_account = _linked_stripe_account(db, invoice, connection) if connection is not None else None
    attempts = db.scalars(select(StripeCheckoutAttempt).where(
        StripeCheckoutAttempt.organization_id == tenant.organization_id,
        StripeCheckoutAttempt.invoice_id == invoice.id,
        StripeCheckoutAttempt.mode == "test",
    ).order_by(StripeCheckoutAttempt.created_at.desc()).limit(10)).all()
    return {
        "test_mode": True, "gateway_connected": connection is not None,
        "financial_account_linked": linked_account is not None,
        "financial_account_name": linked_account.name if linked_account else None,
        "webhook_configured": bool(connection and connection.webhook_secret_ciphertext),
        "checkout_available": bool(connection and connection.connection_method == "api_key"
                                   and connection.charges_enabled and connection.secret_key_ciphertext
                                   and connection.webhook_secret_ciphertext
                                   and invoice.status in {"sent", "partially_paid"}
                                   and linked_account is not None
                                   and invoice.balance_due > 0 and invoice.currency == "USD"),
        "account_id": connection.provider_account_id if connection else None,
        "webhook_url": (
            settings.public_api_url.rstrip("/") +
            f"/api/v1/finance/stripe-checkout/webhook/{connection.id}"
        ) if connection else None,
        "attempts": [_attempt_json(x) for x in attempts],
    }


@router.get("/live/invoices/{invoice_id}")
def stripe_live_checkout_status(invoice_id: str, db: DbSession, tenant: FinanceViewer):
    invoice = db.scalar(select(Invoice).where(
        Invoice.organization_id == tenant.organization_id, Invoice.id == invoice_id,
    ))
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == "live",
        PaymentGatewayConnection.is_active.is_(True),
    ))
    linked = _linked_stripe_account(db, invoice, connection) if connection else None
    attempts = db.scalars(select(StripeCheckoutAttempt).where(
        StripeCheckoutAttempt.organization_id == tenant.organization_id,
        StripeCheckoutAttempt.invoice_id == invoice.id,
        StripeCheckoutAttempt.mode == "live",
    ).order_by(StripeCheckoutAttempt.created_at.desc()).limit(10)).all()
    return {
        "mode": "live",
        "platform_live_enabled": settings.stripe_live_collection_enabled,
        "gateway_connected": connection is not None,
        "financial_account_linked": linked is not None,
        "webhook_configured": bool(connection and connection.webhook_secret_ciphertext),
        "checkout_available": bool(
            settings.stripe_live_collection_enabled and connection
            and connection.connection_method == "api_key" and connection.secret_key_ciphertext
            and connection.webhook_secret_ciphertext and connection.charges_enabled
            and linked and invoice.status in {"sent", "partially_paid"}
            and invoice.balance_due > 0 and invoice.currency == "USD"
        ),
        "attempts": [_attempt_json(x) for x in attempts],
    }


@router.post("/webhook-secret")
def save_webhook_secret(payload: WebhookSecretRequest, request: Request, db: DbSession, tenant: CurrentTenantAdmin):
    raw = payload.signing_secret.get_secret_value().strip()
    if not raw.startswith("whsec_") or len(raw) < 20 or len(raw) > 256:
        raise HTTPException(status_code=400, detail="Enter a valid Stripe webhook signing secret (whsec_...)")
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == payload.mode,
        PaymentGatewayConnection.is_active.is_(True),
    ).with_for_update())
    if connection is None:
        raise HTTPException(status_code=404, detail="No active Stripe account found")
    before = bool(connection.webhook_secret_ciphertext)
    connection.webhook_secret_ciphertext = encrypt_gateway_secret(raw)
    record_activity(
        db, action="payment_gateway.stripe.webhook_secret_saved", scope="tenant",
        actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="payment_gateway_connection", entity_id=connection.id,
        before={"webhook_configured": before}, after={"webhook_configured": True, "mode": payload.mode},
        request=request,
    )
    db.commit()
    return {"webhook_configured": True}


def _create_checkout(
    invoice_id: str, request: Request, db: DbSession,
    tenant: TenantContext | None, *, mode: str, authorized_organization_id: str | None = None,
):
    # For an authenticated manager, derive organization scope from their verified
    # context. For a public pay link, the caller MUST verify a signed capability
    # before explicitly passing authorized_organization_id.
    organization_id = tenant.organization_id if tenant is not None else authorized_organization_id
    if not organization_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    actor_user_id = tenant.user_id if tenant is not None else None
    """Create or reuse a tenant-owned USD Stripe Checkout with explicit mode."""
    invoice = db.scalar(select(Invoice).where(
        Invoice.organization_id == organization_id, Invoice.id == invoice_id,
    ).with_for_update())
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status not in {"sent", "partially_paid"} or invoice.balance_due <= 0:
        raise HTTPException(status_code=409, detail="Only issued unpaid invoices can create Stripe Checkout")
    amount_minor = to_usd_minor_units(Decimal(invoice.balance_due), invoice.currency)
    connection = _stripe_connection(db, organization_id, mode=mode)
    if _linked_stripe_account(db, invoice, connection) is None:
        raise HTTPException(
            status_code=409,
            detail="The invoice Stripe receipt account must be linked to this company's connected Stripe account in Financial Accounts.",
        )
    if connection.connection_method != "api_key" or not connection.secret_key_ciphertext:
        raise HTTPException(status_code=409, detail="Connect your Stripe API Key in Company Settings first")
    if not connection.charges_enabled or not connection.webhook_secret_ciphertext:
        raise HTTPException(status_code=409, detail="Enable Stripe charges and save a Webhook Signing Secret first")
    if settings.environment.lower().strip() in {"production", "staging"} and not settings.public_api_url.startswith("https://"):
        raise HTTPException(status_code=503, detail="Platform webhook public HTTPS API URL is not configured")
    now = datetime.now(timezone.utc)
    existing = db.scalar(select(StripeCheckoutAttempt).where(
        StripeCheckoutAttempt.organization_id == organization_id,
        StripeCheckoutAttempt.invoice_id == invoice.id,
        StripeCheckoutAttempt.connection_id == connection.id,
        StripeCheckoutAttempt.currency == invoice.currency,
        StripeCheckoutAttempt.amount_minor == amount_minor,
        StripeCheckoutAttempt.status == "open",
        StripeCheckoutAttempt.mode == mode,
        StripeCheckoutAttempt.expires_at > now,
    ).order_by(StripeCheckoutAttempt.created_at.desc()).limit(1))
    if existing is not None and existing.checkout_url:
        return _attempt_json(existing)

    attempt = StripeCheckoutAttempt(
        organization_id=organization_id, invoice_id=invoice.id,
        connection_id=connection.id, mode=mode,
        currency=invoice.currency, amount_minor=amount_minor,
        created_by_user_id=actor_user_id or invoice.created_by_user_id,
        status="initiated",
    )
    db.add(attempt)
    db.flush()
    try:
        checkout = stripe_checkout_request(
            api_key=decrypt_gateway_secret(connection.secret_key_ciphertext),
            attempt_id=attempt.id, invoice_number=invoice.invoice_number,
            currency=invoice.currency, amount_minor=amount_minor,
            client_email=invoice.client_email_snapshot,
            public_app_url=settings.public_app_url, mode=mode,
        )
    except Exception:
        db.rollback()
        raise
    attempt.stripe_session_id = checkout["id"]
    attempt.checkout_url = checkout["url"]
    attempt.expires_at = datetime.fromtimestamp(int(checkout["expires_at"]), tz=timezone.utc)
    attempt.status = "open"
    record_activity(
        db, action="payment_gateway.stripe.checkout_created", scope="tenant",
        actor_user_id=actor_user_id, actor_type="user" if tenant is not None else "system", organization_id=organization_id,
        entity_type="stripe_checkout_attempt", entity_id=attempt.id,
        after={"invoice_id": invoice.id, "invoice_number": invoice.invoice_number,
               "connection_id": connection.id, "mode": mode, "amount_minor": amount_minor,
               "currency": invoice.currency}, request=request,
    )
    db.commit()
    return _attempt_json(attempt)



@router.post("/invoices/{invoice_id}", status_code=status.HTTP_201_CREATED)
def create_sandbox_checkout(invoice_id: str, request: Request, db: DbSession, tenant: FinanceManager):
    """Existing Test Checkout stays Sandbox-only."""
    return _create_checkout(invoice_id, request, db, tenant, mode="test")


@router.post("/live/invoices/{invoice_id}", status_code=status.HTTP_201_CREATED)
def create_live_checkout(invoice_id: str, request: Request, db: DbSession, tenant: FinanceManager):
    """Real-money Checkout: require merchant Live gateway and signed webhook."""
    if not settings.stripe_live_collection_enabled:
        raise HTTPException(status_code=409, detail="Live collection requires platform approval and STRIPE_LIVE_COLLECTION_ENABLED")
    return _create_checkout(invoice_id, request, db, tenant, mode="live")


@router.post("/live/invoices/{invoice_id}/attempts/{attempt_id}/reconcile")
def reconcile_live_checkout(
    invoice_id: str, attempt_id: str, request: Request, db: DbSession, tenant: FinanceManager,
):
    """Recover a paid Live Checkout when a signed webhook was lost or held.

    Re-read the exact original Checkout from the company's Stripe account,
    validate amount, ownership, PaymentIntent, captured Charge and fee before
    invoking established GL services. Never use client-supplied payment truth.
    """
    if not settings.stripe_live_collection_enabled:
        raise HTTPException(status_code=409, detail="Live Stripe reconciliation is not enabled")
    attempt = db.scalar(select(StripeCheckoutAttempt).where(
        StripeCheckoutAttempt.organization_id == tenant.organization_id,
        StripeCheckoutAttempt.invoice_id == invoice_id,
        StripeCheckoutAttempt.id == attempt_id,
        StripeCheckoutAttempt.mode == "live",
    ).with_for_update())
    if attempt is None or not attempt.stripe_session_id:
        raise HTTPException(status_code=404, detail="Live Stripe Checkout session not found")
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.id == attempt.connection_id,
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == "live",
        PaymentGatewayConnection.is_active.is_(True),
    ))
    if connection is None or not connection.secret_key_ciphertext or connection.connection_method != "api_key":
        raise HTTPException(status_code=409, detail="Verified connected Stripe Live API credentials are required")
    from app.services.stripe_settlement import stripe_retrieve
    from app.api.v1.stripe_lifecycle import _verify_live_checkout_and_post
    from app.db.session import defer_commits
    session = stripe_retrieve(
        decrypt_gateway_secret(connection.secret_key_ciphertext),
        "checkout_session", attempt.stripe_session_id,
    )
    with defer_commits(db):
        result, related_attempt_id = _verify_live_checkout_and_post(db, connection, session)
        record_activity(
            db, action="stripe.live_checkout_manual_reconciliation", scope="tenant",
            organization_id=tenant.organization_id, actor_user_id=tenant.user_id,
            entity_type="stripe_checkout_attempt", entity_id=attempt.id,
            after={"result": result, "attempt_id": related_attempt_id, "invoice_id": invoice_id},
            request=request,
        )
    db.commit()
    return {"result": result, "attempt_id": attempt.id, "accounting_posted": result == "live_paid_posted"}


@router.get("/pay/{organization_id}/{invoice_id}/{signature}", include_in_schema=False)
def open_public_live_invoice_checkout(
    organization_id: str, invoice_id: str, signature: str, request: Request, db: DbSession,
):
    """Public bearer link shown in issued invoice PDFs and QR codes.

    The HMAC is validated before reading tenant data. This endpoint exposes
    no invoice/client details and only starts an authorized Live Stripe Checkout.
    """
    verify_public_invoice_link(organization_id, invoice_id, signature)
    if not settings.stripe_live_collection_enabled:
        raise HTTPException(status_code=503, detail="Online invoice payments are temporarily unavailable")
    result = _create_checkout(
        invoice_id, request, db, None, mode="live", authorized_organization_id=organization_id,
    )
    return RedirectResponse(url=result["checkout_url"], status_code=303)


@router.post("/webhook/{connection_id}", include_in_schema=False)
async def stripe_sandbox_webhook(connection_id: str, request: Request, db: DbSession):
    """Public webhook: the secret binds it to the specific registered tenant account."""
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.id == connection_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == "test",
        PaymentGatewayConnection.is_active.is_(True),
    ))
    if connection is None or not connection.webhook_secret_ciphertext:
        raise HTTPException(status_code=404, detail="Stripe webhook not available")
    body = await request.body()
    event = verify_stripe_signature(
        body, request.headers.get("stripe-signature"),
        decrypt_gateway_secret(connection.webhook_secret_ciphertext),
    )
    if event.get("livemode") is not False:
        raise HTTPException(status_code=400, detail="Live Stripe events are not accepted by this endpoint")
    event_id = event["id"]
    if not event_id.startswith("evt_") or len(event_id) > 140:
        raise HTTPException(status_code=400, detail="Invalid Stripe event ID")
    existing = db.scalar(select(StripeWebhookEvent).where(
        StripeWebhookEvent.connection_id == connection.id,
        StripeWebhookEvent.stripe_event_id == event_id,
    ))
    if existing:
        return {"received": True, "duplicate": True}

    event_type = event["type"]
    stripe_object = (event.get("data") or {}).get("object")
    attempt = None
    result = "ignored"
    relevant_types = {"checkout.session.completed", "checkout.session.async_payment_succeeded"}
    if event_type in relevant_types:
        if not isinstance(stripe_object, dict) or not isinstance(stripe_object.get("id"), str):
            raise HTTPException(status_code=400, detail="Malformed Stripe Checkout event")
        attempt = db.scalar(select(StripeCheckoutAttempt).where(
            StripeCheckoutAttempt.organization_id == connection.organization_id,
            StripeCheckoutAttempt.connection_id == connection.id,
            StripeCheckoutAttempt.stripe_session_id == stripe_object["id"],
            StripeCheckoutAttempt.mode == "test",
        ).with_for_update())
        if attempt is None:
            raise HTTPException(status_code=409, detail="Unknown Stripe Checkout session for this merchant")
        if (
            stripe_object.get("livemode") is not False
            or stripe_object.get("currency") != attempt.currency.lower()
            or stripe_object.get("amount_total") != attempt.amount_minor
            or stripe_object.get("client_reference_id") != attempt.id
            or (stripe_object.get("metadata") or {}).get("checkout_attempt_id") != attempt.id
        ):
            raise HTTPException(status_code=409, detail="Stripe Checkout amount or ownership did not match")
        invoice = db.scalar(select(Invoice).where(
            Invoice.organization_id == connection.organization_id,
            Invoice.id == attempt.invoice_id,
        ))
        if invoice is None:
            raise HTTPException(status_code=409, detail="Invoice no longer exists")
        # Stripe customer paid in the sandbox. Do not change invoice status or
        # operational GL amounts: sandbox money is not business cash or revenue.
        if stripe_object.get("payment_status") == "paid":
            result = "sandbox_paid"
            if attempt.status != "sandbox_paid":
                attempt.status = "sandbox_paid"
                attempt.stripe_payment_intent_id = str(stripe_object.get("payment_intent") or "")[:120] or None
                attempt.completed_at = datetime.now(timezone.utc)
        else:
            result = "pending_payment"
    row = StripeWebhookEvent(
        organization_id=connection.organization_id,
        connection_id=connection.id, stripe_event_id=event_id,
        event_type=event_type[:100], attempt_id=attempt.id if attempt else None,
        result=result,
    )
    db.add(row)
    record_activity(
        db, action="payment_gateway.stripe.sandbox_webhook_processed", scope="tenant",
        organization_id=connection.organization_id, actor_user_id=None, actor_type="system",
        entity_type="stripe_webhook_event", entity_id=row.id,
        after={"event_id": event_id, "event_type": event_type[:100],
               "attempt_id": attempt.id if attempt else None,
               "invoice_id": attempt.invoice_id if attempt else None,
               "result": result, "mode": "test"},
        request=None,  # Never store signed webhook headers or raw payment/customer payload.
    )
    db.commit()
    return {"received": True, "duplicate": False}
