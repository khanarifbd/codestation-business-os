"""Actual Records query services/route bodies, synthetic SQLite only; no PostgreSQL proof."""
import ast
import base64
import copy
from datetime import date, datetime, timedelta
import hashlib
import json
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
from starlette.datastructures import QueryParams
from app.models.hr import EmployeeHRDocument, EmployeeLifecycleEvent
from app.models.team import Employee
from app.models.membership import Membership
from app.models.user import User
from app.services.hr_records_queries import parse_records_page, documents_page, lifecycle_page

ROOT = Path(__file__).resolve().parents[1]
STAMP = datetime(2026, 1, 1, 12)
LEGACY_AST = {'list_documents': '03e076c0a47481463b25db24fb8d1ebc902e3cecc1f1bce01de709a89c7fcbb3', 'list_lifecycle': 'b3c9fd845395f09dc83ed9ef4d89452b34bcd7ec97f8dc552abf7d4fc6c566d1', 'create_document': 'ecc1a9ce716ac6d09f02855025acc0be8589430dad6da9687703f0ff2785e188', 'create_lifecycle': 'bed7f1a3fd642a0728ef2de55a2d8f5aa3d2d16acc6f2e21eb807b9bafcfbb46'}

def actual(name, ns):
    node = copy.deepcopy(next(n for n in ast.parse((ROOT/'app/api/v1/hr.py').read_text()).body if isinstance(n, ast.FunctionDef) and n.name == name))
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(ROOT/'app/api/v1/hr.py'), 'exec'), ns)
    return ns[name]

class Compiler(SQLiteTypeCompiler):
    def visit_JSONB(self, *a, **k): return 'JSON'

class RecordsPages(unittest.TestCase):
    def setUp(self):
        def blocked(*a, **k): raise AssertionError('Offline Records test forbids network/PostgreSQL')
        for target, name in [(socket.socket,'connect'),(socket.socket,'connect_ex'),(socket.socket,'bind'),(socket.socket,'listen'),(socket,'create_connection'),(socket,'getaddrinfo'),(socket,'gethostbyname')]:
            p = patch.object(target, name, blocked); p.start(); self.addCleanup(p.stop)
        import psycopg
        for target in [psycopg, psycopg.Connection, psycopg.AsyncConnection]:
            p = patch.object(target,'connect',blocked); p.start(); self.addCleanup(p.stop)
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.engine.dialect.type_compiler_instance = Compiler(self.engine.dialect)
        self.addCleanup(self.engine.dispose)
        for m in [User, Membership, Employee, EmployeeHRDocument, EmployeeLifecycleEvent]: m.__table__.create(self.engine)
        with self.engine.begin() as c:
            c.execute(User.__table__.insert(), {'id':'u','full_name':'Synthetic inactive','email':'test@example.invalid','password_hash':'unused'})
            c.execute(Membership.__table__.insert(), {'id':'m','organization_id':'A','user_id':'u','role_id':'r','role':'employee','status':'active'})
            c.execute(Employee.__table__.insert(), {'id':'e','organization_id':'A','membership_id':'m','employee_code':'OLD','employment_status':'inactive'})
        self.db = Session(self.engine); self.addCleanup(self.db.close)
        ns = dict(select=select, EmployeeHRDocument=EmployeeHRDocument, EmployeeLifecycleEvent=EmployeeLifecycleEvent, Employee=Employee, Membership=Membership, User=User, documents_page=documents_page,lifecycle_page=lifecycle_page,parse_records_page=parse_records_page)
        actual('_employee_names',ns)
        self.handlers = {'documents':actual('list_documents',ns),'lifecycle':actual('list_lifecycle',ns)}

    def seed(self, count=205, ties=False):
        with self.engine.begin() as c:
            for resource, model in [('documents',EmployeeHRDocument),('lifecycle',EmployeeLifecycleEvent)]:
                rows=[]
                for i in range(count):
                    row={'id':f'{resource[0]}{i:03}','organization_id':'A','employee_id':'e','title':f'Record {i}','created_at':STAMP if ties else STAMP+timedelta(seconds=i)}
                    if resource=='documents': row.update(document_type='contract' if i%2 else 'identity',file_url=None,storage_key='private-key-not-exposed')
                    else: row.update(event_type='note' if i%2 else 'joining',effective_date=date(2026,1,1) if ties else date(2026,1,1)+timedelta(days=i),details={},created_by_user_id='u')
                    rows.append(row)
                c.execute(model.__table__.insert(), rows)
                foreign=dict(rows[-1],id='foreign',organization_id='B'); c.execute(model.__table__.insert(),foreign)

    def call(self, resource, params=None, org='A'):
        req=None if params is None else NS(query_params=QueryParams(params))
        return self.handlers[resource](self.db,NS(organization_id=org),req)

    def traverse(self,resource,query='mode=page&limit=37'):
        ids=[]; cursor=None
        for _ in range(20):
            page=self.call(resource,query+('&cursor='+cursor if cursor else ''))
            self.assertEqual(set(page),{'items','next_cursor'})
            ids.extend(r['id']for r in page['items']); cursor=page['next_cursor']
            if not cursor:return ids
        self.fail('Cursor traversal did not terminate')

    def test_legacy_arrays_200_preserved(self):
        self.seed()
        for resource in self.handlers:
            rows=self.call(resource);self.assertEqual(len(rows),200);self.assertNotIn(resource[0]+'000',[r['id']for r in rows]);self.assertNotIn('foreign',[r['id']for r in rows])
            self.assertEqual(rows,self.call(resource,'unrecognized_legacy_option=ignored'))

    def test_more_than_200_and_ties_complete(self):
        self.seed(ties=True)
        for resource in self.handlers:
            got=self.traverse(resource);self.assertEqual(got,[f'{resource[0]}{i:03}'for i in reversed(range(205))]);self.assertEqual(len(set(got)),205)

    def test_oldest_detail_and_private_metadata(self):
        self.seed()
        for resource in self.handlers:
            result=self.call(resource,'mode=page&record_id='+resource[0]+'000')
            self.assertEqual(len(result['items']),1);self.assertIsNone(result['next_cursor']);self.assertEqual(result['items'][0]['employee_name'],'Synthetic inactive')
            self.assertNotIn('storage_key',result['items'][0]);self.assertNotIn('original_filename',result['items'][0])
            self.assertEqual(self.call(resource,'mode=page&record_id=foreign')['items'],[])
            self.assertEqual(self.call(resource,'mode=page&record_id=missing')['items'],[])

    def test_exact_shape_matches_legacy(self):
        self.seed(3)
        for resource in self.handlers:
            legacy=self.call(resource);paged=self.call(resource,'mode=page')['items'];self.assertEqual(legacy,paged)

    def test_employee_and_type_filter_full_traversal(self):
        self.seed()
        for resource,key,value in [('documents','document_type','identity'),('lifecycle','event_type','joining')]:
            ids=self.traverse(resource,'mode=page&limit=21&employee_id=e&'+key+'='+value)
            self.assertEqual(len(ids),103);self.assertTrue(all(int(i[1:])%2==0 for i in ids));self.assertEqual(self.call(resource,'mode=page&employee_id=other')['items'],[])

    def test_inclusive_date_filters(self):
        self.seed(3)
        self.assertEqual(len(self.call('documents','mode=page&date_from=2026-01-01&date_to=2026-01-01')['items']),3)
        self.assertEqual(len(self.call('lifecycle','mode=page&date_from=2026-01-02&date_to=2026-01-02')['items']),1)
        for resource in self.handlers:self.assertEqual(self.call(resource,'mode=page&date_from=9999-12-31&date_to=9999-12-31')['items'],[])

    def test_cursor_resource_tenant_limit_and_filter_binding(self):
        self.seed(5);token=self.call('documents','mode=page&limit=2')['next_cursor']
        for resource,query,org in [('documents','mode=page&limit=2','B'),('lifecycle','mode=page&limit=2','A'),('documents','mode=page&limit=3','A'),('documents','mode=page&limit=2&employee_id=e','A'),('documents','mode=page&limit=2&document_type=contract','A'),('documents','mode=page&limit=2&date_from=2026-01-01','A')]:
            with self.subTest(resource=resource,query=query,org=org),self.assertRaises(HTTPException)as e:self.call(resource,query+'&cursor='+token,org)
            self.assertEqual(e.exception.status_code,422)

    def test_cursor_not_snapshot_and_deleted_boundary(self):
        self.seed(5);page=self.call('documents','mode=page&limit=2');last=page['items'][-1]['id'];self.db.execute(EmployeeHRDocument.__table__.delete().where(EmployeeHRDocument.id==last));self.db.commit()
        self.assertEqual([x['id']for x in self.call('documents','mode=page&limit=2&cursor='+page['next_cursor'])['items']],['d002','d001'])

    def test_cursor_payload_strict(self):
        self.seed(3);token=self.call('documents','mode=page&limit=1')['next_cursor'];payload=json.loads(base64.urlsafe_b64decode(token+'='*(-len(token)%4)))
        mutations=[lambda x:x.update(v=True),lambda x:x.update(extra=1),lambda x:x['key'].update(extra=1),lambda x:x['key'].update(created_at='2026-01-01T00:00:00'),lambda x:x['key'].update(id=''),lambda x:x['key'].update(id='a\x00'),lambda x:x['key'].update(id='x'*37)]
        for change in mutations:
            value=copy.deepcopy(payload);change(value);bad=base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()
            with self.assertRaises(HTTPException)as e:self.call('documents','mode=page&limit=1&cursor='+bad)
            self.assertEqual(e.exception.status_code,422)

    def test_legacy_bodies_and_write_policies_exact(self):
        tree=ast.parse((ROOT/'app/api/v1/hr.py').read_text())
        for name,digest in LEGACY_AST.items():
            node=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name==name))
            if name.startswith('list_'):
                self.assertEqual(node.args.args[-1].arg,'request');node.args.args.pop();node.args.defaults.pop()
                branches=[n for n in node.body if isinstance(n,ast.If)]
                self.assertEqual(len(branches),1);node.body.remove(branches[0])
            self.assertEqual(hashlib.sha256(ast.dump(node,include_attributes=False,show_empty=True).encode()).hexdigest(),digest,name)

    def test_lifecycle_resource_filter_rejected(self):
        for query in ['mode=page&document_type=contract','mode=page&event_type='+('x'*41),'mode=page&event_type=note&event_type=note','mode=page&record_id=x&event_type=note']:
            with self.assertRaises(HTTPException):self.call('lifecycle',query)

    def test_document_utc_day_edges(self):
        with self.engine.begin()as c:
            c.execute(EmployeeHRDocument.__table__.insert(),[{'id':str(i),'organization_id':'A','employee_id':'e','title':'Edge','document_type':'contract','created_at':stamp}for i,stamp in enumerate([datetime(2025,12,31,23,59,59,999999),datetime(2026,1,1),datetime(2026,1,1,23,59,59,999999),datetime(2026,1,2)])])
        self.assertEqual([x['id']for x in self.call('documents','mode=page&date_from=2026-01-01&date_to=2026-01-01')['items']],['2','1'])

    def test_history_primary_effective_then_created_and_id(self):
        with self.engine.begin()as c:
            c.execute(EmployeeLifecycleEvent.__table__.insert(),[{'id':ident,'organization_id':'A','employee_id':'e','title':'Order','event_type':'note','created_by_user_id':'u','details':{},'effective_date':effective,'created_at':created}for ident,effective,created in [('a',date(2026,1,2),STAMP),('b',date(2026,1,2),STAMP),('c',date(2026,1,1),STAMP+timedelta(days=10)),('d',date(2026,1,2),STAMP+timedelta(seconds=1))]])
        self.assertEqual(self.traverse('lifecycle','mode=page&limit=1'),['d','b','a','c'])

    def test_duplicate_cursor_json_field_rejected(self):
        self.seed(2);token=self.call('documents','mode=page&limit=1')['next_cursor'];raw=base64.urlsafe_b64decode(token+'='*(-len(token)%4)).decode();bad=base64.urlsafe_b64encode(raw.replace('"v":1','"v":1,"v":1').encode()).rstrip(b'=').decode();self.assertNotEqual(token,bad)
        with self.assertRaises(HTTPException):self.call('documents','mode=page&limit=1&cursor='+bad)

    def test_cursor_extreme_timezone_and_unicode_fail_closed(self):
        self.seed(2)
        for resource in self.handlers:
            token=self.call(resource,'mode=page&limit=1')['next_cursor'];original=json.loads(base64.urlsafe_b64decode(token+'='*(-len(token)%4)))
            for field,bad in [('created_at','0001-01-01T00:00:00+23:59'),('created_at','9999-12-31T23:59:59-23:59'),('created_at',[]),('created_at',{'nested':1}),('created_at','invalid'),('id','\ud800')]:
                value=copy.deepcopy(original);value['key'][field]=bad;encoded=base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()
                with self.subTest(resource=resource,field=field,bad=repr(bad)),self.assertRaises(HTTPException)as e:self.call(resource,'mode=page&limit=1&cursor='+encoded)
                self.assertEqual(e.exception.status_code,422)

    def test_cursor_nested_wrong_shapes_and_non_utf8_fail_closed(self):
        self.seed(2)
        for raw in [b'null',b'[]',b'"text"',b'true',b'{"v":1,"context":{},"key":[]}',b'\xff',b'['*1100+b'0'+b']'*1100]:
            encoded=base64.urlsafe_b64encode(raw).rstrip(b'=').decode()
            with self.subTest(raw=raw[:20]),self.assertRaises(HTTPException)as e:self.call('documents','mode=page&limit=1&cursor='+encoded)
            self.assertEqual(e.exception.status_code,422)

    def test_exactrecord_rejects_every_browse_selector(self):
        for resource,extra in [('documents','document_type=contract'),('lifecycle','event_type=note')]:
            for selector in ['employee_id=e','cursor=x','date_from=2026-01-01','date_to=2026-01-02',extra]:
                with self.assertRaises(HTTPException)as e:self.call(resource,'mode=page&record_id=d000&'+selector)
                self.assertEqual(e.exception.status_code,422)

    def test_unicode_query_values_fail_closed(self):
        for resource,key in [('documents','employee_id'),('documents','document_type'),('lifecycle','event_type'),('documents','record_id')]:
            with self.assertRaises(HTTPException)as e:self.call(resource,[('mode','page'),(key,'\ud800')])
            self.assertEqual(e.exception.status_code,422)

    def test_permissions_and_mutations_untouched(self):
        tree=ast.parse((ROOT/'app/api/v1/hr.py').read_text())
        for name in ['list_documents','list_lifecycle']:
            node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name==name)
            self.assertEqual(ast.unparse(next(a.annotation for a in node.args.args if a.arg=='tenant')),'HRViewer')
        # Bound names/policies checked separately against the frozen source by the lead evidence script.

INVALID=['mode=bad','mode=','mode=page&mode=page','mode=page&limit=0','mode=page&limit=101','mode=page&limit=-1','mode=page&limit=1.0','mode=page&limit=1&limit=2','mode=page&q=unimplemented','mode=page&date_from=20260101','mode=page&date_from=2026-02-30','mode=page&date_from=2026-02-02&date_to=2026-01-01','mode=page&date_to=0','mode=page&record_id=x&employee_id=e','mode=page&record_id=x&cursor=x','mode=page&record_id=x&document_type=contract','mode=page&employee_id=','mode=page&employee_id=%00','mode=page&employee_id='+('x'*37),'mode=page&document_type='+('x'*65),'mode=page&cursor=','mode=page&cursor=%','mode=page&cursor='+('a'*4097),'mode=page&event_type=note','mode=page&date_from=2026-01-01&date_from=2026-01-01','mode=page&record_id=x&record_id=y']
for i,query in enumerate(INVALID):
    def test(self, query=query):
        with self.assertRaises(HTTPException)as caught:self.call('documents',query)
        self.assertEqual(caught.exception.status_code,422)
    setattr(RecordsPages,f'test_invalid_query_{i:02}',test)

if __name__=='__main__':unittest.main()
