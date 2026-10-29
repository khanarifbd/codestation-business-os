"""Actual source bodies + actual gate, explicit transaction fakes; NOT PostgreSQL proof.
No application import/config/engine/provider is loaded. Baseline is byte-pinned.
"""
import ast
import copy
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import patch
from settlement_journal_test_support import restore_v31

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(os.environ.get('DIRECT_WRITER_BASELINE', ROOT.parent / 'evidence/originals'))
EXPECTED = {'app/api/v1/payroll.py': '3e4824b23c659b5a90579264ef5f33aee0f31d92f32ae86ac1a08fc588a4523f', 'app/api/v1/accounting_assets.py': '4ce68fab07fd4731e59e77f37e8bef68101f3a577f38c6caaf5bd7b48d59a457', 'app/api/v1/inventory.py': '1882dfcd65071579c08227888799357413e86b56277e6f3bce50716938601bd4', 'app/api/v1/inventory_fulfillment.py': '300d7a0f48314dd7ac15549545f4bc0f427e39dcc42b708720268954b794c281', 'app/api/v1/payables.py': 'b8d296ab08b795e455bdb03d498e0a02e3cb73e479a3e32be1bccfe0080c247f', 'app/api/v1/capital.py': '3f012b05cdf42885fd1a6307236f00d8acbc5806c458c2fbe589f0951437842f', 'app/api/v1/order_settlements.py': '0c66da897f83dc959fd154e4511ec24a1faa9f7aa509ad793c6ea01a058f8a51', 'app/api/v1/finance_expenses.py': '18ec4030a3eaa8f91d858c509e8b6ec71b9beb48b28ac26fa567d105e66ebadd', 'app/api/v1/finance_auto_post.py': '990c5502758d1cebaa031cd7882a16906fc942e35c888d3fd3b5ad79fdcba403', 'app/services/recurring_auto_post.py': '1a5e43d909e241dc1febc934eb74bef645e61d1e141cda0f9226007ff9ede89b', 'app/services/order_settlement.py': '4b5b8f2fc8d98f6d160ead37c6e9a9d6b70ce02c35687932c459c6b8a4d77df3'}
for relative, digest in EXPECTED.items():
    path = BASE / relative
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError(f'Verified direct-writer baseline required: {relative}')

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail); self.status_code, self.detail = status_code, detail
class StopBoundary(Exception): pass
class Field:
    def __init__(self, name): self.name = name
    def __eq__(self, x): return (self.name, '==', x)
    def __le__(self, x): return (self.name, '<=', x)
    def __ge__(self, x): return (self.name, '>=', x)
    def __gt__(self, x): return (self.name, '>', x)
    def is_(self, x): return (self.name, 'is', x)
    def asc(self): return self
    def desc(self): return self
class ModelMeta(type):
    def __getattr__(cls, name): return Field(cls.__name__+'.'+name)
class Model(metaclass=ModelMeta):
    def __init__(self, **kw): self.__dict__.update(kw)
models = {name: type(name, (Model,), {}) for name in ('AccountingPeriod','RecurringExpense','Organization','CompanyLoan','FinancialAccount','Expense','ExpenseCategory','Vendor','LedgerAccount','PayableBill','PayrollRun','Product','Warehouse','FixedAsset','Order','CompanyInvestor','CompanyInvestment','ProjectInvestor','LoanDisbursement')}
class Query:
    def __init__(self, *targets): self.targets=targets; self.predicates=[]; self.options={}; self.lock=None
    def where(self,*x): self.predicates.extend(x); return self
    def with_for_update(self,**kw): self.lock=kw; return self
    def execution_options(self,**kw): self.options.update(kw); return self
    def join(self,*x): return self
    def order_by(self,*x): return self
    def limit(self,*x): return self
class Tx:
    is_active=True
class Conn:
    def __init__(self):
        self.closed=self.invalidated=False; self.dialect=NS(name='postgresql')
        self.connection=NS(driver_connection=NS(autocommit=False)); self.tx=Tx()
    def get_transaction(self): return self.tx
    def get_isolation_level(self): return 'READ COMMITTED'
class DB:
    def __init__(self, values=()):
        self.info={}; self.is_active=True; self.tx=Tx(); self.conn=Conn(); self.events=[]; self.queries=[]
        self.values=list(values); self.closed_period=None; self.commits=self.rollbacks=0; self.fail_commit=False
        self.stop_domain=False; self.new=[]; self.persisted=[]; self.refresh_values={}
    def get_transaction(self): return self.tx
    def get_nested_transaction(self): return None
    def connection(self): return self.conn
    def execute(self, sql, params): self.events.append('gate'); self.gate_sql=(str(sql),params)
    def start(self):
        if self.tx is None: self.tx=Tx(); self.conn.tx=Tx(); self.events.append('autobegin')
    def scalar(self,q):
        self.start(); self.queries.append(q)
        if isinstance(q.targets[0],Field) and q.targets[0].name=='AccountingPeriod.id':
            self.events.append('period'); return self.closed_period
        self.events.append('lock' if q.lock is not None else 'select')
        if self.stop_domain: raise StopBoundary()
        value=self.values.pop(0) if self.values else None
        if callable(value): return value(q)
        return value
    def scalars(self,q): return NS(all=lambda:self.scalar(q))
    def refresh(self,obj,attribute_names=None):
        self.events.append('refresh:'+','.join(attribute_names or [])); obj.__dict__.update(self.refresh_values)
    def get(self,model,key,**kw): self.events.append(('get',model.__name__,key,kw)); return NS(timezone='UTC')
    def flush(self): self.events.append('flush')
    def add(self,x): self.events.append('add'); self.new.append(x)
    def finish(self):
        if self.tx:self.tx.is_active=False
        if self.conn.tx:self.conn.tx.is_active=False
        self.tx=self.conn.tx=None
    def commit(self):
        if self.info.get('deferred_commit_depth',0):self.flush();return
        self.events.append('commit');self.commits+=1;self.persisted+=self.new;self.new=[];self.finish()
        if self.fail_commit:raise RuntimeError('uncertain commit')
    def rollback(self):self.events.append('rollback');self.rollbacks+=1;self.new=[];self.finish()

def module(name,**kw):
    x=ModuleType(name);x.__dict__.update(kw);return x

def load_source_module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules,{name:result,'sqlalchemy':module('sqlalchemy',select=Query,text=lambda x:x), 'fastapi':module('fastapi',HTTPException=HTTPException), 'app':module('app',__path__=[]),'app.models':module('app.models',__path__=[]),'app.models.finance_controls':module('app.models.finance_controls',AccountingPeriod=models['AccountingPeriod'])}):spec.loader.exec_module(result)
    return result
GATE=load_source_module(ROOT/'app/services/accounting_period_gate.py','direct_gate_actual')
CONSTRAINT=load_source_module(ROOT/'app/services/financial_account_constraints.py','direct_account_actual')

def node(path,name,base=ROOT):
    return next(n for n in ast.parse((base/path).read_text()).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name==name)
def preserved_node(path,name):
    source=restore_v31(path,(ROOT/path).read_text())
    return next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name==name)

def load(path,name,**extras):
    f=copy.deepcopy(node(path,name));f.decorator_list=[]
    ns={'HTTPException':HTTPException,'select':Query,'Decimal':Decimal,'datetime':datetime,'date':date,'timezone':timezone,'timedelta':timedelta,'contextmanager':contextmanager,'status':NS(HTTP_409_CONFLICT=409),**models, **{n:getattr(GATE,n) for n in ('acquire_accounting_period_gate','require_accounting_period_gate','ensure_accounting_period_open')},'ensure_expense_posting_account_supported':CONSTRAINT.ensure_expense_posting_account_supported, 'ensure_payment_receipt_account_supported':CONSTRAINT.ensure_payment_receipt_account_supported, **extras}
    tree=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),f],type_ignores=[])
    exec(compile(ast.fix_missing_locations(tree),str(ROOT/path),'exec'),ns);return ns[name]
DEFER=load('app/db/session.py','defer_commits'); DEFER=contextmanager(DEFER)
TODAY=date(2026,10,27)
def tenant():return NS(organization_id='org-a',user_id='user-a',organization=NS(currency='OLD',timezone='UTC'))
def payload(**kw):return NS(currency='USD',invested_amount='1',payment_date=TODAY,period_date=TODAY,asset_code='A',product_id='p',warehouse_id='w',expense_ledger_account_id='l',model_dump=lambda **_: {},**kw)
def stop(db,*a,**kw):db.events.append('domain');raise StopBoundary()

PREFIXES={
'app/api/v1/payroll.py':['pay_payroll_withholding','approve_run','pay_run'],
'app/api/v1/accounting_assets.py':['create_asset','run_depreciation'],
'app/api/v1/inventory.py':['adjustment','receive_purchase'],
'app/api/v1/inventory_fulfillment.py':['fulfill_order','reverse_fulfillment'],
'app/api/v1/payables.py':['create_payable_bill','pay_payable_bill'],
'app/api/v1/capital.py':['create_loan','repay','create_owner_equity_transaction','fund_company_investor','company_investor_payout','create_investment','add_investment_funding','add_return','fund_project_investor','payout'],
'app/api/v1/order_settlements.py':['create_order_settlement'],
'app/api/v1/finance_expenses.py':['update_expense'],
'app/api/v1/finance_auto_post.py':['retry_recurring_auto_post'],
}
class EntryBoundaryTests(unittest.TestCase): pass

def boundary_case(path,name):
    def test(self):
        db=DB();db.stop_domain=True;t=tenant()
        fn=load(path,name,functional_currency_for_date=stop, reserve_posting=stop, staged_billing_enabled=stop, account=stop, money=Decimal, func=NS(lower=lambda x:x), organization_local_date=lambda _:TODAY,defer_commits=DEFER)
        args={a.arg:('identifier' if a.arg.endswith('_id') else payload(account_id='a',category_id='c') if a.arg=='payload' else db if a.arg=='db' else t if a.arg=='tenant' else NS()) for a in node(path,name).args.args}
        with self.assertRaises(StopBoundary):fn(**args)
        self.assertEqual(db.events[0],'gate')
        self.assertEqual(db.events.count('gate'),1)
        self.assertFalse(db.commits)
    return test
for p,names in PREFIXES.items():
    for n in names:setattr(EntryBoundaryTests,'test_gate_first_'+n,boundary_case(p,n))

class ContractTests(unittest.TestCase):
    def test_shared_companion_bytes_are_frozen(self):
        for p,h in [('accounting_period_gate.py','3d0e8813cf67b45ddec8caf8e88eaa49ec212025583ca7e24e1cf8ebeb1739b8'),('financial_account_constraints.py','c100049ab3c5b30897421df067a5976453c9e6c960df2840292f23d9f544ec7f')]:self.assertEqual(hashlib.sha256((ROOT/'app/services'/p).read_bytes()).hexdigest(),h)
    def test_all_existing_routes_signatures_and_permissions_unchanged(self):
        for p in EXPECTED:
            old={n.name:n for n in ast.parse((BASE/p).read_text()).body if isinstance(n,ast.FunctionDef)}
            new={n.name:n for n in ast.parse((ROOT/p).read_text()).body if isinstance(n,ast.FunctionDef)}
            self.assertEqual(set(old)-set(new),{'_closed_period'} if p.endswith('recurring_auto_post.py') else set())
            self.assertFalse(set(new)-set(old))
            for name in new:
                self.assertEqual(ast.dump(new[name].args),ast.dump(old[name].args),(p,name))
                self.assertEqual([ast.dump(x) for x in new[name].decorator_list],[ast.dump(x) for x in old[name].decorator_list],(p,name))
    def test_nonowned_functions_and_financial_helpers_are_exact(self):
        changed={p:set(v) for p,v in PREFIXES.items()}
        changed['app/api/v1/finance_expenses.py'].add('create_expense')
        changed['app/services/order_settlement.py']={'settle_order'}
        changed['app/services/recurring_auto_post.py']={'_closed_period','post_due_recurring_expense','process_due_auto_posts'}
        for p in EXPECTED:
            for n in ast.parse((BASE/p).read_text()).body:
                if isinstance(n,ast.FunctionDef) and n.name not in changed[p]:self.assertEqual(ast.dump(n),ast.dump(preserved_node(p,n.name)),(p,n.name))
    def test_simple_prefix_adoption_preserves_remaining_body(self):
        exceptions={'create_loan','fulfill_order','update_expense'}
        for p,names in PREFIXES.items():
            for name in names:
                if name in exceptions:continue
                before=node(p,name,BASE);after=preserved_node(p,name)
                after.body=after.body[1:]
                if name in {'create_asset','run_depreciation','adjustment','receive_purchase','retry_recurring_auto_post'}:after.body=after.body[1:]
                self.assertEqual(ast.dump(before),ast.dump(after),name)
    def test_fulfillment_replay_stays_before_refresh_and_date_logic(self):
        for name in ('fulfill_order','reverse_fulfillment'):
            db=DB();calls=[]
            def reserve(db,*a,**kw):calls.append(kw);return NS(),True
            f=load('app/api/v1/inventory_fulfillment.py',name,reserve_posting=reserve,completed_resource=lambda *x:'old-id',_fulfillment_read=lambda *x:'original')
            kw=dict(order_id='o',payload=payload(),request=NS(),db=db,tenant=tenant())
            if name=='reverse_fulfillment':kw['fulfillment_id']='f'
            self.assertEqual(f(**kw),'original');self.assertEqual(db.events,['gate']);self.assertFalse(db.commits)
    def test_fulfillment_remaining_body_exact_including_zero_cost_and_commit(self):
        a=node('app/api/v1/inventory_fulfillment.py','fulfill_order');a.body.pop(0);a.body.pop(2)
        self.assertEqual(ast.dump(a),ast.dump(node('app/api/v1/inventory_fulfillment.py','fulfill_order',BASE)))
    def test_services_reject_missing_gate_before_query_or_attempt_marker(self):
        for p,n,kw in [('app/services/order_settlement.py','settle_order',dict(organization_id='org-a',user_id='u',organization_timezone='UTC',order_id='o',payload=NS(),request=NS())),('app/services/recurring_auto_post.py','post_due_recurring_expense',dict(recurring=NS(organization_id='org-a')))]:
            db=DB()
            with self.assertRaises(GATE.AccountingPeriodGateError):load(p,n)(db,**kw)
            self.assertEqual(db.events,[])
    def test_existing_payroll_accrual_returns_before_new_date_validation(self):
        old=NS(id='old-accrual');db=DB()
        f=load('app/api/v1/payroll.py','_ensure_payroll_accrual',_payroll_journal=lambda *x:old)
        self.assertIs(f(db,tenant(),NS(id='run'),NS(end_date=TODAY)),old);self.assertEqual(db.events,[])
    def test_real_helper_rejects_non_read_committed_before_domain_work(self):
        db=DB();db.conn.get_isolation_level=lambda:'REPEATABLE READ'
        with self.assertRaises(GATE.AccountingPeriodGateError):load('app/api/v1/payroll.py','approve_run')('r',NS(),db,tenant())
        self.assertEqual(db.events,[])
    def test_shared_gate_reentry_and_real_commit_requires_reacquisition(self):
        db=DB();GATE.acquire_accounting_period_gate(db,'org-a');GATE.acquire_accounting_period_gate(db,'org-a')
        self.assertEqual(db.events,['gate']);db.commit();db.start()
        with self.assertRaises(GATE.AccountingPeriodGateError):GATE.require_accounting_period_gate(db,'org-a')
        GATE.acquire_accounting_period_gate(db,'org-a');self.assertEqual(db.events.count('gate'),2)

class ExpenseTests(unittest.TestCase):
    def test_stale_preloaded_account_reloaded_at_first_lock_and_card_rejected(self):
        stale=NS(is_active=True,account_type='bank');db=DB()
        def authoritative(q):
            self.assertIs(q.targets[0],models['FinancialAccount']);self.assertEqual(q.lock,{})
            self.assertEqual(q.options,{'populate_existing':True});stale.account_type='credit_card';return stale
        db.values=[authoritative]
        with self.assertRaises(HTTPException) as e:load('app/api/v1/finance_expenses.py','create_expense')(payload(account_id='a'),NS(),db,tenant())
        self.assertEqual(e.exception.status_code,400);self.assertIn('credit-card liability',e.exception.detail)
        self.assertEqual(db.events,['lock']);self.assertFalse(db.new)
    def test_active_check_remains_before_supported_account_check(self):
        db=DB([NS(is_active=False,account_type='credit_card')])
        with self.assertRaises(HTTPException) as e:load('app/api/v1/finance_expenses.py','create_expense')(payload(account_id='a'),NS(),db,tenant())
        self.assertEqual(e.exception.status_code,404)
    def test_metadata_update_closed_date_blocks_before_changes_flush_or_commit(self):
        row=NS(id='e',status='posted',expense_date=TODAY,description='old');db=DB([row]);db.closed_period='closed'
        with self.assertRaises(HTTPException) as e:load('app/api/v1/finance_expenses.py','update_expense')('e',NS(model_dump=lambda **_: {'description':'new'}),NS(),db,tenant())
        self.assertEqual(e.exception.status_code,409);self.assertEqual(row.description,'old');self.assertEqual(db.events,['gate','lock','period'])
        self.assertEqual(db.queries[0].options,{'populate_existing':True})
    def test_metadata_update_uses_existing_expense_date_and_preserves_audit(self):
        row=NS(id='e',expense_number='E',status='posted',expense_date=TODAY,description='old',vendor_id=None,category_id='c',reference=None)
        db=DB([row]);logs=[]
        f=load('app/api/v1/finance_expenses.py','update_expense',_clean=lambda x:x.strip(),record_activity=lambda *a,**kw:logs.append(kw),_expense_detail=lambda *x:row)
        self.assertIs(f('e',NS(model_dump=lambda **_: {'description':'new'}),NS(),db,tenant()),row)
        self.assertEqual(row.description,'new');self.assertEqual(db.commits,1);self.assertEqual(logs[0]['before']['description'],'old')
        self.assertIn(('AccountingPeriod.start_date','<=',TODAY),db.queries[1].predicates)

class LoanAtomicityTests(unittest.TestCase):
    def invoke(self,db,*,account_id='a',fail=None):
        def delegate(label):
            def call(*args):
                db.events.append(label);GATE.require_accounting_period_gate(db,'org-a');db.add(label)
                if fail==label:raise ValueError('synthetic delegate failure')
                db.commit();return {'id':'loan'}
            return call
        f=load('app/api/v1/capital.py','create_loan',defer_commits=DEFER,account=lambda *x:db.events.append('preflight'),AccountingLoanCreate=NS,LoanDisbursementCreate=NS,create_accounting_loan=delegate('create'),approve_accounting_loan=delegate('approve'),disburse_accounting_loan=delegate('disburse'),loan_json=lambda x:x)
        p=payload(account_id=account_id,lender_name='Synthetic',lender_type='bank',principal_amount=Decimal('100'),annual_interest_rate=0,loan_date=TODAY,maturity_date=None,reference=None,notes=None)
        db.values=[NS(id='loan')]
        return f(p,NS(),db,tenant())
    def test_one_real_commit_three_deferred_commits(self):
        db=DB();self.assertEqual(self.invoke(db).id,'loan');self.assertEqual(db.commits,1);self.assertEqual(db.events.count('flush'),3)
        self.assertEqual(db.persisted,['create','approve','disburse']);self.assertNotIn('deferred_commit_depth',db.info)
    def test_each_delegate_failure_rolls_back_no_partial_agreement(self):
        for phase in ('create','approve','disburse'):
            db=DB()
            with self.assertRaises(ValueError):self.invoke(db,fail=phase)
            self.assertEqual(db.commits,0);self.assertEqual(db.rollbacks,1);self.assertFalse(db.new or db.persisted)
    def test_agreement_only_no_new_period_rejection(self):
        db=DB();db.closed_period='closed';self.invoke(db,account_id=None)
        self.assertEqual(db.persisted,['create','approve']);self.assertNotIn('period',db.events);self.assertEqual(db.commits,1)
    def test_outer_commit_unknown_not_retried_or_relabelled_rollback(self):
        db=DB();db.fail_commit=True
        with self.assertRaisesRegex(RuntimeError,'uncertain'):self.invoke(db)
        self.assertEqual(db.commits,1);self.assertEqual(db.rollbacks,0)
    def test_inner_payloads_and_delegate_order_exact(self):
        a=node('app/api/v1/capital.py','create_loan');a.body=a.body[1].body
        last=a.body[-1];self.assertIsInstance(last,ast.Assign);a.body[-1]=ast.Return(value=last.value)
        self.assertEqual(ast.dump(a),ast.dump(node('app/api/v1/capital.py','create_loan',BASE)))

class RecurringWorkerTests(unittest.TestCase):
    def recurring(self,**kw):return NS(**(dict(id='r',organization_id='org-a',auto_post=True,is_active=True,next_due_date=TODAY,name='Synthetic',auto_post_last_error=None)|kw))
    def run_worker(self,db,post):
        f=load('app/services/recurring_auto_post.py','process_due_auto_posts',_organization_date=lambda *x:TODAY,post_due_recurring_expense=post,record_activity=lambda *a,**kw:db.events.append('audit'))
        return f(db,now=datetime(2026,10,27,tzinfo=timezone.utc))
    def test_each_candidate_gate_before_fresh_skiplocked_and_new_transaction(self):
        db=DB([['a','b'],'org-a',self.recurring(id='a'),'org-b',self.recurring(id='b',organization_id='org-b')])
        def post(db,row,**kw):GATE.require_accounting_period_gate(db,row.organization_id);db.events.append('post')
        self.assertEqual(self.run_worker(db,post),(2,0));self.assertEqual(db.commits,2);self.assertEqual(db.events.count('gate'),2)
        locks=[q for q in db.queries if q.lock is not None]
        self.assertEqual(len(locks),2)
        for q,org in zip(locks,('org-a','org-b')):
            self.assertEqual(q.lock,{'skip_locked':True});self.assertEqual(q.options,{'populate_existing':True});self.assertIn(('RecurringExpense.organization_id','==',org),q.predicates)
        for event in db.events:
            if isinstance(event,tuple) and event[0]=='get':self.assertEqual(event[3],{'populate_existing':True})
    def test_missing_candidate_rolls_back_without_gate(self):
        db=DB([['gone'],None]);self.assertEqual(self.run_worker(db,lambda *a,**k:None),(0,0));self.assertEqual(db.rollbacks,1);self.assertNotIn('gate',db.events)
    def test_known_rejection_rolls_back_then_fenced_nonfinancial_marker(self):
        row=self.recurring();db=DB([['r'],'org-a',row,row])
        def post(*a,**kw):raise HTTPException(409,'closed')
        self.assertEqual(self.run_worker(db,post),(0,1));self.assertEqual(db.rollbacks,1);self.assertEqual(db.commits,1);self.assertEqual(row.auto_post_last_error,'closed')
        self.assertLess(db.events.index('rollback'),db.events.index('audit'));self.assertEqual(db.events.count('gate'),1)
    def test_advanced_due_date_not_marked_as_failed(self):
        row=self.recurring();fresh=self.recurring(next_due_date=TODAY+timedelta(days=30));db=DB([['r'],'org-a',row,fresh])
        def post(*a,**kw):raise ValueError('known')
        self.assertEqual(self.run_worker(db,post),(0,1));self.assertEqual(db.rollbacks,2);self.assertFalse(db.commits);self.assertIsNone(fresh.auto_post_last_error)
    def test_commit_failure_stops_worker_without_marker_or_second_candidate(self):
        db=DB([['a','b'],'org-a',self.recurring()]);db.fail_commit=True
        with self.assertRaisesRegex(RuntimeError,'uncertain'):self.run_worker(db,lambda *a,**kw:None)
        self.assertEqual(db.commits,1);self.assertEqual(db.rollbacks,0);self.assertNotIn('audit',db.events);self.assertEqual(db.events.count('gate'),1)
    def test_actual_leaf_uses_due_date_not_today_before_account_lock(self):
        row=self.recurring(expense_amount='12',tax_amount='0',end_date=None,next_due_date=date(2026,9,1))
        db=DB();GATE.acquire_accounting_period_gate(db,'org-a');db.closed_period='closed'
        with self.assertRaises(HTTPException) as e:load('app/services/recurring_auto_post.py','post_due_recurring_expense',_money=Decimal)(db,row,now=datetime(2026,10,27,tzinfo=timezone.utc))
        self.assertEqual(e.exception.status_code,409);self.assertEqual(db.events,['gate','period'])
        self.assertIn(('AccountingPeriod.start_date','<=',date(2026,9,1)),db.queries[0].predicates)

class SettlementTests(unittest.TestCase):
    def test_route_acquires_before_staged_read(self):
        db=DB()
        def staged(db,*a):GATE.require_accounting_period_gate(db,'org-a');db.events.append('staged');return True
        with self.assertRaises(HTTPException) as e:load('app/api/v1/order_settlements.py','create_order_settlement',staged_billing_enabled=staged,_staged_reason=lambda:'staged')('o',NS(),NS(),db,tenant())
        self.assertEqual(e.exception.status_code,409);self.assertEqual(db.events,['gate','staged'])
    def test_service_closed_new_effect_date_blocks_before_balance_or_writes(self):
        order=NS(id='o',status='completed',currency='USD',total='100',order_date=date(2026,1,1));account=NS(is_active=True,currency='USD',account_type='bank')
        db=DB([order,account]);GATE.acquire_accounting_period_gate(db,'org-a');db.closed_period='closed'
        f=load('app/services/order_settlement.py','settle_order',staged_billing_enabled=lambda *x:False,_active_invoice=lambda *x:None,_money=Decimal,_account_balance=lambda *x:self.fail('balance evaluated before closed-date check'))
        with self.assertRaises(HTTPException) as e:f(db,organization_id='org-a',user_id='u',organization_timezone='UTC',order_id='o',payload=NS(account_id='a',expense_amount='0',settlement_date=TODAY),request=NS())
        self.assertEqual(e.exception.status_code,409);self.assertEqual(db.events,['gate','lock','lock','period']);self.assertFalse(db.new)

class ZeroCostCompatibilityTests(unittest.TestCase):
    def test_zero_cost_stock_adjustment_keeps_no_journal_behavior(self):
        product=NS(id='p',currency='USD',sku='S');warehouse=NS(id='w');db=DB([product,warehouse]);db.closed_period='closed';db.refresh_values={'currency':'USD'}
        f=load('app/api/v1/inventory.py','adjustment',uuid4=lambda:'synthetic',qty=Decimal,cost=Decimal,money=Decimal,clean=lambda x:x,_stock_out=lambda *a,**kw:NS(total_cost=Decimal(0),total_cost_base=Decimal(0)),record_activity=lambda *a,**kw:db.events.append('audit'),post_journal=lambda *a,**kw:self.fail('zero-cost posting changed'))
        p=NS(product_id='p',warehouse_id='w',quantity_delta='-1',reference=None,reason='Synthetic count',adjustment_date=TODAY)
        self.assertEqual(f(p,NS(),db,tenant())['status'],'posted');self.assertNotIn('period',db.events);self.assertEqual(db.commits,1)



def parsed(source):return ast.parse(source).body

def add_refresh(query):
    return ast.Call(func=ast.Attribute(value=query,attr='execution_options',ctx=ast.Load()),args=[],keywords=[ast.keyword(arg='populate_existing',value=ast.Constant(True))])

class ExactBoundedChangeTests(unittest.TestCase):
    def test_expense_create_only_locked_refresh_and_existing_card_policy_added(self):
        a=node('app/api/v1/finance_expenses.py','create_expense',BASE)
        a.body[0].value.args[0]=add_refresh(a.body[0].value.args[0])
        a.body.insert(2,parsed('ensure_expense_posting_account_supported(account.account_type)')[0])
        self.assertEqual(ast.dump(a),ast.dump(node('app/api/v1/finance_expenses.py','create_expense')))
    def test_expense_metadata_only_gate_refresh_and_original_date_validation_added(self):
        a=node('app/api/v1/finance_expenses.py','update_expense',BASE)
        a.body[0].value.args[0]=add_refresh(a.body[0].value.args[0]);a.body.insert(3,parsed('ensure_accounting_period_open(db, tenant.organization_id, item.expense_date)')[0])
        a.body.insert(0,parsed('acquire_accounting_period_gate(db, tenant.organization_id)')[0])
        self.assertEqual(ast.dump(a),ast.dump(node('app/api/v1/finance_expenses.py','update_expense')))
    def test_settlement_only_required_gate_and_actual_effect_date_check_added(self):
        a=node('app/services/order_settlement.py','settle_order',BASE)
        index=next(i for i,x in enumerate(a.body) if isinstance(x,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='current_balance' for t in x.targets))
        a.body.insert(index,parsed('ensure_accounting_period_open(db, organization_id, settlement_date)')[0]);a.body.insert(0,parsed('require_accounting_period_gate(db, organization_id)')[0])
        self.assertEqual(ast.dump(a),ast.dump(preserved_node('app/services/order_settlement.py','settle_order')))
    def test_recurring_leaf_only_required_gate_and_shared_date_validator(self):
        a=node('app/services/recurring_auto_post.py','post_due_recurring_expense',BASE)
        index=next(i for i,x in enumerate(a.body) if isinstance(x,ast.If) and isinstance(x.test,ast.Call) and isinstance(x.test.func,ast.Name) and x.test.func.id=='_closed_period')
        a.body[index]=parsed('ensure_accounting_period_open(db, recurring.organization_id, expense_date)')[0]
        a.body.insert(0,parsed('require_accounting_period_gate(db, recurring.organization_id)')[0])
        self.assertEqual(ast.dump(a),ast.dump(node('app/services/recurring_auto_post.py','post_due_recurring_expense')))
    def test_worker_only_tenant_gate_and_fresh_locked_context_added(self):
        a=node('app/services/recurring_auto_post.py','process_due_auto_posts',BASE)
        loop=next(n for n in a.body if isinstance(n,ast.For));attempt=next(n for n in loop.body if isinstance(n,ast.Try))
        old=attempt.body[0];self.assertEqual(ast.unparse(old.targets[0]),'recurring')
        attempt.body[0:1]=parsed('''organization_id = db.scalar(select(RecurringExpense.organization_id).where(RecurringExpense.id == recurring_id))
if organization_id is None:
    db.rollback()
    continue
acquire_accounting_period_gate(db, organization_id)
recurring = db.scalar(select(RecurringExpense).where(RecurringExpense.id == recurring_id, RecurringExpense.organization_id == organization_id).with_for_update(skip_locked=True).execution_options(populate_existing=True))''')
        organization=next(n for n in attempt.body if isinstance(n,ast.Assign) and ast.unparse(n.targets[0])=='organization')
        organization.value.keywords.append(ast.keyword(arg='populate_existing',value=ast.Constant(True)))
        self.assertEqual(ast.dump(a),ast.dump(node('app/services/recurring_auto_post.py','process_due_auto_posts')))
    def test_no_period_settlement_preserves_path_to_balance(self):
        order=NS(id='o',status='completed',currency='USD',total='100',order_date=date(2026,1,1));account=NS(is_active=True,currency='USD',account_type='bank')
        db=DB([order,account]);GATE.acquire_accounting_period_gate(db,'org-a')
        f=load('app/services/order_settlement.py','settle_order',staged_billing_enabled=lambda *x:False,_active_invoice=lambda *x:None,_money=Decimal,_account_balance=stop)
        with self.assertRaises(StopBoundary):f(db,organization_id='org-a',user_id='u',organization_timezone='UTC',order_id='o',payload=NS(account_id='a',expense_amount='0',settlement_date=TODAY),request=NS())
        self.assertEqual(db.events,['gate','lock','lock','period','domain'])
    def test_module_constants_imports_and_nonfunction_nodes_preserved(self):
        allowed={'app.services.accounting_period_gate','app.services.financial_account_constraints'}
        for p in EXPECTED:
            before=ast.parse((BASE/p).read_text());after=ast.parse(restore_v31(p,(ROOT/p).read_text()))
            def normalized(t):
                result=[]
                for n in t.body:
                    if isinstance(n,ast.FunctionDef):continue
                    if isinstance(n,ast.ImportFrom) and (n.module in allowed or (p.endswith('capital.py') and n.module=='app.db.session')):continue
                    if isinstance(n,ast.ImportFrom) and n.module=='app.models.finance_controls':continue
                    result.append(ast.dump(n))
                return result
            self.assertEqual(normalized(before),normalized(after),p)

class PostgreSQLCompilationTests(unittest.TestCase):
    """Compile real SQLAlchemy SQL only, with no engine/driver/database."""
    def test_actual_expense_authoritative_lock_is_tenant_scoped_and_fresh(self):
        from sqlalchemy import Table,Column,MetaData,String,select
        from sqlalchemy.dialects import postgresql
        table=Table('financial_accounts',MetaData(),Column('id',String),Column('organization_id',String))
        financial=NS(id=table.c.id,organization_id=table.c.organization_id)
        expression=copy.deepcopy(node('app/api/v1/finance_expenses.py','create_expense').body[0].value.args[0])
        # The real selector requires a mapped ORM class. A table has identical SQL scope.
        class ReplaceModel(ast.NodeTransformer):
            def visit_Name(self,n):return ast.Name(id='table',ctx=n.ctx) if n.id=='FinancialAccount' else n
            def visit_Attribute(self,n):
                if isinstance(n.value,ast.Name) and n.value.id=='FinancialAccount':return ast.Attribute(value=ast.Name(id='financial',ctx=ast.Load()),attr=n.attr,ctx=n.ctx)
                return self.generic_visit(n)
        expression=ReplaceModel().visit(expression)
        q=eval(compile(ast.fix_missing_locations(ast.Expression(expression)),'actual-lock','eval'),{'select':select,'table':table,'financial':financial,'payload':NS(account_id='account-a'),'tenant':tenant()})
        compiled=q.compile(dialect=postgresql.dialect());sql=str(compiled)
        self.assertIn('FOR UPDATE',sql);self.assertEqual(set(compiled.params.values()),{'account-a','org-a'});self.assertTrue(q.get_execution_options()['populate_existing'])
    def test_actual_period_validator_compiles_tenant_closed_inclusive_date_predicates(self):
        from sqlalchemy import Table,Column,MetaData,String,Date,select,text
        from sqlalchemy.dialects import postgresql
        table=Table('accounting_periods',MetaData(),Column('id',String),Column('organization_id',String),Column('status',String),Column('start_date',Date),Column('end_date',Date))
        db=DB();queries=[]
        db.scalar=lambda q:queries.append(q) or None
        with patch.object(GATE,'select',select),patch.object(GATE,'text',text),patch.object(GATE,'AccountingPeriod',NS(**{c.name:c for c in table.c})):
            GATE.acquire_accounting_period_gate(db,'org-a');GATE.ensure_accounting_period_open(db,'org-a',TODAY)
        compiled=queries[0].compile(dialect=postgresql.dialect());sql=str(compiled)
        self.assertIn('start_date <=',sql);self.assertIn('end_date >=',sql)
        self.assertIn('org-a',compiled.params.values());self.assertIn('closed',compiled.params.values());self.assertEqual(list(compiled.params.values()).count(TODAY),2)
        self.assertIn('pg_advisory_xact_lock_shared',db.gate_sql[0])

class AssetCompatibilityTests(unittest.TestCase):
    def test_all_skipped_run_does_not_invent_closed_date_rejection(self):
        row=NS(id='asset',record_mode='opening',opening_balance_date=TODAY)
        db=DB([[row]]);db.closed_period='closed';db.refresh_values={'currency':'USD'};t=tenant()
        f=load('app/api/v1/accounting_assets.py','run_depreciation',system_account=lambda *x:NS(id='l'),record_activity=lambda *a,**kw:None,post_journal=lambda *a,**kw:self.fail('must not post skipped opening month'))
        result=f(NS(period_date=TODAY),NS(),db,t)
        self.assertEqual(result['skipped'],[{'asset_id':'asset','reason':'before_or_at_opening_balance'}]);self.assertFalse(result['posted']);self.assertEqual(db.commits,1);self.assertNotIn('period',db.events)
        self.assertEqual(t.organization.currency,'USD');self.assertEqual(db.events[:3],['gate','refresh:currency','lock'])

if __name__=='__main__':unittest.main()
