"""Source, SQL and actual-handler fake-session contracts; not PostgreSQL concurrency proof."""
import ast
import importlib.util
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace as NS
from datetime import date
from decimal import Decimal
import socket
import sys
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'app/api/v1/accounting_loans.py'
spec=importlib.util.spec_from_file_location('loan_account_lock_review_api',SOURCE)
api=importlib.util.module_from_spec(spec);sys.modules[spec.name]=api;spec.loader.exec_module(api)
BASELINE_SOURCE_SHA256 = 'c817ec28c4418c4c1cf86bf53fbd5246fad2b56ca0cae7fd7f1d16308f248493'
# Exact original classes/functions; comparison excludes only the documented lock additions.
BASELINE_FUNCTION_HASHES = {'AccountingLoanCreate': 'dcdb6c8a0e6083ae3b132e7cad2ecdc01d7de8d031cccbf9507049f79bcbe5b0', 'LoanDisbursementCreate': '47ec732bacbfaa4d51e4eeb1ba9890c3a717ec5c6ff4e44a049954e0c44195ae', 'LoanAccountingRepaymentCreate': 'bd0dea4f026dc3e49661d52050637bfc379ad8c808e8fd8d7e824f28255d27a0', 'ScheduleLineCreate': 'd5a7f6480344742f08d63eb1593341d75dd5742a53aa5edc62b5ea327b06614f', 'LoanScheduleCreate': '95e1bfbd64e550db4d243a9325768420b6fcc30eb9d299d266ee3aed9dfb3827', '_balance': '7d5c0bba5abfa612ad2fb2c69a02bbb701f2c20f52f1ce37d0650c4148b9e7cc', '_cash_transaction': 'b380f70f5b458d17befeffe79ee4a88951e9771752fc182f7c9eb08ac2c31f18', '_loan': 'a275389d1f873f47d76bda93579a647e185c3ed211cf0afacb35cb87cd0bef72', '_disbursed_total': '3225cfe6f34a3f0bf34941f59dbd291df5ed97b5c908f62bef6c4f2ae87e300f', '_loan_principal_carrying_base': '646f8b7b963eec00493281d573d87aea8ed833cc2df0585380ca6acba2fb00ce', '_loan_json': '45c8ad19ae8a06e67260b53efeb22eaad8200469ad8312e77265b63dfeb7b765', 'list_accounting_loans': '6dfc065fa6dcabe64749f66eddd941736e57b82dc79fb71066d1dc876d454b12', 'create_accounting_loan': 'c241740781710e4515a2f8cec277c71bdb8897909afa7a3f5b2ea6ac5b6f7893', 'approve_loan': '01b64b0a499a0f47c7036b047d6fb3388686d1afedcecddba97cae625cdd9afc', 'disburse_loan': 'df092127039c5d9afc07e8d1ecf5b24644c326641b825e527552f967b6c0c789', 'repay_loan': '61f270fca7d5a1aecff5e09a0678692932179984fb1c21f00b7e873371294f20', 'close_loan': 'f93067bf268572e1b8363feca8f87377113378ecbec167e80202a661ab651e32', 'get_schedule': 'b982ac6a51462f5aa600fc326bbacb84af5e566c04adbf4f82f59fddc2d5cd69', 'replace_schedule': 'e5de2a301578456ac8da4868dab010279f9a71cb0143a7e5aa0a8d02b21f66c6'}
def syntax_hash(node):
    def normalized(value):
        if isinstance(value, ast.AST):
            return [type(value).__name__, {key: normalized(item) for key, item in ast.iter_fields(value) if not (key == "type_params" and not item)}]
        if isinstance(value, list):
            return [normalized(item) for item in value]
        return value
    return hashlib.sha256(json.dumps(normalized(node), sort_keys=True, separators=(",", ":")).encode()).hexdigest()

class StopAfterLock(Exception):pass

def loan(**changes):
    values=dict(id='loan-a',organization_id='org-a',status='active',loan_date=date(2026,1,1),principal_amount=Decimal('1000'),outstanding_principal=Decimal('300'),currency='USD',lender_name='Synthetic lender')
    values.update(changes);return NS(**values)
def account(**changes):
    values=dict(id='account-a',organization_id='org-a',is_active=True,currency='USD',opening_balance=Decimal('100'))
    values.update(changes);return NS(**values)
class FakeDB:
    def __init__(self,values):self.values=list(values);self.queries=[];self.events=[];self.added=[]
    def scalar(self,q):
        c=q.compile(dialect=postgresql.dialect());row=(str(c),c.params,q.get_execution_options());self.queries.append(row);self.events.append(('query',str(c)))
        if not self.values:raise AssertionError('Unexpected query '+str(c))
        return self.values.pop(0)
    def add(self,item):self.added.append(item);self.events.append(('add',type(item).__name__))
    def flush(self):self.events.append(('flush',))
    def commit(self):self.events.append(('commit',))
class LoanAccountLockTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall);patch.object(Engine,'connect',side_effect=AssertionError('No database')).start();patch.object(socket.socket,'connect',side_effect=AssertionError('No network')).start()
        self.tenant=NS(organization_id='org-a',user_id='synthetic-actor')
    def receive(self,**changes):
        data=dict(account_id='account-a',disbursement_date=date(2026,1,2),principal_amount=Decimal('100'),fee_withheld_amount=Decimal('0'));data.update(changes);return api.LoanDisbursementCreate(**data)
    def repay(self,**changes):
        data=dict(account_id='account-a',payment_date=date(2026,1,2),principal_amount=Decimal('20'),interest_amount=Decimal('2'),fee_amount=Decimal('1'));data.update(changes);return api.LoanAccountingRepaymentCreate(**data)
    def expect(self,status,fn):
        with self.assertRaises(HTTPException) as c:fn()
        self.assertEqual(c.exception.status_code,status)
    def assert_lock(self,row,table,identity):
        sql,params,options=row;self.assertIn(table,sql);self.assertIn('FOR UPDATE',sql);self.assertIn(identity,params.values());self.assertIn('org-a',params.values());self.assertTrue(options['populate_existing'])
    def test_account_lock_has_tenant_and_identity_predicates_and_refreshes_state(self):
        fresh=account();db=FakeDB([fresh]);self.assertIs(api._locked_loan_account(db,'org-a','account-a'),fresh);self.assert_lock(db.queries[0],'financial_accounts','account-a')
    def test_missing_account_stops(self):
        db=FakeDB([None]);self.expect(404,lambda:api._locked_loan_account(db,'org-a','account-a'));self.assertEqual(len(db.queries),1)
    def test_account_deactivated_while_waiting_stops(self):
        db=FakeDB([account(is_active=False)]);self.expect(404,lambda:api._locked_loan_account(db,'org-a','account-a'));self.assertTrue(db.queries[0][2]['populate_existing'])
    def test_other_tenant_query_is_explicit(self):
        db=FakeDB([None]);self.expect(404,lambda:api._locked_loan_account(db,'org-b','account-a'));self.assertIn('org-b',db.queries[0][1].values())
    def test_loan_row_is_refreshed_after_waiting(self):
        fresh=loan(status='closed');db=FakeDB([fresh]);self.assertIs(api._loan(db,'org-a','loan-a',lock=True),fresh);self.assert_lock(db.queries[0],'company_loans','loan-a')
    def test_read_only_loan_lookup_does_not_lock(self):
        db=FakeDB([loan()]);api._loan(db,'org-a','loan-a');self.assertNotIn('FOR UPDATE',db.queries[0][0])
    def test_receive_locks_loan_then_account_before_ledger_or_writes(self):
        db=FakeDB([loan(status='approved'),account()]);
        def stop(*args):db.events.append(('ledger',));raise StopAfterLock()
        with patch.object(api,'financial_ledger_account',side_effect=stop):
            with self.assertRaises(StopAfterLock):api.disburse_loan('loan-a',self.receive(),None,db,self.tenant)
        self.assert_lock(db.queries[0],'company_loans','loan-a');self.assert_lock(db.queries[1],'financial_accounts','account-a');self.assertEqual(db.events[-1],('ledger',));self.assertFalse(db.added)
    def test_receive_waited_inactive_account_prevents_ledger(self):
        db=FakeDB([loan(status='approved'),account(is_active=False)])
        with patch.object(api,'financial_ledger_account') as ledger:self.expect(404,lambda:api.disburse_loan('loan-a',self.receive(),None,db,self.tenant));ledger.assert_not_called()
    def test_receive_closed_loan_stops_before_account_lock(self):
        db=FakeDB([loan(status='closed')]);self.expect(409,lambda:api.disburse_loan('loan-a',self.receive(),None,db,self.tenant));self.assertEqual(len(db.queries),1)
    def test_receive_invalid_date_stops_before_account_lock(self):
        db=FakeDB([loan(status='approved')]);self.expect(409,lambda:api.disburse_loan('loan-a',self.receive(disbursement_date=date(2025,1,1)),None,db,self.tenant));self.assertEqual(len(db.queries),1)
    def test_repay_locks_account_before_balance_read_or_writes(self):
        a=account();db=FakeDB([loan(),'disbursement-a',a])
        def ledger(*args):db.events.append(('ledger',));return a,NS(id='ledger-a')
        def balance(*args):db.events.append(('balance',));raise StopAfterLock()
        with patch.object(api,'financial_ledger_account',side_effect=ledger),patch.object(api,'_balance',side_effect=balance):
            with self.assertRaises(StopAfterLock):api.repay_loan('loan-a',self.repay(),None,db,self.tenant)
        self.assert_lock(db.queries[0],'company_loans','loan-a');self.assert_lock(db.queries[2],'financial_accounts','account-a');self.assertEqual(db.events[-2:],[('ledger',),('balance',)]);self.assertFalse(db.added)
    def test_repay_fresh_insufficient_balance_stops_without_posting(self):
        a=account();db=FakeDB([loan(),'disbursement-a',a])
        with patch.object(api,'financial_ledger_account',return_value=(a,NS(id='ledger-a'))),patch.object(api,'_balance',return_value=Decimal('10')),patch.object(api,'post_journal') as post:
            self.expect(409,lambda:api.repay_loan('loan-a',self.repay(),None,db,self.tenant));post.assert_not_called()
        self.assert_lock(db.queries[2],'financial_accounts','account-a');self.assertFalse(db.added)
    def test_repay_deactivated_account_stops_before_balance(self):
        db=FakeDB([loan(),'disbursement-a',account(is_active=False)])
        with patch.object(api,'_balance') as balance:self.expect(404,lambda:api.repay_loan('loan-a',self.repay(),None,db,self.tenant));balance.assert_not_called()
    def test_repay_closed_loan_stops_before_account(self):
        db=FakeDB([loan(status='closed')]);self.expect(409,lambda:api.repay_loan('loan-a',self.repay(),None,db,self.tenant));self.assertEqual(len(db.queries),1)
    def test_repay_absent_canonical_disbursement_stops_before_account(self):
        db=FakeDB([loan(),None]);self.expect(409,lambda:api.repay_loan('loan-a',self.repay(),None,db,self.tenant));self.assertEqual(len(db.queries),2)
    def test_currency_check_retained_after_account_lock(self):
        a=account(currency='EUR');db=FakeDB([loan(),'disbursement-a',a])
        with patch.object(api,'financial_ledger_account',return_value=(a,NS(id='ledger-a'))),patch.object(api,'_balance') as balance:self.expect(400,lambda:api.repay_loan('loan-a',self.repay(),None,db,self.tenant));balance.assert_not_called()
    def test_no_formula_schedule_payload_or_commit_changes(self):
        current=ast.parse(SOURCE.read_text())
        new={n.name:n for n in current.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
        self.assertEqual(set(new)-set(BASELINE_FUNCTION_HASHES),{'_locked_loan_account'});self.assertEqual(set(BASELINE_FUNCTION_HASHES)-set(new),set())
        for name,expected in BASELINE_FUNCTION_HASHES.items():
            if name=='_loan':continue  # Actual compiled query tests prove its one lock-refresh addition.
            actual=new[name]
            if name in ('disburse_loan','repay_loan'):
                actual.body=[n for n in actual.body if not (isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='_locked_loan_account')]
            self.assertEqual(syntax_hash(actual),expected,name)
if __name__=='__main__':unittest.main()
