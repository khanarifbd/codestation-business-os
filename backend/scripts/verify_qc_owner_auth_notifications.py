"""Local owner AUTH01 assertions; never sends mail or changes auth policy.

The only patch wraps the actual send_email_verification function to capture its
issued synthetic token. The real mail function still runs with SMTP disabled and
must return False. No auth, tenant, database, or route dependencies are replaced.
The --capture-verification helper is used by browser QC after real UI signup. It
runs the real resend endpoint locally and returns its captured token only to the
browser process, never in the retained evidence report. Provider delivery is NOT
covered. All fixtures are fresh, synthetic and intentionally retained locally.
"""
import argparse
import json
import re
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api.v1 import auth
from app.core.config import settings
from app.core.security import create_email_verification_token, decode_token_claims
from app.db.session import SessionLocal, engine
from app.main import app
from app.models.activity_log import ActivityLog
from app.models.membership import Membership
from app.models.user import User


def local_only():
    assert settings.environment == "test", "Test environment only"
    assert engine.url.get_backend_name() == "postgresql"
    assert engine.url.host in {"127.0.0.1", "localhost"}, "Loopback DB only"
    assert not settings.smtp_host.strip() and not settings.smtp_configured, "SMTP must be disabled"
    assert not app.dependency_overrides, "No inherited authentication or tenant overrides"


def capture_delivery(target):
    original = auth.send_email_verification

    def wrapped(**kwargs):
        delivered = original(**kwargs)
        assert delivered is False, "Provider delivery must stay disabled"
        target.append({**kwargs, "delivered": delivered})
        return delivered

    return wrapped


def call(http, method, path, expected=200, **kwargs):
    response = http.request(method, "/api/v1" + path, **kwargs)
    assert response.status_code == expected, (method, path, response.status_code, response.text)
    return response.json()


def capture_verification(email):
    local_only()
    assert re.fullmatch(r"qc-auth-browser-[0-9a-f]{12}@example\.com", email), "Fresh synthetic browser identity only"
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user and user.is_active and not user.is_verified
        assert db.scalar(select(func.count(Membership.id)).where(Membership.user_id == user.id)) == 0
    captured = []
    http = TestClient(app, client=("127.0.0.84", 58084))
    try:
        with patch.object(auth, "send_email_verification", side_effect=capture_delivery(captured)):
            call(http, "POST", "/auth/verification/resend", 202, json={"email": email})
    finally:
        http.close()
    assert len(captured) == 1 and captured[0]["email"] == email
    claims = decode_token_claims(captured[0]["token"], "email_verify")
    assert claims.user_id == user.id and claims.email == email
    return {"email": email, "token": captured[0]["token"], "provider_delivered": False}


def main():
    local_only()
    marker = uuid4().hex[:12]
    email = f"qc-auth-http-{marker}@example.com"
    password = "Synthetic-auth-only-123!"
    captured = []
    # No lifespan: avoid application bootstrap jobs; only requested public routes.
    http = TestClient(app, client=("127.0.0.85", 58085))
    try:
        with patch.object(auth, "send_email_verification", side_effect=capture_delivery(captured)):
            result = call(http, "POST", "/auth/signup", 201, json={"email": email, "full_name": "Synthetic owner auth QC", "password": password})
        assert "verify" in result["message"].lower()
        assert len(captured) == 1 and captured[0]["email"] == email
        token = captured[0]["token"]
        claims = decode_token_claims(token, "email_verify")
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.email == email))
            assert user and not user.is_verified
            user_id = user.id
            assert claims.user_id == user_id and claims.email == email
            assert db.scalar(select(func.count(Membership.id)).where(Membership.user_id == user_id)) == 0
            created = db.scalar(select(ActivityLog).where(ActivityLog.actor_user_id == user_id, ActivityLog.action == "auth.user.created"))
            assert created.metadata_json["verification_email_delivered"] is False
        call(http, "POST", "/auth/login", 403, json={"email": email, "password": password})
        mismatched = create_email_verification_token(user_id, f"wrong-{marker}@example.com", 0)
        call(http, "POST", "/auth/verify-email", 400, json={"token": mismatched})
        with SessionLocal() as db:
            assert not db.get(User, user_id).is_verified
        call(http, "POST", "/auth/verify-email", json={"token": token})
        session = call(http, "POST", "/auth/login", json={"email": email, "password": password})
        assert session["user"]["id"] == user_id and session["user"]["is_verified"] is True
        headers = {"Authorization": "Bearer " + session["access_token"]}
        assert call(http, "GET", "/organizations", headers=headers) == []
        workspace = call(http, "POST", "/organizations", 201, headers=headers, json={"name": f"QC owner auth {marker}", "country_code": "BD", "timezone": "Asia/Dhaka", "currency": "BDT", "business_type": "Software & IT Services", "team_size": "2-5", "financial_year_start_month": 7})
        assert workspace["role"] == "admin" and workspace["is_owner"] is True
        org = workspace["organization"]
        assert org["currency"] == "BDT" and org["country_code"] == "BD" and org["timezone"] == "Asia/Dhaka" and org["financial_year_start_month"] == 7
        memberships = call(http, "GET", "/organizations", headers=headers)
        assert len(memberships) == 1 and memberships[0]["organization"]["id"] == org["id"]
        headers["X-Organization-ID"] = org["id"]
        people = call(http, "GET", "/hr/people", headers=headers)["people"]
        assert len(people) == 1 and people[0]["full_name"] == "Synthetic owner auth QC"
        print(json.dumps({"case": "AUTH01", "status": "BOUNDED_LOCAL_PASS", "user_id": user_id, "organization_id": org["id"], "assertions": ["HTTP signup persists unverified account with no membership", "Captured issued token binds matching account and email", "Unverified login denied 403", "Wrong-email signed token denied 400 without activation", "Captured matching token activates account", "Real password login returns verified user", "Onboarding creates only isolated owner/admin workspace and owner employee", "Country, currency, timezone and financial year persist"], "provider_delivery": "NOT_TESTED_SMTP_DISABLED"}, indent=2))
    finally:
        http.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture-verification")
    parser.add_argument("--assert-local-safety", action="store_true")
    args = parser.parse_args()
    if args.assert_local_safety:
        local_only()
        print(json.dumps({"environment": "test", "database": "loopback_postgresql", "smtp": "disabled"}))
    elif args.capture_verification:
        print(json.dumps(capture_verification(args.capture_verification)))
    else:
        main()
