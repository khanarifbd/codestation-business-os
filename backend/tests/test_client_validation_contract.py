"""Real Pydantic/FastAPI input boundaries; recording conversion probe, not DB proof.

The existing verify_crm_won_flow CI script runs this suite before its PostgreSQL
conversion scenario. Browser tests separately exercise authenticated client CRUD.
"""
import ast
import copy
from pathlib import Path
from types import SimpleNamespace
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.core.localization import (
    ISO_COUNTRY_CODES, ISO_CURRENCY_CODES,
    normalize_country_code, normalize_currency_code,
)
from app.models.crm import Lead, LeadStatus
from app.schemas.crm import ClientCreate, ClientUpdate, LeadConvertRequest

ROOT = Path(__file__).resolve().parents[1]
app = FastAPI()


@app.post('/client-input', status_code=201)
def create_input(payload: ClientCreate):
    return payload.model_dump(mode='json')


@app.patch('/client-input')
def update_input(payload: ClientUpdate):
    return payload.model_dump(mode='json', exclude_unset=True)


@app.post('/conversion-input')
def conversion_input(payload: LeadConvertRequest):
    return payload.model_dump(mode='json', exclude_unset=True)


class ClientValidationContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.http.close()

    def test_create_rejects_blank_name_before_handler(self):
        for value in ['', '   ', '\t\r\n', '\u00a0\u2003', None]:
            with self.subTest(value=value):
                response = self.http.post('/client-input', json={'display_name': value})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()['detail'][0]['loc'], ['body', 'display_name'])

    def test_unicode_and_internal_spacing_are_preserved_after_outer_trim(self):
        for value in ['José O’Connor', '株式会社', 'মোঃ আরিফ', 'Müller GmbH', 'A  B / C & Co.']:
            with self.subTest(value=value):
                for method in [self.http.post, self.http.patch]:
                    response = method('/client-input', json={'display_name': f' \u00a0{value}\t'})
                    self.assertIn(response.status_code, [200, 201])
                    self.assertEqual(response.json()['display_name'], value)
        self.assertEqual(ClientCreate(display_name='  '+'あ'*220+'  ').display_name, 'あ'*220)
        with self.assertRaises(ValidationError):
            ClientCreate(display_name='あ'*221)

    def test_required_patch_fields_cannot_be_null_or_blank(self):
        for field in ['display_name', 'client_type', 'status']:
            for value in [None, '', '   ']:
                with self.subTest(field=field, value=value):
                    response = self.http.patch('/client-input', json={field: value})
                    self.assertEqual(response.status_code, 422)
                    self.assertEqual(response.json()['detail'][0]['loc'], ['body', field])
        self.assertEqual(self.http.patch('/client-input', json={}).json(), {})
        self.assertEqual(ClientUpdate().model_fields_set, set())
        self.assertEqual(ClientUpdate(status='inactive', client_type='individual').model_dump(exclude_unset=True),
                         {'client_type': 'individual', 'status': 'inactive'})

    def test_optional_null_clears_without_implicit_defaults(self):
        optional = ['legal_name','contact_name','phone','whatsapp','country_code','currency',
                    'address_line1','address_line2','postal_code','tax_identifier','notes']
        payload = dict.fromkeys(optional)
        response = self.http.patch('/client-input', json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), payload)
        self.assertEqual(ClientUpdate(phone=None).model_dump(exclude_unset=True), {'phone': None})

    def test_codes_normalize_before_length_and_reject_unsupported_values(self):
        for schema, required in [(ClientCreate, {'display_name':'Client'}), (ClientUpdate, {}), (LeadConvertRequest,{})]:
            for country in ['GB','gb',' gb ']:
                for currency in ['GBP','gbp',' gbp ']:
                    payload = schema(**required, country_code=country, currency=currency)
                    self.assertEqual(payload.country_code, 'GB')
                    self.assertEqual(payload.currency, 'GBP')
            for field, values in [('country_code',['ZZ','',' ',7,True]), ('currency',['QQQ','',' ',7,True])]:
                for value in values:
                    with self.subTest(schema=schema.__name__, field=field,value=value):
                        with self.assertRaises(ValidationError):
                            schema(**required, **{field:value})
        for route, method, required in [('/client-input',self.http.post,{'display_name':'Client'}),
                                        ('/client-input',self.http.patch,{}),('/conversion-input',self.http.post,{})]:
            for field,value in [('country_code','ZZ'),('currency','QQQ')]:
                self.assertEqual(method(route,json={**required,field:value}).status_code,422)

    def test_existing_supported_code_sets_remain_accepted(self):
        for code in ISO_COUNTRY_CODES:
            self.assertEqual(ClientCreate(display_name='Client',country_code=code).country_code,code)
        for code in ISO_CURRENCY_CODES:
            self.assertEqual(ClientUpdate(currency=code).currency,code)
        self.assertEqual(LeadConvertRequest(country_code=None,currency=None).model_dump(exclude_unset=True),
                         {'country_code':None,'currency':None})

    def test_international_address_and_phone_values_are_not_westernized(self):
        for postal in ['SW1A 1AA','02108','H2Z 1A4']:
            payload = ClientCreate(display_name='国際 Client',postal_code=postal,phone='+44 20 1234 5678 ext 9',
                                   whatsapp='+880 1712 345678',address_line1='東京都 千代田区 1-2',
                                   tax_identifier='GB 123 4567 89')
            self.assertEqual(payload.postal_code,postal)
            self.assertEqual(payload.phone,'+44 20 1234 5678 ext 9')
            self.assertEqual(payload.whatsapp,'+880 1712 345678')
            self.assertEqual(payload.address_line1,'東京都 千代田区 1-2')
        for field,length in [('phone',64),('whatsapp',64),('postal_code',32)]:
            self.assertEqual(getattr(ClientUpdate(**{field:'x'*length}),field),'x'*length)
            with self.assertRaises(ValidationError):
                ClientUpdate(**{field:'x'*(length+1)})


class ClientConstructed(Exception):
    pass


def conversion_probe(country='GB',currency='GBP',category='won'):
    """Execute the real handler until Client construction, recording tenant SQL."""
    lead = SimpleNamespace(id='lead',organization_id='tenant',converted_client_id=None,status_id='won',
        lead_type='company',company_name='Müller GmbH',contact_name='José',email=None,phone=None,
        whatsapp=None,website=None,country_code=country,state_region=None,city=None,address_line1=None,
        currency=currency,assigned_employee_id=None,notes=None,source_id=None)
    queries=[]; clients=[]; sequences=[]
    class DB:
        def scalar(self,query):
            compiled=query.compile(dialect=postgresql.dialect())
            queries.append((str(compiled),compiled.params))
            return lead if len(queries)==1 else SimpleNamespace(category=category)
        def add(self,*args):
            raise AssertionError('Unexpected write in validation probe')
    def client(**kwargs):
        clients.append(kwargs)
        raise ClientConstructed()
    ns={'select':select,'Lead':Lead,'LeadStatus':LeadStatus,'HTTPException':HTTPException,
        'normalize_country_code':normalize_country_code,'normalize_currency_code':normalize_currency_code,
        '_tenant_employee':lambda *args:None,'Client':client,
        'next_sequence_code':lambda *args:sequences.append(args) or 'C-001'}
    tree=ast.parse((ROOT/'app/api/v1/crm.py').read_text())
    nodes=[]
    for name in ['_clean','_payload_value','convert_lead']:
        node=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name))
        node.decorator_list=[]; nodes.append(node)
    code=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),*nodes],type_ignores=[])
    exec(compile(ast.fix_missing_locations(code),'crm-conversion-probe','exec'),ns)
    def call(payload):
        return ns['convert_lead']('lead',payload,None,DB(),SimpleNamespace(organization_id='tenant',user_id='user'))
    return call,queries,clients,sequences


class EffectiveConversionCodes(unittest.TestCase):
    def test_legacy_invalid_codes_reject_before_client_or_sequence_mutation(self):
        for country,currency in [('ZZ','GBP'),('GB','QQQ')]:
            call,queries,clients,sequences=conversion_probe(country,currency)
            with self.assertRaises(HTTPException) as raised:
                call(LeadConvertRequest())
            self.assertEqual(raised.exception.status_code,422)
            self.assertEqual(clients,[]); self.assertEqual(sequences,[])
            self.assertEqual(queries[0][1]['organization_id_1'],'tenant')
            self.assertEqual(queries[1][1]['organization_id_1'],'tenant')
            self.assertIn('FOR UPDATE',queries[0][0])

    def test_valid_override_repairs_legacy_codes_without_changing_won_or_tenant_gate(self):
        call,queries,clients,sequences=conversion_probe('ZZ','QQQ')
        with self.assertRaises(ClientConstructed):
            call(LeadConvertRequest(country_code=' gb ',currency=' gbp '))
        self.assertEqual(clients[0]['country_code'],'GB')
        self.assertEqual(clients[0]['currency'],'GBP')
        self.assertEqual(clients[0]['display_name'],'Müller GmbH')
        self.assertEqual(clients[0]['organization_id'],'tenant')
        self.assertEqual(len(sequences),1)
        call,_,clients,sequences=conversion_probe(category='open')
        with self.assertRaises(HTTPException) as raised:
            call(LeadConvertRequest(country_code='GB',currency='GBP'))
        self.assertEqual(raised.exception.status_code,409)
        self.assertEqual(clients,[]); self.assertEqual(sequences,[])

    def test_valid_inherited_codes_normalize_and_explicit_null_remains_null(self):
        for payload,expected in [(LeadConvertRequest(),('GB','GBP')),
                                  (LeadConvertRequest(country_code=None,currency=None),(None,None))]:
            call,_,clients,_=conversion_probe(' gb ',' gbp ')
            with self.assertRaises(ClientConstructed):
                call(payload)
            self.assertEqual((clients[0]['country_code'],clients[0]['currency']),expected)


if __name__ == '__main__':
    unittest.main()
