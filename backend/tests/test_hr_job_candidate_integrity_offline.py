"""Actual schemas and extracted handler contracts, not SQL or HTTP auth proof."""
import ast
import copy
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
def source_node(name):
    return copy.deepcopy(next(n for n in TREE.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name == name))
def extract(names, ns):
    nodes = [source_node(n) for n in names]
    for n in nodes:
        if isinstance(n, ast.FunctionDef): n.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), '<hr-job-candidate-contract>', 'exec'), ns)
    return ns
SCHEMAS = extract(['JobCreate', 'CandidateUpdate'], dict(__name__=__name__, BaseModel=BaseModel, Field=Field, field_validator=field_validator, Decimal=Decimal))
JobCreate, CandidateUpdate = SCHEMAS['JobCreate'], SCHEMAS['CandidateUpdate']

class Column:
    def __init__(self, name): self.name = name
    def __eq__(self, value): return self.name, value
class Department:
    id, organization_id = Column('department_id'), Column('organization_id')
class Candidate:
    id, organization_id = Column('candidate_id'), Column('organization_id')
class Job:
    def __init__(self, **kw): self.id = 'job-created'; self.__dict__.update(kw)
class Query:
    def __init__(self, model): self.model, self.conditions, self.locked = model, {}, False
    def where(self, *items): self.conditions.update(items); return self
    def with_for_update(self): self.locked = True; return self

class SchemaTests(unittest.TestCase):
    def test_stage_omitted_is_unchanged(self): self.assertEqual(CandidateUpdate().model_dump(exclude_unset=True), {})
    def test_explicit_null_stage_rejected(self):
        with self.assertRaises(ValidationError): CandidateUpdate(stage=None)
    def test_stage_exact_storage_length_accepted(self): self.assertEqual(CandidateUpdate(stage='x'*24).stage, 'x'*24)
    def test_stage_over_storage_length_rejected(self):
        with self.assertRaises(ValidationError): CandidateUpdate(stage='x'*25)
    def test_arbitrary_stage_and_empty_policy_preserved(self):
        for stage in ['applied', 'hired', 'custom', '']:
            with self.subTest(stage=stage): self.assertEqual(CandidateUpdate(stage=stage).stage, stage)
    def test_nullable_notes_rating_and_zero_preserved(self):
        self.assertEqual(CandidateUpdate(notes=None,rating=None).model_dump(exclude_unset=True), {'rating':None,'notes':None})
        self.assertEqual(CandidateUpdate(rating=0).rating,Decimal('0'))
    def test_rating_boundaries_preserved(self):
        self.assertEqual(CandidateUpdate(rating=5).rating,Decimal('5'))
        for rating in [-1,6]:
            with self.subTest(rating=rating),self.assertRaises(ValidationError): CandidateUpdate(rating=rating)
    def test_job_default_department_is_none(self): self.assertIsNone(JobCreate(title='Synthetic').department_id)
    def test_other_job_string_policy_not_silently_hardened(self):
        with self.assertRaises(ValidationError): JobCreate(title='x'*181)
        self.assertEqual(JobCreate(title='', employment_type='custom').title, '')
        self.assertEqual(JobCreate(title='ok', employment_type='custom').employment_type, 'custom')

class HandlerTests(unittest.TestCase):
    def setUp(self):
        def deny(*args,**kwargs): raise AssertionError('Offline test forbids network')
        for obj,name in [(socket.socket,'connect'),(socket.socket,'connect_ex'),(socket.socket,'bind'),(socket.socket,'listen'),(socket,'create_connection'),(socket,'getaddrinfo')]:
            guard=patch.object(obj,name,deny);guard.start();self.addCleanup(guard.stop)
        self.events,self.queries=[],[];self.departments={('org-A','dept-A'),('org-A','inactive-A'),('org-B','dept-B')}
        self.row=NS(id='candidate-A',organization_id='org-A',stage='applied',rating=Decimal('3'),notes='note');self.audit_error=False
        def scalar(query):
            self.queries.append(query);self.events.append(('lookup',dict(query.conditions)))
            if query.model is Department.id:
                key=(query.conditions.get('organization_id'),query.conditions.get('department_id'))
                return key[1]if key in self.departments else None
            return self.row if query.conditions=={'candidate_id':self.row.id,'organization_id':self.row.organization_id}else None
        def audit(*args):
            self.events.append(('audit',))
            if self.audit_error: raise RuntimeError('Synthetic audit failure')
        self.db=NS(scalar=scalar,add=lambda item:self.events.append(('add',item)),flush=lambda:self.events.append(('flush',)),commit=lambda:self.events.append(('commit',)))
        self.f=extract(['create_job','update_candidate'],dict(JobOpening=Job,JobCandidate=Candidate,Department=Department,select=Query,_audit=audit,HTTPException=HTTPException));self.tenant=NS(organization_id='org-A')
    def create(self,department=None):return self.f['create_job'](JobCreate(title='Synthetic',department_id=department),NS(),self.db,self.tenant)
    def update(self,id='candidate-A',**kw):return self.f['update_candidate'](id,CandidateUpdate(**kw),NS(),self.db,self.tenant)
    def test_own_department_lookup_before_write(self):
        self.assertEqual(self.create('dept-A'),{'id':'job-created'})
        self.assertEqual(self.queries[0].conditions,{'department_id':'dept-A','organization_id':'org-A'})
        self.assertEqual([e[0]for e in self.events],['lookup','add','flush','audit','commit'])
        self.assertEqual(self.events[1][1].department_id,'dept-A')
    def test_null_department_does_not_lookup(self):
        self.create();self.assertEqual(self.queries,[]);self.assertIsNone(self.events[0][1].department_id)
    def test_foreign_department_rejected_before_write(self):
        with self.assertRaises(HTTPException)as e:self.create('dept-B')
        self.assertEqual((e.exception.status_code,e.exception.detail),(404,'Department not found'));self.assertEqual([x[0]for x in self.events],['lookup'])
    def test_missing_department_has_same_generic_rejection(self):
        with self.assertRaises(HTTPException)as e:self.create('missing')
        self.assertEqual((e.exception.status_code,e.exception.detail),(404,'Department not found'));self.assertEqual([x[0]for x in self.events],['lookup'])
    def test_empty_department_not_silently_converted_to_none(self):
        with self.assertRaises(HTTPException):self.create('')
        self.assertEqual([x[0]for x in self.events],['lookup'])
    def test_no_new_department_active_only_policy(self):self.assertEqual(self.create('inactive-A'),{'id':'job-created'})
    def test_create_audit_failure_does_not_call_commit(self):
        self.audit_error=True
        with self.assertRaises(RuntimeError):self.create('dept-A')
        self.assertNotIn(('commit',),self.events)
    def test_candidate_update_scope_lock_and_normal_receipt(self):
        self.assertEqual(self.update(stage='custom',rating=0),{'id':'candidate-A','stage':'custom'})
        self.assertTrue(self.queries[0].locked);self.assertEqual(self.queries[0].conditions,{'candidate_id':'candidate-A','organization_id':'org-A'});self.assertEqual(self.row.rating,Decimal('0'))
        self.assertEqual([e[0]for e in self.events],['lookup','audit','commit'])
    def test_foreign_candidate_update_rejected_without_write(self):
        self.row.organization_id='org-B'
        with self.assertRaises(HTTPException)as e:self.update(stage='custom')
        self.assertEqual(e.exception.status_code,404);self.assertEqual([x[0]for x in self.events],['lookup'])
    def test_missing_candidate_rejected_without_write(self):
        with self.assertRaises(HTTPException):self.update(id='missing')
        self.assertEqual([x[0]for x in self.events],['lookup'])
    def test_omitted_update_fields_preserve_values(self):
        before=vars(self.row).copy();self.update();self.assertEqual(vars(self.row),before)
    def test_nullable_fields_clear_without_nulling_stage(self):
        self.update(notes=None,rating=None);self.assertIsNone(self.row.notes);self.assertIsNone(self.row.rating);self.assertEqual(self.row.stage,'applied')
    def test_permission_annotations_unchanged_not_http_auth_proof(self):
        for name in ['create_job','update_candidate']:
            self.assertEqual(ast.unparse(source_node(name).args.args[-1].annotation),'HRManager')

if __name__=='__main__':unittest.main()
