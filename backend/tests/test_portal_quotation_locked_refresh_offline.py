"""Actual-handler and real ORM identity-map checks, entirely in SQLite memory.

These checks do not simulate PostgreSQL row-lock waiting or prove concurrency.
SQLite ignores FOR UPDATE: its exact PostgreSQL compilation is checked separately.
The stored-state change is deliberately injected between the portal pre-read and
the status handler's locked SELECT, not performed by a second live transaction.
No settings, configured server engine, provider, network, or production database is imported.
Real audit callbacks and activity recording bodies are extracted from source and
installed on the fixture Session subclass; no guard flags are forged or disabled.
"""
import ast
import copy
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine, event, inspect, select, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.sales import Quotation
from app.models.user_session import UserSession


ROOT = Path(__file__).resolve().parents[1]
SALES_PREIMAGE = "3fb4f4a766d326d3c2a2e49c7068a6f3376c949783fbacf051e8ab055fd7036f"
PORTAL_PREIMAGE = "0ce556e97336e50da6d90e7bef6a36194e988649132f399ae99f5ff3de3deb6c"
ORG, CLIENT, QUOTE, USER_SESSION = "synthetic-org", "synthetic-client", "synthetic-quote", "synthetic-session"


def actual_function(relative, name, context):
    source = ROOT / relative
    node = copy.deepcopy(next(item for item in ast.parse(source.read_text()).body
                              if isinstance(item, ast.FunctionDef) and item.name == name))
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), node], type_ignores=[])
    namespace = dict(context)
    exec(compile(ast.fix_missing_locations(module), str(source), "exec"), namespace)
    return namespace[name]



class AuditFixtureTypeCompiler(SQLiteTypeCompiler):
    def visit_JSONB(self, _type, **_kwargs):
        # This fixture engine only: retain real audit columns and JSON values.
        return "JSON"


def actual_audit_callbacks():
    context = {"Session": Session}
    for name in ("_is_activity_log", "_has_business_mutation", "_remember_audit_coverage",
                 "_require_audit_for_commit", "_clear_audit_state"):
        context[name] = actual_function("app/db/session.py", name, context)
    return context


def actual_activity_recorder():
    tree = ast.parse((ROOT / "app/services/activity_log.py").read_text())
    sensitive_keys = next(ast.literal_eval(item.value) for item in tree.body
                          if isinstance(item, ast.Assign) and any(
                              isinstance(target, ast.Name) and target.id == "SENSITIVE_KEYS"
                              for target in item.targets))
    context = {"Mapping": Mapping, "Sequence": Sequence, "ActivityLog": ActivityLog,
               "SENSITIVE_KEYS": sensitive_keys}
    for name in ("_is_sensitive_key", "sanitize_for_audit", "_request_fields", "record_activity"):
        context[name] = actual_function("app/services/activity_log.py", name, context)
    # request=None is the exact existing fixture input. No request/client-IP/config
    # dependency is evaluated; all request provenance fields must remain null.
    return context["record_activity"]


def quote_values(**changes):
    return {
        "id": QUOTE, "organization_id": ORG, "quotation_number": "SYN-Q-1",
        "client_id": CLIENT, "created_by_user_id": "synthetic-user", "status": "sent",
        "issue_date": date(2026, 10, 27), "currency": "USD",
        "seller_name_snapshot": "Synthetic seller", "client_name_snapshot": "Synthetic client",
        "total": Decimal("123.45"), "subtotal": Decimal("123.45"),
        "discount_total": Decimal("0.00"), "tax_total": Decimal("0.00"),
        "sent_at": datetime(2026, 10, 26), "revision_number": 1,
        **changes,
    }


class TrackedSession(Session):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.before_locked_read = None
        self.lock_reads = []
        self.commit_count = 0
        self.flush_count = 0

    def scalar(self, statement, *args, **kwargs):
        if getattr(statement, "_for_update_arg", None) is not None:
            self.lock_reads.append(statement)
            callback, self.before_locked_read = self.before_locked_read, None
            if callback:
                callback(self)
        return super().scalar(statement, *args, **kwargs)

    def commit(self):
        self.commit_count += 1
        return super().commit()

    def flush(self, *args, **kwargs):
        self.flush_count += 1
        return super().flush(*args, **kwargs)


class LockedQuotationIdentityTests(unittest.TestCase):
    def setUp(self):
        # The only permitted database here is an ephemeral in-process SQLite DB.
        self.addCleanup(patch.stopall)
        patch.object(socket.socket, "connect", side_effect=AssertionError("Network prohibited")).start()
        patch.object(socket, "create_connection", side_effect=AssertionError("Network prohibited")).start()
        callbacks = actual_audit_callbacks()
        for event_name, name in (("before_flush", "_remember_audit_coverage"),
                                 ("before_commit", "_require_audit_for_commit"),
                                 ("after_commit", "_clear_audit_state"),
                                 ("after_rollback", "_clear_audit_state")):
            listener = callbacks[name]
            event.listen(TrackedSession, event_name, listener)
            self.addCleanup(event.remove, TrackedSession, event_name, listener)
            self.assertTrue(event.contains(TrackedSession, event_name, listener))
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = AuditFixtureTypeCompiler(self.engine.dialect)
        Quotation.__table__.create(self.engine)
        UserSession.__table__.create(self.engine)
        ActivityLog.__table__.create(self.engine)
        with self.engine.begin() as connection:
            # Core inserts avoid unrelated snapshot listeners; all values are synthetic.
            connection.execute(Quotation.__table__.insert(), quote_values())
            connection.execute(UserSession.__table__.insert(), {
                "id": USER_SESSION, "user_id": "synthetic-user", "token_version": 1,
                "auth_method": "synthetic", "device_type": "synthetic",
                "browser": "synthetic", "operating_system": "synthetic",
                "last_seen_at": datetime(2026, 10, 26),
                "expires_at": datetime(2026, 11, 1),
            })
        self.db = TrackedSession(self.engine, autoflush=False, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.tenant = NS(organization_id=ORG, user_id="synthetic-user", membership_id="synthetic-member")
        self.audit = Mock(side_effect=actual_activity_recorder())
        context = {"select": select, "Quotation": Quotation, "HTTPException": HTTPException,
                   "datetime": datetime, "timezone": timezone, "record_activity": self.audit}
        context["_successor_revision"] = actual_function("app/api/v1/sales.py", "_successor_revision", context)
        context["_require_latest_revision"] = actual_function("app/api/v1/sales.py", "_require_latest_revision", context)
        context["_detail"] = self.detail
        self.change_status = actual_function("app/api/v1/sales.py", "change_quotation_status", context)
        portal_context = {"select": select, "Quotation": Quotation, "HTTPException": HTTPException,
                          "_client_portal_client_ids": lambda db, tenant: [CLIENT],
                          "change_quotation_status": self.change_status,
                          "QuotationStatusChange": lambda **kwargs: NS(**kwargs),
                          "_quotation_detail": lambda db, tenant, row: self.detail(db, tenant.organization_id, row.id)}
        self.decide = actual_function("app/api/v1/client_portal.py", "decide_client_portal_quotation", portal_context)

    @staticmethod
    def detail(db, organization_id, quotation_id):
        row = db.scalar(select(Quotation).where(Quotation.id == quotation_id, Quotation.organization_id == organization_id))
        return {"id": row.id, "status": row.status, "total": row.total, "currency": row.currency}

    def preload(self):
        return self.db.scalar(select(Quotation).where(Quotation.id == QUOTE))

    def stored_status(self, status):
        # Core connection execution does not synchronize or expire ORM objects.
        self.db.connection().execute(update(Quotation.__table__).where(Quotation.id == QUOTE).values(status=status))

    def transition(self, target):
        return self.change_status(QUOTE, NS(status=target, reason="Synthetic review"), None, self.db, self.tenant)

    def assert_no_transition(self):
        self.assertEqual(self.db.commit_count, 0)
        self.assertEqual(self.db.flush_count, 0)
        self.audit.assert_not_called()

    def test_control_plain_locked_select_keeps_the_preloaded_stale_instance(self):
        stale = self.preload()
        self.stored_status("accepted")
        plain = self.db.scalar(select(Quotation).where(Quotation.id == QUOTE).with_for_update())
        self.assertIs(plain, stale)
        self.assertEqual(plain.status, "sent")
        stored = self.db.connection().scalar(select(Quotation.__table__.c.status).where(Quotation.id == QUOTE))
        self.assertEqual(stored, "accepted")
        self.assert_no_transition()

    def test_opposite_terminal_decisions_refresh_before_lifecycle_validation(self):
        for stored, target in [("accepted", "rejected"), ("rejected", "accepted"), ("cancelled", "accepted")]:
            with self.subTest(stored=stored, target=target):
                self.stored_status("sent")
                self.db.expire_all()  # Test fixture reset only, never application behavior.
                stale = self.preload()
                self.stored_status(stored)
                self.assertEqual(stale.status, "sent")
                with self.assertRaises(HTTPException) as caught:
                    self.transition(target)
                self.assertEqual(caught.exception.status_code, 409)
                self.assertEqual(stale.status, stored)
                self.assertEqual(stale.total, Decimal("123.45"))
                self.assert_no_transition()

    def test_portal_pre_read_then_storage_change_reaches_actual_refreshed_handler(self):
        def changed_after_portal_read(db):
            loaded = db.identity_map.get((Quotation, (QUOTE,), None))
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.status, "sent")
            self.stored_status("accepted")
        self.db.before_locked_read = changed_after_portal_read
        with self.assertRaises(HTTPException) as caught:
            self.decide(QUOTE, NS(status="rejected", reason="Synthetic review"), None, self.db, self.tenant)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(len(self.db.lock_reads), 1)
        self.assert_no_transition()

    def test_existing_same_target_success_remains_read_only_after_refresh(self):
        stale = self.preload()
        self.stored_status("accepted")
        result = self.transition("accepted")
        self.assertEqual(result, {"id": QUOTE, "status": "accepted", "total": Decimal("123.45"), "currency": "USD"})
        self.assertEqual(stale.status, "accepted")
        self.assert_no_transition()

    def test_ordinary_sent_acceptance_retains_amount_currency_identity_and_audit(self):
        row = self.preload()
        result = self.transition("accepted")
        self.assertEqual(result["status"], "accepted")
        self.assertEqual((row.id, row.client_id, row.total, row.currency), (QUOTE, CLIENT, Decimal("123.45"), "USD"))
        self.assertIsNotNone(row.accepted_at)
        self.assertIsNone(row.rejected_at)
        self.assertIsNone(row.cancelled_at)
        self.audit.assert_called_once()
        self.assertEqual(self.audit.call_args.kwargs["before"], {"status": "sent"})
        self.assertEqual(self.audit.call_args.kwargs["after"], {"status": "accepted"})
        self.assertEqual(self.audit.call_args.kwargs["entity_id"], QUOTE)
        self.assertEqual(self.db.commit_count, 1)

    def test_ordinary_sent_rejection_remains_supported(self):
        self.assertEqual(self.transition("rejected")["status"], "rejected")
        self.assertEqual(self.db.commit_count, 1)
        self.audit.assert_called_once()

    def test_ordinary_sent_cancellation_remains_supported(self):
        self.assertEqual(self.transition("cancelled")["status"], "cancelled")
        self.assertEqual(self.db.commit_count, 1)

    def test_draft_to_sent_remains_supported(self):
        self.stored_status("draft")
        self.assertEqual(self.transition("sent")["status"], "sent")
        self.assertEqual(self.db.commit_count, 1)

    def test_refreshed_draft_cannot_skip_directly_to_accepted(self):
        self.preload()
        self.stored_status("draft")
        with self.assertRaises(HTTPException) as caught:
            self.transition("accepted")
        self.assertEqual(caught.exception.status_code, 409)
        self.assert_no_transition()

    def test_latest_revision_is_checked_even_for_the_same_target(self):
        self.stored_status("accepted")
        self.db.connection().execute(Quotation.__table__.insert(), quote_values(
            id="synthetic-revision", revision_number=2, root_quotation_id=QUOTE,
            supersedes_quotation_id=QUOTE, status="draft"))
        with self.assertRaises(HTTPException) as caught:
            self.transition("accepted")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("superseded", caught.exception.detail)
        self.assert_no_transition()

    def test_quotation_refresh_retains_unflushed_authentication_session_changes(self):
        row = self.preload()
        auth = self.db.get(UserSession, USER_SESSION)
        newer = datetime(2026, 10, 27, 11, 37)
        auth.last_seen_at = newer
        self.stored_status("accepted")
        with self.assertRaises(HTTPException):
            self.transition("rejected")
        self.assertEqual(row.status, "accepted")
        self.assertEqual(auth.last_seen_at, newer)
        self.assertIn(auth, self.db.dirty)
        self.assertTrue(inspect(auth).attrs.last_seen_at.history.has_changes())
        stored = self.db.connection().scalar(select(UserSession.__table__.c.last_seen_at).where(UserSession.id == USER_SESSION))
        self.assertEqual(stored, datetime(2026, 10, 26))
        self.assert_no_transition()

    def test_success_still_commits_existing_pending_authentication_session_touch(self):
        auth = self.db.get(UserSession, USER_SESSION)
        newer = datetime(2026, 10, 27, 11, 38)
        auth.last_seen_at = newer
        self.transition("accepted")
        self.assertEqual(auth.last_seen_at, newer)
        stored = self.db.connection().scalar(select(UserSession.__table__.c.last_seen_at).where(UserSession.id == USER_SESSION))
        self.assertEqual(stored, newer)
        self.assertEqual(self.db.commit_count, 1)

    def test_cross_tenant_identity_is_not_found_or_changed(self):
        self.tenant.organization_id = "other-synthetic-org"
        with self.assertRaises(HTTPException) as caught:
            self.transition("accepted")
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.preload().status, "sent")
        self.assert_no_transition()

    def test_missing_quotation_remains_404(self):
        with self.assertRaises(HTTPException) as caught:
            self.change_status("missing-synthetic", NS(status="accepted"), None, self.db, self.tenant)
        self.assertEqual(caught.exception.status_code, 404)
        self.assert_no_transition()

    def test_success_persists_exact_audit_provenance_in_same_transaction(self):
        self.transition("accepted")
        self.audit.assert_called_once()
        rows = self.db.scalars(select(ActivityLog)).all()
        self.assertEqual(len(rows), 1)
        log = rows[0]
        self.assertEqual((log.organization_id, log.actor_user_id, log.actor_type, log.scope),
                         (ORG, "synthetic-user", "user", "tenant"))
        self.assertEqual((log.action, log.entity_type, log.entity_id, log.outcome),
                         ("sales.quotation.status_changed", "quotation", QUOTE, "success"))
        self.assertEqual(log.before_data, {"status": "sent"})
        self.assertEqual(log.after_data, {"status": "accepted"})
        self.assertEqual(log.message, "Quotation SYN-Q-1 status changed from sent to accepted")
        self.assertIsNone(log.metadata_json)
        for field in ("request_id", "ip_address", "user_agent", "http_method", "request_path"):
            self.assertIsNone(getattr(log, field))
        self.assertTrue(log.id)
        self.assertIsNotNone(log.created_at)
        self.assertEqual(self.db.commit_count, 1)
        self.db.expire_all()
        self.assertEqual(self.preload().status, "accepted")
        self.assertEqual(self.db.get(ActivityLog, log.id).after_data, {"status": "accepted"})

    def test_missing_audit_is_rejected_and_rollback_preserves_stored_quotation(self):
        # Deliberately omit only the audit write: the real guard remains attached.
        self.audit.side_effect = None
        with self.assertRaisesRegex(RuntimeError, "Audit guard blocked database commit"):
            self.transition("accepted")
        self.audit.assert_called_once()
        self.assertEqual(self.db.commit_count, 1)  # attempted, not acknowledged
        self.assertGreater(self.db.flush_count, 0)
        self.db.rollback()
        self.db.expire_all()
        self.assertEqual(self.preload().status, "sent")
        self.assertEqual(self.db.scalars(select(ActivityLog)).all(), [])

    def test_actual_query_retains_scoped_postgresql_lock_and_populate_existing(self):
        self.transition("accepted")
        self.assertEqual(len(self.db.lock_reads), 1)
        statement = self.db.lock_reads[0]
        compiled = statement.compile(dialect=postgresql.dialect())
        self.assertIn("FOR UPDATE", str(compiled))
        self.assertEqual(set(compiled.params.values()), {QUOTE, ORG})
        self.assertEqual(statement.get_execution_options().get("populate_existing"), True)


class ExactDeltaTests(unittest.TestCase):
    def test_only_one_approved_statement_option_changes_the_entire_sales_source(self):
        path = ROOT / "app/api/v1/sales.py"
        source = path.read_text()
        node = next(item for item in ast.parse(source).body if isinstance(item, ast.FunctionDef) and item.name == "change_quotation_status")
        lines = source.splitlines(keepends=True)
        function = "".join(lines[node.lineno - 1:node.end_lineno])
        addition = "        .execution_options(populate_existing=True)\n"
        self.assertEqual(function.count(addition), 1)
        restored = "".join(lines[:node.lineno - 1]) + function.replace(addition, "", 1) + "".join(lines[node.end_lineno:])
        self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(), SALES_PREIMAGE)

    def test_portal_payload_auth_scope_and_terminal_precheck_source_is_unchanged(self):
        self.assertEqual(hashlib.sha256((ROOT / "app/api/v1/client_portal.py").read_bytes()).hexdigest(), PORTAL_PREIMAGE)


if __name__ == "__main__":
    unittest.main()
