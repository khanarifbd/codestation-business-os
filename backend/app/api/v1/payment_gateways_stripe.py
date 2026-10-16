"""Stripe Connect Standard-account authorization for each Business OS organization.

Connection setup only: creating Stripe charges is deliberately disabled until
Checkout and verified-webhook ledger reconciliation are shipped.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as HttpRequest, urlopen

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, SecretStr, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentTenantAdmin, DbSession, require_tenant_permission
from app.core.config import settings
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.payment_gateways import GatewayOAuthState, PaymentGatewayConnection
from app.services.activity_log import record_activity
from app.services.payment_gateway_secrets import encrypt_gateway_secret
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance/payment-gateways/stripe", tags=["Payment Gateways"])
GatewayViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
STATE_LIFETIME = timedelta(minutes=10)

class StripeManualConnectionCreate(BaseModel):
    mode: str = Field(pattern="^(test|live)$")
    secret_key: SecretStr
    webhook_secret: SecretStr | None = None
    replace_existing: bool = False

    @model_validator(mode="after")
    def validate_keys(self):
        secret = self.secret_key.get_secret_value().strip()
        if not secret.startswith("sk_" + self.mode + "_") or len(secret) < 24 or len(secret) > 256:
            raise ValueError("Use the Stripe secret key matching the selected Test/Live mode")
        if self.webhook_secret is not None:
            webhook = self.webhook_secret.get_secret_value().strip()
            if webhook and (not webhook.startswith("whsec_") or len(webhook) < 20 or len(webhook) > 256):
                raise ValueError("Use the Stripe webhook signing secret beginning with whsec_")
        return self




def _credentials(mode: str) -> tuple[str, str]:
    if mode not in {"test", "live"}:
        raise HTTPException(status_code=400, detail="Mode must be test or live")
    client_id = settings.stripe_connect_client_id_test if mode == "test" else settings.stripe_connect_client_id_live
    secret = settings.stripe_secret_key_test if mode == "test" else settings.stripe_secret_key_live
    if not client_id or not secret or not settings.stripe_oauth_redirect_uri:
        raise HTTPException(status_code=503, detail="Stripe Connect is not configured by the platform administrator")
    if not client_id.startswith("ca_") or not secret.startswith("sk_" + mode + "_"):
        raise HTTPException(status_code=503, detail="Stripe platform credentials do not match the requested mode")
    if settings.environment.lower() in {"production", "staging"} and not settings.stripe_oauth_redirect_uri.startswith("https://"):
        raise HTTPException(status_code=503, detail="Stripe redirect URI must use HTTPS")
    return client_id, secret


def _stripe_request(url: str, *, api_key: str, form: dict[str, str] | None = None) -> dict:
    """Perform a server-only Stripe API call; URLs are fixed call-site constants."""
    data = urlencode(form).encode() if form is not None else None
    auth = base64.b64encode((api_key + ":").encode()).decode()
    request = HttpRequest(
        url, data=data,
        headers={"Authorization": "Basic " + auth, "Accept": "application/json",
                 **({"Content-Type": "application/x-www-form-urlencoded"} if data is not None else {})},
        method="POST" if form is not None else "GET",
    )
    try:
        with urlopen(request, timeout=12) as response:
            result = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        # Stripe OAuth errors can contain diagnostic/PII details. Do not leak them.
        raise HTTPException(status_code=502, detail="Stripe could not complete this request; please retry") from exc
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Unexpected Stripe response")
    return result


def _connection_read(row: PaymentGatewayConnection | None, *, mode: str) -> dict:
    return {
        "provider": "stripe", "mode": mode,
        "connected": bool(row and row.is_active),
        "stripe_account_id": row.provider_account_id if row and row.is_active else None,
        "charges_enabled": bool(row and row.is_active and row.charges_enabled),
        "payouts_enabled": bool(row and row.is_active and row.payouts_enabled),
        "details_submitted": bool(row and row.is_active and row.details_submitted),
        "connection_method": row.connection_method if row and row.is_active else None,
        "account_label": row.account_label if row and row.is_active else None,
        "credential_hint": row.credential_hint if row and row.is_active else None,
        "webhook_configured": bool(row and row.is_active and row.webhook_secret_ciphertext),
        "webhook_url": (
            settings.public_api_url.rstrip("/") +
            f"/api/v1/finance/stripe-checkout/webhook/{row.id}"
        ) if row and row.is_active and mode == "test" else None,
        "checkout_available": False,  # Never pretend payments are live before webhook reconciliation exists.
    }


def _connection(db: DbSession, organization_id: str, mode: str) -> PaymentGatewayConnection | None:
    return db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.organization_id == organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == mode,
    ))


@router.post("/manual")
def connect_stripe_manually(
    payload: StripeManualConnectionCreate, request: Request,
    db: DbSession, tenant: CurrentTenantAdmin,
):
    """Self-service BYO Stripe account for companies not using platform OAuth.

    Validate ownership by performing a server-only Stripe account request using
    the supplied key. Never echo or audit the key; store only encrypted secrets.
    """
    # Refuse before asking Stripe if server-side encrypted storage is unavailable.
    secret = payload.secret_key.get_secret_value().strip()
    encrypted = encrypt_gateway_secret(secret)
    supplied_webhook = payload.webhook_secret.get_secret_value().strip() if payload.webhook_secret else ""
    encrypted_webhook = encrypt_gateway_secret(supplied_webhook) if supplied_webhook else None
    try:
        account = _stripe_request("https://api.stripe.com/v1/account", api_key=secret)
    except HTTPException as exc:
        raise HTTPException(status_code=400, detail="Stripe could not verify this secret key or its account permissions") from exc
    account_id = account.get("id")
    if not isinstance(account_id, str) or not account_id.startswith("acct_"):
        raise HTTPException(status_code=400, detail="Stripe returned an invalid account identifier")
    # Prevent one Stripe merchant account from being used by different tenants.
    duplicate = db.scalar(select(PaymentGatewayConnection.id).where(
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == payload.mode,
        PaymentGatewayConnection.provider_account_id == account_id,
        PaymentGatewayConnection.organization_id != tenant.organization_id,
    ))
    if duplicate:
        raise HTTPException(status_code=409, detail="This Stripe account is already connected to another company")
    current = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == payload.mode,
    ).with_for_update())
    if current is not None and current.is_active and not payload.replace_existing:
        raise HTTPException(status_code=409, detail="A Stripe connection already exists; explicitly confirm replacement")
    before_data = _connection_read(current, mode=payload.mode) if current else None
    name = account.get("business_profile") or {}
    if not isinstance(name, dict):
        name = {}
    label = name.get("name") or account.get("business_name") or account.get("email")
    if current is None:
        current = PaymentGatewayConnection(
            organization_id=tenant.organization_id, provider="stripe", mode=payload.mode,
            provider_account_id=account_id, connected_by_user_id=tenant.user_id,
        )
        db.add(current)
    current.provider_account_id = account_id
    current.account_label = str(label)[:180] if label else None
    current.connection_method = "api_key"
    current.secret_key_ciphertext = encrypted
    current.webhook_secret_ciphertext = encrypted_webhook
    current.credential_hint = "••••" + secret[-4:]
    current.charges_enabled = bool(account.get("charges_enabled"))
    current.payouts_enabled = bool(account.get("payouts_enabled"))
    current.details_submitted = bool(account.get("details_submitted"))
    current.connected_by_user_id = tenant.user_id
    current.is_active = True
    db.flush()
    record_activity(
        db, action="payment_gateway.stripe.manual_connected", scope="tenant",
        organization_id=tenant.organization_id, actor_user_id=tenant.user_id,
        entity_type="payment_gateway_connection", entity_id=current.id,
        before=before_data,
        after={"provider": "stripe", "mode": payload.mode, "stripe_account_id": account_id,
               "connection_method": "api_key", "webhook_configured": bool(encrypted_webhook),
               "charges_enabled": current.charges_enabled},
        request=request,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Stripe account is already assigned to another company") from exc
    return _connection_read(current, mode=payload.mode)


@router.post("/disable")
def disable_stripe_connection(
    request: Request, db: DbSession, tenant: CurrentTenantAdmin,
    mode: str = Query(default="test", pattern="^(test|live)$"),
):
    row = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe", PaymentGatewayConnection.mode == mode,
    ).with_for_update())
    if row is None or not row.is_active:
        raise HTTPException(status_code=404, detail="No active Stripe connection to disable")
    before = _connection_read(row, mode=mode)
    row.is_active = False
    row.secret_key_ciphertext = None
    row.webhook_secret_ciphertext = None
    row.credential_hint = None
    record_activity(
        db, action="payment_gateway.stripe.disabled", scope="tenant",
        organization_id=tenant.organization_id, actor_user_id=tenant.user_id,
        entity_type="payment_gateway_connection", entity_id=row.id,
        before=before, after=_connection_read(row, mode=mode), request=request,
    )
    db.commit()
    return _connection_read(row, mode=mode)


@router.get("")
def stripe_connections(db: DbSession, tenant: GatewayViewer):
    return {"manual_setup_available": bool(settings.payment_gateway_encryption_key.strip()),
            "configured_modes": [m for m in ("test", "live")
             if bool(getattr(settings, "stripe_connect_client_id_" + m, "")) and bool(getattr(settings, "stripe_secret_key_" + m, ""))],
            "connections": [_connection_read(_connection(db, tenant.organization_id, mode), mode=mode)
                            for mode in ("test", "live")]}


@router.post("/connect")
def connect_stripe(request: Request, db: DbSession, tenant: CurrentTenantAdmin, mode: str = Query(default="test")):
    client_id, _ = _credentials(mode)
    token = secrets.token_urlsafe(40)
    row = GatewayOAuthState(
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        organization_id=tenant.organization_id,
        provider="stripe", mode=mode, requested_by_user_id=tenant.user_id,
        expires_at=datetime.now(timezone.utc) + STATE_LIFETIME,
    )
    db.add(row)
    record_activity(
        db, action="payment_gateway.stripe.connect_requested", scope="tenant",
        organization_id=tenant.organization_id, actor_user_id=tenant.user_id,
        entity_type="payment_gateway_connection", entity_id=tenant.organization_id,
        after={"provider": "stripe", "mode": mode}, request=request,
    )
    db.commit()
    url = "https://connect.stripe.com/oauth/authorize?" + urlencode({
        "response_type": "code", "client_id": client_id, "scope": "read_write",
        "redirect_uri": settings.stripe_oauth_redirect_uri, "state": token,
    })
    return {"authorization_url": url}


@router.get("/oauth/callback", include_in_schema=False)
def stripe_oauth_callback(
    request: Request, db: DbSession, state: str = Query(..., min_length=30, max_length=256),
    code: str | None = None, error: str | None = None,
):
    # Callback is intentionally unauthenticated.  The short-lived, random,
    # one-use, DB-held OAuth state binds it to a verified tenant admin.
    token_hash = hashlib.sha256(state.encode()).hexdigest()
    row = db.scalar(select(GatewayOAuthState).where(
        GatewayOAuthState.token_hash == token_hash,
        GatewayOAuthState.provider == "stripe",
    ).with_for_update())
    if row is None or row.consumed_at is not None or row.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Stripe authorization expired or invalid")
    org = db.scalar(select(Organization).where(Organization.id == row.organization_id,
                                                Organization.status == "active"))
    membership = db.scalar(select(Membership).where(
        Membership.organization_id == row.organization_id,
        Membership.user_id == row.requested_by_user_id,
        Membership.status == "active", Membership.role == "admin",
    ))
    if org is None or membership is None:
        raise HTTPException(status_code=403, detail="Stripe connection initiator no longer has organization admin access")
    destination = settings.public_app_url.rstrip("/") + "/dashboard/company?tab=payments"
    if error or not code:
        row.consumed_at = datetime.now(timezone.utc)
        db.commit()
        return RedirectResponse(destination + "&stripe=cancelled", status_code=303)
    _, secret = _credentials(row.mode)
    oauth = _stripe_request("https://connect.stripe.com/oauth/token", api_key=secret,
                             form={"grant_type": "authorization_code", "code": code})
    account_id = oauth.get("stripe_user_id")
    if not isinstance(account_id, str) or not account_id.startswith("acct_"):
        raise HTTPException(status_code=502, detail="Stripe returned an invalid account")
    account = _stripe_request("https://api.stripe.com/v1/accounts/" + account_id, api_key=secret)
    if account.get("id") != account_id:
        raise HTTPException(status_code=502, detail="Stripe account verification failed")
    # Do not let the same external Stripe account be attached to multiple tenants.
    collision = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == row.mode,
        PaymentGatewayConnection.provider_account_id == account_id,
        PaymentGatewayConnection.organization_id != row.organization_id,
    ))
    if collision is not None:
        raise HTTPException(status_code=409, detail="Stripe account is already linked to another workspace")
    current = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.organization_id == row.organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == row.mode,
    ).with_for_update())
    before = {"stripe_account_id": current.provider_account_id, "active": current.is_active} if current else None
    if current is None:
        current = PaymentGatewayConnection(
            organization_id=row.organization_id, provider="stripe", mode=row.mode,
            provider_account_id=account_id, connected_by_user_id=row.requested_by_user_id,
        )
        db.add(current)
    else:
        current.provider_account_id = account_id
        current.connected_by_user_id = row.requested_by_user_id
    current.is_active = True
    current.connection_method = "oauth"
    current.secret_key_ciphertext = None
    current.webhook_secret_ciphertext = None
    current.credential_hint = None
    current.charges_enabled = bool(account.get("charges_enabled"))
    current.payouts_enabled = bool(account.get("payouts_enabled"))
    current.details_submitted = bool(account.get("details_submitted"))
    row.consumed_at = datetime.now(timezone.utc)
    db.flush()
    record_activity(
        db, action="payment_gateway.stripe.connected", scope="tenant",
        organization_id=row.organization_id, actor_user_id=None, actor_type="system",
        entity_type="payment_gateway_connection", entity_id=current.id,
        before=before, after={"mode": row.mode, "stripe_account_id": account_id,
                              "charges_enabled": current.charges_enabled,
                              "initiated_by_user_id": row.requested_by_user_id},
        request=None, # Never log OAuth authorization codes from callback URLs.
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This Stripe account is already connected elsewhere") from exc
    return RedirectResponse(destination + "&stripe=connected", status_code=303)


@router.post("/refresh")
def refresh_stripe_connection(request: Request, db: DbSession, tenant: CurrentTenantAdmin,
                              mode: str = Query(default="test")):
    row = _connection(db, tenant.organization_id, mode)
    if row is None or not row.is_active:
        raise HTTPException(status_code=404, detail="Stripe account not connected to this company")
    if row.connection_method == "api_key":
        from app.services.payment_gateway_secrets import decrypt_gateway_secret
        if not row.secret_key_ciphertext:
            raise HTTPException(status_code=409, detail="Encrypted Stripe credentials are missing; reconnect Stripe")
        secret = decrypt_gateway_secret(row.secret_key_ciphertext)
    else:
        _, secret = _credentials(mode)
    account = _stripe_request("https://api.stripe.com/v1/accounts/" + row.provider_account_id, api_key=secret)
    if account.get("id") != row.provider_account_id:
        raise HTTPException(status_code=502, detail="Stripe account verification failed")
    before = _connection_read(row, mode=mode)
    row.charges_enabled = bool(account.get("charges_enabled"))
    row.payouts_enabled = bool(account.get("payouts_enabled"))
    row.details_submitted = bool(account.get("details_submitted"))
    record_activity(
        db, action="payment_gateway.stripe.status_refreshed", scope="tenant",
        organization_id=tenant.organization_id, actor_user_id=tenant.user_id,
        entity_type="payment_gateway_connection", entity_id=row.id,
        before=before, after=_connection_read(row, mode=mode), request=request,
    )
    db.commit()
    return _connection_read(row, mode=mode)
