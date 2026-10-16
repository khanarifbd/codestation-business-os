"""Regression for Stripe Checkout diagnostic errors and tenant-safe account gateway links."""
import io
import json
from unittest.mock import patch
from urllib.error import HTTPError
from uuid import uuid4
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.finance import FinancialAccount
from app.models.organization import Organization
from app.models.membership import Membership
from app.models.payment_gateways import PaymentGatewayConnection
from app.services.payment_gateway_mapping import validate_gateway_mapping
from app.services.stripe_checkout import stripe_checkout_request


def rejected_status(code: int, expected: int, param=None):
    error = {"error": {"code": "parameter_invalid_empty", "type": "invalid_request_error"}}
    if param:
        error["error"]["param"] = param
    response = io.BytesIO(json.dumps(error).encode())
    def fail(_request, timeout=15):
        raise HTTPError("https://api.stripe.com/v1/checkout/sessions", code, "Stripe error", {}, response)
    try:
        with patch("app.services.stripe_checkout.urlopen", fail):
            stripe_checkout_request(
                api_key="sk_test_example_not_real", attempt_id=str(uuid4()),
                invoice_number="INV-CI", currency="USD",
                amount_minor=100, client_email=None,
                public_app_url="https://os.example.com",
            )
    except HTTPException as exc:
        assert exc.status_code == expected, (exc.status_code, exc.detail)
        assert "sk_test_example_not_real" not in str(exc.detail)
    else:
        raise AssertionError(f"Stripe HTTP {code} should be reported")


def expect_error(status: int, fn):
    try:
        fn()
    except HTTPException as exc:
        assert exc.status_code == status, (exc.status_code, exc.detail)
    else:
        raise AssertionError(f"Expected {status} gateway mapping rejection")


def main() -> None:
    rejected_status(401, 409)
    rejected_status(403, 409)
    rejected_status(400, 422, "customer_email")
    rejected_status(400, 422, "line_items[0][price_data][currency]")
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).where(Organization.name == "Existing Tenant Fixture"))
        assert org is not None
        member = db.scalar(select(Membership).where(
            Membership.organization_id == org.id,
            Membership.user_id == org.created_by_user_id,
            Membership.status == "active",
        ))
        assert member is not None
        connection = PaymentGatewayConnection(
            organization_id=org.id, provider="stripe", mode="test",
            provider_account_id="acct_CI_map_" + uuid4().hex[:10],
            connection_method="api_key", connected_by_user_id=member.user_id,
            is_active=True, charges_enabled=True,
        )
        db.add(connection)
        db.flush()
        gateway_id = validate_gateway_mapping(
            db, organization_id=org.id, gateway_connection_id=connection.id,
            account_type="payment_gateway", currency="USD",
        )
        assert gateway_id == connection.id
        expect_error(404, lambda: validate_gateway_mapping(
            db, organization_id=str(uuid4()), gateway_connection_id=connection.id,
            account_type="payment_gateway", currency="USD",
        ))
        expect_error(422, lambda: validate_gateway_mapping(
            db, organization_id=org.id, gateway_connection_id=connection.id,
            account_type="bank", currency="USD",
        ))
        expect_error(422, lambda: validate_gateway_mapping(
            db, organization_id=org.id, gateway_connection_id=connection.id,
            account_type="payment_gateway", currency="BDT",
        ))
        account = FinancialAccount(
            organization_id=org.id, name="CI Gateway Link " + uuid4().hex[:8],
            account_type="payment_gateway", currency="USD",
            gateway_connection_id=connection.id,
            created_by_user_id=member.user_id, opening_balance=Decimal("0.00"),
        )
        db.add(account)
        db.flush()
        expect_error(409, lambda: validate_gateway_mapping(
            db, organization_id=org.id, gateway_connection_id=connection.id,
            account_type="payment_gateway", currency="USD",
        ))
        assert validate_gateway_mapping(
            db, organization_id=org.id, gateway_connection_id=connection.id,
            account_type="payment_gateway", currency="USD", exclude_account_id=account.id,
        ) == connection.id
    finally:
        db.rollback()
        db.close()
    print("Stripe Checkout failure diagnostics and tenant-safe gateway account mapping passed")


if __name__ == "__main__":
    main()
