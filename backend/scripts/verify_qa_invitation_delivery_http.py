"""Real FastAPI + local PostgreSQL; real loopback SMTP capture, never externally delivered.

All fixtures roll back. No external provider calls or auth/permission overrides.
SMTP is real TCP to a disposable loopback sink, not external mail delivery.
"""
from contextlib import ExitStack
from datetime import timedelta
import re
from unittest.mock import patch
from uuid import uuid4
from qa_smtp_capture import SMTPCapture

from fastapi.testclient import TestClient
from sqlalchemy import select, func

from app.core.config import settings
from app.core.security import create_access_token, create_email_verification_token, _create_token, hash_password
from app.db.session import engine, SessionLocal, get_db
from app.main import app
from app.models.user import User
from app.models.membership import Membership
from app.models.team import OrganizationRole, EmployeeInvitation
from app.models.client_invitations import ClientInvitation
from app.models.client_access import ClientMembership
from app.models.crm import Client
from app.models.common import utc_now
from app.services.activity_log import record_activity

PASSWORD = "Synthetic-local-password-42!"


def main():
    assert settings.environment == "test"
    assert engine.url.get_backend_name() == "postgresql" and engine.url.host in {"127.0.0.1", "localhost"}
    assert engine.url.port != 55432, "Never use the user's active review database"
    assert not app.dependency_overrides
    marker = uuid4().hex[:10]
    captured = []
    fail_delivery = [False]

    connection = engine.connect()
    outer = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")
    def local_db():
        with SessionLocal(bind=connection, join_transaction_mode="create_savepoint") as request_db:
            yield request_db
    app.dependency_overrides[get_db] = local_db
    http = TestClient(app, client=("127.0.0." + str(20 + int(marker[:2], 16) % 220), 50000))
    checks = [0]
    def req(method, path, headers=None, expected=200, **kwargs):
        db.rollback()  # End any fixture read savepoint before request-owned writes.
        response = http.request(method, "/api/v1" + path, headers=headers or {}, **kwargs)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        checks[0] += 1
        return response
    def audit():
        record_activity(db, action="qa.invitation.fixture", scope="system", actor_type="system")
        db.commit()
    def user(email, **kwargs):
        value = User(email=email, full_name="Synthetic QA account", **kwargs)
        db.add(value); db.flush(); audit()
        return value
    def headers(value, org=None):
        result = {"Authorization": "Bearer " + create_access_token(value.id)}
        if org: result["X-Organization-ID"] = org
        return result
    def mail_token(kind):
        msg = captured[-1]
        assert msg.get_content_type() == "multipart/alternative"
        plain = msg.get_body(preferencelist=("plain",)).get_content()
        html = msg.get_body(preferencelist=("html",)).get_content()
        assert "localhost:3000" in plain and "localhost:3000" in html
        pattern = r"token=([^\s]+)" if kind == "verify" else rf"/{kind}/([^\s]+)"
        return re.search(pattern, plain).group(1)
    def query(model, *where):
        db.expire_all()
        result = db.scalar(select(model).where(*where))
        if result is not None: db.expunge(result)
        db.rollback()
        return result
    try:
        with ExitStack() as stack:
            stack.enter_context(patch("app.services.auth_rate_limit.SessionLocal", lambda: SessionLocal(bind=connection, join_transaction_mode="create_savepoint")))
            smtp = stack.enter_context(SMTPCapture(captured, fail_delivery))
            for key, value in {"smtp_host": "127.0.0.1", "smtp_port": smtp.port, "smtp_use_starttls": False, "smtp_use_ssl": False, "smtp_username": "", "smtp_password": "", "public_app_url": "http://localhost:3000"}.items():
                stack.enter_context(patch.object(settings, key, value))
            # Signup and resend exercise real templates + MIME building + loopback-only SMTP.
            email = f"qa-verify-{marker}@example.com"
            req("POST", "/auth/signup", expected=201, json={"email": email, "full_name": "QA <Name>", "password": PASSWORD})
            mail_token("verify")
            assert captured[-1]["To"] == email and "QA &lt;Name&gt;" in captured[-1].get_body(preferencelist=("html",)).get_content()
            account = query(User, User.email == email)
            assert not account.is_verified
            req("POST", "/auth/login", expected=403, json={"email": email, "password": PASSWORD})
            req("POST", "/auth/verification/resend", expected=202, json={"email": email})
            token = mail_token("verify")
            for bad in ["invalid-token-long-enough", create_access_token(account.id), create_email_verification_token(account.id, "wrong@example.com"), _create_token(account.id, "email_verify", timedelta(seconds=-5), email=email), create_email_verification_token(account.id, email, 99)]:
                req("POST", "/auth/verify-email", expected=400, json={"token": bad})
            req("POST", "/auth/verify-email", json={"token": token})
            # Verification is deliberately idempotent, unlike single-use invitations.
            req("POST", "/auth/verify-email", json={"token": token})
            req("POST", "/auth/login", json={"email": email, "password": PASSWORD})
            count = len(captured)
            for e in [email, f"missing-{marker}@example.com"]:
                req("POST", "/auth/verification/resend", expected=202, json={"email": e})
            assert len(captured) == count
            fail_delivery[0] = True
            failed_email = f"qa-failed-{marker}@example.com"
            req("POST", "/auth/signup", expected=503, json={"email": failed_email, "full_name": "QA failed", "password": PASSWORD})
            assert query(User, User.email == failed_email) is None
            fail_delivery[0] = False
            # Two independent workspaces, owner and restricted inviter identities.
            owners, orgs, hs = [], [], []
            for label in ["a", "b"]:
                owner = user(f"qa-owner-{label}-{marker}@example.com", is_verified=True, password_hash=hash_password(PASSWORD))
                org = req("POST", "/organizations", headers(owner), 201, json={"name": f"QA invitation {label} {marker}", "currency": "USD", "country_code": "US", "timezone": "UTC"}).json()["organization"]["id"]
                owner_login = req("POST", "/auth/login", json={"email": owner.email, "password": PASSWORD}).json()
                # Retain the real pre-invitation owner session throughout acceptance.
                owner_headers = {"Authorization": "Bearer " + owner_login["access_token"], "X-Organization-ID": org}
                owners.append(owner); orgs.append(org); hs.append(owner_headers)
            role = query(OrganizationRole, OrganizationRole.organization_id == orgs[0], OrganizationRole.slug == "user")
            admin = query(OrganizationRole, OrganizationRole.organization_id == orgs[0], OrganizationRole.slug == "admin")
            delegate = user(f"qa-delegate-{marker}@example.com", is_verified=True)
            delegate_role = OrganizationRole(organization_id=orgs[0], name="QA inviter", slug="qa-inviter", permissions=["employees.invite"])
            db.add(delegate_role); db.flush()
            db.add(Membership(organization_id=orgs[0], user_id=delegate.id, role="user", role_id=delegate_role.id, status="active")); audit()
            dh = headers(delegate, orgs[0])
            invited_email = f"qa-employee-{marker}@example.com"
            payload = {"email": invited_email, "full_name": "QA invitee", "role_id": role.id}
            send = "/hr/people/invitations/send"
            req("POST", send, expected=401, json=payload)
            req("POST", send, dh, 403, json={**payload, "role_id": admin.id})
            foreign_role = query(OrganizationRole, OrganizationRole.organization_id == orgs[1], OrganizationRole.slug == "user")
            req("POST", send, hs[0], 403, json={**payload, "role_id": foreign_role.id})
            invite = req("POST", send, dh, 201, json=payload).json()
            assert invite["email_sent"] is True
            first = mail_token("invite")
            assert invite["invite_token"] == first
            req("GET", f"/employee-invitations/{first}")
            resend = f'/hr/people/invitations/{invite["id"]}/resend'
            req("POST", resend, hs[1], 404)
            req("POST", resend, dh)
            current = mail_token("invite")
            assert current != first
            req("GET", f"/employee-invitations/{first}", expected=404)
            req("POST", "/employee-invitations/accept", expected=404, json={"token": first, "password": PASSWORD})
            before_team = req("GET", "/team", hs[0]).json()
            assert not any(row["login_email"] == invited_email for row in before_team["employees"])
            owner_before = next(row for row in before_team["employees"] if row["user_id"] == owners[0].id)
            req("POST", "/employee-invitations/accept", json={"token": current, "password": PASSWORD})
            after_team = req("GET", "/team", hs[0]).json()
            matches = [row for row in after_team["employees"] if row["login_email"] == invited_email]
            assert len(matches) == 1
            new_employee = matches[0]
            assert new_employee["work_email"] == invited_email
            assert new_employee["role_id"] == role.id and new_employee["role_slug"] == "user"
            assert new_employee["membership_status"] == new_employee["employment_status"] == "active"
            assert new_employee["employment_type"] == "full_time"
            accepted_invitation = next(row for row in after_team["invitations"] if row["id"] == invite["id"])
            assert accepted_invitation["status"] == "accepted"
            assert not any(row["id"] == invite["id"] and row["status"] == "pending" for row in after_team["invitations"])
            assert after_team["summary"]["pending_invitations"] == before_team["summary"]["pending_invitations"] - 1
            assert after_team["summary"]["total_employees"] == before_team["summary"]["total_employees"] + 1
            assert after_team["summary"]["active_employees"] == before_team["summary"]["active_employees"] + 1
            assert next(row for row in after_team["employees"] if row["user_id"] == owners[0].id) == owner_before
            assert req("GET", "/auth/me", hs[0]).json()["id"] == owners[0].id
            req("POST", "/employee-invitations/accept", expected=404, json={"token": current, "password": PASSWORD})
            replay_team = req("GET", "/team", hs[0]).json()
            assert replay_team == after_team, "Rejected replay must not duplicate employees or alter owner access"
            req("POST", "/auth/login", json={"email": invited_email, "password": PASSWORD})
            accepted = query(User, User.email == invited_email)
            membership = query(Membership, Membership.user_id == accepted.id, Membership.organization_id == orgs[0])
            assert membership.role_id == role.id and membership.role == "user"
            assert query(Membership, Membership.user_id == accepted.id, Membership.organization_id == orgs[1]) is None
            # Existing password accounts must authenticate; no-password accounts fail closed.
            for label, password_hash, expected in [("existing", hash_password(PASSWORD), 401), ("google", None, 401)]:
                existing = user(f"qa-{label}-{marker}@example.com", password_hash=password_hash, is_verified=True)
                req("POST", send, hs[0], 201, json={**payload, "email": existing.email})
                existing_token = mail_token("invite")
                req("POST", "/employee-invitations/accept", expected=expected, json={"token": existing_token, "password": "Wrong-password!"})
                if password_hash:
                    req("POST", "/employee-invitations/accept", json={"token": existing_token, "password": PASSWORD})
            # Expired and corrupted cross-tenant roles cannot be accepted or previewed.
            for label in ["expired", "foreign-role"]:
                result = req("POST", send, hs[0], 201, json={**payload, "email": f"qa-{label}-{marker}@example.com"}).json()
                t = mail_token("invite")
                item = db.get(EmployeeInvitation, result["id"])
                if label == "expired": item.expires_at = utc_now() - timedelta(seconds=1)
                else: item.role_id = foreign_role.id
                audit()
                req("GET", f"/employee-invitations/{t}", expected=404)
                req("POST", "/employee-invitations/accept", expected=404 if label == "expired" else 403, json={"token": t, "password": PASSWORD})
                assert query(User, User.email == f"qa-{label}-{marker}@example.com") is None
            # Failed employee delivery explicitly returns an undelivered manual link.
            fail_delivery[0] = True
            failed = req("POST", send, hs[0], 201, json={**payload, "email": f"qa-employee-failure-{marker}@example.com"}).json()
            fail_delivery[0] = False
            assert failed["email_sent"] is False and failed["invite_token"]
            req("POST", f'/hr/people/invitations/{failed["id"]}/revoke', hs[0])
            req("GET", f'/employee-invitations/{failed["invite_token"]}', expected=404)
            # Client invitation capture, rotation, tenant and permission denial, rollback.
            client = Client(organization_id=orgs[0], client_code="QA-INVITE", display_name="QA client", currency="USD")
            db.add(client); db.flush(); audit()
            client_path = f"/crm/client-access/client/{client.id}/invite"
            cp = {"email": f"qa-client-{marker}@example.com", "full_name": "QA Client"}
            req("POST", client_path, dh, 403, json=cp)
            req("POST", client_path, hs[1], 404, json=cp)
            ci = req("POST", client_path, hs[0], 201, json=cp).json()
            ct = mail_token("client-invite")
            req("GET", f"/client-invitations/{ct}")
            cr = f'/crm/client-access/invitations/{ci["id"]}/resend'
            req("POST", cr, hs[1], 404)
            fail_delivery[0] = True
            req("POST", cr, hs[0], 503)
            fail_delivery[0] = False
            req("GET", f"/client-invitations/{ct}") # failure must preserve old token
            req("POST", cr, hs[0]); fresh = mail_token("client-invite")
            req("GET", f"/client-invitations/{ct}", expected=404)
            req("POST", "/client-invitations/accept", expected=400, json={"token": fresh, "password": "short"})
            req("POST", "/client-invitations/accept", json={"token": fresh, "password": PASSWORD})
            req("POST", "/client-invitations/accept", expected=404, json={"token": fresh, "password": PASSWORD})
            req("POST", "/auth/login", json={"email": cp["email"], "password": PASSWORD})
            cu = query(User, User.email == cp["email"])
            cm = query(Membership, Membership.user_id == cu.id, Membership.organization_id == orgs[0])
            assert cm.role != "admin"
            assert query(ClientMembership, ClientMembership.membership_id == cm.id, ClientMembership.client_id == client.id)
            req("POST", send, headers(cu, orgs[0]), 403, json=payload)
            # A newly registered existing account must prove its password when accepting.
            pending = req("POST", client_path, hs[0], 201, json={**cp, "email": f"qa-client-existing-{marker}@example.com"}).json()
            pending_token = mail_token("client-invite")
            user(f"qa-client-existing-{marker}@example.com", password_hash=hash_password(PASSWORD))
            req("POST", "/client-invitations/accept", expected=401, json={"token": pending_token, "password": "Wrong-password!"})
            req("POST", "/client-invitations/accept", json={"token": pending_token, "password": PASSWORD})
            # Explicit expiration/revocation and arbitrary token rejection.
            for label in ["expired", "revoked"]:
                ci = req("POST", client_path, hs[0], 201, json={**cp, "email": f"qa-client-{label}-{marker}@example.com"}).json()
                t = mail_token("client-invite")
                if label == "expired":
                    row = db.get(ClientInvitation, ci["id"])
                    row.expires_at = utc_now() - timedelta(seconds=1); audit()
                else:
                    req("DELETE", f'/crm/client-access/invitations/{ci["id"]}', hs[0], 204)
                req("GET", f"/client-invitations/{t}", expected=404)
                req("POST", "/client-invitations/accept", expected=404, json={"token": t, "password": PASSWORD})
            req("POST", "/client-invitations/accept", expected=404, json={"token": "x" * 40, "password": PASSWORD})

        print(f"Invitation/email HTTP QA passed: {checks[0]} responses; real local PostgreSQL/auth/RBAC/templates; {len(captured)} MIME messages captured via real loopback SMTP only; no external delivery or provider calls.")
    finally:
        http.close(); app.dependency_overrides.clear(); db.close(); outer.rollback(); connection.close()
    with SessionLocal() as verify_db:
        assert verify_db.scalar(select(func.count()).select_from(User).where(User.email.like(f"%{marker}%"))) == 0
    print("Rollback verified: no synthetic user fixtures retained.")


if __name__ == "__main__": main()
