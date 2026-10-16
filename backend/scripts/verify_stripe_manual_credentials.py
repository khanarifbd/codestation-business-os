"""No-network Stripe self-service regression: credential encryption, tenant isolation and audit safety."""
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi import HTTPException
from pydantic import SecretStr, ValidationError
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1 import payment_gateways_stripe as gateway
from app.db.session import SessionLocal
from app.models.activity_log import ActivityLog
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.user import User
from app.services.payment_gateway_secrets import decrypt_gateway_secret, encrypt_gateway_secret
from app.tenancy.context import TenantContext


def _request() -> Request:
    return Request({
        "type": "http", "method": "POST",
        "path": "/api/v1/finance/payment-gateways/stripe/manual",
        "headers": [], "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    secret = "sk_test_" + "A" * 48
    webhook = "whsec_" + "B" * 50
    try:
        gateway.StripeManualConnectionCreate(mode="live", secret_key=SecretStr(secret))
    except ValidationError:
        pass
    else:
        raise AssertionError("Live mode must reject a test Secret Key")
    try:
        gateway.StripeManualConnectionCreate(
            mode="test", secret_key=SecretStr(secret),
            webhook_secret=SecretStr("not-a-webhook-secret"),
        )
    except ValidationError:
        pass
    else:
        raise AssertionError("Invalid webhook key must be rejected")
    encryption_key = Fernet.generate_key().decode()
    with patch.object(gateway.settings, "payment_gateway_encryption_key", encryption_key):
        ciphertext = encrypt_gateway_secret(secret)
        assert ciphertext != secret and decrypt_gateway_secret(ciphertext) == secret
        assert secret not in ciphertext

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
        user = db.get(User, member.user_id)
        assert user is not None
        tenant = TenantContext(organization=org, membership=member, user=user)
        payload = gateway.StripeManualConnectionCreate(
            mode="test", secret_key=SecretStr(secret),
            webhook_secret=SecretStr(webhook),
        )
        def fake_stripe(url, *, api_key, form=None):
            assert url == "https://api.stripe.com/v1/account"
            assert api_key == secret
            assert form is None
            return {
                "id": "acct_CI_self_service_gw",
                "charges_enabled": True,
                "payouts_enabled": True,
                "details_submitted": True,
                "business_profile": {"name": "CI Stripe Gateway Fixture"},
            }

        # Suppress commits to leave the entire CI fixture unmodified at rollback.
        with (
            patch.object(gateway.settings, "payment_gateway_encryption_key", encryption_key),
            patch.object(gateway, "_stripe_request", fake_stripe),
            patch.object(db, "commit", db.flush),
        ):
            response = gateway.connect_stripe_manually(payload, _request(), db, tenant)
            assert response["connected"] and response["mode"] == "test"
            assert response["connection_method"] == "api_key"
            assert response["webhook_configured"] is True
            assert response["checkout_available"] is False
            assert "secret_key" not in response
            row = db.scalar(select(PaymentGatewayConnection).where(
                PaymentGatewayConnection.organization_id == org.id,
                PaymentGatewayConnection.mode == "test",
            ))
            assert row is not None
            assert row.secret_key_ciphertext != secret
            assert decrypt_gateway_secret(row.secret_key_ciphertext) == secret
            assert decrypt_gateway_secret(row.webhook_secret_ciphertext) == webhook
            assert gateway._connection(db, "other_company_id", "test") is None
            try:
                gateway.connect_stripe_manually(payload, _request(), db, tenant)
            except HTTPException as exc:
                assert exc.status_code == 409
            else:
                raise AssertionError("Existing connection replacement must be explicit")
            audit = db.scalar(select(ActivityLog).where(
                ActivityLog.organization_id == org.id,
                ActivityLog.action == "payment_gateway.stripe.manual_connected",
            ).order_by(ActivityLog.created_at.desc()))
            assert audit is not None
            assert secret not in str(audit.after_data) and webhook not in str(audit.after_data)
            disabled = gateway.disable_stripe_connection(_request(), db, tenant, mode="test")
            assert not disabled["connected"]
            assert row.secret_key_ciphertext is None and row.webhook_secret_ciphertext is None
    finally:
        db.rollback()
        db.close()
    print("Stripe self-service gateway verification passed: encryption, account match, isolation, replacement guard, audit, disable")


if __name__ == "__main__":
    main()
