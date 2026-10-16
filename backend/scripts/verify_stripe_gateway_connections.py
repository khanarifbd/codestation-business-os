"""No-network tenant isolation smoke checks for Stripe Connect setup."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.payment_gateways_stripe import (
    _credentials,
    _connection,
    _connection_read,
    stripe_connections,
    stripe_oauth_callback,
)
from app.db.session import SessionLocal
from app.models.organization import Organization
from app.models.payment_gateways import GatewayOAuthState, PaymentGatewayConnection
from app.models.membership import Membership
from app.models.user import User
from app.tenancy.context import TenantContext


def _request() -> Request:
    return Request({
        "type": "http", "method": "GET",
        "path": "/api/v1/finance/payment-gateways/stripe/oauth/callback",
        "headers": [], "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def main() -> None:
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
        assert user is not None
        tenant = TenantContext(user=user, membership=membership, organization=org)
        status = stripe_connections(db, tenant)
        assert "connections" in status and len(status["connections"]) == 2
        assert all(conn["checkout_available"] is False for conn in status["connections"])
        invalid_mode = False
        try:
            _credentials("invalid")
        except HTTPException as exc:
            invalid_mode = exc.status_code == 400
        assert invalid_mode
        token = secrets.token_urlsafe(40)
        state = GatewayOAuthState(
            organization_id=org.id, requested_by_user_id=user.id,
            mode="test", provider="stripe",
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        db.add(state)
        db.flush()
        rejected = False
        try:
            stripe_oauth_callback(_request(), db, state=token, code="should-not-be-exchanged")
        except HTTPException as exc:
            rejected = exc.status_code == 400
        assert rejected, "Expired OAuth state must be rejected before network calls"
        fake = PaymentGatewayConnection(
            organization_id=org.id, provider="stripe", mode="test",
            provider_account_id="acct_CIconnection_" + secrets.token_hex(8),
            connected_by_user_id=user.id, charges_enabled=False,
        )
        db.add(fake)
        db.flush()
        assert _connection(db, org.id, "test").id == fake.id
        assert _connection(db, "fake-other-organization", "test") is None
        assert _connection_read(fake, mode="test")["checkout_available"] is False
        print("Stripe Connect setup verification passed: per-tenant status, no live checkout, expired state, isolation")
    finally:
        db.rollback()
        db.close()


if __name__ == "__main__":
    main()
