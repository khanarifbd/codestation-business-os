"""Offline Controls handler/ASGI/SQL boundaries, not PostgreSQL concurrency proof.

All sessions are explicit fakes. The ASGI transport invokes FastAPI in-process;
no socket, database, scheduler process or real financial write is used.
"""
import ast
import asyncio
from contextlib import ExitStack
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from app.api.v1 import finance_auto_post as api
from app.api.v1 import finance_controls as controls
from app.api.v1 import financial_safety as keyed
from app.schemas.finance_auto_post import AutoPostRetry
from app.services import finance_controls_safety as safety
from app.services import recurring_auto_post as service
from app.services.accounting_period_gate import (
    AccountingPeriodGateError, acquire_accounting_period_gate,
    require_accounting_period_gate,
)


TODAY = date(2026, 10, 26)
DUE = date(2026, 8, 1)
NEXT = date(2026, 9, 1)
NOW = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)


def recurring(**changes):
    return NS(**({
        "id": "schedule-a", "organization_id": "org-a", "name": "Synthetic hosting",
        "description": "Fixture only", "next_due_date": DUE, "end_date": None,
        "is_active": True, "auto_post": True, "account_id": "account-a",
        "category_id": "category-a", "vendor_id": None, "project_id": None,
        "client_id": None, "expense_currency": "USD", "expense_amount": Decimal("10.00"),
        "tax_amount": Decimal("0"), "frequency": "monthly", "interval_count": 1,
        "payment_method": "card", "reference": None, "notes": None,
        "created_by_user_id": "user-a", "last_posted_expense_id": None,
        "auto_post_last_error": "Earlier known rejection", "auto_post_last_attempt_at": None,
    } | changes))


def account(**changes):
    return NS(**({
        "id": "account-a", "organization_id": "org-a", "name": "Synthetic bank",
        "is_active": True, "account_type": "bank", "currency": "USD",
        "opening_balance": Decimal("100.00"),
    } | changes))


def response(item):
    return api.AutoPostRow(
        id=item.id, name=item.name, description=item.description,
        category_name="Synthetic category", vendor_name=None, account_name="Synthetic bank",
        account_currency="USD", expense_currency=item.expense_currency,
        expense_amount=str(item.expense_amount), frequency=item.frequency,
        interval_count=item.interval_count, next_due_date=item.next_due_date.isoformat(),
        is_active=item.is_active, auto_post=item.auto_post, eligible=True,
        eligibility_reason=None, retryable=False, last_attempt_at=NOW, last_error=None,
    )


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class DB:
    def __init__(self, values=(), ids=(), commit_error=None, on_commit=None, identities=None, refresh_organization=None):
        self.values = list(values)
        self.ids = list(ids)
        self.queries = []
        self.events = []
        self.added = []
        self.commit_error = commit_error
        self.on_commit = on_commit
        self.get_values = {}
        self.identities = {} if identities is None else dict(identities)
        self.refresh_organization = refresh_organization
        self.gate_roots = []
        self.discovery_roots = []
        self.organization_reads = []
        self.info = {}
        # Explicit fake root/connection lifecycle for the period-gate contract.
        # No driver, engine or network connection is constructed here.
        self.is_active = True
        self._root_transaction = NS(is_active=True)
        self._connection_transaction = NS(is_active=True)
        self._gate_connection = NS(
            closed=False, invalidated=False, dialect=NS(name="postgresql"),
            connection=NS(driver_connection=NS(autocommit=False)),
            get_transaction=lambda: self._connection_transaction,
            get_isolation_level=lambda: "READ COMMITTED",
        )

    def get_transaction(self):
        return self._root_transaction

    def get_nested_transaction(self):
        return None

    def connection(self):
        if self._root_transaction is None:
            raise AssertionError("Period helper must not implicitly begin")
        return self._gate_connection

    def _end_transaction(self):
        if self._root_transaction is not None:
            self._root_transaction.is_active = False
        if self._connection_transaction is not None:
            self._connection_transaction.is_active = False
        self._root_transaction = self._connection_transaction = None

    def begin_request(self):
        """Explicit fake tenant/auth read starts a subsequent request transaction."""
        if self._root_transaction is not None:
            raise AssertionError("The previous request transaction is still active")
        self._root_transaction = NS(is_active=True)
        self._connection_transaction = NS(is_active=True)

    def capture(self, query, params=None):
        if self._root_transaction is None:
            # A real caller SQL read (never the gate helper) starts the next root.
            self.begin_request()
        compiled = query.compile(dialect=postgresql.dialect())
        self.queries.append((str(compiled), compiled.params, query.get_execution_options(), params))
        if "pg_advisory_xact_lock" in str(compiled):
            mode = "shared" if "pg_advisory_xact_lock_shared" in str(compiled) else "exclusive"
            self.events.append("gate:" + mode)
            self.gate_roots.append(self._root_transaction)
        else:
            self.events.append("query")

    def scalar(self, query):
        self.capture(query)
        columns = tuple(str(column) for column in query.selected_columns)
        if columns == ("recurring_expenses.organization_id",):
            sql, params, _, _ = self.queries[-1]
            if "FOR UPDATE" in sql or set(params) != {"id_1"}:
                raise AssertionError("Worker discovery must be an exact nonlocking identity read")
            self.events[-1] = "tenant-discovery"
            self.discovery_roots.append(self._root_transaction)
            return self.identities.pop(params["id_1"])
        return self.values.pop(0)

    def scalars(self, query):
        self.capture(query)
        return Rows(self.ids)

    def execute(self, query, params=None):
        self.capture(query, params)
        return Rows([])

    def get(self, model, key, *, populate_existing=False):
        if model.__name__ == "Organization":
            if populate_existing is not True:
                raise AssertionError("Worker organization must be freshly loaded after gate")
            require_accounting_period_gate(self, key)
            self.organization_reads.append((key, populate_existing, self._root_transaction))
        elif populate_existing:
            raise AssertionError("Unexpected fake get refresh")
        self.events.append("get:" + model.__name__)
        return self.get_values.get((model.__name__, key))

    def add(self, item):
        self.events.append("add:" + type(item).__name__)
        if type(item).__name__ == "Expense":
            item.id = "expense-synthetic"
        self.added.append(item)

    def flush(self):
        self.events.append("flush")

    def rollback(self):
        self.events.append("rollback")
        self._end_transaction()

    def commit(self):
        self.events.append("commit")
        self._end_transaction()
        if self.on_commit:
            self.on_commit()
        if self.commit_error:
            raise self.commit_error

    def refresh(self, item, *, attribute_names=None):
        if self._root_transaction is None:
            raise AssertionError("Unexpected postcommit read")
        if item is not self.refresh_organization:
            raise AssertionError("Only the explicitly registered organization may be refreshed")
        if attribute_names not in (None, ["timezone"]):
            raise AssertionError("Unexpected organization refresh attributes")
        require_accounting_period_gate(self, item.id)
        self.events.append("refresh:Organization")


class Base(unittest.TestCase):
    def setUp(self):
        self.tenant = NS(organization_id="org-a", user_id="user-a", organization=NS(id="org-a", timezone="UTC"))
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch("sqlalchemy.engine.Engine.connect", side_effect=AssertionError("Database forbidden")))
        self.stack.enter_context(patch("socket.create_connection", side_effect=AssertionError("Network forbidden")))
        self.stack.enter_context(patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")))
        self.stack.enter_context(patch("socket.socket.bind", side_effect=AssertionError("Service forbidden")))

    def intercept(self, module, name, **kwargs):
        return self.stack.enter_context(patch.object(module, name, **kwargs))


class FakeLifecycleTests(Base):
    def test_refresh_requires_held_gate_and_exact_registered_organization(self):
        organization = self.tenant.organization
        db = DB(refresh_organization=organization)
        with self.assertRaises(AccountingPeriodGateError): db.refresh(organization, attribute_names=["timezone"])
        self.assertFalse(db.events)
        acquire_accounting_period_gate(db, "org-a")
        with self.assertRaisesRegex(AssertionError, "registered organization"): db.refresh(NS(id="org-a"))
        with self.assertRaisesRegex(AssertionError, "refresh attributes"): db.refresh(organization, attribute_names=["currency"])
        db.refresh(organization, attribute_names=["timezone"])
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization"])

    def test_refresh_after_commit_or_rollback_never_autobegins(self):
        for finish in ("commit", "rollback"):
            with self.subTest(finish=finish):
                db = DB(refresh_organization=self.tenant.organization)
                acquire_accounting_period_gate(db, "org-a"); getattr(db, finish)()
                with self.assertRaisesRegex(AssertionError, "postcommit read"): db.refresh(self.tenant.organization)
                self.assertIsNone(db.get_transaction())
                self.assertEqual(db.events, ["gate:shared", finish])


class RetryTests(Base):
    def configure(self, item=None, values=None, **db_options):
        self.item = item or recurring()
        self.db = DB(values=[self.item] if values is None else values, refresh_organization=self.tenant.organization, **db_options)
        self.intercept(api, "organization_local_date", return_value=TODAY)

        def post(db, item, **kwargs):
            require_accounting_period_gate(db, item.organization_id)
            db.events.append("post")
            item.next_due_date = NEXT
            item.last_posted_expense_id = "expense-synthetic"

        self.post = self.intercept(api, "post_due_recurring_expense", side_effect=post)
        self.audit = self.intercept(api, "record_activity", side_effect=lambda db, **kw: db.events.append("audit:" + kw["action"]))
        self.read = self.intercept(api, "_read", side_effect=lambda db, item, today: (db.events.append("snapshot") or response(item)))
        return self.db

    def call(self, payload=None):
        return api.retry_recurring_auto_post("schedule-a", None, self.db, self.tenant, payload)

    def test_matching_due_posts_one_occurrence_and_preserves_response_dto(self):
        db = self.configure()
        result = self.call(AutoPostRetry(expected_next_due_date=DUE))
        self.post.assert_called_once()
        self.assertEqual(result.next_due_date, NEXT.isoformat())
        self.assertEqual(set(result.model_dump()), set(api.AutoPostRow.model_fields))
        self.assertEqual(db.events[-2:], ["snapshot", "commit"])
        self.assertNotIn("refresh", db.events)

    def test_schedule_lock_is_tenant_scoped_and_refreshed(self):
        db = self.configure(); self.call()
        self.assertEqual(db.events[:3], ["gate:shared", "refresh:Organization", "query"])
        self.assertIn("pg_advisory_xact_lock_shared", db.queries[0][0])
        sql, params, options, _ = db.queries[1]
        self.assertIn("FOR UPDATE", sql)
        self.assertIn("recurring_expenses.organization_id =", sql)
        self.assertIn("org-a", params.values())
        self.assertIn("schedule-a", params.values())
        self.assertTrue(options["populate_existing"])

    def test_omitted_body_preserves_legacy_current_due(self):
        self.configure(); self.assertIsInstance(self.call(), api.AutoPostRow)

    def test_empty_object_preserves_legacy_current_due(self):
        self.configure(); self.call(AutoPostRetry()); self.post.assert_called_once()

    def test_null_date_preserves_legacy_current_due(self):
        self.configure(); self.call(AutoPostRetry(expected_next_due_date=None)); self.post.assert_called_once()

    def test_mismatch_has_no_post_audit_snapshot_attempt_or_error_effect(self):
        db = self.configure(item=recurring(next_due_date=NEXT))
        before = vars(self.item).copy()
        with self.assertRaises(HTTPException) as caught:
            self.call(AutoPostRetry(expected_next_due_date=DUE))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("reviewed due occurrence changed", caught.exception.detail)
        self.assertEqual(vars(self.item), before)
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization", "query"])
        self.post.assert_not_called(); self.audit.assert_not_called(); self.read.assert_not_called()

    def test_missing_tenant_schedule_is404_before_fence(self):
        db = self.configure(values=[None])
        with self.assertRaises(HTTPException) as caught:
            self.call(AutoPostRetry(expected_next_due_date=DUE))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization", "query"])

    def test_disabled_not_posted(self):
        self.configure(item=recurring(auto_post=False))
        with self.assertRaises(HTTPException) as caught: self.call()
        self.assertEqual(caught.exception.status_code, 409); self.post.assert_not_called()

    def test_inactive_not_posted(self):
        self.configure(item=recurring(is_active=False))
        with self.assertRaises(HTTPException) as caught: self.call()
        self.assertEqual(caught.exception.status_code, 409); self.post.assert_not_called()

    def test_future_due_not_posted(self):
        self.configure(item=recurring(next_due_date=date(2026, 11, 1)))
        with self.assertRaises(HTTPException) as caught: self.call()
        self.assertEqual(caught.exception.status_code, 409); self.post.assert_not_called()

    def test_response_is_detached_from_orm_changes_at_commit(self):
        db = self.configure()
        db.on_commit = lambda: setattr(self.item, "name", "Changed after snapshot")
        result = self.call()
        self.assertEqual(result.name, "Synthetic hosting")

    def test_commit_exception_is_unknown503_no_failed_marker_or_second_query(self):
        db = self.configure(commit_error=RuntimeError("Synthetic lost acknowledgement"))
        with self.assertRaises(HTTPException) as caught: self.call()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("outcome could not be confirmed", caught.exception.detail)
        self.assertEqual(len(db.queries), 2)
        self.assertEqual(db.events.count("commit"), 1)
        self.assertNotIn("rollback", db.events)
        self.assertFalse(any("failed" in event for event in db.events))

    def test_snapshot_failure_rolls_back_without_false_business_failure(self):
        db = self.configure(); self.read.side_effect = ValueError("Response invalid")
        with self.assertRaisesRegex(ValueError, "Response invalid"): self.call()
        self.assertEqual(db.events[-1], "rollback")
        self.assertNotIn("commit", db.events)
        self.assertEqual(len(db.queries), 2)

    def test_success_audit_failure_rolls_back_without_false_business_failure(self):
        db = self.configure(); self.audit.side_effect = ValueError("Audit invalid")
        with self.assertRaisesRegex(ValueError, "Audit invalid"): self.call()
        self.assertEqual(db.events[-1], "rollback")
        self.assertNotIn("commit", db.events)
        self.assertEqual(len(db.queries), 2)

    def test_unknown_precommit_error_rolls_back_without_failure_record(self):
        db = self.configure(); self.post.side_effect = RuntimeError("Driver failed")
        with self.assertRaisesRegex(RuntimeError, "Driver failed"): self.call()
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization", "query", "rollback"])
        self.audit.assert_not_called()

    def test_upstream503_not_mislabeled409(self):
        db = self.configure(); self.post.side_effect = HTTPException(503, "Unknown")
        with self.assertRaises(HTTPException) as caught: self.call()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization", "query", "rollback"])

    def rejection(self, exception, failed=None):
        failed = failed or recurring()
        db = self.configure(values=[recurring(), failed])
        self.post.side_effect = exception
        with self.assertRaises(HTTPException) as caught: self.call()
        self.assertEqual(caught.exception.status_code, 409)
        return db, failed

    def test_known_rejection_rolls_back_then_locks_before_failure_commit(self):
        db, failed = self.rejection(ValueError("Insufficient balance"))
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization", "query", "rollback", "query", "audit:finance.recurring_expense.auto_post_retry_failed", "commit"])
        self.assertEqual(failed.auto_post_last_error, "Insufficient balance")
        sql, params, options, _ = db.queries[2]
        self.assertIn("FOR UPDATE", sql); self.assertIn("org-a", params.values()); self.assertTrue(options["populate_existing"])

    def test_closed_period_http409_is_known_precommit_rejection(self):
        db, failed = self.rejection(HTTPException(409, "Period closed"))
        self.assertEqual(failed.auto_post_last_error, "Period closed")
        self.assertEqual(db.events.count("commit"), 1)

    def test_failure_marker_truncated_to2000(self):
        _, failed = self.rejection(ValueError("x" * 2100))
        self.assertEqual(len(failed.auto_post_last_error), 2000)

    def test_concurrently_advanced_occurrence_not_marked_failed(self):
        db, failed = self.rejection(ValueError("Rejected"), recurring(next_due_date=NEXT, auto_post_last_error=None))
        self.assertIsNone(failed.auto_post_last_error)
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization", "query", "rollback", "query", "rollback"])
        self.audit.assert_not_called()

    def test_removed_schedule_after_rejection_does_not_write_stale_marker(self):
        db = self.configure(values=[recurring(), None]); self.post.side_effect = ValueError("Rejected")
        with self.assertRaises(HTTPException) as caught: self.call()
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization", "query", "rollback", "query", "rollback"])
        self.audit.assert_not_called()

    def test_failure_marker_commit_error_is_not_returned_as_known409(self):
        db = self.configure(values=[recurring(), recurring()], commit_error=RuntimeError("Marker commit unknown"))
        self.post.side_effect = ValueError("Known posting rejection")
        with self.assertRaisesRegex(RuntimeError, "Marker commit unknown"): self.call()
        self.assertEqual(db.events.count("commit"), 1)

    def test_two_sequential_fenced_attempts_second_rejects_without_second_post(self):
        db = self.configure(); self.call(AutoPostRetry(expected_next_due_date=DUE))
        db.values.append(self.item)
        db.begin_request()  # Next request tenant/auth transaction, not helper autobegin.
        with self.assertRaises(HTTPException) as caught: self.call(AutoPostRetry(expected_next_due_date=DUE))
        self.assertEqual(caught.exception.status_code, 409)
        self.post.assert_called_once()

    def test_fence_is_not_configuration_fingerprint(self):
        self.configure(item=recurring(expense_amount=Decimal("12.00")))
        result = self.call(AutoPostRetry(expected_next_due_date=DUE))
        self.assertEqual(result.expense_amount, "12.00")

    def test_unsupported_isolation_rejects_before_refresh_read_or_post(self):
        db = self.configure()
        db._gate_connection.get_isolation_level = lambda: "REPEATABLE READ"
        with self.assertRaises(AccountingPeriodGateError): self.call()
        self.assertFalse(db.events); self.assertFalse(db.queries); self.assertFalse(db.added)
        self.post.assert_not_called(); self.audit.assert_not_called(); self.read.assert_not_called()

    def test_same_session_next_request_needs_new_root_and_gate(self):
        db = self.configure(); self.call()
        old_root = db.gate_roots[0]
        self.assertFalse(old_root.is_active)
        with self.assertRaises(AccountingPeriodGateError): require_accounting_period_gate(db, "org-a")
        db.begin_request()
        with self.assertRaises(AccountingPeriodGateError): require_accounting_period_gate(db, "org-a")
        db.values.append(self.item); self.call()
        self.assertEqual(len(db.gate_roots), 2)
        self.assertIsNot(db.gate_roots[1], old_root)
        self.assertEqual(self.post.call_count, 2)


class BodyCompatibilityTests(Base):
    # Each test sends through the actual route, with DB/auth dependencies replaced
    # by explicit synthetic values. No HTTP server or real login is started.
    configure = RetryTests.configure

    def request(self, content=None, content_type=None):
        app = FastAPI()
        app.include_router(api.router)
        # Newer FastAPI lazily includes routers in the application route list;
        # the source APIRoute retains the exact dependency call identities.
        route = next(r for r in api.router.routes if r.path.endswith("/{recurring_id}/retry"))
        for dependency in route.dependant.dependencies:
            if dependency.name == "db": app.dependency_overrides[dependency.call] = lambda: self.db
            if dependency.name == "tenant": app.dependency_overrides[dependency.call] = lambda: self.tenant

        async def send():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
                return await client.post("/finance/recurring-auto-post/schedule-a/retry", content=content, headers={} if content_type is None else {"Content-Type": content_type})
        return asyncio.run(send())

    def test_asgi_no_body_no_content_type(self):
        self.configure(); self.assertEqual(self.request().status_code, 200)

    def test_asgi_empty_string_proxy_body(self):
        self.configure(); self.assertEqual(self.request(content=b"", content_type="application/json").status_code, 200)

    def test_asgi_empty_json_object(self):
        self.configure(); self.assertEqual(self.request(content=b"{}", content_type="application/json").status_code, 200)

    def test_asgi_json_null_body(self):
        self.configure(); self.assertEqual(self.request(content=b"null", content_type="application/json").status_code, 200)

    def test_asgi_null_date(self):
        self.configure(); self.assertEqual(self.request(content=b'{"expected_next_due_date":null}', content_type="application/json").status_code, 200)

    def test_asgi_date_parses_and_posts(self):
        self.configure(); result = self.request(content=b'{"expected_next_due_date":"2026-08-01"}', content_type="application/json")
        self.assertEqual(result.status_code, 200); self.assertEqual(result.json()["next_due_date"], "2026-09-01")

    def test_asgi_invalid_date422_no_post_or_query(self):
        self.configure(); result = self.request(content=b'{"expected_next_due_date":"not-a-date"}', content_type="application/json")
        self.assertEqual(result.status_code, 422); self.post.assert_not_called(); self.assertFalse(self.db.queries)

    def test_asgi_mismatch409_no_post(self):
        self.configure(); result = self.request(content=b'{"expected_next_due_date":"2026-07-01"}', content_type="application/json")
        self.assertEqual(result.status_code, 409); self.post.assert_not_called()


class SchedulerTests(Base):
    def configure(self, values=None, ids=None, **options):
        ids = ["schedule-a"] if ids is None else ids
        identities = options.pop("identities", {key: "org-a" for key in ids})
        self.db = DB(values=[recurring()] if values is None else values, ids=ids, identities=identities, **options)
        self.db.get_values[("Organization", "org-a")] = NS(timezone="UTC")
        def post(db, item, **kwargs):
            require_accounting_period_gate(db, item.organization_id)
            db.events.append("post:" + item.id)
        self.post = self.intercept(service, "post_due_recurring_expense", side_effect=post)
        self.audit = self.intercept(service, "record_activity", side_effect=lambda db, **kw: db.events.append("audit:" + kw["action"]))
        return self.db

    def call(self): return service.process_due_auto_posts(self.db, now=NOW)

    def test_one_occurrence_per_candidate(self):
        db = self.configure(); self.assertEqual(self.call(), (1, 0)); self.post.assert_called_once()
        self.assertEqual(db.events[-2:], ["post:schedule-a", "commit"])

    def test_skip_locked_fresh_schedule_after_candidates(self):
        db = self.configure(); self.call()
        self.assertEqual(db.events[:5], ["query", "tenant-discovery", "gate:shared", "query", "get:Organization"])
        self.assertIs(db.discovery_roots[0], db.gate_roots[0])
        self.assertEqual(db.organization_reads[0][:2], ("org-a", True))
        self.assertIs(db.organization_reads[0][2], db.gate_roots[0])
        self.assertIn("pg_advisory_xact_lock_shared", db.queries[2][0])
        self.assertIn("FOR UPDATE SKIP LOCKED", db.queries[3][0]); self.assertTrue(db.queries[3][2]["populate_existing"])
        self.assertIn("recurring_expenses.organization_id =", db.queries[3][0])
        self.assertIn("org-a", db.queries[3][1].values())
        self.assertIn("LIMIT", db.queries[0][0]); self.assertIn(100, db.queries[0][1].values())

    def test_commit_unknown_stops_before_next_candidate_no_failure_marker(self):
        db = self.configure(values=[recurring(), recurring(id="schedule-b")], ids=["schedule-a", "schedule-b"], commit_error=RuntimeError("Commit acknowledgement lost"))
        with self.assertRaisesRegex(RuntimeError, "Commit acknowledgement lost"): self.call()
        self.post.assert_called_once(); self.audit.assert_not_called()
        self.assertEqual(len(db.values), 1); self.assertNotIn("rollback", db.events)

    def test_precommit_driver_failure_stops_without_marker(self):
        db = self.configure(); self.post.side_effect = RuntimeError("Driver offline")
        with self.assertRaisesRegex(RuntimeError, "Driver offline"): self.call()
        self.assertEqual(db.events[-1], "rollback"); self.assertNotIn("commit", db.events); self.audit.assert_not_called()

    def test_known_rejection_rollsback_then_marks_original_due(self):
        failed = recurring(); db = self.configure(values=[recurring(), failed]); self.post.side_effect = ValueError("Insufficient funds")
        self.assertEqual(self.call(), (0, 1)); self.assertEqual(failed.auto_post_last_error, "Insufficient funds")
        self.assertEqual(db.events[-4:], ["rollback", "query", "audit:finance.recurring_expense.auto_post_failed", "commit"])
        self.assertIn("org-a", db.queries[-1][1].values()); self.assertTrue(db.queries[-1][2]["populate_existing"])

    def test_http409_precommit_classifies_known_failure(self):
        db = self.configure(values=[recurring(), recurring()]); self.post.side_effect = HTTPException(409, "Closed period")
        self.assertEqual(self.call(), (0, 1)); self.assertEqual(db.events.count("commit"), 1)

    def test_newer_due_after_rollback_not_marked(self):
        fresh = recurring(next_due_date=NEXT, auto_post_last_error=None)
        db = self.configure(values=[recurring(), fresh]); self.post.side_effect = ValueError("Rejected")
        self.assertEqual(self.call(), (0, 1)); self.assertIsNone(fresh.auto_post_last_error)
        self.audit.assert_not_called(); self.assertNotIn("commit", db.events)

    def test_failure_marker_commit_unknown_also_stops_before_next_candidate(self):
        db = self.configure(values=[recurring(), recurring(), recurring(id="b")], ids=["schedule-a", "b"], commit_error=RuntimeError("Marker commit unknown"))
        self.post.side_effect = ValueError("Rejected")
        with self.assertRaisesRegex(RuntimeError, "Marker commit unknown"): self.call()
        self.post.assert_called_once(); self.assertEqual(len(db.values), 1)

    def test_disabled_schedule_skipped(self):
        db = self.configure(values=[recurring(auto_post=False)]); self.assertEqual(self.call(), (0, 0)); self.post.assert_not_called()
        self.assertIn("rollback", db.events)

    def test_locked_schedule_unavailable_skipped(self):
        self.configure(values=[None]); self.assertEqual(self.call(), (0, 0)); self.post.assert_not_called()

    def test_organization_date_not_utc_controls_due_check(self):
        self.configure(values=[recurring(next_due_date=date(2026, 10, 27))])
        self.db.get_values[("Organization", "org-a")] = NS(timezone="Pacific/Kiritimati")
        self.assertEqual(self.call(), (1, 0))

    def test_future_in_organization_skipped(self):
        self.configure(values=[recurring(next_due_date=date(2026, 10, 27))])
        self.assertEqual(self.call(), (0, 0)); self.post.assert_not_called()

    def test_missing_discovery_rolls_back_without_gate_or_schedule_read(self):
        db = self.configure(values=[], identities={"schedule-a": None})
        self.assertEqual(self.call(), (0, 0)); self.post.assert_not_called()
        self.assertEqual(db.events, ["query", "tenant-discovery", "rollback"])
        self.assertFalse(db.gate_roots); self.assertFalse(db.organization_reads)

    def test_each_candidate_discovers_tenant_and_reacquires_after_commit(self):
        db = self.configure(values=[recurring(), recurring(id="schedule-b", organization_id="org-b")],
                            ids=["schedule-a", "schedule-b"],
                            identities={"schedule-a": "org-a", "schedule-b": "org-b"})
        db.get_values[("Organization", "org-b")] = NS(timezone="UTC")
        self.assertEqual(self.call(), (2, 0)); self.assertEqual(self.post.call_count, 2)
        self.assertEqual(db.events, ["query", "tenant-discovery", "gate:shared", "query", "get:Organization", "post:schedule-a", "commit",
                                     "tenant-discovery", "gate:shared", "query", "get:Organization", "post:schedule-b", "commit"])
        self.assertEqual(len(db.gate_roots), 2); self.assertIsNot(db.gate_roots[0], db.gate_roots[1])
        for discovery, gate_root in zip(db.discovery_roots, db.gate_roots):
            self.assertIs(discovery, gate_root); self.assertFalse(gate_root.is_active)
        keys = [q[3]["lock_key"] for q in db.queries if "pg_advisory_xact_lock" in q[0]]
        self.assertEqual(len(set(keys)), 2)
        self.assertEqual([read[:2] for read in db.organization_reads], [("org-a", True), ("org-b", True)])

    def test_unsupported_runtime_stops_before_schedule_lock_or_effect(self):
        db = self.configure(); db._gate_connection.connection.driver_connection.autocommit = True
        with self.assertRaises(AccountingPeriodGateError): self.call()
        self.assertEqual(db.events, ["query", "tenant-discovery", "rollback"])
        self.post.assert_not_called(); self.audit.assert_not_called(); self.assertFalse(db.added)


class AccountAndPeriodTests(Base):
    def test_eligibility_refetches_account_with_tenant_scope(self):
        db = DB(values=[account()]); self.assertEqual(service.auto_post_eligibility(db, recurring()), (True, None))
        sql, params, options, _ = db.queries[0]
        self.assertIn("financial_accounts.organization_id =", sql); self.assertIn("org-a", params.values()); self.assertTrue(options["populate_existing"])

    def test_card_ineligible_explicit_supported_path_reason(self):
        db = DB(values=[account(account_type="credit_card")])
        self.assertEqual(service.auto_post_eligibility(db, recurring()), (False, safety.CREDIT_CARD_RECURRING_UNSUPPORTED))

    def test_asset_account_payment_method_card_is_not_liability_rejected(self):
        for account_type in ["bank", "cash", "mobile_wallet", "payment_gateway", "petty_cash", "other"]:
            with self.subTest(account_type=account_type):
                db = DB(); self.assertEqual(service.auto_post_eligibility(db, recurring(payment_method="card"), account=account(account_type=account_type)), (True, None)); self.assertFalse(db.queries)

    def test_locked_refreshed_currency_controls_eligibility(self):
        eligible, reason = service.auto_post_eligibility(DB(), recurring(), account=account(currency="BDT"))
        self.assertFalse(eligible); self.assertIn("match", reason)

    def test_inactive_card_retains_unavailable_reason(self):
        eligible, reason = service.auto_post_eligibility(DB(), recurring(), account=account(is_active=False, account_type="credit_card"))
        self.assertFalse(eligible); self.assertIn("inactive", reason)

    def test_enabling_card_schedule_rejected_without_configuration_commit(self):
        db = DB(values=[recurring(auto_post=False), account(account_type="credit_card")])
        audit = self.intercept(api, "record_activity")
        with self.assertRaises(HTTPException) as caught:
            api.set_recurring_auto_post("schedule-a", api.AutoPostToggle(enabled=True), None, db, self.tenant)
        self.assertEqual(caught.exception.status_code, 409); self.assertIn("Credit-card", caught.exception.detail)
        self.assertTrue(db.queries[0][2]["populate_existing"]); self.assertNotIn("commit", db.events); audit.assert_not_called()

    def test_disabling_unsupported_schedule_remains_possible(self):
        item = recurring(); db = DB(values=[item])
        db.refresh = lambda row: None
        eligible = self.intercept(api, "auto_post_eligibility", side_effect=AssertionError("Disable must not require eligibility"))
        self.intercept(api, "record_activity"); self.intercept(api, "_read", side_effect=lambda db, row, today: response(row))
        result = api.set_recurring_auto_post("schedule-a", api.AutoPostToggle(enabled=False), None, db, self.tenant)
        self.assertFalse(result.auto_post); self.assertIsNone(item.auto_post_last_error); eligible.assert_not_called()
        self.assertEqual(db.events.count("commit"), 1)

    def test_manual_new_post_card_rejected_after_locked_fresh_read_before_effects(self):
        db = DB(values=[None, account(account_type="credit_card")]); item = recurring()
        acquire_accounting_period_gate(db, self.tenant.organization_id)
        self.intercept(controls, "_load_recurring_item", return_value=item)
        category = self.intercept(controls, "_validate_category")
        with self.assertRaises(HTTPException) as caught: controls.post_recurring_expense("schedule-a", controls.RecurringExpensePost(), None, db, self.tenant)
        self.assertEqual(caught.exception.status_code, 409); self.assertIn("Credit-card", caught.exception.detail)
        self.assertIn("FOR UPDATE", db.queries[2][0]); self.assertTrue(db.queries[2][2]["populate_existing"])
        self.assertIn("org-a", db.queries[2][1].values()); self.assertFalse(db.added); self.assertEqual(item.next_due_date, DUE); category.assert_not_called()

    def test_auto_card_rejected_after_locked_read_before_expense_movement_or_advance(self):
        db = DB(values=[None, account(account_type="credit_card")]); item = recurring()
        acquire_accounting_period_gate(db, item.organization_id)
        db.get_values[("ExpenseCategory", "category-a")] = NS(is_active=True)
        post = self.intercept(service, "post_expense")
        sequence = self.intercept(service, "next_sequence_code")
        with self.assertRaisesRegex(ValueError, "Credit-card"): service.post_due_recurring_expense(db, item, now=NOW)
        self.assertIn("FOR UPDATE", db.queries[2][0]); self.assertTrue(db.queries[2][2]["populate_existing"])
        self.assertFalse(db.added); self.assertEqual(item.next_due_date, DUE); post.assert_not_called(); sequence.assert_not_called()

    def test_auto_service_allowed_path_preserves_debit_amount_and_one_advance(self):
        db = DB(values=[None, account()]); item = recurring()
        acquire_accounting_period_gate(db, item.organization_id)
        db.get_values[("ExpenseCategory", "category-a")] = NS(is_active=True)
        self.intercept(service, "account_balance", return_value=Decimal("100"))
        self.intercept(service, "next_sequence_code", return_value="EXP-SYNTHETIC")
        self.intercept(service, "record_activity")
        journal = self.intercept(service, "post_expense")
        result = service.post_due_recurring_expense(db, item, now=NOW)
        self.assertEqual(result.expense_amount, Decimal("10.00")); self.assertEqual(result.expense_date, DUE)
        movement = next(row for row in db.added if type(row).__name__ == "FinancialTransaction")
        self.assertEqual((movement.direction, movement.amount, movement.currency), ("debit", Decimal("10.00"), "USD"))
        self.assertEqual(item.next_due_date, NEXT); journal.assert_called_once(); self.assertNotIn("commit", db.events)

    def test_direct_service_requires_real_prior_ownership_before_any_mutation(self):
        db = DB(); item = recurring(); before = vars(item).copy()
        with self.assertRaises(AccountingPeriodGateError): service.post_due_recurring_expense(db, item, now=NOW)
        self.assertEqual(vars(item), before); self.assertFalse(db.queries); self.assertFalse(db.events); self.assertFalse(db.added)

    def test_closed_due_rejects_before_account_lock_sequence_or_expense(self):
        db = DB(values=["closed-period"]); item = recurring()
        acquire_accounting_period_gate(db, item.organization_id)
        journal = self.intercept(service, "post_expense"); sequence = self.intercept(service, "next_sequence_code")
        with self.assertRaises(HTTPException) as caught: service.post_due_recurring_expense(db, item, now=NOW)
        self.assertEqual((caught.exception.status_code, caught.exception.detail), (409, "Accounting period is closed for 2026-08-01"))
        self.assertEqual(db.events, ["gate:shared", "query"])
        sql, params, _, _ = db.queries[1]
        self.assertIn("accounting_periods.organization_id =", sql); self.assertIn("org-a", params.values())
        self.assertIn("start_date <=", sql); self.assertIn("end_date >=", sql); self.assertIn(DUE, params.values())
        self.assertEqual(item.next_due_date, DUE); self.assertFalse(db.added)
        journal.assert_not_called(); sequence.assert_not_called()

    def test_completed_keyed_replay_does_not_enter_new_card_guard(self):
        db = DB(values=[NS(id="saved-expense", expense_number="EXP-ORIGINAL", expense_date=DUE)], refresh_organization=self.tenant.organization)
        saved = NS(next_due_date=NEXT, is_active=False)
        def reserve(db, request, **kwargs):
            require_accounting_period_gate(db, kwargs["organization_id"])
            self.assertEqual(db.info["deferred_commit_depth"], 1)
            db.events.append("reserve")
            return NS(resource_id="saved-expense", resource_type="expense"), True
        self.intercept(keyed, "reserve_posting", side_effect=reserve)
        self.intercept(keyed, "_read_recurring", return_value=saved)
        result_type = self.intercept(keyed, "RecurringExpensePostResult", side_effect=lambda **kw: NS(**kw))
        new_post = self.intercept(keyed, "post_recurring_expense")
        journal = self.intercept(keyed, "post_expense")
        result = keyed.safe_post_recurring_expense("schedule-a", controls.RecurringExpensePost(), None, db, self.tenant)
        self.assertEqual(result.expense_id, "saved-expense"); self.assertEqual(result.next_due_date, NEXT)
        self.assertFalse(result.is_active); result_type.assert_called_once(); new_post.assert_not_called(); journal.assert_not_called()
        self.assertNotIn("commit", db.events)
        self.assertEqual(db.events, ["gate:shared", "refresh:Organization", "reserve", "query"])
        self.assertFalse(any("accounting_periods" in query[0] for query in db.queries))
        self.assertNotIn("deferred_commit_depth", db.info)
        require_accounting_period_gate(db, "org-a")

    def test_tenant_mutex_is_stable_namespaced_signed_and_transaction_scoped(self):
        a = DB(); b = DB(); again = DB()
        safety.lock_accounting_period_creation(a, "org-a"); safety.lock_accounting_period_creation(b, "org-b"); safety.lock_accounting_period_creation(again, "org-a")
        sql, _, _, params = a.queries[0]
        self.assertIn("pg_advisory_xact_lock", sql); self.assertEqual(params, again.queries[0][3]); self.assertNotEqual(params, b.queries[0][3])
        self.assertTrue(-(2 ** 63) <= params["lock_key"] < 2 ** 63)
        self.assertEqual(a.events, ["gate:exclusive"])

    def period_body(self, start=DUE, end=NEXT):
        return controls.AccountingPeriodCreate(name="Synthetic period", start_date=start, end_date=end)

    def test_invalid_period_range_rejects_before_mutex(self):
        db = DB()
        lock = self.intercept(controls, "lock_accounting_period_creation", wraps=safety.lock_accounting_period_creation)
        with self.assertRaises(HTTPException) as caught: controls.create_accounting_period(self.period_body(NEXT, DUE), None, db, self.tenant)
        self.assertEqual(caught.exception.status_code, 400); lock.assert_not_called(); self.assertFalse(db.queries)

    def test_period_mutex_before_overlap_even_when_no_matching_rows(self):
        db = DB(values=[None])
        self.intercept(controls, "lock_accounting_period_creation", side_effect=lambda db, org: (db.events.append("mutex:" + org), safety.lock_accounting_period_creation(db, org))[-1])
        self.intercept(controls, "record_activity", side_effect=RuntimeError("Stop before commit"))
        with self.assertRaisesRegex(RuntimeError, "Stop before commit"): controls.create_accounting_period(self.period_body(), None, db, self.tenant)
        self.assertEqual(db.events[:4], ["mutex:org-a", "gate:exclusive", "query", "add:AccountingPeriod"])
        self.assertEqual(len(db.added), 1); self.assertEqual(db.added[0].status, "open")
        self.assertIn("accounting_periods.organization_id =", db.queries[1][0])

    def test_inclusive_overlap409_after_mutex_before_insert(self):
        db = DB(values=["overlap-a"])
        self.intercept(controls, "lock_accounting_period_creation", side_effect=lambda db, org: (db.events.append("mutex"), safety.lock_accounting_period_creation(db, org))[-1])
        with self.assertRaises(HTTPException) as caught: controls.create_accounting_period(self.period_body(), None, db, self.tenant)
        self.assertEqual(caught.exception.status_code, 409); self.assertEqual(db.events, ["mutex", "gate:exclusive", "query"])
        sql, params, _, _ = db.queries[1]
        self.assertIn("start_date <=", sql); self.assertIn("end_date >=", sql)
        self.assertIn(DUE, params.values()); self.assertIn(NEXT, params.values()); self.assertFalse(db.added)

    def test_actual_period_handler_executes_advisory_before_overlap_select(self):
        db = DB(values=["overlap-a"])
        with self.assertRaises(HTTPException): controls.create_accounting_period(self.period_body(), None, db, self.tenant)
        self.assertIn("pg_advisory_xact_lock", db.queries[0][0])
        self.assertIn("accounting_periods", db.queries[1][0])
        self.assertEqual(len(db.queries), 2); self.assertFalse(db.added)

    def test_mutex_helper_does_not_claim_global_close_barrier_or_commit(self):
        source = Path(safety.__file__).read_text()
        self.assertIn("not a global", source)
        self.assertNotIn("db.commit(", source); self.assertNotIn("db.rollback(", source)


class ContractShapeTests(Base):
    def test_optional_input_has_only_due_date_field(self):
        self.assertEqual(set(AutoPostRetry.model_fields), {"expected_next_due_date"})
        self.assertIsNone(AutoPostRetry().expected_next_due_date)

    def test_invalid_due_date_schema_rejected(self):
        with self.assertRaises(ValidationError): AutoPostRetry(expected_next_due_date="2026-02-30")

    def test_retry_read_permission_not_broadened_and_manage_exact(self):
        source = Path(api.__file__).read_text()
        self.assertIn('require_tenant_permission("finance.manage")', source)
        self.assertIn('require_tenant_permission("finance.view")', source)

    def test_no_new_retry_endpoint_or_response_fields(self):
        retry_routes = [r for r in api.router.routes if r.path.endswith("/retry")]
        self.assertEqual(len(retry_routes), 1)
        self.assertIs(retry_routes[0].response_model, api.AutoPostRow)
        self.assertNotIn("expense_id", api.AutoPostRow.model_fields)
        self.assertNotIn("idempotency_key", AutoPostRetry.model_fields)

    def test_manual_replay_validation_stays_before_business_handler(self):
        tree = ast.parse(Path(keyed.__file__).read_text())
        handler = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "safe_post_recurring_expense")
        text = ast.unparse(handler)
        self.assertLess(text.index("if reused:"), text.index("result = post_recurring_expense("))
        self.assertNotIn("credit_card", text)


if __name__ == "__main__":
    unittest.main()
