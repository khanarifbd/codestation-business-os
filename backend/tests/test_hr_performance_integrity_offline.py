"""Performance schema and extracted-handler contracts; no HTTP or real SQL proof.

Uses actual Pydantic schemas and AST-extracted route/helper bodies with recording
fakes. Does not establish PostgreSQL FK/JSONB/locking or HTTP authorization.
"""
import ast
import copy
from datetime import date
from decimal import Decimal
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator

ROOT = Path(__file__).resolve().parents[1]
TREE = ast.parse((ROOT / 'app/api/v1/hr.py').read_text())


def node(name):
    return copy.deepcopy(next(n for n in TREE.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name == name))


def extracted(names, namespace):
    nodes = [node(n) for n in names]
    for n in nodes:
        if isinstance(n, ast.FunctionDef): n.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), '<performance-contract>', 'exec'), namespace)
    return namespace


SCHEMAS = extracted(['PerformanceCreate', 'PerformanceUpdate'], dict(__name__=__name__, BaseModel=BaseModel, Field=Field, field_validator=field_validator, date=date, Decimal=Decimal))
Create, Update = SCHEMAS['PerformanceCreate'], SCHEMAS['PerformanceUpdate']


class Column:
    def __init__(self, name): self.name = name
    def __eq__(self, value): return self.name, value


class Employee:
    id, organization_id = Column('id'), Column('organization_id')


class Review:
    id, organization_id = Column('id'), Column('organization_id')
    def __init__(self, **values):
        self.id = 'new-review'
        self.status, self.rating = 'draft', None
        self.__dict__.update(values)


class Query:
    def __init__(self, model): self.model, self.conditions, self.locked = model, {}, False
    def where(self, *conditions): self.conditions.update(conditions); return self
    def with_for_update(self): self.locked = True; return self


class SchemaContract(unittest.TestCase):
    def test_omitted_patch_fields_remain_omitted(self): self.assertEqual(Update().model_dump(exclude_unset=True), {})
    def test_explicit_null_status_rejected(self):
        with self.assertRaises(ValidationError): Update(status=None)
    def test_explicit_null_goals_rejected(self):
        with self.assertRaises(ValidationError): Update(goals=None)
    def test_status_24_accepted_without_enum(self): self.assertEqual(Update(status='x'*24).status, 'x'*24)
    def test_status_25_rejected(self):
        with self.assertRaises(ValidationError): Update(status='x'*25)
    def test_empty_status_preserves_existing_flexible_policy(self): self.assertEqual(Update(status='').status, '')
    def test_existing_completed_and_in_progress_statuses(self):
        for status in ['draft', 'in_progress', 'completed']:
            with self.subTest(status=status): self.assertEqual(Update(status=status).status, status)
    def test_empty_goals_accepted(self): self.assertEqual(Update(goals=[]).goals, [])
    def test_arbitrary_goal_dictionary_preserved(self):
        goals = [{'custom': {'nested': [1, 'x', None]}, 'progress': 'not-a-policy'}]
        self.assertEqual(Update(goals=goals).goals, goals)
    def test_goals_must_remain_list_of_dictionaries(self):
        for value in ['text', {'not': 'a list'}, [3]]:
            with self.subTest(value=value), self.assertRaises(ValidationError): Update(goals=value)
    def test_nullable_text_and_rating_can_clear(self):
        self.assertEqual(Update(self_review=None, manager_review=None, rating=None).model_dump(exclude_unset=True), {'self_review': None, 'manager_review': None, 'rating': None})
    def test_zero_rating_is_not_missing(self): self.assertEqual(Update(rating=0).model_dump(exclude_unset=True), {'rating': Decimal('0')})
    def test_rating_upper_boundary_and_fraction_preserved(self):
        self.assertEqual(Update(rating='5').rating, Decimal('5'))
        self.assertEqual(Update(rating='2.50').rating, Decimal('2.50'))
    def test_out_of_range_ratings_rejected(self):
        for value in [-1, '5.01']:
            with self.subTest(value=value), self.assertRaises(ValidationError): Update(rating=value)
    def test_create_default_reviewer_and_goals(self):
        p = Create(employee_id='employee-A', period_start='2026-02-01', period_end='2026-02-02')
        self.assertIsNone(p.reviewer_employee_id); self.assertEqual(p.goals, [])
    def test_period_order_policy_unchanged(self):
        p = Create(employee_id='employee-A', period_start='2026-02-02', period_end='2026-02-01')
        self.assertGreater(p.period_start, p.period_end)


class HandlerContract(unittest.TestCase):
    def setUp(self):
        def denied(*args, **kwargs): raise AssertionError('No network in offline contract tests')
        for obj, name in [(socket.socket, 'connect'), (socket.socket, 'connect_ex'), (socket.socket, 'bind'), (socket.socket, 'listen'), (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            guard = patch.object(obj, name, denied); guard.start(); self.addCleanup(guard.stop)
        self.events, self.queries = [], []
        self.employees = {('org-A', 'employee-A'), ('org-A', 'reviewer-A'), ('org-B', 'foreign-B')}
        self.existing = NS(id='review-A', organization_id='org-A', status='draft', rating=Decimal('3'), goals=[{'legacy': True}], self_review='self', manager_review='manager')
        self.audit_raises = False
        def scalar(query):
            self.queries.append(query); self.events.append(('lookup', query.model.__name__, dict(query.conditions)))
            if query.model is Employee:
                key = (query.conditions.get('organization_id'), query.conditions.get('id'))
                return NS(id=key[1]) if key in self.employees else None
            return self.existing if query.conditions == {'id': self.existing.id, 'organization_id': self.existing.organization_id} else None
        self.db = NS(scalar=scalar, add=lambda item: self.events.append(('add', item)), flush=lambda: self.events.append(('flush',)), commit=lambda: self.events.append(('commit',)))
        def audit(*args):
            self.events.append(('audit', args[3], args[4], args[5], args[6:] ))
            if self.audit_raises: raise RuntimeError('Synthetic audit failure')
        self.ns = extracted(['_employee', 'create_performance', 'update_performance'], dict(select=Query, Employee=Employee, PerformanceReview=Review, HTTPException=HTTPException, _audit=audit))
        self.tenant, self.request = NS(organization_id='org-A', user_id='synthetic-user'), NS()
    def create(self, reviewer=None, employee='employee-A'):
        payload = Create(employee_id=employee, reviewer_employee_id=reviewer, period_start='2026-01-01', period_end='2026-01-31')
        return self.ns['create_performance'](payload, self.request, self.db, self.tenant)
    def update(self, review_id='review-A', **values):
        return self.ns['update_performance'](review_id, Update(**values), self.request, self.db, self.tenant)
    def assert_no_write(self): self.assertTrue(all(e[0]=='lookup' for e in self.events))
    def test_own_reviewer_validated_before_writes(self):
        self.assertEqual(self.create('reviewer-A'), {'id': 'new-review'})
        self.assertEqual([e[0]for e in self.events], ['lookup', 'lookup', 'add', 'flush', 'audit', 'commit'])
        self.assertEqual(self.queries[1].conditions, {'id':'reviewer-A', 'organization_id':'org-A'})
        self.assertEqual(self.events[2][1].reviewer_employee_id, 'reviewer-A')
    def test_null_reviewer_preserves_single_employee_lookup(self):
        self.create(); self.assertEqual(len(self.queries), 1)
        self.assertIsNone(next(e[1]for e in self.events if e[0]=='add').reviewer_employee_id)
    def test_foreign_reviewer_rejected_without_writes(self):
        with self.assertRaises(HTTPException) as error: self.create('foreign-B')
        self.assertEqual((error.exception.status_code,error.exception.detail),(404,'Employee not found')); self.assert_no_write()
    def test_missing_reviewer_same_response_without_writes(self):
        with self.assertRaises(HTTPException) as error: self.create('missing')
        self.assertEqual((error.exception.status_code,error.exception.detail),(404,'Employee not found')); self.assert_no_write()
    def test_foreign_subject_rejected_before_reviewer_or_writes(self):
        with self.assertRaises(HTTPException): self.create('reviewer-A', 'foreign-B')
        self.assertEqual(len(self.queries), 1); self.assert_no_write()
    def test_missing_subject_rejected_without_writes(self):
        with self.assertRaises(HTTPException): self.create(employee='missing')
        self.assert_no_write()
    def test_self_reviewer_policy_unchanged(self): self.assertEqual(self.create('employee-A'), {'id':'new-review'})
    def test_update_remains_scoped_and_locked(self):
        self.assertEqual(self.update(status='completed', rating=0), {'id':'review-A'})
        self.assertEqual(self.queries[0].conditions, {'id':'review-A','organization_id':'org-A'}); self.assertTrue(self.queries[0].locked)
        self.assertEqual(self.existing.rating, Decimal('0')); self.assertEqual(self.existing.status,'completed')
        self.assertEqual([e[0]for e in self.events], ['lookup','audit','commit'])
    def test_foreign_review_update_has_no_audit_or_commit(self):
        self.existing.organization_id='org-B'
        with self.assertRaises(HTTPException) as error: self.update()
        self.assertEqual(error.exception.status_code,404); self.assert_no_write()
    def test_missing_review_update_has_no_write(self):
        with self.assertRaises(HTTPException): self.update(review_id='missing')
        self.assert_no_write()
    def test_omitted_update_fields_do_not_overwrite_record(self):
        before=vars(self.existing).copy();self.update();self.assertEqual(vars(self.existing),before)
    def test_nullable_fields_can_clear_in_handler(self):
        self.update(self_review=None,manager_review=None,rating=None)
        self.assertIsNone(self.existing.self_review);self.assertIsNone(self.existing.manager_review);self.assertIsNone(self.existing.rating)
    def test_create_audit_failure_prevents_commit_call(self):
        self.audit_raises=True
        with self.assertRaises(RuntimeError): self.create('reviewer-A')
        self.assertNotIn(('commit',),self.events)
    def test_update_audit_failure_prevents_commit_call(self):
        self.audit_raises=True
        with self.assertRaises(RuntimeError): self.update(status='completed')
        self.assertNotIn(('commit',),self.events)
    def test_permission_declarations_unchanged_not_http_auth_proof(self):
        declarations={n.targets[0].id:ast.unparse(n.value)for n in TREE.body if isinstance(n,ast.Assign)and isinstance(n.targets[0],ast.Name)}
        self.assertIn("require_tenant_permission('hr.manage')",declarations['HRManager'])
        for name in ['create_performance','update_performance']:
            self.assertEqual(ast.unparse(node(name).args.args[-1].annotation),'HRManager')


if __name__ == '__main__': unittest.main()
