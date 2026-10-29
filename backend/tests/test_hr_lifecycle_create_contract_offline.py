"""Actual schema/handler AST, synthetic Python fakes only: no application imports.

Characterizes route-body behavior, not HTTP serving, auth execution, PostgreSQL,
constraints, rollback/isolation, audit persistence, or production readiness.
"""
import ast
import copy
from datetime import date
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'app/api/v1/hr.py'
TREE = ast.parse(SOURCE.read_text())


def actual_nodes():
    schema = copy.deepcopy(next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == 'LifecycleCreate'))
    handler = copy.deepcopy(next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == 'create_lifecycle'))
    handler.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), schema, handler], type_ignores=[])
    return compile(ast.fix_missing_locations(module), str(SOURCE), 'exec')


class LifecycleContract(unittest.TestCase):
    def setUp(self):
        def blocked(*args, **kwargs):
            raise AssertionError('Offline characterization forbids network/server access')
        for obj, name in [(socket.socket, 'connect'), (socket.socket, 'connect_ex'), (socket.socket, 'bind'), (socket.socket, 'listen'), (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            guard = patch.object(obj, name, blocked)
            guard.start()
            self.addCleanup(guard.stop)
        self.calls, self.events = [], []
        self.employee = NS(employment_status='active', end_date=None, salary='unchanged', department='unchanged', role='unchanged')
        self.tenant = NS(organization_id='synthetic-org', user_id='synthetic-user')
        self.fail_at = None
        self.request = object()

        def stage(name):
            self.calls.append(name)
            if self.fail_at == name:
                raise RuntimeError('Synthetic ' + name + ' failure')

        def employee(db, org, employee_id):
            stage('lookup')
            self.assertIs(db, self.db)
            self.assertEqual((org, employee_id), ('synthetic-org', 'synthetic-employee'))
            return self.employee

        def add(item):
            stage('add')
            self.events.append(item)

        def flush():
            stage('flush')
            self.events[-1].id = str(UUID(int=len(self.events)))

        def audit(db, request, tenant, action, kind, entity_id, after):
            stage('audit')
            self.assertIs(db, self.db)
            self.assertIs(request, self.request)
            self.assertIs(tenant, self.tenant)
            self.audit = (action, kind, entity_id, after)

        self.db = NS(add=add, flush=flush, commit=lambda: stage('commit'))
        self.ns = dict(BaseModel=BaseModel, Field=Field, date=date, _employee=employee,
                       EmployeeLifecycleEvent=lambda **kw: NS(**kw), _audit=audit)
        exec(actual_nodes(), self.ns)
        self.schema = self.ns['LifecycleCreate']
        self.schema.model_rebuild(_types_namespace=self.ns)
        self.handler = self.ns['create_lifecycle']

    def payload(self, event_type='note', **extra):
        fields = dict(employee_id='synthetic-employee', event_type=event_type,
                      effective_date='2099-01-02', title='Synthetic event')
        fields.update(extra)
        return self.schema(**fields)

    def create(self, event_type='note', **extra):
        return self.handler(self.payload(event_type, **extra), self.request, self.db, self.tenant)

    def test_exit_immediately_inactivates_including_future_date(self):
        for kind in ['resignation', 'termination']:
            for day in ['2000-01-02', '2099-01-02']:
                with self.subTest(kind=kind, day=day):
                    self.employee.employment_status = 'active'
                    self.employee.end_date = None
                    self.create(kind, effective_date=day)
                    self.assertEqual(self.employee.employment_status, 'inactive')
                    self.assertEqual(self.employee.end_date, date.fromisoformat(day))

    def test_exit_overwrites_existing_inactive_employee_end_date(self):
        self.employee.employment_status = 'inactive'
        self.employee.end_date = date(2000, 1, 1)
        self.create('termination')
        self.assertEqual(self.employee.end_date, date(2099, 1, 2))

    def test_other_existing_choices_are_record_only(self):
        for kind in ['joining', 'confirmation', 'promotion', 'transfer', 'role_change', 'compensation_change', 'note']:
            for status in ['active', 'inactive']:
                with self.subTest(kind=kind, status=status):
                    self.employee.employment_status = status
                    self.employee.end_date = date(2001, 2, 3)
                    before = vars(self.employee).copy()
                    self.create(kind)
                    self.assertEqual(vars(self.employee), before)
                    self.assertEqual(self.events[-1].event_type, kind)

    def test_exit_matching_is_exact_and_unknown_types_currently_record_only(self):
        for kind in ['Termination', 'termination ', 'custom-event']:
            with self.subTest(kind=kind):
                before = vars(self.employee).copy()
                self.create(kind)
                self.assertEqual(vars(self.employee), before)

    def test_receipt_attribution_audit_and_commit_order(self):
        receipt = self.create(details={'synthetic': 'detail'}, notes='Synthetic note')
        self.assertEqual(self.calls, ['lookup', 'add', 'flush', 'audit', 'commit'])
        self.assertEqual(receipt, {'id': str(UUID(int=1))})
        self.assertRegex(receipt['id'], r'^[0-9a-f-]{36}$')
        self.assertEqual(self.audit, ('hr.lifecycle.created', 'employee_lifecycle_event', receipt['id'], {'event_type': 'note'}))
        item = self.events[0]
        self.assertEqual((item.organization_id, item.created_by_user_id), ('synthetic-org', 'synthetic-user'))
        self.assertEqual((item.details, item.notes), ({'synthetic': 'detail'}, 'Synthetic note'))

    def test_deliberate_duplicate_calls_have_no_route_level_deduplication(self):
        first, second = self.create(), self.create()
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(len(self.events), 2)
        self.assertEqual(self.calls.count('commit'), 2)

    def test_failures_propagate_without_returning_receipt(self):
        stages = ['lookup', 'add', 'flush', 'audit', 'commit']
        for position, stage in enumerate(stages):
            with self.subTest(stage=stage):
                self.calls.clear()
                self.events.clear()
                self.fail_at = stage
                with self.assertRaisesRegex(RuntimeError, 'Synthetic ' + stage):
                    self.create()
                self.assertEqual(self.calls, stages[:position + 1])

    def test_schema_defaults_required_fields_and_date_validation(self):
        value = self.payload()
        self.assertEqual(value.details, {})
        self.assertIsNone(value.notes)
        for field in ['employee_id', 'event_type', 'effective_date', 'title']:
            values = value.model_dump()
            del values[field]
            with self.subTest(field=field), self.assertRaises(ValidationError):
                self.schema(**values)
        for invalid in ['2026-02-30', 'not-a-date']:
            with self.subTest(date=invalid), self.assertRaises(ValidationError):
                self.payload(effective_date=invalid)

    def test_schema_currently_has_no_title_length_or_event_enum_constraints(self):
        for title in ['', '   ', 'x' * 181]:
            with self.subTest(title=repr(title)):
                self.assertEqual(self.payload(event_type='unknown', title=title).title, title)

    def test_actual_route_declares_201_and_hr_manager_without_response_model(self):
        node = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == 'create_lifecycle')
        self.assertEqual(ast.unparse(next(a.annotation for a in node.args.args if a.arg == 'tenant')), 'HRManager')
        decorator = node.decorator_list[0]
        self.assertEqual(ast.unparse(decorator.func), 'router.post')
        self.assertEqual(ast.literal_eval(decorator.args[0]), '/lifecycle')
        self.assertEqual({k.arg: ast.literal_eval(k.value) for k in decorator.keywords}, {'status_code': 201})


if __name__ == '__main__':
    unittest.main(verbosity=2)
