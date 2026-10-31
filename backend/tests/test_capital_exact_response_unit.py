"""Actual HTTP serialization with synthetic in-memory collaborators, no database."""
import asyncio
from copy import deepcopy
from datetime import date
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.routing import serialize_response
from fastapi.testclient import TestClient
from app.api.v1 import capital, capital_insights
from app.schemas.capital_response import CapitalExactResponse, CAPITAL_DECIMAL_FIELDS

ROOT = Path(__file__).resolve().parents[1]
class Rows:
    def __init__(self, rows): self.rows = rows
    def all(self): return self.rows
class DB:
    def __init__(self, rows): self.rows = rows; self.commits = 0
    def scalars(self, statement): return Rows(self.rows)
    def add(self, row): self.rows.append(row)
    def flush(self):
        for row in self.rows:
            if not row.id: row.id = 'synthetic-created-investor'
    def commit(self): self.commits += 1

def investor(amount='90071992547409.91'):
    return NS(id='synthetic-investor',investor_name='Synthetic only',investor_email=None,investor_type='individual',instrument='equity',currency='USD',committed_amount=Decimal(amount),funded_amount=Decimal('0.00'),ownership_percent=None,valuation_amount=None,agreement_date=date(2026,10,30),effective_date=None,expected_exit_date=None,agreement_reference=None,status='active',notes=None)

def without_companions(value):
    if isinstance(value,dict): return {key:without_companions(item) for key,item in value.items() if not key.endswith('_exact')}
    if isinstance(value,list): return [without_companions(item) for item in value]
    return value

class CapitalWireTests(unittest.TestCase):
    def app(self, db):
        app=FastAPI(); app.include_router(capital.router); app.include_router(capital_insights.router)
        tenant=NS(organization_id='synthetic-company',user_id='synthetic-user')
        for route in [*capital.router.routes,*capital_insights.router.routes]:
            for dependency in route.dependant.dependencies:
                if dependency.name=='db': app.dependency_overrides[dependency.call]=lambda:db
                elif dependency.name=='tenant': app.dependency_overrides[dependency.call]=lambda:tenant
        return app

    def test_actual_get_handler_keeps_decimal_but_http_adds_exact_and_preserves_legacy(self):
        for amount in ['0.01','90071992547409.91','9999999999999999.99']:
            with self.subTest(amount=amount):
                db=DB([investor(amount)])
                direct=capital.company_investors(db,NS(organization_id='synthetic-company'))
                self.assertIsInstance(direct[0]['committed_amount'],Decimal)
                response=TestClient(self.app(db)).get('/capital/company-investors')
                self.assertEqual(response.status_code,200)
                wire=response.json()
                self.assertEqual(without_companions(wire),jsonable_encoder(direct))
                self.assertEqual(wire[0]['committed_amount_exact'],amount)
                self.assertIsNone(wire[0]['valuation_amount_exact'])
                self.assertEqual(db.commits,0)

    def test_actual_post_handler_preserves_201_and_direct_accounting_behavior(self):
        db=DB([])
        with patch.object(capital,'functional_currency_for_date',return_value='USD'), patch.object(capital,'record_activity'):
            response=TestClient(self.app(db)).post('/capital/company-investors',json={'investor_name':'Synthetic only','investor_type':'individual','instrument':'equity','currency':'USD','committed_amount':'90071992547409.91','agreement_date':'2026-10-30'})
        self.assertEqual(response.status_code,201,response.text)
        body=response.json()
        self.assertEqual(body['committed_amount_exact'],'90071992547409.91')
        self.assertEqual(body['committed_amount'],jsonable_encoder(Decimal('90071992547409.91')))
        self.assertIsInstance(db.rows[0].committed_amount,Decimal)
        self.assertEqual(db.commits,1)

    def test_all_23_actual_routes_use_same_boundary_and_document_additive_fields(self):
        app=self.app(DB([])); schema=app.openapi()
        routes=[*capital.router.routes,*capital_insights.router.routes]
        self.assertEqual(len(routes),23)
        model=schema['components']['schemas']['CapitalExactResponse']
        self.assertEqual(set(model['x-capital-exact-decimal-fields']),CAPITAL_DECIMAL_FIELDS)
        self.assertEqual(set(model['x-capital-exact-companions']),{f'{field}_exact' for field in CAPITAL_DECIMAL_FIELDS})
        for route in routes:
            with self.subTest(route=route.path,methods=route.methods):
                self.assertIs(route.response_model,CapitalExactResponse)
                status=route.status_code or 200
                for method in route.methods:
                    spec=schema['paths'][route.path][method.lower()]
                    self.assertEqual(spec['responses'][str(status)]['content']['application/json']['schema']['$ref'],'#/components/schemas/CapitalExactResponse')
                    self.assertNotIn('exact_money',[p['name'] for p in spec.get('parameters',[])])
                raw={'rows':[{field:Decimal('-0.01') for field in CAPITAL_DECIMAL_FIELDS}], 'count':1,'status':'active','date':date(2026,10,30),'nullable':None}
                wire=asyncio.run(serialize_response(field=route.response_field,response_content=raw,is_coroutine=False))
                self.assertEqual(without_companions(wire),jsonable_encoder(raw))
                self.assertTrue(all(wire['rows'][0][f'{key}_exact']=='-0.01' for key in CAPITAL_DECIMAL_FIELDS))

    def test_financial_scales_nested_nulls_counts_and_source_not_mutated(self):
        raw={'fundings':[{'amount':Decimal('9999999999999999.99')}], 'ownership_percent':Decimal('12.3456'),'share_value':Decimal('12345678.1234'),'valuation_amount':None,'outstanding_capital':Decimal('-2.50'),'active_investments':2,'id':'fixture','created_at':date(2026,10,30)}
        before=deepcopy(raw)
        wire=CapitalExactResponse(raw).model_dump(mode='json')
        self.assertEqual(raw,before)
        self.assertEqual(without_companions(wire),jsonable_encoder(raw))
        self.assertEqual(wire['ownership_percent_exact'],'12.3456')
        self.assertEqual(wire['share_value_exact'],'12345678.1234')
        self.assertEqual(wire['fundings'][0]['amount_exact'],'9999999999999999.99')
        self.assertNotIn('active_investments_exact',wire)
        self.assertEqual(json.dumps(without_companions(wire),separators=(',',':')),json.dumps(jsonable_encoder(raw),separators=(',',':')))

    def test_invalid_nonfinite_or_reserved_collision_cannot_emit_misleading_exact_value(self):
        for value in [{'amount':Decimal('NaN')},{'amount':Decimal('Infinity')},{'amount':Decimal('1.00'),'amount_exact':'2.00'}]:
            with self.subTest(value=str(value)):
                with self.assertRaises(Exception): CapitalExactResponse(value).model_dump(mode='json')

    def test_endpoint_bodies_permissions_and_arithmetic_remain_exact(self):
        baselines=json.loads((ROOT/'tests/fixtures/capital_exact_handler_baseline.json').read_text())
        for filename,expected in baselines.items():
            if filename == "verify_capital.py":
                continue
            source=(ROOT/'app/api/v1'/filename).read_text()
            self.assertEqual(source.count('from app.schemas.capital_response import CapitalExactResponse\n'),1)
            expected_count=22 if filename=='capital.py' else 1
            self.assertEqual(source.count(', response_model=CapitalExactResponse'),expected_count)
            restored=source.replace('from app.schemas.capital_response import CapitalExactResponse\n','').replace(', response_model=CapitalExactResponse','')
            self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(),expected)
            for old,new in [('require_tenant_permission("capital.view")','require_tenant_permission("capital.manage")'),('return {','return {"tampered": True,')]:
                if old in restored:
                    self.assertNotEqual(hashlib.sha256(restored.replace(old,new,1).encode()).hexdigest(),expected)


    def test_existing_ci_verifier_runs_new_offline_proof_before_database_actions(self):
        source=(ROOT/'scripts/verify_capital.py').read_text()
        call='    subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_capital_exact_response_unit.py", "-v"], cwd=Path(__file__).resolve().parents[1], check=True)\n'
        self.assertIn('def main() -> None:\n'+call,source)
        self.assertEqual(source.count(call),1)
        restored=source.replace('from pathlib import Path\nimport subprocess\nimport sys\n\n','',1).replace(call,'',1)
        expected=json.loads((ROOT/'tests/fixtures/capital_exact_handler_baseline.json').read_text())['verify_capital.py']
        self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(),expected)
        self.assertIn('python scripts/verify_capital.py',(ROOT.parent/'.github/workflows/ci.yml').read_text())

if __name__=='__main__': unittest.main()
