"""Offline actual-handler + SQL construction checks; not database race proof."""
import ast
import copy
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from app.models.finance import FinancialAccount, Invoice
from app.services.financial_account_constraints import (
    ensure_payment_receipt_account_supported,
    ensure_expense_posting_account_supported,
    ensure_transfer_accounts_supported,
)

ROOT=Path(__file__).resolve().parents[1]
class StopBeforeMutation(Exception): pass

def actual_function(path,name,context):
    node=copy.deepcopy(next(n for n in ast.parse((ROOT/path).read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name))
    node.decorator_list=[]
    tree=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),node],type_ignores=[])
    context=dict(context)
    exec(compile(ast.fix_missing_locations(tree),str(ROOT/path),'exec'),context)
    return context[name]

def account(identity='a',**kw):
    return NS(**({'id':identity,'is_active':True,'account_type':'bank','currency':'USD'}|kw))

class Rows:
    def __init__(self,rows): self.rows=rows
    def all(self): return self.rows

class CachedAccountDB:
    def __init__(self,stale,fresh): self.stale=stale;self.fresh=fresh;self.queries=[]
    def capture(self,query):
        compiled=query.compile(dialect=postgresql.dialect())
        self.queries.append((str(compiled),compiled.params,query.get_execution_options()))
    def scalar(self,query):
        self.capture(query)
        if query.column_descriptions[0]['entity'] is Invoice:
            return NS(status='sent',balance_due=Decimal('100'),currency='USD')
        return self.fresh if query.get_execution_options().get('populate_existing') else self.stale
    def scalars(self,query):
        self.capture(query)
        return Rows(self.fresh if query.get_execution_options().get('populate_existing') else self.stale)

class LockedAccountTests(unittest.TestCase):
    tenant=NS(organization_id='synthetic-org')
    payment_payload=NS(invoice_id='invoice-a',account_id='a',invoice_amount=Decimal('10'))
    transfer_payload=NS(from_account_id='a',to_account_id='b',source_amount=Decimal('10'))
    def payment(self):
        return actual_function('app/api/v1/finance.py','record_payment',{
            'select':select,'Invoice':Invoice,'FinancialAccount':FinancialAccount,'HTTPException':HTTPException,
            'ensure_payment_receipt_account_supported':ensure_payment_receipt_account_supported,
        })
    def transfer(self):
        return actual_function('app/api/v1/finance_transfers.py','record_transfer',{
            'select':select,'FinancialAccount':FinancialAccount,'HTTPException':HTTPException,
            'ensure_transfer_accounts_supported':ensure_transfer_accounts_supported,
            '_money':lambda value: (_ for _ in ()).throw(StopBeforeMutation()),
        })
    def test_payment_uses_locked_inactive_state_not_preflight_active_cache(self):
        db=CachedAccountDB(account(),account(is_active=False))
        with self.assertRaises(HTTPException) as caught:self.payment()(self.payment_payload,None,db,self.tenant)
        self.assertEqual(caught.exception.status_code,404)
        self.assertEqual(len(db.queries),2)
        sql,params,options=db.queries[-1]
        self.assertIn('FOR UPDATE',sql);self.assertTrue(options['populate_existing'])
        self.assertIn('synthetic-org',params.values());self.assertIn('a',params.values())
    def test_payment_revalidates_card_restriction_after_fresh_lock(self):
        db=CachedAccountDB(account(),account(account_type='credit_card'))
        with self.assertRaises(HTTPException) as caught:self.payment()(self.payment_payload,None,db,self.tenant)
        self.assertEqual(caught.exception.status_code,400)
        self.assertEqual(caught.exception.detail,'Customer payments cannot be received into a credit card account')
    def test_transfer_uses_fresh_inactive_destination(self):
        db=CachedAccountDB([account('a'),account('b')],[account('a'),account('b',is_active=False)])
        with self.assertRaises(HTTPException) as caught:self.transfer()(self.transfer_payload,None,db,self.tenant)
        self.assertEqual(caught.exception.status_code,409)
        sql,params,options=db.queries[0]
        self.assertIn('ORDER BY financial_accounts.id ASC',sql);self.assertIn('FOR UPDATE',sql)
        self.assertTrue(options['populate_existing']);self.assertIn(['a','b'],params.values());self.assertIn('synthetic-org',params.values())
    def test_transfer_revalidates_fresh_source_card(self):
        db=CachedAccountDB([account('a'),account('b')],[account('a',account_type='credit_card'),account('b')])
        with self.assertRaises(HTTPException) as caught:self.transfer()(self.transfer_payload,None,db,self.tenant)
        self.assertEqual(caught.exception.status_code,400)
        self.assertIn('Credit card settlement is not an account transfer',caught.exception.detail)
    def test_transfer_revalidates_fresh_destination_card(self):
        db=CachedAccountDB([account('a'),account('b')],[account('a'),account('b',account_type='credit_card')])
        with self.assertRaises(HTTPException) as caught:self.transfer()(self.transfer_payload,None,db,self.tenant)
        self.assertEqual(caught.exception.status_code,400)
    def test_transfer_supported_fresh_accounts_reach_existing_amount_logic(self):
        db=CachedAccountDB([account('a'),account('b')],[account('a'),account('b')])
        with self.assertRaises(StopBeforeMutation):self.transfer()(self.transfer_payload,None,db,self.tenant)
        self.assertEqual(len(db.queries),1)
    def test_identical_transfer_accounts_rejected_before_lock(self):
        db=CachedAccountDB([],[])
        with self.assertRaises(HTTPException) as caught:self.transfer()(NS(from_account_id='a',to_account_id='a'),None,db,self.tenant)
        self.assertEqual(caught.exception.status_code,400);self.assertEqual(db.queries,[])

class SharedConstraintTests(unittest.TestCase):
    def test_existing_supported_types_remain_allowed(self):
        for kind in ['bank','cash','mobile_wallet','payment_gateway','other']:
            with self.subTest(kind=kind):
                self.assertIsNone(ensure_payment_receipt_account_supported(kind))
                self.assertIsNone(ensure_expense_posting_account_supported(kind))
                self.assertIsNone(ensure_transfer_accounts_supported(kind,kind))
    def test_expense_card_error_exactly_preserved(self):
        with self.assertRaises(HTTPException) as caught:ensure_expense_posting_account_supported('credit_card')
        self.assertEqual(caught.exception.status_code,400)
        self.assertEqual(caught.exception.detail,'This expense workflow cannot safely post credit-card liability movements yet. Use Money Out for credit-card spending until the dedicated card workflow is enabled.')

if __name__=='__main__': unittest.main()
