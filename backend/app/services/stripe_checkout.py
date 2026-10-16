"""Strict Stripe webhook authentication and currency-safe Checkout helpers.

Sandbox events never modify business financial records. Live webhooks are
explicitly rejected until settlement/accounting integration is verified.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request as UrlRequest, urlopen

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Never relay raw Stripe error messages: some may contain customer data.
SAFE_STRIPE_PARAMETERS = {
    "customer_email", "success_url", "cancel_url", "mode",
    "payment_method_types", "line_items", "line_items[0][price_data][currency]",
    "line_items[0][price_data][unit_amount]",
}

def _stripe_checkout_error(exc: HTTPError) -> HTTPException:
    code = ""
    param = ""
    try:
        raw = json.loads(exc.read(4096))
        error = raw.get("error", {}) if isinstance(raw, dict) else {}
        if isinstance(error, dict):
            code = error.get("code") if isinstance(error.get("code"), str) else ""
            param = error.get("param") if isinstance(error.get("param"), str) else ""
    except (ValueError, UnicodeDecodeError, OSError):
        pass
    # Log only numeric status and a bounded allowlisted parameter name.
    safe_param = param if param in SAFE_STRIPE_PARAMETERS else "other"
    logger.warning("Stripe Checkout rejected request: status=%s code=%s parameter=%s",
                   exc.code, code[:48].replace("\n", ""), safe_param)
    if exc.code == 401:
        return HTTPException(status_code=409, detail="Stripe rejected the Test API Key. Reconnect the correct Stripe Sandbox Secret Key.")
    if exc.code == 403:
        return HTTPException(status_code=409, detail="Stripe API Key lacks permission to create Checkout Sessions; check Stripe key permissions.")
    if exc.code == 400 and safe_param == "customer_email":
        return HTTPException(status_code=422, detail="The invoice client email is invalid for Stripe Checkout. Correct the client email and try again.")
    if exc.code == 400:
        return HTTPException(status_code=422, detail=f"Stripe rejected the Checkout configuration ({safe_param}). Review the Sandbox Stripe account settings.")
    return HTTPException(status_code=502, detail="Stripe Checkout is temporarily unavailable; try again later.")


SIGNATURE_TOLERANCE_SECONDS = 300
MAX_WEBHOOK_BYTES = 1024 * 1024


def verify_stripe_signature(body: bytes, signature_header: str | None, secret: str, *, now: int | None = None) -> dict:
    """Validate Stripe-Signature t/v1 with clock skew + replay tolerance."""
    if not signature_header or not isinstance(body, bytes) or len(body) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=400, detail="Missing or oversized Stripe event")
    values: dict[str, list[str]] = {}
    for item in signature_header.split(","):
        key, sep, value = item.strip().partition("=")
        if sep:
            values.setdefault(key, []).append(value)
    if len(values.get("t", [])) != 1 or not values.get("v1"):
        raise HTTPException(status_code=400, detail="Malformed Stripe event signature")
    try:
        timestamp = int(values["t"][0])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe event timestamp") from exc
    if abs((int(time.time()) if now is None else now) - timestamp) > SIGNATURE_TOLERANCE_SECONDS:
        raise HTTPException(status_code=400, detail="Stripe event signature expired")
    signed = str(timestamp).encode() + b"." + body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(candidate, expected) for candidate in values["v1"]):
        raise HTTPException(status_code=400, detail="Stripe event signature verification failed")
    try:
        event = json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Stripe event JSON is invalid") from exc
    if not isinstance(event, dict) or not isinstance(event.get("id"), str) or not isinstance(event.get("type"), str):
        raise HTTPException(status_code=400, detail="Stripe event is malformed")
    return event


def stripe_checkout_request(
    *, api_key: str, attempt_id: str, invoice_number: str, currency: str,
    amount_minor: int, client_email: str | None, public_app_url: str,
) -> dict:
    """Create one Stripe-hosted Checkout Session with deterministic retry key."""
    if not currency.isalpha() or len(currency) != 3 or currency.upper() != "USD":
        raise HTTPException(status_code=422, detail="Stripe sandbox Checkout initially supports USD invoices only")
    if not 1 <= amount_minor <= 99_999_999:
        raise HTTPException(status_code=422, detail="Invoice amount is outside the supported Stripe sandbox range")
    app_url = public_app_url.rstrip("/")
    parsed = urlparse(app_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise HTTPException(status_code=503, detail="Public HTTPS app URL must be configured before Stripe Checkout")
    success_url = app_url + "/payments/stripe/return?result=success&session_id={CHECKOUT_SESSION_ID}"
    cancel_url = app_url + "/payments/stripe/return?result=cancelled"
    form: dict[str, str] = {
        "mode": "payment",
        "client_reference_id": attempt_id,
        "line_items[0][price_data][currency]": currency.lower(),
        "line_items[0][price_data][unit_amount]": str(amount_minor),
        "line_items[0][price_data][product_data][name]": "Business OS invoice " + invoice_number[:40],
        "line_items[0][quantity]": "1",
        "success_url": success_url, "cancel_url": cancel_url,
        "metadata[checkout_attempt_id]": attempt_id,
    }
    if client_email:
        form["customer_email"] = client_email.strip()
    token = base64.b64encode((api_key + ":").encode()).decode()
    req = UrlRequest(
        "https://api.stripe.com/v1/checkout/sessions",
        method="POST",
        data=urlencode(form).encode(),
        headers={
            "Authorization": "Basic " + token,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": "business-os-checkout-" + attempt_id,
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=15) as response:
            result = json.load(response)
    except HTTPError as exc:
        raise _stripe_checkout_error(exc) from None
    except (URLError, TimeoutError, ValueError) as exc:
        logger.warning("Stripe Checkout request failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Could not reach Stripe Checkout. Please retry.") from None
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Unexpected Stripe Checkout response")
    url = result.get("url")
    parsed_checkout = urlparse(url) if isinstance(url, str) else None
    if not (
        str(result.get("id", "")).startswith("cs_test_")
        and parsed_checkout and parsed_checkout.scheme == "https"
        and parsed_checkout.hostname in {"checkout.stripe.com", "stripe.com"}
        and result.get("livemode") is False
        and result.get("currency") == currency.lower()
        and result.get("amount_total") == amount_minor
        and result.get("client_reference_id") == attempt_id
    ):
        raise HTTPException(status_code=502, detail="Stripe Checkout response failed verification")
    return result


def to_usd_minor_units(amount: Decimal, currency: str) -> int:
    if currency.upper() != "USD":
        raise HTTPException(status_code=422, detail="Stripe sandbox checkout currently supports USD only")
    if not amount.is_finite() or amount <= 0 or amount != amount.quantize(Decimal("0.01")):
        raise HTTPException(status_code=422, detail="Unsupported Stripe payment amount")
    minor = amount * 100
    if minor != minor.to_integral_value() or minor > 99_999_999:
        raise HTTPException(status_code=422, detail="Unsupported Stripe payment amount")
    return int(minor)
