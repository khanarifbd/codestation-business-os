"""CP07–CP08 isolated service/unit regressions; never starts or contacts services.

Run from backend: PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -p test_client_invitations_unit.py -v

Calls endpoint functions directly, without HTTP/auth sessions or browser state.
SQLite in-memory fixtures exercise transaction rollback; they do NOT establish
PostgreSQL locking/concurrency, API authorization, browser or real mail delivery.
SMTP is mocked and socket connections are explicitly blocked for the whole run.
"""
from contextlib import ExitStack
from datetime import timedelta, timezone
import os
import smtplib
import socket
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import DateTime, create_engine, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.sqlite import DATETIME
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateIndex

# Process-local import configuration only. Never change a service environment.
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = "postgresql+psycopg://unused@127.0.0.1:1/unit_never_connect"

from app.api.v1 import client_invitations as invitations
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import engine as configured_engine
from app.models.activity_log import ActivityLog
from app.models.common import utc_now
from app.models.team import OrganizationRole
from app.services import account_email
from app.services.activity_log import record_activity
from app.services.team import ensure_system_roles, hash_invitation_token
from app.tenancy.context import TenantContext

PASSWORD = "Synthetic-unit-password-42!"


class UTCFixtureDateTime(DATETIME):
    """Preserve UTC semantics that SQLite's normal DATETIME reader discards."""

    def result_processor(self, dialect, coltype):
        processor = super().result_processor(dialect, coltype)

        def process(value):
            result = processor(value) if processor else value
            if result is not None and result.tzinfo is None:
                return result.replace(tzinfo=timezone.utc)
            return result

        return process


@compiles(JSONB, "sqlite")
def _sqlite_jsonb(_element, _compiler, **_kwargs):
    return "JSON"


@compiles(CreateIndex, "sqlite")
def _sqlite_partial_index(element, compiler, **kwargs):
    """Carry the model's PostgreSQL pending-only predicate into the fixture."""
    result = compiler.visit_create_index(element, **kwargs)
    pg_where = element.element.dialect_options["postgresql"].get("where")
    sqlite_where = element.element.dialect_options["sqlite"].get("where")
    if pg_where is not None and sqlite_where is None:
        result += " WHERE " + compiler.sql_compiler.process(pg_where, literal_binds=True)
    return result


class ClientInvitationUnitTests(unittest.TestCase):
    def setUp(self):
        self.resources = ExitStack()
        self.addCleanup(self.resources.close)
        self.resources.enter_context(patch.object(configured_engine, "connect", side_effect=AssertionError("Unit test attempted a configured DB connection")))
        self.resources.enter_context(patch.object(socket.socket, "connect", side_effect=AssertionError("Unit test attempted a network connection")))
        self.resources.enter_context(patch.object(socket, "create_connection", side_effect=AssertionError("Unit test attempted a network connection")))
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.colspecs = {**self.engine.dialect.colspecs, DateTime: UTCFixtureDateTime}
        for model in (
            invitations.User, invitations.Organization, OrganizationRole,
            invitations.Membership, invitations.Client, invitations.ClientInvitation,
            invitations.ClientMembership, ActivityLog,
        ):
            model.__table__.create(self.engine)
        self.db = Session(self.engine, expire_on_commit=False, autoflush=False)
        self.addCleanup(self.db.close)
        self.owner = invitations.User(email="owner@example.com", full_name="Unit Owner", is_verified=True)
        self.db.add(self.owner)
        self.db.flush()
        self.organization = invitations.Organization(name="Unit Company", slug="unit-company", created_by_user_id=self.owner.id)
        self.db.add(self.organization)
        self.db.flush()
        self.roles = ensure_system_roles(self.db, self.organization)
        self.owner_membership = invitations.Membership(
            organization_id=self.organization.id, user_id=self.owner.id,
            role_id=self.roles["admin"].id, role="admin", is_owner=True,
        )
        self.client = invitations.Client(organization_id=self.organization.id, client_code="UNIT-001", display_name="Unit Client")
        self.db.add_all([self.owner_membership, self.client])
        self.save_fixture()
        self.tenant = TenantContext(self.owner, self.organization, self.owner_membership, self.roles["admin"])

    def save_fixture(self):
        record_activity(self.db, action="qa.unit.fixture", scope="system", actor_type="system")
        self.db.commit()

    def count(self, model):
        return self.db.scalar(select(func.count()).select_from(model))

    def action_count(self, action):
        return self.db.scalar(select(func.count()).select_from(ActivityLog).where(ActivityLog.action == action))

    def pending(self, *, email="invitee@example.com", client=None, **overrides):
        token, token_hash = invitations.create_invitation_token()
        item = invitations.ClientInvitation(
            organization_id=self.organization.id, client_id=(client or self.client).id,
            email=email, full_name="Unit Invitee", token_hash=token_hash,
            status="pending", is_primary_contact=True, invited_by_user_id=self.owner.id,
            expires_at=utc_now() + timedelta(days=2), last_sent_at=utc_now() - timedelta(days=1),
        )
        for key, value in overrides.items():
            setattr(item, key, value)
        self.db.add(item)
        self.save_fixture()
        return item, token

    def assert_http_error(self, code, call):
        with self.assertRaises(HTTPException) as caught:
            call()
        self.assertEqual(caught.exception.status_code, code)

    def send(self, email="new@example.com"):
        return invitations.invite_client(
            self.client.id, invitations.ClientInvitationCreate(email=email, full_name="Unit New Client"),
            None, self.db, self.tenant,
        )

    def accept(self, token, password=PASSWORD):
        return invitations.accept_client_invitation(
            invitations.ClientInvitationAccept(token=token, password=password), None, self.db,
        )

    def assert_unavailable(self, token):
        self.assert_http_error(404, lambda: invitations.preview_client_invitation(token, self.db))
        self.assert_http_error(404, lambda: self.accept(token))

    def test_initial_smtp_exception_rolls_back_new_invite_and_previous_revocations(self):
        previous, token = self.pending()
        original_hash = previous.token_hash
        with patch.object(invitations, "send_client_portal_invitation", side_effect=account_email.AccountEmailDeliveryError("Synthetic SMTP failure")):
            self.assert_http_error(503, self.send)
        self.assertEqual(self.count(invitations.ClientInvitation), 1)
        self.assertEqual(previous.status, "pending")
        self.assertIsNone(previous.revoked_at)
        self.assertEqual(previous.token_hash, original_hash)
        self.assertEqual(invitations._valid_invitation(self.db, token).id, previous.id)
        self.assertEqual(self.action_count("client.invitation.sent"), 0)

    def test_initial_unconfigured_mail_does_not_claim_delivery(self):
        previous, token = self.pending()
        with patch.object(settings, "environment", "development"), patch.object(settings, "smtp_host", ""):
            self.assert_http_error(503, self.send)
        self.assertEqual(self.count(invitations.ClientInvitation), 1)
        self.assertEqual(invitations._valid_invitation(self.db, token).id, previous.id)
        self.assertEqual(self.action_count("client.invitation.sent"), 0)

    def test_resend_unconfigured_mail_preserves_the_old_link(self):
        item, token = self.pending()
        old_state = (item.token_hash, item.expires_at, item.last_sent_at)
        with patch.object(settings, "environment", "development"), patch.object(settings, "smtp_host", ""):
            self.assert_http_error(503, lambda: invitations.resend_client_invitation(item.id, None, self.db, self.tenant))
        self.assertEqual((item.token_hash, item.expires_at, item.last_sent_at), old_state)
        self.assertEqual(invitations._valid_invitation(self.db, token).id, item.id)
        self.assertEqual(self.action_count("client.invitation.resent"), 0)

    def test_resend_smtp_exception_preserves_hash_expiry_timestamp_and_audit(self):
        item, token = self.pending()
        old_state = (item.token_hash, item.expires_at, item.last_sent_at)
        with patch.object(invitations, "send_client_portal_invitation", side_effect=account_email.AccountEmailDeliveryError("Synthetic SMTP failure")):
            self.assert_http_error(503, lambda: invitations.resend_client_invitation(item.id, None, self.db, self.tenant))
        self.assertEqual((item.token_hash, item.expires_at, item.last_sent_at), old_state)
        self.assertEqual(invitations._valid_invitation(self.db, token).id, item.id)
        self.assertEqual(self.action_count("client.invitation.resent"), 0)

    def test_successful_resend_rotates_only_token_and_refreshes_delivery_window(self):
        item, old_token = self.pending()
        old_expiry, old_sent = item.expires_at, item.last_sent_at
        with patch.object(invitations, "send_client_portal_invitation", return_value=True) as mail:
            result = invitations.resend_client_invitation(item.id, None, self.db, self.tenant)
        new_token = mail.call_args.kwargs["token"]
        self.assertNotEqual(new_token, old_token)
        self.assertEqual(item.token_hash, hash_invitation_token(new_token))
        self.assertEqual(result.id, item.id)
        self.assertGreater(item.expires_at, old_expiry)
        self.assertGreater(item.last_sent_at, old_sent)
        self.assert_unavailable(old_token)
        self.assertEqual(invitations._valid_invitation(self.db, new_token).id, item.id)
        self.assertNotIn(new_token, result.model_dump_json())
        audit = self.db.scalar(select(ActivityLog).where(ActivityLog.action == "client.invitation.resent"))
        self.assertNotIn(new_token, str(audit.after_data))

    def test_expired_pending_invite_can_be_renewed_by_resend(self):
        item, token = self.pending(expires_at=utc_now() - timedelta(seconds=1))
        self.assert_unavailable(token)
        with patch.object(invitations, "send_client_portal_invitation", return_value=True) as mail:
            invitations.resend_client_invitation(item.id, None, self.db, self.tenant)
        self.assertEqual(invitations._valid_invitation(self.db, mail.call_args.kwargs["token"]).id, item.id)

    def test_replacement_retires_only_same_client_pending_invites(self):
        previous, token = self.pending(email="new@example.com")
        other = invitations.Client(organization_id=self.organization.id, client_code="UNIT-002", display_name="Other Client")
        self.db.add(other)
        self.save_fixture()
        untouched, other_token = self.pending(client=other)
        with patch.object(invitations, "send_client_portal_invitation", return_value=True):
            result = self.send()
        self.assertNotEqual(result.id, previous.id)
        self.assertEqual(previous.status, "revoked")
        self.assertIsNotNone(previous.revoked_at)
        self.assert_unavailable(token)
        self.assertEqual(invitations._valid_invitation(self.db, other_token).id, untouched.id)
        self.assertEqual(self.action_count("client.invitation.sent"), 1)

    def test_exact_expiry_boundary_rejects_preview_and_acceptance_without_mutation(self):
        now = utc_now()
        item, token = self.pending(expires_at=now)
        with patch.object(invitations, "utc_now", return_value=now):
            self.assert_unavailable(token)
        self.assertEqual(self.count(invitations.User), 1)
        self.assertEqual(self.count(invitations.ClientMembership), 0)
        self.assertEqual(item.status, "pending")
        self.assertEqual(self.action_count("client.invitation.accepted"), 0)

    def test_revocation_is_single_audit_and_rejects_resend_and_acceptance(self):
        item, token = self.pending()
        invitations.revoke_client_invitation(item.id, None, self.db, self.tenant)
        revoked_at = item.revoked_at
        invitations.revoke_client_invitation(item.id, None, self.db, self.tenant)
        self.assertEqual(item.status, "revoked")
        self.assertEqual(item.revoked_at, revoked_at)
        self.assertEqual(self.action_count("client.invitation.revoked"), 1)
        self.assert_http_error(404, lambda: invitations.resend_client_invitation(item.id, None, self.db, self.tenant))
        self.assert_unavailable(token)

    def test_new_account_acceptance_is_client_only_verified_and_single_use(self):
        item, token = self.pending()
        result = self.accept(token)
        self.assertTrue(result["ok"])
        user = self.db.scalar(select(invitations.User).where(invitations.User.email == item.email))
        membership = self.db.scalar(select(invitations.Membership).where(invitations.Membership.user_id == user.id))
        access = self.db.scalar(select(invitations.ClientMembership).where(invitations.ClientMembership.membership_id == membership.id))
        self.assertTrue(user.is_verified)
        self.assertEqual(membership.role, "client")
        self.assertEqual(membership.role_id, self.roles["client"].id)
        self.assertFalse(membership.is_owner)
        self.assertEqual(access.client_id, self.client.id)
        self.assertEqual(item.status, "accepted")
        self.assertIsNotNone(item.accepted_at)
        self.assert_unavailable(token)
        self.assertEqual(self.count(invitations.User), 2)
        self.assertEqual(self.count(invitations.Membership), 2)
        self.assertEqual(self.count(invitations.ClientMembership), 1)
        self.assertEqual(self.action_count("client.invitation.accepted"), 1)
        self.assertEqual(self.owner_membership.role, "admin")
        self.assertTrue(self.owner_membership.is_owner)
        invitations.revoke_client_invitation(item.id, None, self.db, self.tenant)
        self.assertEqual(item.status, "accepted")
        self.assertEqual(access.status, "active")

    def test_bad_existing_account_password_preserves_pending_invite_and_identity(self):
        item, token = self.pending()
        existing = invitations.User(email=item.email, full_name="Existing Name", password_hash=hash_password(PASSWORD), is_verified=False)
        self.db.add(existing)
        self.save_fixture()
        old_hash = existing.password_hash
        for wrong in (None, "Wrong-password"):
            self.assert_http_error(401, lambda: self.accept(token, wrong))
        self.assertEqual(item.status, "pending")
        self.assertFalse(existing.is_verified)
        self.assertEqual(self.count(invitations.ClientMembership), 0)
        self.accept(token)
        self.assertEqual(existing.full_name, "Existing Name")
        self.assertEqual(existing.password_hash, old_hash)
        self.assertTrue(existing.is_verified)
        self.assertEqual(self.count(invitations.User), 2)

    def test_short_new_password_does_not_create_identity_or_access(self):
        item, token = self.pending()
        self.assert_http_error(400, lambda: self.accept(token, "short"))
        self.assertEqual(item.status, "pending")
        self.assertEqual(self.count(invitations.User), 1)
        self.assertEqual(self.count(invitations.ClientMembership), 0)

    def test_suspended_account_rejects_acceptance_without_grant(self):
        item, token = self.pending()
        existing = invitations.User(email=item.email, full_name="Suspended", is_active=False)
        self.db.add(existing)
        self.save_fixture()
        self.assert_http_error(403, lambda: self.accept(token, None))
        self.assertEqual(item.status, "pending")
        self.assertEqual(self.count(invitations.ClientMembership), 0)
        self.assertFalse(existing.is_verified)

    def test_existing_identity_cannot_be_reinvited_or_revoke_old_pending_link(self):
        previous, token = self.pending()
        with patch.object(invitations, "send_client_portal_invitation") as mail:
            self.assert_http_error(409, lambda: self.send(self.owner.email))
        mail.assert_not_called()
        self.assertEqual(invitations._valid_invitation(self.db, token).id, previous.id)

    def test_unavailable_company_and_mismatched_client_reject_without_mutation(self):
        item, token = self.pending()
        self.organization.status = "suspended"
        self.save_fixture()
        self.assert_http_error(404, lambda: invitations.preview_client_invitation(token, self.db))
        self.assert_http_error(403, lambda: self.accept(token))
        self.organization.status = "active"
        self.client.organization_id = "another-company"
        self.save_fixture()
        self.assert_http_error(404, lambda: invitations.preview_client_invitation(token, self.db))
        self.assert_http_error(403, lambda: self.accept(token))
        self.assertEqual(item.status, "pending")
        self.assertEqual(self.count(invitations.User), 1)

    def test_suspended_company_membership_cannot_be_reactivated_by_invitation(self):
        item, token = self.pending()
        user = invitations.User(email=item.email, full_name="Suspended Member", is_verified=False)
        self.db.add(user)
        self.db.flush()
        membership = invitations.Membership(
            organization_id=self.organization.id, user_id=user.id,
            role_id=self.roles["client"].id, role="client", status="suspended",
        )
        self.db.add(membership)
        self.save_fixture()
        self.assert_http_error(409, lambda: self.accept(token, None))
        # The request dependency closes/rolls back this rejected transaction.
        self.db.rollback()
        self.assertEqual(membership.status, "suspended")
        self.assertEqual(item.status, "pending")
        self.assertFalse(user.is_verified)
        self.assertEqual(self.count(invitations.ClientMembership), 0)
        self.assertEqual(self.action_count("client.invitation.accepted"), 0)

    def test_acceptance_preserves_active_staff_role_and_switches_only_client_primary(self):
        item, token = self.pending(email=self.owner.email)
        old_user = invitations.User(email="old-primary@example.com", full_name="Old Primary")
        self.db.add(old_user)
        self.db.flush()
        old_membership = invitations.Membership(
            organization_id=self.organization.id, user_id=old_user.id,
            role_id=self.roles["client"].id, role="client",
        )
        self.db.add(old_membership)
        self.db.flush()
        old_access = invitations.ClientMembership(
            organization_id=self.organization.id, client_id=self.client.id,
            membership_id=old_membership.id, is_primary_contact=True,
            created_by_user_id=self.owner.id,
        )
        other_client = invitations.Client(
            organization_id=self.organization.id, client_code="UNIT-OTHER",
            display_name="Other Client",
        )
        self.db.add(other_client)
        self.db.flush()
        other_primary = invitations.ClientMembership(
            organization_id=self.organization.id, client_id=other_client.id,
            membership_id=old_membership.id, is_primary_contact=True,
            created_by_user_id=self.owner.id,
        )
        self.db.add_all([old_access, other_primary])
        self.save_fixture()
        # Passwordless existing-account acceptance is an explicit client-portal
        # product flow, not the employee invitation policy; no login is performed.
        self.accept(token, None)
        self.assertEqual(self.owner_membership.role, "admin")
        self.assertEqual(self.owner_membership.role_id, self.roles["admin"].id)
        self.assertTrue(self.owner_membership.is_owner)
        self.assertFalse(old_access.is_primary_contact)
        self.assertEqual(old_access.status, "active")
        self.assertTrue(other_primary.is_primary_contact)
        self.assertEqual(other_primary.status, "active")
        primary = self.db.scalars(select(invitations.ClientMembership).where(
            invitations.ClientMembership.client_id == self.client.id,
            invitations.ClientMembership.is_primary_contact.is_(True),
        )).all()
        self.assertEqual(len(primary), 1)
        self.assertEqual(primary[0].membership_id, self.owner_membership.id)
        self.assertEqual(self.count(invitations.Membership), 2)

    def test_resend_and_revoke_queries_are_organization_scoped(self):
        item, token = self.pending()
        foreign_org = invitations.Organization(name="Other Company", slug="other-company", created_by_user_id=self.owner.id)
        self.db.add(foreign_org)
        self.save_fixture()
        foreign_tenant = TenantContext(self.owner, foreign_org, self.owner_membership)
        with patch.object(invitations, "send_client_portal_invitation") as mail:
            self.assert_http_error(404, lambda: invitations.resend_client_invitation(item.id, None, self.db, foreign_tenant))
            self.assert_http_error(404, lambda: invitations.revoke_client_invitation(item.id, None, self.db, foreign_tenant))
        mail.assert_not_called()
        self.assertEqual(invitations._valid_invitation(self.db, token).id, item.id)
        self.assertEqual(self.action_count("client.invitation.resent"), 0)
        self.assertEqual(self.action_count("client.invitation.revoked"), 0)

    def test_unknown_token_rejected_without_writes(self):
        self.assert_unavailable("not-an-invitation-token-123456789")
        self.assertEqual(self.count(invitations.User), 1)
        self.assertEqual(self.count(invitations.ClientInvitation), 0)

    def test_smtp_transport_failure_is_translated_without_network(self):
        for failure in (OSError("Synthetic connection failure"), smtplib.SMTPException("Synthetic SMTP failure")):
            with self.subTest(failure=type(failure).__name__), patch.object(settings, "smtp_host", "unit.invalid"), patch.object(settings, "smtp_use_ssl", False), patch.object(settings, "smtp_use_starttls", False), patch.object(account_email.smtplib, "SMTP", side_effect=failure):
                with self.assertRaises(account_email.AccountEmailDeliveryError):
                    account_email.send_client_portal_invitation(email="unit@example.com", full_name="Unit", company_name="Unit", client_name="Unit", token="synthetic-unit-token")

    def test_mail_template_escapes_untrusted_text_and_uses_client_route(self):
        with patch.object(settings, "smtp_host", "unit.invalid"), patch.object(settings, "smtp_use_ssl", False), patch.object(settings, "smtp_use_starttls", False), patch.object(settings, "smtp_username", ""), patch.object(account_email.smtplib, "SMTP") as smtp:
            delivered = account_email.send_client_portal_invitation(email="unit@example.com", full_name="Unit <Name>", company_name="Unit & Co", client_name="Unit <Client>", token="synthetic-unit-token")
        self.assertTrue(delivered)
        message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
        self.assertEqual(message["To"], "unit@example.com")
        text = message.get_body(preferencelist=("plain",)).get_content()
        html = message.get_body(preferencelist=("html",)).get_content()
        self.assertIn("/client-invite/synthetic-unit-token", text)
        self.assertIn("/client-invite/synthetic-unit-token", html)
        self.assertIn("Unit &lt;Name&gt;", html)
        self.assertIn("Unit &amp; Co", html)
        self.assertIn("Unit &lt;Client&gt;", html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
