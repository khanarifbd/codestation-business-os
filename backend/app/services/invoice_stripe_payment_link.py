"""Permanent, signed client pay links for issued Stripe Live invoices.

A Stripe Checkout Session expires; the invoice PDF must use a stable URL.
The stable URL is a bearer capability, HMAC-authenticated and never serves
client/invoice details. Visiting it creates/reuses a valid Checkout session.
"""
from __future__ import annotations

import hashlib
import hmac
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.models.finance import FinancialAccount, Invoice
from app.models.payment_gateways import PaymentGatewayConnection


def _signing_key() -> bytes:
    # This is a long-lived, randomly generated, server-only Fernet secret.
    # Domain separation prevents a pay-link MAC from being reusable elsewhere.
    key = settings.payment_gateway_encryption_key.strip()
    if len(key) < 40:
        raise HTTPException(status_code=503, detail="Payment link signing secret is not configured")
    return key.encode("ascii")


def _canonical_uuid(value: str) -> str:
    try:
        result = str(UUID(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Payment link not found") from exc
    if value != result:
        raise HTTPException(status_code=404, detail="Payment link not found")
    return result


def _signature(organization_id: str, invoice_id: str) -> str:
    payload = f"business-os:stripe:invoice-pay:v1:{organization_id}:{invoice_id}".encode()
    return hmac.new(_signing_key(), payload, hashlib.sha256).hexdigest()


def verify_public_invoice_link(organization_id: str, invoice_id: str, signature: str) -> None:
    organization_id = _canonical_uuid(organization_id)
    invoice_id = _canonical_uuid(invoice_id)
    if len(signature) != 64 or not hmac.compare_digest(signature, _signature(organization_id, invoice_id)):
        raise HTTPException(status_code=404, detail="Payment link not found")


def eligible_live_payment_invoice(db, invoice: Invoice) -> bool:
    if (not settings.stripe_live_collection_enabled
            or invoice.status not in {"sent", "partially_paid"}
            or invoice.payment_method != "stripe"
            or invoice.currency != "USD"
            or not invoice.payment_account_id
            or invoice.balance_due <= 0):
        return False
    return db.scalar(select(FinancialAccount.id)
        .join(PaymentGatewayConnection, PaymentGatewayConnection.id == FinancialAccount.gateway_connection_id)
        .where(
            FinancialAccount.organization_id == invoice.organization_id,
            FinancialAccount.id == invoice.payment_account_id,
            FinancialAccount.account_type == "payment_gateway",
            FinancialAccount.currency == invoice.currency,
            FinancialAccount.is_active.is_(True),
            PaymentGatewayConnection.organization_id == invoice.organization_id,
            PaymentGatewayConnection.provider == "stripe",
            PaymentGatewayConnection.mode == "live",
            PaymentGatewayConnection.is_active.is_(True),
            PaymentGatewayConnection.charges_enabled.is_(True),
            PaymentGatewayConnection.secret_key_ciphertext.is_not(None),
            PaymentGatewayConnection.webhook_secret_ciphertext.is_not(None),
        ).limit(1)) is not None


def effective_invoice_payment_url(db, invoice: Invoice) -> str | None:
    if eligible_live_payment_invoice(db, invoice):
        api_base = settings.public_api_url.rstrip("/")
        if (settings.environment.lower().strip() in {"production", "staging"}
                and not api_base.startswith("https://")):
            return None
        signature = _signature(invoice.organization_id, invoice.id)
        return (
            f"{api_base}/api/v1/finance/stripe-checkout/pay/"
            f"{invoice.organization_id}/{invoice.id}/{signature}"
        )
    return invoice.payment_url_snapshot
