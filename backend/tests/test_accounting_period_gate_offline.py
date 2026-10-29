"""Isolated source/transaction contract tests; NOT PostgreSQL concurrency proof.

Standard library only. Load the actual helper with explicit dependency stubs;
compile selected actual Controls functions without importing their module.
No app config, .env, database driver, socket, server, provider or service is loaded.
"""
import ast
from contextlib import nullcontext
from datetime import date, datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "app/services/accounting_period_gate.py"
CONTROLS = ROOT / "app/api/v1/finance_controls.py"
SAFETY = ROOT / "app/services/finance_controls_safety.py"
TODAY = date(2026, 10, 27)
START, END = date(2026, 8, 1), date(2026, 8, 31)


def canonical_ast_dump(node):
    """Preserve the pinned structural dump across 3.12/3.13 display defaults.

    Python 3.13 ast.dump defaults omit empty lists; our immutable fixture was
    created with 3.12's explicit lists. Emit every present field consistently.
    Only the known version-added type_params field may normalize absent to [].
    Nonempty/new fields, bodies, signatures, routes and list ordering are kept.
    """
    if isinstance(node, ast.AST):
        fields = list(ast.iter_fields(node))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not hasattr(node, "type_params"):
            fields.append(("type_params", []))
        values = [
            f"{name}={canonical_ast_dump(value)}" for name, value in fields
            if not (value is None and getattr(type(node), name, ...) is None)
        ]
        return f"{type(node).__name__}({', '.join(values)})"
    if isinstance(node, list):
        return f"[{', '.join(canonical_ast_dump(value) for value in node)}]"
    return repr(node)


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


class Field:
    def __init__(self, name): self.name = name
    def __eq__(self, value): return (self.name, "==", value)
    def __le__(self, value): return (self.name, "<=", value)
    def __ge__(self, value): return (self.name, ">=", value)


class AccountingPeriod:
    id = Field("id")
    organization_id = Field("organization_id")
    status = Field("status")
    start_date = Field("start_date")
    end_date = Field("end_date")

    def __init__(self, **values):
        self.__dict__.update(values)
        if "id" not in values: self.id = "new-period"


class Query:
    def __init__(self, target):
        self.target, self.predicates, self.locked, self.options = target, [], False, {}
    def where(self, *predicates): self.predicates.extend(predicates); return self
    def with_for_update(self): self.locked = True; return self
    def execution_options(self, **options): self.options.update(options); return self


def module(name, **attributes):
    result = ModuleType(name)
    result.__dict__.update(attributes)
    return result


def load_helper():
    name = "period_gate_source_under_test"
    spec = importlib.util.spec_from_file_location(name, HELPER)
    loaded = importlib.util.module_from_spec(spec)
    stubs = {
        name: loaded,
        "sqlalchemy": module("sqlalchemy", select=Query, text=lambda value: value),
        "fastapi": module("fastapi", HTTPException=HTTPException),
        "app": module("app", __path__=[]),
        "app.models": module("app.models", __path__=[]),
        "app.models.finance_controls": module("app.models.finance_controls", AccountingPeriod=AccountingPeriod),
    }
    with patch.dict(sys.modules, stubs):
        spec.loader.exec_module(loaded)
    return loaded


gate = load_helper()


class Tx:
    def __init__(self): self.is_active = True


class Connection:
    def __init__(self, db):
        self.db, self.closed, self.invalidated = db, False, False
        self.dialect = NS(name="postgresql")
        self.connection = NS(driver_connection=NS(autocommit=False))
        self.transaction = Tx()
        self.isolation = "READ COMMITTED"
        self.isolation_hook = None
    def get_transaction(self): return self.transaction
    def get_isolation_level(self):
        self.db.events.append("isolation")
        if self.isolation_hook: self.isolation_hook()
        return self.isolation


class DB:
    def __init__(self, *, rows=(), values=()):
        self.info, self.events, self.sql, self.queries, self.added = {}, [], [], [], []
        self.transaction, self.nested, self.is_active = Tx(), None, True
        self.conn = Connection(self)
        self.rows, self.values = list(rows), list(values)
        self.execute_error, self.execute_hook, self.commit_error, self.audit_error = None, None, None, None
        self.defer_depth = 0
        self.commits = self.rollbacks = self.begins = 0
    def get_transaction(self): return self.transaction
    def get_nested_transaction(self): return self.nested
    def connection(self):
        if self.transaction is None:
            self.begins += 1
            raise AssertionError("Helper attempted implicit begin")
        self.events.append("connection")
        return self.conn
    def execute(self, statement, params):
        self.events.append("gate")
        self.sql.append((str(statement), params.copy()))
        if self.execute_hook: self.execute_hook()
        if self.execute_error: raise self.execute_error
    def scalar(self, query):
        self.events.append("select"); self.queries.append(query)
        if self.values: return self.values.pop(0)
        for row in self.rows:
            matches = []
            for name, operator, expected in query.predicates:
                value = getattr(row, name)
                matches.append(value == expected if operator == "==" else value <= expected if operator == "<=" else value >= expected)
            if all(matches): return row.id if isinstance(query.target, Field) else row
        return None
    def add(self, item): self.events.append("add"); self.added.append(item)
    def flush(self): self.events.append("flush")
    def refresh(self, item): self.events.append("refresh")
    def finish(self):
        if self.transaction is not None: self.transaction.is_active = False
        if self.conn.transaction is not None: self.conn.transaction.is_active = False
        self.transaction = self.conn.transaction = None
        self.nested = None
    def commit(self):
        if self.defer_depth:
            self.flush(); return
        self.events.append("commit"); self.commits += 1
        self.finish()
        if self.commit_error: raise self.commit_error
    def rollback(self):
        self.events.append("rollback"); self.rollbacks += 1; self.finish()
    def begin(self):
        self.events.append("begin"); self.begins += 1
        self.transaction, self.conn.transaction, self.is_active = Tx(), Tx(), True


def period(**changes):
    values = dict(id="period-a", organization_id="org-a", name="August", status="open", start_date=START, end_date=END)
    return AccountingPeriod(**(values | changes))


def record_activity(db, **kwargs):
    db.events.append("audit")
    db.last_audit = kwargs
    if db.audit_error: raise db.audit_error


def read_model(item, **kwargs): return item


def load_controls():
    tree = ast.parse(CONTROLS.read_text())
    names = {"create_accounting_period", "close_accounting_period", "reopen_accounting_period", "_ensure_open_period", "post_recurring_expense"}
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    for node in functions: node.decorator_list = []
    compatibility = next(node for node in ast.parse(SAFETY.read_text()).body if isinstance(node, ast.FunctionDef) and node.name == "lock_accounting_period_creation")
    extracted = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), compatibility, *functions], type_ignores=[])
    namespace = dict(
        acquire_accounting_period_gate=gate.acquire_accounting_period_gate,
        ensure_accounting_period_open=gate.ensure_accounting_period_open,
        HTTPException=HTTPException, select=Query, AccountingPeriod=AccountingPeriod,
        AccountingPeriodRead=NS(model_validate=read_model), record_activity=record_activity,
        datetime=datetime, timezone=timezone, _tenant_today=lambda tz: TODAY,
        _clean=lambda value: value.strip() if value and value.strip() else None,
        _load_recurring_item=lambda db, organization_id, recurring_id, *, lock: db.load_recurring(organization_id, recurring_id, lock=lock),
    )
    exec(compile(ast.fix_missing_locations(extracted), str(CONTROLS), "exec"), namespace)
    return NS(**{name: namespace[name] for name in names | {"lock_accounting_period_creation"}})


controls = load_controls()


class GateTests(unittest.TestCase):
    def acquired(self, *, exclusive=False):
        db = DB(); gate.acquire_accounting_period_gate(db, "org-a", exclusive=exclusive); return db
    def reject(self, db, *, exclusive=False, organization="org-a", expected=None):
        with self.assertRaises(gate.AccountingPeriodGateError) as caught:
            gate.acquire_accounting_period_gate(db, organization, exclusive=exclusive)
        if expected: self.assertIn(expected, str(caught.exception))
        return caught.exception
    def test_preserves_exact_namespace_signed_key_and_modes(self):
        expected = int.from_bytes(hashlib.sha256(b"business-os:period-create:v1:org-a").digest()[:8], "big", signed=True)
        shared, exclusive = self.acquired(), self.acquired(exclusive=True)
        self.assertEqual(shared.sql, [("SELECT pg_advisory_xact_lock_shared(:lock_key)", {"lock_key": expected})])
        self.assertEqual(exclusive.sql, [("SELECT pg_advisory_xact_lock(:lock_key)", {"lock_key": expected})])
        self.assertTrue(-(2**63) <= expected < 2**63)
        self.assertNotEqual(expected, gate.accounting_period_gate_key("org-b"))
    def test_same_root_reentry_no_second_sql_or_isolation_check(self):
        db = self.acquired()
        gate.acquire_accounting_period_gate(db, "org-a")
        gate.require_accounting_period_gate(db, "org-a")
        self.assertEqual(len(db.sql), 1); self.assertEqual(db.events.count("isolation"), 1)
        self.assertEqual((db.commits, db.rollbacks, db.begins), (0, 0, 0))
    def test_exclusive_satisfies_nested_shared_without_downgrade(self):
        db = self.acquired(exclusive=True); db.nested = Tx()
        gate.acquire_accounting_period_gate(db, "org-a")
        gate.require_accounting_period_gate(db, "org-a", exclusive=True)
        self.assertEqual(len(db.sql), 1)
    def test_shared_to_exclusive_upgrade_rejected_without_sql(self):
        db = self.acquired(); self.reject(db, exclusive=True, expected="cannot upgrade")
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a", exclusive=True)
        self.assertEqual(len(db.sql), 1)
    def test_second_tenant_rejected_without_sql(self):
        db = self.acquired(); self.reject(db, organization="org-b", expected="one tenant")
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-b")
        self.assertEqual(len(db.sql), 1)
    def test_missing_root_does_not_begin(self):
        db = DB(); db.transaction = None; self.reject(db, expected="active root")
        self.assertFalse(db.events); self.assertEqual(db.begins, 0)
    def test_inactive_root_or_partial_rollback_rejected(self):
        for condition in ("root", "session"):
            with self.subTest(condition=condition):
                db = self.acquired()
                if condition == "root": db.transaction.is_active = False
                else: db.is_active = False
                self.reject(db)
                with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
                self.assertEqual(len(db.sql), 1)
    def test_commit_then_same_session_requires_new_acquisition(self):
        db = self.acquired(); root = db.transaction; db.commit(); db.begin()
        self.assertIsNot(db.transaction, root)
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
        gate.acquire_accounting_period_gate(db, "org-a"); self.assertEqual(len(db.sql), 2)
    def test_rollback_then_same_session_requires_new_acquisition(self):
        db = self.acquired(); db.rollback(); db.begin()
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
        gate.acquire_accounting_period_gate(db, "org-b", exclusive=True); self.assertEqual(len(db.sql), 2)
    def test_root_identity_change_without_info_cleanup_not_reused(self):
        db = self.acquired(); db.transaction, db.conn.transaction = Tx(), Tx()
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
        gate.acquire_accounting_period_gate(db, "org-a"); self.assertEqual(len(db.sql), 2)
    def test_failed_lock_sql_never_grants_ownership_or_rolls_back(self):
        db = DB(); error = RuntimeError("synthetic lock failure"); db.execute_error = error
        with self.assertRaises(RuntimeError) as caught: gate.acquire_accounting_period_gate(db, "org-a")
        self.assertIs(caught.exception, error)
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
        self.assertFalse(db.info); self.assertEqual((db.commits, db.rollbacks), (0, 0))
    def test_transaction_changes_during_lock_never_grant_ownership(self):
        for hook in (lambda db: setattr(db, "transaction", Tx()), lambda db: db.finish(), lambda db: setattr(db.conn, "transaction", Tx()), lambda db: setattr(db, "nested", Tx())):
            with self.subTest(hook=hook):
                db = DB(); db.execute_hook = lambda: hook(db)
                self.reject(db); self.assertFalse(db.info); self.assertEqual(db.begins, 0)
    def test_transaction_changes_during_isolation_prevents_lock_sql(self):
        db = DB(); db.conn.isolation_hook = lambda: setattr(db, "transaction", Tx())
        self.reject(db); self.assertFalse(db.sql); self.assertFalse(db.info)
    def test_invalid_connection_and_connection_transaction_rejected(self):
        for change in (lambda c: setattr(c, "closed", True), lambda c: setattr(c, "invalidated", True), lambda c: setattr(c, "transaction", None), lambda c: setattr(c.transaction, "is_active", False)):
            with self.subTest(change=change):
                db = DB(); change(db.conn); self.reject(db); self.assertFalse(db.sql)
    def test_connection_identity_or_root_changed_invalidates_existing_claim(self):
        for change in (lambda db: setattr(db, "conn", Connection(db)), lambda db: setattr(db.conn, "transaction", Tx()), lambda db: setattr(db.conn, "invalidated", True)):
            with self.subTest(change=change):
                db = self.acquired(); change(db)
                with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
                self.assertEqual(len(db.sql), 1)
    def test_fresh_savepoint_acquisition_rejected_before_connection_or_sql(self):
        db = DB(); db.nested = Tx(); self.reject(db, expected="before entering a savepoint")
        self.assertFalse(db.events); self.assertFalse(db.info)
    def test_root_held_gate_survives_nested_rollback(self):
        db = self.acquired(); root = db.transaction; db.nested = Tx()
        gate.require_accounting_period_gate(db, "org-a")
        db.nested.is_active = False; db.nested = None
        gate.require_accounting_period_gate(db, "org-a")
        self.assertIs(db.transaction, root); self.assertEqual(len(db.sql), 1)
    def test_savepoint_attempt_never_leaves_ownership_after_nested_rollback(self):
        db = DB(); db.nested = Tx(); self.reject(db); db.nested = None
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
        gate.acquire_accounting_period_gate(db, "org-a"); self.assertEqual(len(db.sql), 1)
    def test_deferred_commit_flush_preserves_root_gate_real_commit_releases(self):
        db = self.acquired(); db.defer_depth = 1; root = db.transaction; db.commit()
        self.assertIs(db.transaction, root); gate.require_accounting_period_gate(db, "org-a")
        db.defer_depth = 0; db.commit()
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
        self.assertEqual(db.commits, 1)
    def test_unknown_commit_failure_does_not_retry_or_grant_next_transaction(self):
        db = self.acquired(); db.commit_error = RuntimeError("synthetic uncertain commit")
        with self.assertRaises(RuntimeError): db.commit()
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
        self.assertEqual(len(db.sql), 1); self.assertEqual(db.commits, 1); self.assertEqual(db.rollbacks, 0)
    def test_require_never_acquires_missing_gate(self):
        db = DB()
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
        self.assertFalse(db.events); self.assertFalse(db.sql)
    def test_non_postgresql_rejected_before_isolation_and_lock(self):
        db = DB(); db.conn.dialect.name = "sqlite"; self.reject(db, expected="PostgreSQL")
        self.assertFalse(db.sql); self.assertNotIn("isolation", db.events)
    def test_unsupported_isolation_rejected_no_settings_change_or_lock(self):
        for isolation in ("REPEATABLE READ", "SERIALIZABLE", "READ UNCOMMITTED", None):
            with self.subTest(isolation=isolation):
                db = DB(); db.conn.isolation = isolation; self.reject(db, expected="READ COMMITTED")
                self.assertFalse(db.sql); self.assertEqual(db.conn.isolation, isolation)
    def test_autocommit_true_missing_unknown_rejected_even_if_rc(self):
        for value in (True, None, 0, "false"):
            with self.subTest(value=value):
                db = DB(); db.conn.connection.driver_connection.autocommit = value
                self.reject(db, expected="autocommit disabled"); self.assertFalse(db.sql)
        db = DB(); db.conn.connection = NS(); self.reject(db, expected="autocommit disabled")
    def test_driver_autocommit_change_invalidates_existing_claim(self):
        db = self.acquired(); db.conn.connection.driver_connection.autocommit = True
        with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
    def test_invalid_mode_and_tenant_rejected_before_any_connection(self):
        for tenant in (None, "", 123):
            db = DB(); self.reject(db, organization=tenant); self.assertFalse(db.events)
        db = DB(); self.reject(db, exclusive="shared"); self.assertFalse(db.events)
    def test_inclusive_dates_scoped_status_and_absent_period(self):
        for effect_date, rejected in ((START, True), (END, True), (date(2026, 7, 31), False), (date(2026, 9, 1), False)):
            with self.subTest(effect_date=effect_date):
                db = self.acquired(); db.rows = [period(status="closed")]
                if rejected:
                    with self.assertRaises(HTTPException) as caught: gate.ensure_accounting_period_open(db, "org-a", effect_date)
                    self.assertEqual(caught.exception.status_code, 409)
                    self.assertEqual(caught.exception.detail, f"Accounting period is closed for {effect_date.isoformat()}")
                else: gate.ensure_accounting_period_open(db, "org-a", effect_date)
                self.assertEqual(db.queries[0].predicates, [("organization_id", "==", "org-a"), ("status", "==", "closed"), ("start_date", "<=", effect_date), ("end_date", ">=", effect_date)])
                self.assertFalse(db.queries[0].locked)
        for rows in ([], [period(status="open")], [period(organization_id="org-b", status="closed")]):
            db = self.acquired(); db.rows = rows; gate.ensure_accounting_period_open(db, "org-a", START)
    def test_custom_detail_and_exclusive_gate_validates(self):
        db = self.acquired(exclusive=True); db.rows = [period(status="closed")]
        with self.assertRaises(HTTPException) as caught: gate.ensure_accounting_period_open(db, "org-a", START, detail="Existing transition message")
        self.assertEqual(caught.exception.detail, "Existing transition message"); self.assertEqual(caught.exception.status_code, 409)
    def test_date_validation_without_gate_or_wrong_tenant_does_not_query(self):
        db = DB()
        with self.assertRaises(gate.AccountingPeriodGateError): gate.ensure_accounting_period_open(db, "org-a", START)
        gate.acquire_accounting_period_gate(db, "org-a")
        with self.assertRaises(gate.AccountingPeriodGateError): gate.ensure_accounting_period_open(db, "org-b", START)
        self.assertFalse(db.queries)


class ControlsTests(unittest.TestCase):
    tenant = NS(organization_id="org-a", user_id="actor-a", organization=NS(timezone="UTC"))
    def create(self, db, **changes):
        payload = NS(**(dict(name=" August ", start_date=START, end_date=END) | changes))
        return controls.create_accounting_period(payload, None, db, self.tenant)
    def close(self, db): return controls.close_accounting_period("period-a", NS(notes=" reviewed "), None, db, self.tenant)
    def reopen(self, db): return controls.reopen_accounting_period("period-a", NS(reason=" reviewed reopening "), None, db, self.tenant)
    def test_creation_alias_signature_and_exclusive_key_preserved(self):
        db = DB(); controls.lock_accounting_period_creation(db, "org-a")
        self.assertIn("pg_advisory_xact_lock(:lock_key)", db.sql[0][0]); self.assertEqual(db.commits, 0)
    def test_create_empty_range_gate_before_overlap_add_flush_audit_one_commit(self):
        db = DB(); row = self.create(db)
        filtered = [e for e in db.events if e != "connection"]
        self.assertEqual(filtered, ["isolation", "gate", "select", "add", "flush", "audit", "commit", "refresh"])
        self.assertEqual((row.status, row.name), ("open", "August")); self.assertEqual(db.commits, 1)
        self.assertEqual(db.queries[0].predicates, [("organization_id", "==", "org-a"), ("start_date", "<=", END), ("end_date", ">=", START)])
    def test_invalid_create_range_before_gate(self):
        db = DB()
        with self.assertRaises(HTTPException) as caught: self.create(db, start_date=END, end_date=START)
        self.assertEqual((caught.exception.status_code, caught.exception.detail), (400, "Period end date cannot be before start date")); self.assertFalse(db.events)
    def test_overlap_rejected_after_gate_with_no_mutations(self):
        db = DB(rows=[period()])
        with self.assertRaises(HTTPException) as caught: self.create(db)
        self.assertEqual((caught.exception.status_code, caught.exception.detail), (409, "Accounting periods cannot overlap"))
        self.assertLess(db.events.index("gate"), db.events.index("select")); self.assertFalse(db.added); self.assertEqual(db.commits, 0)
    def test_close_gate_before_tenant_row_lock_refresh_and_mutation(self):
        row = period(); db = DB(rows=[row]); result = self.close(db)
        self.assertIs(result, row); self.assertEqual(row.status, "closed"); self.assertEqual(row.close_notes, "reviewed")
        self.assertEqual(row.closed_by_user_id, "actor-a"); self.assertIsNotNone(row.closed_at)
        q = db.queries[0]; self.assertTrue(q.locked); self.assertEqual(q.options, {"populate_existing": True})
        self.assertEqual(q.predicates, [("id", "==", "period-a"), ("organization_id", "==", "org-a")])
        self.assertLess(db.events.index("gate"), db.events.index("select")); self.assertEqual(db.commits, 1)
        self.assertEqual(db.last_audit["action"], "finance.accounting_period.closed")
    def test_reopen_gate_before_refreshed_row_and_one_commit(self):
        row = period(status="closed"); db = DB(rows=[row]); self.reopen(db)
        self.assertEqual((row.status, row.reopen_reason, row.reopened_by_user_id), ("open", "reviewed reopening", "actor-a"))
        self.assertTrue(db.queries[0].locked); self.assertEqual(db.queries[0].options, {"populate_existing": True})
        self.assertLess(db.events.index("gate"), db.events.index("select")); self.assertEqual(db.commits, 1)
        self.assertEqual(db.last_audit["action"], "finance.accounting_period.reopened")
    def test_close_rejections_preserve_status_errors_without_writes(self):
        cases = [([], 404, "Accounting period not found"), ([period(organization_id="org-b")], 404, "Accounting period not found"), ([period(status="closed")], 409, "Accounting period is already closed"), ([period(end_date=date(2026, 10, 28))], 409, "Future accounting periods cannot be closed")]
        for rows, code, detail in cases:
            with self.subTest(detail=detail):
                db = DB(rows=rows)
                with self.assertRaises(HTTPException) as caught: self.close(db)
                self.assertEqual((caught.exception.status_code, caught.exception.detail), (code, detail))
                self.assertFalse(any(e in db.events for e in ("add", "flush", "audit", "commit")))
    def test_reopen_missing_wrong_tenant_and_nonclosed_preserve_errors(self):
        for rows, code, detail in [([], 404, "Accounting period not found"), ([period(organization_id="org-b", status="closed")], 404, "Accounting period not found"), ([period()], 409, "Only closed accounting periods can be reopened")]:
            db = DB(rows=rows)
            with self.assertRaises(HTTPException) as caught: self.reopen(db)
            self.assertEqual((caught.exception.status_code, caught.exception.detail), (code, detail)); self.assertEqual(db.commits, 0)
    def test_invalid_runtime_and_lock_failure_block_all_handlers_before_queries_or_writes(self):
        for action in (self.create, self.close, self.reopen):
            for invalid in ("isolation", "autocommit", "lock"):
                with self.subTest(action=action.__name__, invalid=invalid):
                    db = DB(rows=[period()])
                    if invalid == "isolation": db.conn.isolation = "SERIALIZABLE"
                    if invalid == "autocommit": db.conn.connection.driver_connection.autocommit = True
                    if invalid == "lock": db.execute_error = RuntimeError("synthetic lock failure")
                    with self.assertRaises(RuntimeError): action(db)
                    self.assertFalse(db.queries); self.assertFalse(db.added); self.assertEqual(db.commits, 0)
                    self.assertFalse(any(e in db.events for e in ("flush", "audit", "commit")))
    def test_audit_failure_never_causes_helper_commit_or_rollback(self):
        for action, rows in ((self.create, []), (self.close, [period()]), (self.reopen, [period(status="closed")])):
            db = DB(rows=rows); db.audit_error = RuntimeError("synthetic audit failure")
            with self.assertRaises(RuntimeError): action(db)
            self.assertEqual((db.commits, db.rollbacks), (0, 0))
            gate.require_accounting_period_gate(db, "org-a", exclusive=True)
    def test_unknown_handler_commit_failure_not_retried_or_refreshed(self):
        db = DB(rows=[period()]); db.commit_error = RuntimeError("synthetic commit acknowledgement lost")
        with self.assertRaises(RuntimeError): self.close(db)
        self.assertEqual(db.commits, 1); self.assertNotIn("refresh", db.events); self.assertEqual(db.rollbacks, 0)


class SourceContractTests(unittest.TestCase):
    def test_existing_controls_fake_adapter_has_strict_root_lifecycle(self):
        source = ROOT / "tests/test_controls_safety_unit.py"
        definition = next(n for n in ast.parse(source.read_text()).body if isinstance(n, ast.ClassDef) and n.name == "DB")
        namespace = dict(NS=NS, postgresql=NS(dialect=lambda: None), Rows=lambda values: values)
        exec(compile(ast.Module(body=[definition], type_ignores=[]), str(source), "exec"), namespace)
        class Statement(str):
            params = {}
            def compile(self, **kwargs): return self
            def get_execution_options(self): return {}
        db = namespace["DB"]()
        with patch.object(gate, "text", Statement):
            root = db.get_transaction()
            gate.acquire_accounting_period_gate(db, "org-a", exclusive=True)
            self.assertIs(db.get_transaction(), root)
            gate.require_accounting_period_gate(db, "org-a")
            db.commit()
            with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
            with self.assertRaises(AssertionError): db.connection()
            db.execute(Statement("synthetic next-operation query"))
            self.assertIsNot(db.get_transaction(), root)
            gate.acquire_accounting_period_gate(db, "org-a")
            db.rollback()
            with self.assertRaises(gate.AccountingPeriodGateError): gate.require_accounting_period_gate(db, "org-a")
    def test_controls_public_signatures_routes_and_other_functions_unchanged(self):
        baseline = json.loads((ROOT / "tests/fixtures/period_gate_baseline_contract.json").read_text())
        functions = {n.name: n for n in ast.parse(CONTROLS.read_text()).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        for name, expected in baseline["public_contract"].items():
            f = functions[name]
            self.assertEqual({"args": canonical_ast_dump(f.args), "returns": canonical_ast_dump(f.returns) if f.returns else None, "decorators": [canonical_ast_dump(d) for d in f.decorator_list]}, expected)
        for name, expected in baseline["unchanged_function_ast_sha256"].items():
            self.assertEqual(hashlib.sha256(canonical_ast_dump(functions[name]).encode()).hexdigest(), expected, name)
    def test_helper_has_no_transaction_boundary_mutators_or_settings_changes(self):
        tree = ast.parse(HELPER.read_text())
        forbidden = {"begin", "begin_nested", "commit", "rollback", "close", "execution_options", "set_isolation_level"}
        for call in (n for n in ast.walk(tree) if isinstance(n, ast.Call)):
            if isinstance(call.func, ast.Attribute): self.assertNotIn(call.func.attr, forbidden)
        self.assertIn("not a global", HELPER.read_text()); self.assertIn("not a global", SAFETY.read_text())
    def test_controls_imports_correct_helper_and_canonical_is_not_unadopted_fallback(self):
        tree = ast.parse(CONTROLS.read_text())
        imported = [n for n in tree.body if isinstance(n, ast.ImportFrom) and n.module == "app.services.accounting_period_gate"]
        self.assertEqual([[a.name for a in n.names] for n in imported], [["acquire_accounting_period_gate", "ensure_accounting_period_open"]])
        fn = next(n for n in ast.parse(HELPER.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == "ensure_accounting_period_open")
        names = [n.func.id for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
        self.assertIn("require_accounting_period_gate", names); self.assertNotIn("acquire_accounting_period_gate", names)


class ASTPortabilityTests(unittest.TestCase):
    def test_empty_display_fields_are_explicit_without_changing_structure(self):
        args = ast.parse("def example(value):\n    return value\n").body[0].args
        result = canonical_ast_dump(args)
        for expected in ("posonlyargs=[]", "kwonlyargs=[]", "kw_defaults=[]", "defaults=[]"):
            self.assertIn(expected, result)
        self.assertIn("args=[arg(arg='value')]", result)
        self.assertEqual(canonical_ast_dump(ast.Constant(value=None)), "Constant(value=None)")
    def test_only_absent_empty_type_params_normalized_nonempty_preserved(self):
        node = ast.parse("def example():\n    pass\n").body[0]
        node.type_params = []
        empty = canonical_ast_dump(node)
        del node.type_params
        self.assertEqual(canonical_ast_dump(node), empty)
        node.type_params = [ast.Name(id="SyntheticTypeParameter", ctx=ast.Load())]
        self.assertNotEqual(canonical_ast_dump(node), empty)
        self.assertIn("SyntheticTypeParameter", canonical_ast_dump(node))
    def test_semantic_body_signature_route_and_nonempty_changes_remain_visible(self):
        baseline = canonical_ast_dump(ast.parse("@router.post('/same')\ndef example(value=1):\n    return value\n").body[0])
        for changed in (
            "@router.post('/same')\ndef example(value=1):\n    return 2\n",
            "@router.post('/same')\ndef example(value=2):\n    return value\n",
            "@router.post('/different')\ndef example(value=1):\n    return value\n",
            "@router.post('/same', enabled=True)\ndef example(value=1):\n    return value\n",
        ):
            self.assertNotEqual(canonical_ast_dump(ast.parse(changed).body[0]), baseline)


class ControlsAdapterTests(unittest.TestCase):
    tenant = NS(organization_id="org-a", user_id="actor-a", organization=NS(timezone="UTC"))
    def test_actual_adapter_requires_prior_gate_without_query_or_fallback(self):
        db = DB()
        with self.assertRaises(gate.AccountingPeriodGateError): controls._ensure_open_period(db, "org-a", START)
        self.assertFalse(db.events); self.assertFalse(db.queries); self.assertEqual(db.commits, 0)
    def test_adapter_shared_and_exclusive_preserve_date_and_default409(self):
        for exclusive in (False, True):
            for finance_date in (START, END):
                with self.subTest(exclusive=exclusive, finance_date=finance_date):
                    db = DB(rows=[period(status="closed")]); gate.acquire_accounting_period_gate(db, "org-a", exclusive=exclusive)
                    with self.assertRaises(HTTPException) as caught: controls._ensure_open_period(db, "org-a", finance_date)
                    self.assertEqual((caught.exception.status_code, caught.exception.detail), (409, f"Accounting period is closed for {finance_date.isoformat()}"))
                    self.assertEqual(db.queries[-1].predicates, [("organization_id", "==", "org-a"), ("status", "==", "closed"), ("start_date", "<=", finance_date), ("end_date", ">=", finance_date)])
                    self.assertEqual(len(db.sql), 1); self.assertEqual(db.commits, 0)
    def test_adapter_gap_open_other_tenant_stay_allowed(self):
        for rows in ([], [period()], [period(organization_id="org-b", status="closed")], [period(start_date=date(2026, 9, 1), end_date=date(2026, 9, 30), status="closed")]):
            db = DB(rows=rows); gate.acquire_accounting_period_gate(db, "org-a")
            self.assertIsNone(controls._ensure_open_period(db, "org-a", START)); self.assertEqual(len(db.queries), 1)
    def test_adapter_wrong_tenant_cannot_reuse_gate_or_query(self):
        db = DB(); gate.acquire_accounting_period_gate(db, "org-a")
        with self.assertRaises(gate.AccountingPeriodGateError): controls._ensure_open_period(db, "org-b", START)
        self.assertFalse(db.queries)
    def test_actual_post_handler_preserves_explicit_or_fresh_due_date_before_effects(self):
        for explicit in (None, date(2026, 9, 14)):
            with self.subTest(explicit=explicit):
                selected = explicit or START
                db = DB(rows=[period(status="closed", start_date=selected, end_date=selected)])
                gate.acquire_accounting_period_gate(db, "org-a")
                recurring = NS(is_active=True, next_due_date=START, end_date=None)
                def load_recurring(org, recurring_id, *, lock):
                    db.events.append("recurring_lock")
                    self.assertEqual((org, recurring_id, lock), ("org-a", "schedule-a", True))
                    return recurring
                db.load_recurring = load_recurring
                with self.assertRaises(HTTPException) as caught:
                    controls.post_recurring_expense("schedule-a", NS(expense_date=explicit), None, db, self.tenant)
                self.assertEqual(caught.exception.detail, f"Accounting period is closed for {selected.isoformat()}")
                self.assertLess(db.events.index("gate"), db.events.index("recurring_lock"))
                self.assertLess(db.events.index("recurring_lock"), db.events.index("select"))
                self.assertEqual(len(db.queries), 1); self.assertFalse(db.added); self.assertEqual(db.commits, 0)
    def test_completed_recurring_replay_never_calls_adapter_or_new_post(self):
        source = ROOT / "app/api/v1/financial_safety.py"
        definition = next(n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == "safe_post_recurring_expense")
        definition.decorator_list = []
        expense = NS(id="expense-a", expense_number="EXP-OLD", expense_date=START)
        recurring = NS(next_due_date=date(2026, 9, 1), is_active=True)
        class Expense:
            id, organization_id = Field("id"), Field("organization_id")
        def forbidden(*args, **kwargs): raise AssertionError("Completed replay entered new period/posting validation")
        namespace = dict(
            defer_commits=lambda db: nullcontext(), select=Query, Expense=Expense,
            acquire_accounting_period_gate=gate.acquire_accounting_period_gate,
            reserve_posting=lambda *args, **kwargs: (NS(), True), completed_resource=lambda *args: expense.id,
            _read_recurring=lambda *args: recurring, RecurringExpensePostResult=lambda **kwargs: NS(**kwargs),
            HTTPException=HTTPException, post_recurring_expense=forbidden, post_expense=forbidden,
            complete_posting=forbidden, ensure_accounting_period_open=forbidden,
        )
        tree = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), definition], type_ignores=[])
        exec(compile(ast.fix_missing_locations(tree), str(source), "exec"), namespace)
        db = DB(rows=[period(status="closed")], values=[expense])
        result = namespace["safe_post_recurring_expense"]("schedule-a", NS(model_dump=lambda **kwargs: {}), None, db, self.tenant)
        self.assertEqual((result.expense_id, result.posted_date), (expense.id, START))
        self.assertEqual(len(db.queries), 1); self.assertIs(db.queries[0].target, Expense)
        self.assertFalse(db.added); self.assertEqual(db.commits, 0)
    def test_only_mapped_post_handler_calls_controls_adapter_no_get_import(self):
        tree = ast.parse(CONTROLS.read_text())
        callers = []
        for function in (n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))):
            if any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_ensure_open_period" for n in ast.walk(function)):
                callers.append(function.name)
        self.assertEqual(callers, ["post_recurring_expense"])
        imports = []
        for source in (ROOT / "app").rglob("*.py"):
            for node in ast.walk(ast.parse(source.read_text())):
                if isinstance(node, ast.ImportFrom) and node.module == "app.api.v1.finance_controls":
                    for alias in node.names:
                        if alias.name in {"_ensure_open_period", "post_recurring_expense"}:
                            imports.append((str(source.relative_to(ROOT)), alias.name))
        self.assertEqual(imports, [("app/api/v1/financial_safety.py", "post_recurring_expense")])
        router = ast.parse((ROOT / "app/api/v1/router.py").read_text())
        shadowed = next(ast.literal_eval(n.value) for n in router.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_SHADOWED_FINANCIAL_OPERATIONS" for t in n.targets))
        self.assertIn(("POST", "/finance/recurring-expenses/{recurring_id}/post"), shadowed)
    def test_adapter_exact_signature_and_single_canonical_call(self):
        function = next(n for n in ast.parse(CONTROLS.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == "_ensure_open_period")
        self.assertEqual([arg.arg for arg in function.args.args], ["db", "organization_id", "finance_date"])
        self.assertEqual(len(function.body), 1)
        call = function.body[0].value
        self.assertIsInstance(call, ast.Call); self.assertEqual(call.func.id, "ensure_accounting_period_open")
        self.assertEqual([arg.id for arg in call.args], ["db", "organization_id", "finance_date"])
        self.assertEqual(call.keywords, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
