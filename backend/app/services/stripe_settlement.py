"""Read authoritative Stripe balance transactions for reconciliation.

This module never writes an Invoice, Payment, FinancialTransaction or Journal.
The account's API key is supplied by the tenant-scoped calling service.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import HTTPException

logger = logging.getLogger(__name__)
_ID_RULES = {
    "intent": re.compile(r"^pi_[A-Za-z0-9]{8,110}$"),
    "charge": re.compile(r"^ch_[A-Za-z0-9]{8,110}$"),
    "transaction": re.compile(r"^txn_[A-Za-z0-9]{8,110}$"),
    "payout": re.compile(r"^po_[A-Za-z0-9]{8,110}$"),
}


@dataclass(frozen=True)
class VerifiedStripeSettlement:
    payment_intent_id: str
    charge_id: str
    balance_transaction_id: str
    currency: str
    gross_minor: int
    fee_minor: int
    net_minor: int
    availability_status: str


def _stripe_id(value: object, kind: str) -> str:
    if not isinstance(value, str) or not _ID_RULES[kind].fullmatch(value):
        raise HTTPException(status_code=409, detail=f"Stripe {kind} reference is missing or invalid")
    return value


def _object_id(value: object, kind: str) -> str:
    if isinstance(value, dict):
        value = value.get("id")
    return _stripe_id(value, kind)


def stripe_retrieve(api_key: str, resource: str, resource_id: str) -> dict:
    """Only fixed Stripe endpoints and validated IDs; never external URLs."""
    if resource not in _ID_RULES:
        raise ValueError("Unsupported Stripe resource")
    valid_id = _stripe_id(resource_id, resource)
    segment = {"intent": "payment_intents", "charge": "charges", "transaction": "balance_transactions", "payout": "payouts"}[resource]
    auth = base64.b64encode((api_key + ":").encode()).decode()
    request = UrlRequest(
        f"https://api.stripe.com/v1/{segment}/{valid_id}",
        headers={"Authorization": "Basic " + auth, "Accept": "application/json"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=12) as response:
            payload = json.load(response)
    except HTTPError as exc:
        logger.warning("Stripe settlement read rejected: resource=%s status=%s", resource, exc.code)
        raise HTTPException(status_code=502, detail="Stripe balance details are temporarily unavailable") from None
    except (URLError, TimeoutError, ValueError, UnicodeDecodeError):
        logger.warning("Stripe settlement read failed: resource=%s", resource)
        raise HTTPException(status_code=502, detail="Stripe balance details could not be retrieved") from None
    if not isinstance(payload, dict) or payload.get("id") != valid_id:
        raise HTTPException(status_code=502, detail="Stripe returned an unexpected settlement object")
    return payload


def _expected_amount(value: object, expected: int, name: str) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or value != expected:
        raise HTTPException(status_code=409, detail=f"Stripe {name} does not match the Checkout amount")


def verified_sandbox_settlement(
    *, api_key: str, payment_intent_id: str, currency: str, amount_minor: int,
    mode: str = "test",
) -> VerifiedStripeSettlement:
    """Require matching PaymentIntent → Charge → BalanceTransaction facts."""
    if mode not in {"test", "live"} or currency != "USD" or not isinstance(amount_minor, int) or amount_minor <= 0:
        raise HTTPException(status_code=422, detail="Only positive USD Sandbox payments can be reconciled")

    intent_id = _stripe_id(payment_intent_id, "intent")
    intent = stripe_retrieve(api_key, "intent", intent_id)
    if (intent.get("livemode") is not (mode == "live") or intent.get("currency") != currency.lower()
            or intent.get("status") != "succeeded"):
        raise HTTPException(status_code=409, detail="Stripe PaymentIntent is not a completed USD Sandbox payment")
    _expected_amount(intent.get("amount_received"), amount_minor, "captured amount")
    charge_id = _object_id(intent.get("latest_charge"), "charge")
    charge = stripe_retrieve(api_key, "charge", charge_id)
    if (charge.get("livemode") is not (mode == "live") or charge.get("currency") != currency.lower()
            or charge.get("paid") is not True or charge.get("captured") is not True
            or charge.get("refunded") is True or charge.get("disputed") is True
            or charge.get("status") != "succeeded"
            or charge.get("payment_intent") not in (intent_id, {"id": intent_id})):
        raise HTTPException(status_code=409, detail="Stripe Charge is not eligible for settlement")
    _expected_amount(charge.get("amount_captured"), amount_minor, "Charge amount")
    _expected_amount(charge.get("amount_refunded"), 0, "refunded amount")
    transaction_id = _object_id(charge.get("balance_transaction"), "transaction")
    txn = stripe_retrieve(api_key, "transaction", transaction_id)
    if txn.get("currency") != currency.lower():
        raise HTTPException(status_code=409, detail="Stripe settlement currency differs from invoice currency; FX reconciliation is required")
    _expected_amount(txn.get("amount"), amount_minor, "balance transaction gross")
    if txn.get("source") not in (charge_id, {"id": charge_id}):
        raise HTTPException(status_code=409, detail="Stripe balance transaction does not match the Charge")
    fee = txn.get("fee")
    net = txn.get("net")
    if (not isinstance(fee, int) or isinstance(fee, bool) or fee < 0
            or not isinstance(net, int) or isinstance(net, bool) or net < 0
            or fee + net != amount_minor):
        raise HTTPException(status_code=409, detail="Stripe balance gross, fee and net do not reconcile")
    state = txn.get("status")
    if state not in ("pending", "available"):
        raise HTTPException(status_code=409, detail="Stripe balance transaction is not yet reconcilable")
    return VerifiedStripeSettlement(
        payment_intent_id=intent_id,
        charge_id=charge_id,
        balance_transaction_id=transaction_id,
        currency=currency,
        gross_minor=amount_minor,
        fee_minor=fee,
        net_minor=net,
        availability_status=state,
    )
