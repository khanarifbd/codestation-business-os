"""Execute actual handler/schema AST against recording fakes, never app imports.

Offline characterization only: no HTTP authentication, SQL execution, PostgreSQL
constraints/concurrency/rollback, provider, real GPS, or payroll execution proof.
"""
import ast
import copy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo
from pydantic import BaseModel, Field, ValidationError

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'app/api/v1/hr_attendance.py'
TREE = ast.parse(SOURCE.read_text())
SERVICE = ast.parse((ROOT / 'app/services/hr_attendance.py').read_text())


def node(name, tree=TREE):
    return next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name == name)


class Column:
    def __init__(self, name): self.name = name
    def __eq__(self, value): return (self.name, '=', value)
    def is_(self, value): return (self.name, 'is', value)
    def is_not(self, value): return (self.name, 'is not', value)
    def desc(self): return (self.name, 'desc')


class Query:
    def __init__(self, *targets): self.targets, self.conditions, self.lock, self.cap = targets, (), False, None
    def where(self, *args): self.conditions += args; return self
    def join(self, *args): return self
    def order_by(self, *args): self.order = args; return self
    def with_for_update(self): self.lock = True; return self
    def limit(self, number): self.cap = number; return self


class Model:
    def __init__(self, name): self.name = name
    def __getattr__(self, name): return Column(self.name + '.' + name)
    def __call__(self, **kwargs): return NS(**kwargs)


class Rejection(Exception):
    def __init__(self, status_code, detail): self.status_code, self.detail = status_code, detail


class AttendanceSetupContract(unittest.TestCase):
    def setUp(self):
        def blocked(*args, **kwargs): raise AssertionError('Network/server access forbidden in offline characterization')
        for obj, key in [(socket.socket, 'connect'), (socket.socket, 'connect_ex'), (socket.socket, 'bind'), (socket.socket, 'listen'), (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            guard = patch.object(obj, key, blocked); guard.start(); self.addCleanup(guard.stop)
        self.calls, self.queries, self.queue, self.added, self.audits = [], [], [], [], []
        self.tenant = NS(organization_id='org-A', membership_id='manager-A', user_id='user-A', organization=NS(timezone='UTC'))
        self.employee = NS(id='employee-A', membership_id='employee-membership')
        self.office = NS(id='office-A', name='Main office', latitude=23.0, longitude=90.0, radius_meters=100, is_active=True)
        self.policy = NS(id='policy-A', employee_id='employee-A', office_id='office-A', weekly_modes=['office'] * 7)
        self.today = date(2026, 10, 27)
        self.item = NS(id='request-A', employee_id='employee-A', work_date=self.today, request_type='mode', requested_mode='remote', reason='Synthetic reason', proposed_check_in_at=None, proposed_check_out_at=None, status='pending', review_notes=None, created_at=datetime(2026, 10, 26, tzinfo=timezone.utc))
        self.fail_commit = False
        def scalar(query): self.calls.append('scalar'); self.queries.append(query); return self.queue.pop(0)
        def execute(query): self.queries.append(query); return NS(all=lambda: self.queue.pop(0))
        def add(row): self.calls.append('add'); self.added.append(row)
        def flush():
            self.calls.append('flush')
            for i, row in enumerate(self.added):
                if not hasattr(row, 'id'): row.id = 'fake-flush-' + str(i)
        def commit():
            self.calls.append('commit')
            if self.fail_commit: raise RuntimeError('Synthetic commit acknowledgement lost; persistence unknown')
        def audit(db, request, tenant, action, kind, ident, **kw): self.calls.append('audit'); self.audits.append((action, kind, ident, kw))
        self.db = NS(scalar=scalar, scalars=execute, execute=execute, add=add, flush=flush, commit=commit)
        models = {n: Model(n) for n in ['HROfficeLocation', 'EmployeeAttendancePolicy', 'HRAttendanceRequest', 'AttendanceRecord', 'Employee', 'Membership', 'User']}
        self.ns = dict(BaseModel=BaseModel, Field=Field, date=date, datetime=datetime, timezone=timezone, ZoneInfo=ZoneInfo, select=Query, func=NS(count=lambda c: ('count', c.name)), HTTPException=Rejection, _audit=audit, MODES={'office','remote','field','off'}, **models)
        names = ['OfficePayload','PolicyPayload','AttendanceRequestReview','_employee','_office_data','_request_data','list_offices','list_policies','list_requests','create_office','update_office','upsert_policy','review_request']
        nodes = [copy.deepcopy(node(n)) for n in names] + [copy.deepcopy(node('validate_weekly_modes', SERVICE))]
        for n in nodes:
            if isinstance(n, ast.FunctionDef): n.decorator_list = []
        module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
        exec(compile(ast.fix_missing_locations(module), str(SOURCE), 'exec'), self.ns)
        for name in ['OfficePayload','PolicyPayload','AttendanceRequestReview']: self.ns[name].model_rebuild(_types_namespace=self.ns)
        self.ns.update(_local_date=lambda tenant: self.today, effective_attendance_mode=lambda *a, **kw: ('office',self.policy,self.office), shift_for_date=lambda *a, **kw: 'synthetic-shift', scheduled_presence_minutes=lambda *a: 480, attendance_status_for_check_in=lambda *a: 'present')

    def office_payload(self, **kw): return self.ns['OfficePayload'](**(dict(name='Changed office',latitude=0,longitude=0,radius_meters=25,is_active=True) | kw))
    def policy_payload(self, **kw): return self.ns['PolicyPayload'](**(dict(office_id='office-A',weekly_modes=['office']*7) | kw))
    def review(self, status='approved', notes=None): return self.ns['review_request']('request-A',self.ns['AttendanceRequestReview'](status=status,review_notes=notes),object(),self.db,self.tenant)
    def reject(self, code, fn):
        with self.assertRaises(Rejection) as cm: fn()
        self.assertEqual(cm.exception.status_code,code); self.assertNotIn('commit',self.calls); self.assertFalse(self.audits)
        return cm.exception.detail
    def tenant_query(self, query, model): self.assertIn((model+'.organization_id','=', 'org-A'),query.conditions)

    def test_office_create_exact_receipt_audit_commit_order(self):
        p=self.office_payload(); got=self.ns['create_office'](p,object(),self.db,self.tenant)
        self.assertEqual(got,{'id':'fake-flush-0',**p.model_dump()}); self.assertEqual(self.added[0].organization_id,'org-A')
        self.assertEqual(self.calls,['add','flush','audit','commit']); self.assertEqual(self.audits[0][0],'hr.office.created')
    def test_office_schema_numeric_and_name_boundaries(self):
        for change in [{'latitude':float('nan')},{'longitude':float('inf')},{'latitude':91},{'longitude':-181},{'radius_meters':24},{'radius_meters':1001},{'radius_meters':25.5},{'name':'x'},{'name':'x'*121}]:
            with self.subTest(change=change), self.assertRaises(ValidationError): self.office_payload(**change)
        self.assertEqual(self.office_payload(latitude=-90,longitude=180,radius_meters=1000).longitude,180)
    def test_office_patch_tenant_lock_full_receipt(self):
        self.queue=[self.office]; p=self.office_payload(); got=self.ns['update_office']('office-A',p,object(),self.db,self.tenant)
        self.assertEqual(got,{'id':'office-A',**p.model_dump()}); self.tenant_query(self.queries[0],'HROfficeLocation'); self.assertTrue(self.queries[0].lock)
        self.assertEqual(self.audits[0][3]['before']['name'],'Main office'); self.assertEqual(self.calls[-2:],['audit','commit'])
    def test_office_deactivation_blocks_any_policy_not_employee_status(self):
        self.queue=[self.office,1]; self.reject(409,lambda:self.ns['update_office']('office-A',self.office_payload(is_active=False),object(),self.db,self.tenant))
        self.assertEqual(self.queries[1].targets,(('count','EmployeeAttendancePolicy.id'),)); self.assertEqual(self.queries[1].conditions,(('EmployeeAttendancePolicy.organization_id','=','org-A'),('EmployeeAttendancePolicy.office_id','=','office-A'))); self.assertTrue(self.office.is_active)
    def test_office_missing_rejected_before_write(self):
        self.queue=[None]; self.reject(404,lambda:self.ns['update_office']('absent',self.office_payload(),object(),self.db,self.tenant))
    def test_policy_exact_receipt_and_locked_tenant_update(self):
        self.queue=[self.employee,self.office,None,self.policy]; p=self.policy_payload(weekly_modes=['office','remote','field','off','off','remote','office'])
        got=self.ns['upsert_policy']('employee-A',p,object(),self.db,self.tenant); self.assertEqual(got,{'employee_id':'employee-A',**p.model_dump()}); self.assertEqual(self.policy.weekly_modes,p.weekly_modes)
        for q,model in zip(self.queries,['Employee','HROfficeLocation','AttendanceRecord','EmployeeAttendancePolicy']): self.tenant_query(q,model)
        self.assertTrue(self.queries[-1].lock); self.assertIn(('HROfficeLocation.is_active','is',True),self.queries[1].conditions); self.assertEqual(self.calls[-3:],['flush','audit','commit'])
    def test_policy_create_remote_without_office(self):
        self.queue=[self.employee,None,None]; p=self.policy_payload(office_id=None,weekly_modes=['remote']*7)
        got=self.ns['upsert_policy']('employee-A',p,object(),self.db,self.tenant); self.assertEqual(got,{'employee_id':'employee-A',**p.model_dump()}); self.assertEqual(len(self.added),1)
    def test_policy_rejects_missing_or_inactive_office_before_write(self):
        for missing in [True,False]:
            with self.subTest(missing=missing):
                self.queue=[self.employee] if missing else [self.employee,None]
                self.reject(400,lambda:self.ns['upsert_policy']('employee-A',self.policy_payload(office_id=None if missing else 'office-A'),object(),self.db,self.tenant))
    def test_policy_today_checkin_conflict_uses_local_day(self):
        self.queue=[self.employee,self.office,object()]; self.reject(409,lambda:self.ns['upsert_policy']('employee-A',self.policy_payload(),object(),self.db,self.tenant))
        self.assertIn(('AttendanceRecord.attendance_date','=',self.today),self.queries[-1].conditions); self.assertIn(('AttendanceRecord.check_in_at','is not',None),self.queries[-1].conditions)
    def test_policy_seven_modes_and_enum(self):
        for modes in [[],['off']*6,['off']*8]:
            with self.assertRaises(ValidationError): self.policy_payload(weekly_modes=modes)
        self.queue=[self.employee]; self.reject(400,lambda:self.ns['upsert_policy']('employee-A',self.policy_payload(weekly_modes=['bad']*7),object(),self.db,self.tenant))
    def test_requests_cap_tenant_predicates_and_receipt_shape(self):
        self.queue=[[(self.item,'CODE','Example')]]; got=self.ns['list_requests'](self.db,self.tenant); q=self.queries[0]
        self.assertEqual(q.cap,100)
        for model in ['HRAttendanceRequest','Employee','Membership']: self.tenant_query(q,model)
        self.assertEqual(got[0],{**self.ns['_request_data'](self.item),'employee_name':'Example','employee_code':'CODE'})
    def test_review_rejection_receipt_has_no_joined_employee_or_review_timestamp(self):
        self.queue=[self.item,self.employee]; got=self.review('rejected','Reviewed')
        self.assertEqual(set(got),{'id','employee_id','work_date','request_type','requested_mode','reason','proposed_check_in_at','proposed_check_out_at','status','review_notes','created_at'})
        self.assertEqual(got['review_notes'],'Reviewed'); self.assertEqual(got['status'],'rejected'); self.assertEqual(self.calls[-2:],['audit','commit']); self.assertTrue(all(q.lock for q in self.queries))
        self.tenant_query(self.queries[0],'HRAttendanceRequest'); self.tenant_query(self.queries[1],'Employee')
    def test_review_invalid_missing_already_reviewed_self(self):
        self.reject(400,lambda:self.review('bad'))
        self.queue=[None]; self.reject(404,self.review)
        self.item.status='approved';self.queue=[self.item];self.reject(409,self.review)
        self.item.status='pending';self.employee.membership_id='manager-A';self.queue=[self.item,self.employee];self.reject(403,self.review)
    def test_remote_approval_conflicts_before_any_commit(self):
        self.item.work_date=self.today-timedelta(days=1);self.queue=[self.item,self.employee];self.reject(409,self.review)
        self.item.work_date=self.today;self.ns['effective_attendance_mode']=lambda *a,**kw:('off',self.policy,None);self.queue=[self.item,self.employee];self.reject(409,self.review)
        self.ns['effective_attendance_mode']=lambda *a,**kw:('office',self.policy,self.office);self.queue=[self.item,self.employee,object()];self.reject(409,self.review)
    def test_remote_approval_full_receipt(self):
        self.queue=[self.item,self.employee,None]; got=self.review(); self.assertEqual(got['status'],'approved');self.assertEqual(self.item.reviewed_by_user_id,'user-A');self.assertEqual(self.calls[-2:],['audit','commit'])
    def test_correction_updates_attendance_clears_gps_audits_then_commits(self):
        start=datetime(2020,1,1,8,tzinfo=timezone.utc);end=start+timedelta(hours=9)
        self.item.request_type='correction';self.item.proposed_check_in_at=start;self.item.proposed_check_out_at=end
        record=NS(id='attendance-A',check_in_at=start,check_out_at=end,work_minutes=1,overtime_minutes=0,status='late',source='gps',check_in_latitude=23,check_in_longitude=90,check_in_accuracy_meters=4,office_id='office-A')
        self.queue=[self.item,self.employee,record];got=self.review()
        self.assertEqual(got['status'],'approved');self.assertEqual((record.work_minutes,record.overtime_minutes,record.status,record.source,record.verification_method),(540,60,'present','correction','hr_correction'))
        for name in ['check_in_latitude','check_in_longitude','check_in_accuracy_meters','office_id']:self.assertIsNone(getattr(record,name))
        self.assertTrue(self.queries[-1].lock);self.tenant_query(self.queries[-1],'AttendanceRecord');self.assertEqual([a[0] for a in self.audits],['hr.attendance.corrected','hr.attendance_request.reviewed']);self.assertEqual(self.calls[-4:],['flush','audit','audit','commit'])
        calls={n.func.id for n in ast.walk(node('review_request')) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name)}
        self.assertEqual(calls,{'HTTPException','select','_local_date','effective_attendance_mode','AttendanceRecord','shift_for_date','max','int','scheduled_presence_minutes','attendance_status_for_check_in','ZoneInfo','_audit','_request_data'})  # No direct payroll call; not a runtime payroll integration claim.
    def test_correction_invalid_times_do_not_write(self):
        self.item.request_type='correction';self.queue=[self.item,self.employee];self.reject(409,self.review)
    def test_commit_exception_is_not_proof_write_did_not_apply(self):
        self.fail_commit=True
        with self.assertRaisesRegex(RuntimeError,'persistence unknown'):self.ns['create_office'](self.office_payload(),object(),self.db,self.tenant)
        self.assertEqual(self.calls,['add','flush','audit','commit']);self.assertEqual(len(self.added),1)
    def test_declared_permission_and_status_contracts(self):
        for name in ['list_offices','list_policies']:self.assertEqual(ast.unparse(node(name).args.args[-1].annotation),'HRViewer')
        for name in ['list_requests','create_office','update_office','upsert_policy','review_request']:self.assertEqual(ast.unparse(node(name).args.args[-1].annotation),'HRManager')
        decorator=node('create_office').decorator_list[0];self.assertEqual(next(k.value.value for k in decorator.keywords if k.arg=='status_code'),201)
        for name in ['update_office','upsert_policy','review_request']:self.assertFalse(any(k.arg=='status_code' for k in node(name).decorator_list[0].keywords)) # FastAPI default declaration, no HTTP execution.


if __name__ == '__main__': unittest.main(verbosity=2)
