"""Actual handlers and SQLAlchemy queries on synthetic in-memory SQLite only.

No configured engine/settings or network is imported. PostgreSQL statement
compilation verifies lock shape, NOT actual lock waiting/isolation/concurrency.
Audit callbacks/recorder are exact AST bodies installed on this Session subclass.
"""
import ast
import base64
from collections.abc import Mapping, Sequence
import copy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import socket
from types import SimpleNamespace as NS
from typing import Annotated
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlencode

from fastapi import Depends, HTTPException, Request
from fastapi.dependencies.utils import get_dependant
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import create_engine, event, func, select, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
from sqlalchemy.orm import Session
from starlette.datastructures import QueryParams

from app.models.activity_log import ActivityLog
from app.models.hr import AttendanceRecord, LeaveRequest, LeaveType
from app.models.membership import Membership
from app.models.team import Employee
from app.models.user import User
from app.schemas.hr_time import LeaveReview, TimePageQuery
from app.services.hr_leave import ensure_no_leave_overlap, lock_leave_employee
from app.services.hr_time_queries import attendance_page, leave_page, parse_time_page

ROOT = Path(__file__).resolve().parents[1]
ORG, OTHER, EMP, USER = "synthetic-org", "other-org", "synthetic-employee", "synthetic-user"
STAMP = datetime(2026, 10, 27, 10, 20, 30, 123456)
LEGACY_HASHES = {'list_attendance': 'ceaee4c50b876ad0184083223690d28e808e8d41fd40abfdf796da1da8c2bb48', 'list_leave_requests': '95e4d2c84414ad1f4e15ca21d4fc546b790340e38e89da5b9ba6949f94de0f3a'}


def actual_function(relative, name, context):
    node = copy.deepcopy(next(n for n in ast.parse((ROOT / relative).read_text()).body
                              if isinstance(n, ast.FunctionDef) and n.name == name))
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), node], type_ignores=[])
    namespace = dict(context)
    exec(compile(ast.fix_missing_locations(module), str(ROOT / relative), "exec"), namespace)
    return namespace[name]


def legacy_ast_hash(node):
    # Goldens use Python3.12's full-field representation. Python3.13 defaults
    # to omitting empty lists: show_empty restores it without dropping ANY field.
    return hashlib.sha256(ast.dump(node, include_attributes=False, show_empty=True).encode()).hexdigest()


class FixtureCompiler(SQLiteTypeCompiler):
    def visit_JSONB(self, _type, **_kwargs):
        return "JSON"


class TrackedSession(Session):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.commit_count = 0
        self.lock_reads = []

    def scalar(self, statement, *args, **kwargs):
        if getattr(statement, "_for_update_arg", None) is not None:
            self.lock_reads.append(statement)
        return super().scalar(statement, *args, **kwargs)

    def commit(self):
        self.commit_count += 1
        return super().commit()


def recorder():
    tree = ast.parse((ROOT / "app/services/activity_log.py").read_text())
    keys = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "SENSITIVE_KEYS" for t in n.targets))
    context = {"Mapping": Mapping, "Sequence": Sequence, "ActivityLog": ActivityLog, "SENSITIVE_KEYS": keys}
    for name in ("_is_sensitive_key", "sanitize_for_audit", "_request_fields", "record_activity"):
        context[name] = actual_function("app/services/activity_log.py", name, context)
    return context["record_activity"]


def req(**query):
    return Request({"type": "http", "query_string": urlencode(query).encode(), "headers": []})


class TimePageTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(socket.socket, "connect", side_effect=AssertionError("Network prohibited")).start()
        patch.object(socket, "create_connection", side_effect=AssertionError("Network prohibited")).start()
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for model in (AttendanceRecord, LeaveRequest, LeaveType, Employee, Membership, User, ActivityLog):
            model.__table__.create(self.engine)
        callbacks = {"Session": Session}
        for name in ("_is_activity_log", "_has_business_mutation", "_remember_audit_coverage", "_require_audit_for_commit", "_clear_audit_state"):
            callbacks[name] = actual_function("app/db/session.py", name, callbacks)
        for name, function in (("before_flush", "_remember_audit_coverage"), ("before_commit", "_require_audit_for_commit"), ("after_commit", "_clear_audit_state"), ("after_rollback", "_clear_audit_state")):
            event.listen(TrackedSession, name, callbacks[function])
            self.addCleanup(event.remove, TrackedSession, name, callbacks[function])
        with self.engine.begin() as connection:
            connection.execute(User.__table__.insert(), {"id": USER, "full_name": "Synthetic person", "email": "synthetic@example.com", "password_hash": "not-a-credential"})
            connection.execute(Membership.__table__.insert(), {"id": "synthetic-member", "organization_id": ORG, "user_id": USER, "role_id": "synthetic-role", "role": "employee", "status": "active"})
            connection.execute(Employee.__table__.insert(), {"id": EMP, "organization_id": ORG, "membership_id": "synthetic-member", "employee_code": "SYN-1"})
            connection.execute(LeaveType.__table__.insert(), {"id": "leave-type", "organization_id": ORG, "name": "Synthetic leave", "code": "SYN"})
            connection.execute(LeaveType.__table__.insert(), {"id": "foreign-type", "organization_id": OTHER, "name": "Foreign type", "code": "FOREIGN"})
        self.db = TrackedSession(self.engine, autoflush=False, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.tenant = NS(organization_id=ORG, user_id=USER, membership_id="synthetic-member")
        self.audit = Mock(side_effect=recorder())
        context = dict(select=select, Employee=Employee, User=User, Membership=Membership,
                       AttendanceRecord=AttendanceRecord, LeaveRequest=LeaveRequest, LeaveType=LeaveType,
                       HTTPException=HTTPException, datetime=datetime, timezone=timezone,
                       attendance_page=attendance_page, leave_page=leave_page, parse_time_page=parse_time_page,
                       lock_leave_employee=lock_leave_employee, ensure_no_leave_overlap=ensure_no_leave_overlap,
                       record_activity=self.audit)
        context["_employee_names"] = actual_function("app/api/v1/hr.py", "_employee_names", context)
        context["_audit"] = actual_function("app/api/v1/hr.py", "_audit", context)
        self.attendance = actual_function("app/api/v1/hr.py", "list_attendance", context)
        self.leave = actual_function("app/api/v1/hr.py", "list_leave_requests", context)
        self.review = actual_function("app/api/v1/hr.py", "review_leave", context)

    def seed(self, model, rows):
        with self.engine.begin() as connection:
            connection.execute(model.__table__.insert(), rows)

    def attendance_row(self, i, **changes):
        return {"id": f"a{i:04}", "organization_id": ORG, "employee_id": f"employee-{i}",
                "attendance_date": date(2026, 10, 27), "created_at": STAMP, "status": "present", **changes}

    def leave_row(self, i, **changes):
        return {"id": f"l{i:04}", "organization_id": ORG, "employee_id": EMP, "leave_type_id": "leave-type",
                "start_date": date(2026, 10, 1) + timedelta(days=i * 3), "end_date": date(2026, 10, 2) + timedelta(days=i * 3),
                "created_at": STAMP, "days": Decimal("2.00"), "status": "pending", "review_notes": None, **changes}

    def assert_http(self, code, callback):
        with self.assertRaises(HTTPException) as caught:
            callback()
        self.assertEqual(caught.exception.status_code, code)
        return caught.exception

    def browse_all(self, handler, **filters):
        cursor, rows = None, []
        while True:
            query = dict(mode="page", limit=37, **filters)
            if cursor:
                query["cursor"] = cursor
            result = handler(self.db, self.tenant, req(**query))
            self.assertLessEqual(len(result["items"]), 37)
            rows.extend(result["items"])
            cursor = result["next_cursor"]
            if not cursor:
                return rows
            self.assertLess(len(rows), 1000)

    def test_legacy_attendance_exact_200_shape_order_and_ignored_new_parameters(self):
        self.seed(AttendanceRecord, [self.attendance_row(i, created_at=STAMP + timedelta(seconds=i)) for i in range(237)])
        plain = self.attendance(self.db, self.tenant)
        ignored = self.attendance(self.db, self.tenant, req(limit="invalid", status="absent", record_id="a0000", cursor="malformed"))
        self.assertEqual(plain, ignored)
        self.assertEqual(len(plain), 200)
        self.assertEqual([r["id"] for r in plain], [f"a{i:04}" for i in range(236, 36, -1)])
        self.assertEqual(set(plain[0]), {"id", "employee_id", "employee_name", "attendance_date", "status", "attendance_mode", "check_in_at", "check_out_at", "work_minutes", "overtime_minutes", "notes"})

    def test_legacy_leave_exact_200_shape_order_and_ignored_new_parameters(self):
        self.seed(LeaveRequest, [self.leave_row(i, created_at=STAMP + timedelta(seconds=i)) for i in range(237)])
        plain = self.leave(self.db, self.tenant)
        self.assertEqual(plain, self.leave(self.db, self.tenant, req(mode="legacy", limit="bad", record_id="l0000")))
        self.assertEqual(len(plain), 200)
        self.assertEqual([r["id"] for r in plain], [f"l{i:04}" for i in range(236, 36, -1)])
        self.assertEqual(set(plain[0]), {"id", "employee_id", "employee_name", "leave_type_id", "leave_type_name", "start_date", "end_date", "days", "reason", "status", "review_notes"})
        self.assertEqual(plain[0]["days"], "2.00")

    def test_paged_attendance_over_200_ties_have_no_duplicate_or_missing_ids(self):
        self.seed(AttendanceRecord, [self.attendance_row(i) for i in range(237)])
        rows = self.browse_all(self.attendance)
        self.assertEqual([r["id"] for r in rows], [f"a{i:04}" for i in reversed(range(237))])

    def test_paged_leave_over_200_ties_have_no_duplicate_or_missing_ids(self):
        self.seed(LeaveRequest, [self.leave_row(i) for i in range(237)])
        self.assertEqual([r["id"] for r in self.browse_all(self.leave)], [f"l{i:04}" for i in reversed(range(237))])

    def test_attendance_keyset_preserves_date_before_created_at_before_id(self):
        self.seed(AttendanceRecord, [self.attendance_row(1, created_at=STAMP + timedelta(days=1)), self.attendance_row(2, attendance_date=date(2026, 10, 28)), self.attendance_row(3, attendance_date=date(2026, 10, 28))])
        ids, cursor = [], None
        for _ in range(3):
            filters = dict(mode="page", limit=1)
            if cursor:
                filters["cursor"] = cursor
            page = self.attendance(self.db, self.tenant, req(**filters))
            ids.extend(row["id"] for row in page["items"])
            cursor = page["next_cursor"]
        self.assertEqual(ids, ["a0003", "a0002", "a0001"])
        self.assertIsNone(cursor)

    def test_older_pending_work_is_reachable_without_the_newest_200(self):
        self.seed(LeaveRequest, [self.leave_row(i, status="pending" if i == 0 else "approved", created_at=STAMP + timedelta(seconds=i)) for i in range(237)])
        self.assertNotIn("l0000", [r["id"] for r in self.leave(self.db, self.tenant)])
        self.assertEqual([r["id"] for r in self.browse_all(self.leave, status="pending")], ["l0000"])

    def test_record_selector_finds_old_rows_and_hides_other_tenant_ids(self):
        self.seed(AttendanceRecord, [self.attendance_row(1), self.attendance_row(2, organization_id=OTHER)])
        self.seed(LeaveRequest, [self.leave_row(1), self.leave_row(2, organization_id=OTHER)])
        for handler, prefix in ((self.attendance, "a"), (self.leave, "l")):
            with self.subTest(prefix=prefix):
                found = handler(self.db, self.tenant, req(mode="page", record_id=prefix + "0001"))
                self.assertEqual([r["id"] for r in found["items"]], [prefix + "0001"])
                self.assertIsNone(found["next_cursor"])
                self.assertEqual(handler(self.db, self.tenant, req(mode="page", record_id=prefix + "0002")), {"items": [], "next_cursor": None})

    def test_nullable_values_and_existing_fields_are_identical_to_legacy(self):
        self.seed(AttendanceRecord, [self.attendance_row(1, employee_id=EMP)])
        self.seed(LeaveRequest, [self.leave_row(1)])
        for handler in (self.attendance, self.leave):
            self.assertEqual(handler(self.db, self.tenant), handler(self.db, self.tenant, req(mode="page"))["items"])
        row = self.attendance(self.db, self.tenant)[0]
        for key in ("attendance_mode", "check_in_at", "check_out_at", "notes"):
            self.assertIsNone(row[key])
        self.assertEqual(row["employee_name"], "Synthetic person")

    def test_unknown_employee_or_leave_type_label_does_not_leak_foreign_names(self):
        self.seed(LeaveRequest, [self.leave_row(1, employee_id="unknown", leave_type_id="foreign-type")])
        row = self.leave(self.db, self.tenant, req(mode="page"))["items"][0]
        self.assertIsNone(row["employee_name"])
        self.assertIsNone(row["leave_type_name"])

    def test_attendance_date_bounds_are_inclusive_date_only(self):
        self.seed(AttendanceRecord, [self.attendance_row(i, attendance_date=date(2026, 10, 26) + timedelta(days=i)) for i in range(4)])
        rows = self.browse_all(self.attendance, date_from="2026-10-27", date_to="2026-10-28")
        self.assertEqual([r["id"] for r in rows], ["a0002", "a0001"])

    def test_leave_date_bounds_match_inclusive_overlap_not_creation_date(self):
        self.seed(LeaveRequest, [self.leave_row(1, start_date=date(2026, 9, 1), end_date=date(2026, 11, 1)), self.leave_row(2, start_date=date(2026, 10, 27), end_date=date(2026, 10, 27)), self.leave_row(3, start_date=date(2026, 10, 28), end_date=date(2026, 10, 29))])
        rows = self.browse_all(self.leave, date_from="2026-10-27", date_to="2026-10-27")
        self.assertEqual([r["id"] for r in rows], ["l0002", "l0001"])

    def test_employee_status_filter_and_tenant_scope_are_conjunctive(self):
        self.seed(AttendanceRecord, [self.attendance_row(1, employee_id=EMP), self.attendance_row(2, employee_id=EMP, status="absent", attendance_date=date(2026, 10, 26)), self.attendance_row(3, employee_id=EMP, organization_id=OTHER)])
        self.assertEqual([r["id"] for r in self.browse_all(self.attendance, employee_id=EMP, status="present")], ["a0001"])

    def test_cursor_cannot_be_reused_across_tenant_resource_or_filter_context(self):
        self.seed(AttendanceRecord, [self.attendance_row(i) for i in range(3)])
        cursor = self.attendance(self.db, self.tenant, req(mode="page", limit=1))["next_cursor"]
        for changes in ({"status": "absent"}, {"limit": 2}, {"date_from": "2026-10-27"}, {"employee_id": EMP}):
            self.assert_http(422, lambda: self.attendance(self.db, self.tenant, req(**dict(dict(mode="page", limit=1, cursor=cursor), **changes))))
        self.assert_http(422, lambda: self.leave(self.db, self.tenant, req(mode="page", limit=1, cursor=cursor)))
        self.assert_http(422, lambda: self.attendance(self.db, NS(organization_id=OTHER), req(mode="page", limit=1, cursor=cursor)))

    def test_malformed_and_changed_cursor_keys_fail_closed(self):
        self.seed(AttendanceRecord, [self.attendance_row(i) for i in range(2)])
        token = self.attendance(self.db, self.tenant, req(mode="page", limit=1))["next_cursor"]
        value = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
        mutations = [[], {**value, "v": True}, {**value, "extra": 1}, {**value, "key": {**value["key"], "id": []}}, {**value, "key": {**value["key"], "created_at": "2026-10-27T10:20:30"}}, {**value, "key": {**value["key"], "created_at": "0001-01-01T00:00:00+14:00"}}, {**value, "key": {**value["key"], "attendance_date": "20261027"}}]
        for bad in ["bad!", "x" * 4097] + [base64.urlsafe_b64encode(json.dumps(x).encode()).rstrip(b"=").decode() for x in mutations]:
            self.assert_http(422, lambda: self.attendance(self.db, self.tenant, req(mode="page", limit=1, cursor=bad)))

    def test_invalid_opt_in_filters_dates_limits_and_duplicates_are_422(self):
        for query in ({"limit": 0}, {"limit": 101}, {"limit": "1.0"}, {"date_from": "2026-10-28", "date_to": "2026-10-27"}, {"date_from": "2026-02-30"}, {"date_from": "2026-10-27T00:00:00Z"}, {"status": ""}, {"record_id": "a0001", "status": "pending"}, {"record_id": "a0001", "cursor": "x"}):
            self.assert_http(422, lambda: self.attendance(self.db, self.tenant, req(mode="page", **query)))
        self.assert_http(422, lambda: parse_time_page(QueryParams("limit=1&limit=2")))

    def test_deep_bounded_cursor_json_and_duplicate_keys_return_422(self):
        self.seed(AttendanceRecord, [self.attendance_row(i) for i in range(2)])
        token = self.attendance(self.db, self.tenant, req(mode="page", limit=1))["next_cursor"]
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode()
        duplicate_top = raw[:-1] + ',"v":1}'
        duplicate_nested = raw.replace('"id":"a0001"', '"id":"a0001","id":"a0001"')
        self.assertNotEqual(raw, duplicate_nested)
        for malformed in ("[" * 1200 + "]" * 1200, duplicate_top, duplicate_nested):
            encoded = base64.urlsafe_b64encode(malformed.encode()).rstrip(b"=").decode()
            self.assertLessEqual(len(encoded), 4096)
            self.assert_http(422, lambda: self.attendance(self.db, self.tenant, req(mode="page", limit=1, cursor=encoded)))

    def test_duplicate_mode_rejected_only_when_page_mode_selected(self):
        page_request = Request({"type": "http", "query_string": b"mode=legacy&mode=page", "headers": []})
        self.assert_http(422, lambda: self.attendance(self.db, self.tenant, page_request))
        legacy_request = Request({"type": "http", "query_string": b"mode=page&mode=legacy&limit=invalid", "headers": []})
        self.assertEqual(self.attendance(self.db, self.tenant, legacy_request), [])

    def test_cursor_and_new_filter_ids_reject_surrogate_and_nul_not_non_uuid_ids(self):
        self.seed(AttendanceRecord, [self.attendance_row(i) for i in range(2)])
        token = self.attendance(self.db, self.tenant, req(mode="page", limit=1))["next_cursor"]
        value = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
        for bad in ("\ud800", "\x00"):
            value["key"]["id"] = bad
            encoded = base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()
            self.assert_http(422, lambda: self.attendance(self.db, self.tenant, req(mode="page", limit=1, cursor=encoded)))
            for field in ("employee_id", "record_id", "status"):
                self.assert_http(422, lambda: parse_time_page(QueryParams({field: bad})))
        self.assertEqual(TimePageQuery(record_id="synthetic-non-uuid").record_id, "synthetic-non-uuid")

    def test_empty_and_single_pages_do_not_fabricate_cursor_or_count(self):
        self.assertEqual(self.attendance(self.db, self.tenant, req(mode="page")), {"items": [], "next_cursor": None})
        self.seed(LeaveRequest, [self.leave_row(1)])
        page = self.leave(self.db, self.tenant, req(mode="page", limit=1))
        self.assertEqual(set(page), {"items", "next_cursor"})
        self.assertIsNone(page["next_cursor"])

    def test_reads_do_not_write_or_audit(self):
        self.seed(LeaveRequest, [self.leave_row(1)])
        self.leave(self.db, self.tenant, req(mode="page"))
        self.attendance(self.db, self.tenant, req(mode="page"))
        self.assertEqual(self.db.commit_count, 0)
        self.assertFalse(self.db.new or self.db.dirty or self.db.deleted)
        self.audit.assert_not_called()

    def test_expected_status_mismatch_409_no_audit_commit_or_changed_fields(self):
        self.seed(LeaveRequest, [self.leave_row(1, status="approved", review_notes="kept"), self.leave_row(2, start_date=date(2026, 10, 4), end_date=date(2026, 10, 5))])
        error = self.assert_http(409, lambda: self.review("l0001", LeaveReview(status="approved", expected_status="pending"), None, self.db, self.tenant))
        self.assertEqual(error.detail, "Leave status changed; reload before reviewing")
        row = self.db.get(LeaveRequest, "l0001")
        self.assertEqual((row.status, row.review_notes, row.reviewed_at), ("approved", "kept", None))
        self.assertEqual(self.db.commit_count, 0)
        self.audit.assert_not_called()
        self.assertFalse(self.db.dirty)

    def test_expected_status_is_checked_after_actual_locked_identity_refresh(self):
        self.seed(LeaveRequest, [self.leave_row(1)])
        stale = self.db.get(LeaveRequest, "l0001")
        self.db.connection().execute(update(LeaveRequest.__table__).where(LeaveRequest.id == "l0001").values(status="rejected"))
        self.assertEqual(stale.status, "pending")
        self.assert_http(409, lambda: self.review("l0001", LeaveReview(status="approved", expected_status="pending"), None, self.db, self.tenant))
        self.assertEqual(stale.status, "rejected")
        self.assertEqual(len(self.db.lock_reads), 2)
        self.assertIn("FOR UPDATE", str(self.db.lock_reads[-1].compile(dialect=postgresql.dialect())))
        self.assertTrue(self.db.lock_reads[-1].get_execution_options()["populate_existing"])
        self.audit.assert_not_called()

    def test_legacy_no_precondition_still_allows_correction_of_nonpending_status(self):
        self.seed(LeaveRequest, [self.leave_row(1, status="approved")])
        result = self.review("l0001", LeaveReview(status="rejected", review_notes="Synthetic correction"), None, self.db, self.tenant)
        self.assertEqual(result, {"id": "l0001", "status": "rejected"})
        self.assertEqual(self.db.commit_count, 1)
        audit = self.db.scalar(select(ActivityLog))
        self.assertEqual((audit.action, audit.entity_id, audit.organization_id), ("hr.leave.reviewed", "l0001", ORG))
        self.assertEqual(audit.after_data, {"status": "rejected"})

    def test_matching_expected_status_retains_approved_and_cancelled_lifecycle(self):
        self.seed(LeaveRequest, [self.leave_row(1), self.leave_row(2, status="approved")])
        first = self.review("l0001", LeaveReview(status="approved", expected_status="pending"), None, self.db, self.tenant)
        second = self.review("l0002", LeaveReview(status="cancelled", expected_status="approved"), None, self.db, self.tenant)
        self.assertEqual((first["status"], second["status"]), ("approved", "cancelled"))
        self.assertEqual(self.db.scalar(select(func.count(ActivityLog.id))), 2)

    def test_explicit_null_precondition_retains_legacy_behavior(self):
        self.seed(LeaveRequest, [self.leave_row(1, status="cancelled")])
        self.assertEqual(self.review("l0001", LeaveReview(status="rejected", expected_status=None), None, self.db, self.tenant)["status"], "rejected")

    def test_review_foreign_or_missing_id_is_404_without_lock_or_write(self):
        self.seed(LeaveRequest, [self.leave_row(1, organization_id=OTHER)])
        for key in ("l0001", "missing"):
            self.assert_http(404, lambda: self.review(key, LeaveReview(status="approved", expected_status="pending"), None, self.db, self.tenant))
        self.assertFalse(self.db.lock_reads)
        self.assertEqual(self.db.commit_count, 0)
        self.audit.assert_not_called()

    def test_unsupported_target_and_approval_overlap_behavior_unchanged(self):
        self.seed(LeaveRequest, [self.leave_row(1), self.leave_row(2, start_date=date(2026, 10, 4), end_date=date(2026, 10, 5), status="approved")])
        self.assert_http(400, lambda: self.review("l0001", LeaveReview(status="pending"), None, self.db, self.tenant))
        self.assert_http(409, lambda: self.review("l0001", LeaveReview(status="approved", expected_status="pending"), None, self.db, self.tenant))
        self.audit.assert_not_called()
        self.assertEqual(self.db.commit_count, 0)

    def test_actual_audit_guard_remains_enabled_for_missing_audit(self):
        self.seed(LeaveRequest, [self.leave_row(1)])
        self.audit.side_effect = lambda *_args, **_kwargs: None
        with self.assertRaisesRegex(RuntimeError, "Audit guard"):
            self.review("l0001", LeaveReview(status="rejected"), None, self.db, self.tenant)
        self.db.rollback()
        self.assertEqual(self.db.get(LeaveRequest, "l0001").status, "pending")

    def test_legacy_handler_bodies_are_exact_after_only_removing_opt_in_branch(self):
        tree = ast.parse((ROOT / "app/api/v1/hr.py").read_text())
        for name, expected in LEGACY_HASHES.items():
            node = copy.deepcopy(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name))
            node.args.args.pop()
            node.args.defaults.pop()
            node.body = [n for n in node.body if not (isinstance(n, ast.If) and "query_params" in ast.dump(n.test))]
            self.assertEqual(legacy_ast_hash(node), expected)

    def test_ast_representation_adapter_does_not_ignore_body_or_generic_changes(self):
        node = ast.parse("def synthetic():\n    return 1\n").body[0]
        original = legacy_ast_hash(node)
        changed = copy.deepcopy(node)
        changed.body.append(ast.Pass())
        self.assertNotEqual(legacy_ast_hash(changed), original)
        if "type_params" not in node._fields:
            node._fields = (*node._fields, "type_params")
        node.type_params = []
        self.assertEqual(legacy_ast_hash(node), original)
        node.type_params = [ast.Name(id="SyntheticGeneric", ctx=ast.Load())]
        self.assertNotEqual(legacy_ast_hash(node), original)

    def test_route_permissions_and_schema_import_alias_stay_exact(self):
        source = (ROOT / "app/api/v1/hr.py").read_text()
        self.assertIn('HRViewer = Annotated[TenantContext, Depends(require_tenant_permission("hr.view"))]', source)
        self.assertIn('HRManager = Annotated[TenantContext, Depends(require_tenant_permission("hr.manage"))]', source)
        self.assertIn("from app.schemas.hr_time import LeaveReview", source)
        tree = ast.parse(source)
        for name, kind in (("list_attendance", "HRViewer"), ("list_leave_requests", "HRViewer"), ("review_leave", "HRManager")):
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual(next(a.annotation.id for a in node.args.args if a.arg == "tenant"), kind)

    def test_fastapi_signature_injects_request_not_a_body_and_json_fields_remain_compatible(self):
        context = {"DbSession": Annotated[Session, Depends(lambda: self.db)],
                   "HRViewer": Annotated[NS, Depends(lambda: self.tenant)], "Request": Request}
        for name in ("list_attendance", "list_leave_requests"):
            function = actual_function("app/api/v1/hr.py", name, context)
            dependency = get_dependant(path="/synthetic", call=function)
            self.assertEqual(dependency.request_param_name, "request")
            self.assertEqual(len(dependency.dependencies), 2)
            self.assertFalse(dependency.body_params)
        self.seed(LeaveRequest, [self.leave_row(1)])
        encoded = jsonable_encoder(self.leave(self.db, self.tenant, req(mode="page")))
        self.assertEqual(encoded["items"][0]["days"], "2.00")
        self.assertEqual(encoded["items"][0]["start_date"], "2026-10-04")

    def test_expected_status_schema_is_optional_but_not_empty_or_oversized(self):
        self.assertIsNone(LeaveReview(status="approved").expected_status)
        for value in ("", "x" * 25):
            with self.assertRaises(ValidationError):
                LeaveReview(status="approved", expected_status=value)


if __name__ == "__main__":
    unittest.main()
