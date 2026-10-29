"""Actual handler/schema AST with Python fakes; never imports application modules.

Not HTTP/auth execution, real database persistence, constraints, locks, isolation,
rollback, or production proof. Simulated commit acknowledgement loss demonstrates
why a raised exception alone cannot establish absence of a committed write.
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

from pydantic import BaseModel, ValidationError

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'app/api/v1/hr.py'
TREE = ast.parse(SOURCE.read_text())


def node(name):
    return next(n for n in TREE.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name == name)


class Column:
    def __init__(self, name):
        self.name = name

    def __eq__(self, other):
        return (self.name, '=', other)

    def is_(self, other):
        return (self.name, 'is', other)


class Query:
    def __init__(self, target):
        self.target, self.conditions = target, ()

    def where(self, *conditions):
        self.conditions = conditions
        return self


class Missing(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail


class ShiftAssignmentContract(unittest.TestCase):
    def setUp(self):
        def blocked(*args, **kwargs):
            raise AssertionError('Offline characterization forbids network/server access')
        for obj, name in [(socket.socket, 'connect'), (socket.socket, 'connect_ex'), (socket.socket, 'bind'), (socket.socket, 'listen'), (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            guard = patch.object(obj, name, blocked)
            guard.start()
            self.addCleanup(guard.stop)
        self.calls, self.items, self.queries = [], [], []
        self.employee = NS(employment_status='inactive', end_date=date(2000, 1, 1))
        self.prior = NS(effective_from=date(1999, 1, 1), effective_to=None)
        self.employee_found = self.shift_found = True
        self.fail_at = None
        self.applied_commits = 0
        self.commit_applies_before_error = False
        self.tenant = NS(organization_id='synthetic-org')
        self.request = object()
        Employee = NS(id=Column('employee.id'), organization_id=Column('employee.organization_id'))
        Shift = NS(id=Column('shift.id'), organization_id=Column('shift.organization_id'), is_active=Column('shift.is_active'))

        def stage(name):
            self.calls.append(name)
            if self.fail_at == name:
                raise RuntimeError('Synthetic ' + name + ' failure')

        def scalar(query):
            self.queries.append(query)
            if query.target is Employee:
                stage('employee_lookup')
                return self.employee if self.employee_found else None
            stage('shift_lookup')
            return 'synthetic-shift' if self.shift_found else None

        def add(item):
            stage('add')
            self.items.append(item)

        def flush():
            stage('flush')
            self.items[-1].id = str(UUID(int=len(self.items)))

        def commit():
            if self.commit_applies_before_error:
                self.applied_commits += 1
            stage('commit')
            if not self.commit_applies_before_error:
                self.applied_commits += 1

        def audit(db, request, tenant, action, kind, item_id):
            stage('audit')
            self.assertIs(db, self.db)
            self.assertIs(request, self.request)
            self.assertIs(tenant, self.tenant)
            self.audit = (action, kind, item_id)

        self.db = NS(scalar=scalar, add=add, flush=flush, commit=commit)
        self.ns = dict(BaseModel=BaseModel, date=date, select=Query, Employee=Employee, HRShift=Shift,
                       EmployeeShiftAssignment=lambda **kw: NS(effective_to=None, **kw), HTTPException=Missing, _audit=audit)
        nodes = [copy.deepcopy(node(n)) for n in ['ShiftAssign', '_employee', 'assign_shift']]
        for n in nodes:
            if isinstance(n, ast.FunctionDef):
                n.decorator_list = []
        module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
        exec(compile(ast.fix_missing_locations(module), str(SOURCE), 'exec'), self.ns)
        self.schema = self.ns['ShiftAssign']
        self.schema.model_rebuild(_types_namespace=self.ns)

    def payload(self, **kw):
        return self.schema(**(dict(employee_id='synthetic-employee', shift_id='synthetic-shift', effective_from='2099-01-02') | kw))

    def create(self, **kw):
        return self.ns['assign_shift'](self.payload(**kw), self.request, self.db, self.tenant)

    def test_exact_receipt_audit_and_order(self):
        receipt = self.create()
        self.assertEqual(self.calls, ['employee_lookup', 'shift_lookup', 'add', 'flush', 'audit', 'commit'])
        self.assertEqual(receipt, {'id': str(UUID(int=1))})  # ID supplied by fake flush, not production UUID validation.
        self.assertEqual(self.audit, ('hr.shift.assigned', 'employee_shift_assignment', receipt['id']))
        self.assertEqual(self.items[0].organization_id, 'synthetic-org')

    def test_tenant_employee_and_active_shift_queries(self):
        self.create()
        self.assertEqual(self.queries[0].conditions, (('employee.id', '=', 'synthetic-employee'), ('employee.organization_id', '=', 'synthetic-org')))
        self.assertEqual(self.queries[1].conditions, (('shift.id', '=', 'synthetic-shift'), ('shift.organization_id', '=', 'synthetic-org'), ('shift.is_active', 'is', True)))

    def test_missing_employee_or_active_shift_rejected_before_add(self):
        for target, detail in [('employee', 'Employee not found'), ('shift', 'Shift not found')]:
            with self.subTest(target=target):
                self.employee_found = target != 'employee'
                self.shift_found = target != 'shift'
                self.calls.clear()
                with self.assertRaises(Missing) as error:
                    self.create()
                self.assertEqual((error.exception.status_code, error.exception.detail), (404, detail))
                self.assertNotIn('add', self.calls)
                self.assertEqual(self.applied_commits, 0)

    def test_inactive_employee_and_past_future_dates_accepted_without_mutation(self):
        before = vars(self.employee).copy()
        for day in ['1900-01-01', '2099-12-31']:
            self.create(effective_from=day)
            self.assertEqual(self.items[-1].effective_from, date.fromisoformat(day))
            self.assertEqual(vars(self.employee), before)

    def test_duplicates_are_added_without_prior_lookup_or_automatic_end(self):
        before = vars(self.prior).copy()
        first, second = self.create(), self.create()
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(len(self.items), 2)
        self.assertEqual(len(self.queries), 4)  # Only employee + shift reads per call.
        self.assertEqual(vars(self.prior), before)
        self.assertTrue(all(item.effective_to is None for item in self.items))
        self.assertEqual(self.applied_commits, 2)

    def test_stage_failures_propagate_without_receipt(self):
        stages = ['employee_lookup', 'shift_lookup', 'add', 'flush', 'audit', 'commit']
        for i, stage in enumerate(stages):
            with self.subTest(stage=stage):
                self.calls.clear()
                self.items.clear()
                self.fail_at = stage
                with self.assertRaisesRegex(RuntimeError, 'Synthetic ' + stage):
                    self.create()
                self.assertEqual(self.calls, stages[:i + 1])
                self.assertEqual(self.applied_commits, 0)

    def test_simulated_commit_applied_then_acknowledgement_lost_has_no_receipt(self):
        self.commit_applies_before_error = True
        self.fail_at = 'commit'
        with self.assertRaisesRegex(RuntimeError, 'Synthetic commit'):
            self.create()
        self.assertEqual(self.applied_commits, 1)
        self.assertEqual(len(self.items), 1)
        self.assertEqual(self.calls[-2:], ['audit', 'commit'])

    def test_actual_schema_required_date_and_ignored_extra_fields(self):
        values = self.payload().model_dump()
        self.assertEqual(set(values), {'employee_id', 'shift_id', 'effective_from'})
        for key in values:
            with self.subTest(field=key), self.assertRaises(ValidationError):
                self.schema(**{k: v for k, v in values.items() if k != key})
        with self.assertRaises(ValidationError):
            self.payload(effective_from='2026-02-30')
        self.assertEqual(self.payload(employee_id='', shift_id='').employee_id, '')
        self.assertNotIn('effective_to', self.payload(effective_to='2100-01-01', idempotency_key='ignored').model_dump())

    def test_static_route_201_manage_and_no_assignment_unique_constraint(self):
        n = node('assign_shift')
        self.assertEqual(ast.unparse(next(a.annotation for a in n.args.args if a.arg == 'tenant')), 'HRManager')
        d = n.decorator_list[0]
        self.assertEqual(ast.literal_eval(d.args[0]), '/shift-assignments')
        self.assertEqual({k.arg: ast.literal_eval(k.value) for k in d.keywords}, {'status_code': 201})
        tree = ast.parse((ROOT / 'app/models/hr.py').read_text())
        model = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'EmployeeShiftAssignment')
        calls = [ast.unparse(n.func) for n in ast.walk(model) if isinstance(n, ast.Call)]
        self.assertNotIn('UniqueConstraint', calls)
        self.assertIn('Index', calls)

    def test_static_capped_history_and_effective_selection_no_exact_id_endpoint(self):
        tree = ast.parse((ROOT / 'app/api/v1/hr_extended.py').read_text())
        n = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'list_shift_assignments')
        self.assertEqual([a.arg for a in n.args.args], ['db', 'tenant'])
        text = ast.unparse(n)
        self.assertIn('.limit(300)', text)
        self.assertNotIn('is_active', text)
        self.assertNotIn('employment_status', text)
        tree = ast.parse((ROOT / 'app/services/hr_time.py').read_text())
        text = ast.unparse(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'shift_for_date'))
        for fragment in ['effective_from <= work_date', 'effective_to >= work_date', 'effective_to.is_(None)', 'effective_from.desc()', 'created_at.desc()', '.limit(1)']:
            self.assertIn(fragment, text)
        self.assertNotIn('is_active', text)
        self.assertNotIn('with_for_update', text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
