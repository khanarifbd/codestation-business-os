"""Gate-first actual financial callable prefixes and bounded full flows; fake DB only."""
import ast,asyncio,unittest
from types import SimpleNamespace as NS
from decimal import Decimal
from datetime import date,datetime,timezone
from fastapi import HTTPException
from period_entrypoint_harness import *
WRAPPERS=['safe_create_customer_advance','safe_apply_customer_advance','safe_create_money_entry','safe_create_income_with_fee','safe_create_account','safe_change_invoice_status','safe_record_payment','safe_create_expense','safe_post_recurring_expense','safe_void_expense','safe_record_transfer','safe_pay_payable_bill','safe_disburse_loan','safe_repay_loan']
def wrapper_ns():return load_functions('app/api/v1/financial_safety.py',WRAPPERS+['_tenant_account','_journal_for_source'],{**gate_namespace(),**CONSTRAINTS,'reserve_posting':stop,'create_advance':stop,'apply_advance':stop,'create_money_entry':stop,'create_income_with_fee':stop,'create_account':stop,'change_invoice_status':stop})
def wrapper_args(name,db,t):
 payload=NS(kind='income',account_id='account',from_account_id='from',to_account_id='to',model_dump=lambda **kw:{'fixture':True})
 if name=='safe_void_expense':return ['expense',None,db,t]
 if name in ['safe_apply_customer_advance','safe_change_invoice_status','safe_post_recurring_expense','safe_pay_payable_bill','safe_disburse_loan','safe_repay_loan']:return ['resource',payload,None,db,t]
 return [payload,None,db,t]
class EntryPointAdoption(unittest.TestCase):
 def assert_gate_first(self,db,t,exclusive=False):
  self.assertEqual(len(gate_sql(db)),1);self.assertEqual(db.events[0][0],'execute');self.assertIn('pg_advisory_xact_lock(' if exclusive else 'pg_advisory_xact_lock_shared(',db.events[0][1]);self.assertEqual(db.events[1],('refresh',t.organization))
 def test_wrapper_success_defers_delegate_and_completion_to_one_outer_commit(self):
  db=DB();t=tenant();events=[];n=wrapper_ns();result=NS(id='money');guard=NS()
  def reserve(*a,**kw):GATE.require_accounting_period_gate(db,t.organization_id);events.append('reserve');return guard,False
  def create(*a):events.append('delegate');db.commit();return result
  def complete(*a,**kw):events.append('complete');db.commit()
  n.update(reserve_posting=reserve,create_money_entry=create,complete_posting=complete)
  out=n['safe_create_money_entry'](*wrapper_args('safe_create_money_entry',db,t));self.assertIs(out,result);self.assertEqual(events,['reserve','delegate','complete']);self.assertEqual(db.commits,1);self.assertEqual(effect_trace(db).count('flush'),2);self.assert_gate_first(db,t)
 def test_wrapper_original_error_rolls_back_without_outer_commit(self):
  db=DB();t=tenant();n=wrapper_ns()
  with self.assertRaises(StopAtDomain):n['safe_create_money_entry'](*wrapper_args('safe_create_money_entry',db,t))
  self.assertIn('rollback',effect_trace(db));self.assertEqual(db.commits,0)
 def test_completed_recurring_replay_keeps_closed_history_access_without_new_validation(self):
  db=DB(closed=True);t=tenant();n=wrapper_ns();expense=NS(id='expense',expense_number='E-SYN',expense_date=date(2020,1,1));schedule=NS(next_due_date=date(2020,2,1),is_active=False);db.values=[expense]
  n.update(reserve_posting=lambda *a,**k:(NS(),True),completed_resource=lambda *a:'expense',_read_recurring=lambda *a:schedule,RecurringExpensePostResult=lambda **kw:NS(**kw),post_recurring_expense=stop,post_expense=stop)
  out=n['safe_post_recurring_expense'](*wrapper_args('safe_post_recurring_expense',db,t));self.assertEqual(out.expense_id,'expense');self.assertEqual(db.commits,0);self.assertNotIn('period_read',effect_trace(db));self.assertNotIn('add',effect_trace(db));self.assert_gate_first(db,t)
 def test_new_recurring_closed_date_rolls_back_reservation_and_preserves409(self):
  db=DB(closed=True);t=tenant();n=wrapper_ns();n['reserve_posting']=lambda *a,**k:(NS(),False)
  def posting(*a):GATE.ensure_accounting_period_open(db,t.organization_id,date(2026,1,1));raise AssertionError('must reject')
  n['post_recurring_expense']=posting
  with self.assertRaises(HTTPException) as e:n['safe_post_recurring_expense'](*wrapper_args('safe_post_recurring_expense',db,t))
  self.assertEqual(e.exception.status_code,409);self.assertIn('rollback',effect_trace(db));self.assertEqual(db.commits,0)
 def test_manual_create_gate_and_canonical_closed_date_before_currency_or_write(self):
  db=DB(closed=True);t=tenant();n=load_functions('app/api/v1/accounting.py',['_ensure_open_period','create_manual_journal'],gate_namespace())
  with self.assertRaises(HTTPException) as e:n['create_manual_journal'](NS(entry_date=date(2026,2,3)),None,db,t)
  self.assertEqual(e.exception.detail,'Accounting period is closed for 2026-02-03');self.assert_gate_first(db,t);self.assertNotIn('add',effect_trace(db));self.assertEqual(db.commits,0)
 def test_manual_reverse_first_source_lock_is_after_gate_and_populates_cached_state(self):
  db=DB();t=tenant();n=load_functions('app/api/v1/accounting.py',['reverse_journal'],gate_namespace())
  with self.assertRaises(StopAtDomain):n['reverse_journal']('journal',None,db,t)
  self.assert_gate_first(db,t);q=db.events[2][1];self.assertEqual(q.target,'JournalEntry');self.assertTrue(q.lock);self.assertEqual(q.options,{'populate_existing':True});self.assertIn(('JournalEntry.organization_id','=','synthetic-org'),q.conditions)
 def test_manual_reverse_retains_original_date_not_today(self):
  db=DB(closed=True);t=tenant();old=date(2026,1,1);db.values=[NS(id='old',source_type='manual',functional_currency='USD',entry_date=old),None]
  n=load_functions('app/api/v1/accounting.py',['reverse_journal','_ensure_open_period'],{**gate_namespace(),'current_functional_currency_period':lambda *a:NS(currency='USD',effective_from=date(2020,1,1))})
  with self.assertRaises(HTTPException) as e:n['reverse_journal']('journal',None,db,t)
  self.assertEqual(e.exception.detail,'Accounting period is closed for 2026-01-01');self.assertEqual(db.commits,0)
 def test_sync_refreshes_cached_org_then_passes_current_currency_and_one_commit(self):
  db=DB();t=tenant();db.on_refresh=lambda item:setattr(item,'currency','EUR');seen=[]
  def sync(db,**kw):GATE.require_accounting_period_gate(db,kw['organization_id']);seen.append(kw);return {'counts':{},'errors':['preserved synthetic item error']}
  n=load_functions('app/api/v1/accounting_sync.py',['sync_accounting'],{**gate_namespace(),'sync_operational_accounting':sync,'audit_financial_integrity':lambda *a:{'counts':{'issue_count':0},'issues':[]},'AccountingIntegrityRead':lambda **k:NS(**k),'AccountingSyncRead':lambda **k:NS(**k),'record_activity':lambda *a,**k:None})
  out=n['sync_accounting'](None,db,t);self.assertEqual(seen[0]['base_currency'],'EUR');self.assertEqual(out.errors,['preserved synthetic item error']);self.assertEqual(db.commits,1);self.assert_gate_first(db,t)
 def test_currency_patch_exclusive_before_settings_and_journal_test(self):
  db=DB();t=tenant();financial=NS(accounting_currency='OLD',reporting_currency='USD');defaults=NS(default_client_currency=None);events=[]
  def refresh(item):
   if item is t.organization:item.currency='EUR'
   if item is financial:item.accounting_currency='EUR'
  db.on_refresh=refresh
  def rows(*args):GATE.require_accounting_period_gate(db,t.organization_id,exclusive=True);events.append('settings');return financial,defaults
  n=load_functions('app/api/v1/company_currencies.py',['update_company_currency_settings'],{**gate_namespace(),'_settings_rows':rows,'ensure_initial_functional_currency_period':lambda *a:NS(currency='EUR'),'_accounting_currency_locked':lambda *a:True})
  with self.assertRaises(HTTPException) as e:n['update_company_currency_settings'](NS(accounting_currency='USD',reporting_currency='USD',default_client_currency=None),None,db,t)
  self.assertEqual(e.exception.status_code,409);self.assertEqual(t.organization.currency,'EUR');self.assertEqual(financial.accounting_currency,'EUR');self.assertEqual(events,['settings']);self.assert_gate_first(db,t,True);self.assertEqual(effect_trace(db)[:4],['execute','refresh','refresh','refresh']);self.assertEqual(db.commits,0)
 def test_currency_transition_exclusive_reentry_does_not_upgrade_or_release(self):
  db=DB();t=tenant();financial=NS(accounting_currency='USD');captured=[]
  def change(db,**kw):GATE.require_accounting_period_gate(db,t.organization_id,exclusive=True);GATE.acquire_accounting_period_gate(db,t.organization_id);captured.append(kw);db.flush();return NS(period_id='p',new_currency='EUR',previous_currency='USD',effective_date=date(2026,10,1),transition_rate=Decimal('1'),transition_journal_entry_id='j',opening_debit=Decimal('5'),opening_credit=Decimal('5'),synced_counts={})
  n=load_functions('app/api/v1/company_currencies.py',['change_accounting_currency'],{**gate_namespace(),'_settings_rows':lambda *a:(financial,NS()),'ensure_initial_functional_currency_period':lambda *a:None,'current_functional_currency_period':lambda *a:NS(currency='USD'),'change_functional_currency':change,'record_activity':lambda *a,**k:None,'_read':lambda *a:'read'})
  p=NS(new_currency='EUR',effective_date=date(2026,10,1),transition_rate=Decimal('1'),reason='Synthetic reason');self.assertEqual(n['change_accounting_currency'](p,None,db,t),'read');self.assert_gate_first(db,t,True);self.assertEqual(db.commits,1);self.assertEqual(len(gate_sql(db)),1)
 def test_functional_service_rejects_missing_gate_before_read_or_write(self):
  db=DB();n=load_functions('app/services/functional_currency.py',['change_functional_currency'],gate_namespace())
  with self.assertRaises(GATE.AccountingPeriodGateError):n['change_functional_currency'](db,organization=tenant().organization,user_id='synthetic-user',new_currency='EUR',effective_date=date(2026,1,1),transition_rate=None,reason='Synthetic')
  self.assertEqual(db.events,[])
 def test_functional_service_rejects_shared_gate_instead_of_upgrade(self):
  db=DB();GATE.acquire_accounting_period_gate(db,'synthetic-org');n=load_functions('app/services/functional_currency.py',['change_functional_currency'],gate_namespace())
  with self.assertRaises(GATE.AccountingPeriodGateError):n['change_functional_currency'](db,organization=tenant().organization,user_id='synthetic-user',new_currency='EUR',effective_date=date(2026,1,1),transition_rate=None,reason='Synthetic')
  self.assertEqual(len(gate_sql(db)),1);self.assertNotIn('query',effect_trace(db))
 def test_functional_service_keeps_distinct_closed_transition_detail(self):
  db=DB(closed=True);GATE.acquire_accounting_period_gate(db,'synthetic-org',exclusive=True);n=load_functions('app/services/functional_currency.py',['change_functional_currency'],{**gate_namespace(),'organization_local_date':lambda *a:date(2026,10,27),'current_functional_currency_period':lambda *a:NS(currency='USD',effective_from=date(2020,1,1))})
  with self.assertRaises(HTTPException) as e:n['change_functional_currency'](db,organization=tenant().organization,user_id='synthetic-user',new_currency='EUR',effective_date=date(2026,1,1),transition_rate=None,reason='Synthetic')
  self.assertEqual(e.exception.detail,'The accounting period containing 2026-01-01 is closed.');self.assertEqual(db.commits,0)

def prefix_case(name):
 def check(self):
  db=DB();t=tenant();n=wrapper_ns()
  with self.assertRaises(StopAtDomain):n[name](*wrapper_args(name,db,t))
  self.assert_gate_first(db,t);self.assertEqual(db.commits,0)
 return check
for name in WRAPPERS:setattr(EntryPointAdoption,'test_gate_prefix_'+name,prefix_case(name))
def failure_case(name):
 def check(self):
  db=DB(isolation='REPEATABLE READ');t=tenant();n=wrapper_ns()
  with self.assertRaises(GATE.AccountingPeriodGateError):n[name](*wrapper_args(name,db,t))
  self.assertEqual(gate_sql(db),[]);self.assertNotIn('refresh',effect_trace(db));self.assertNotIn('query',effect_trace(db));self.assertEqual(db.commits,0)
 return check
for name in WRAPPERS:setattr(EntryPointAdoption,'test_gate_rejection_'+name,failure_case(name))
