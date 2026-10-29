"""Read-only AST coverage/freshness contracts supplement fake callable execution."""
import ast,unittest
from types import SimpleNamespace as NS
from datetime import date
from period_entrypoint_harness import *
from test_period_entrypoint_adoption_offline import wrapper_ns,wrapper_args
class ContractCoverage(unittest.TestCase):
 def test_all_fourteen_shadowed_wrapper_roots_acquire_inside_existing_defer_before_business(self):
  t=ast.parse((ROOT/'app/api/v1/financial_safety.py').read_text());roots=[n for n in t.body if isinstance(n,ast.FunctionDef) and n.name.startswith('safe_')];self.assertEqual(len(roots),14)
  for f in roots:
   self.assertIsInstance(f.body[0],ast.With);self.assertEqual(ast.unparse(f.body[0].items[0].context_expr),'defer_commits(db)');self.assertEqual(ast.unparse(f.body[0].body[0]),'acquire_accounting_period_gate(db, tenant.organization_id)');self.assertEqual(ast.unparse(f.body[0].body[1]),'db.refresh(tenant.organization)');self.assertEqual(sum(isinstance(n,ast.Call) and ast.unparse(n.func)=='db.commit' for n in ast.walk(f)),1)
 def test_all_owned_public_routes_keep_permission_annotations_and_methods(self):
  expected={'app/api/v1/financial_safety.py':14,'app/api/v1/accounting.py':2,'app/api/v1/accounting_sync.py':1,'app/api/v1/company_currencies.py':2,'app/api/v1/stripe_checkout.py':1,'app/api/v1/stripe_lifecycle.py':1,'app/api/v1/stripe_payouts.py':1}
  names={'create_manual_journal','reverse_journal','sync_accounting','update_company_currency_settings','change_accounting_currency','reconcile_live_checkout','review_live_stripe_event','confirm_live_payout'}
  total=0
  for path,count in expected.items():
   roots=[n for n in ast.parse((ROOT/path).read_text()).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and (n.name.startswith('safe_') or n.name in names)];self.assertEqual(len(roots),count);total+=len(roots)
   for node in roots:
    self.assertEqual(len(node.decorator_list),1);self.assertTrue(ast.unparse(node.decorator_list[0]).startswith(('router.post(','router.patch(')))
    if node.name!='review_live_stripe_event':self.assertIn(ast.unparse(next(a.annotation for a in node.args.args if a.arg=='tenant')),['FinanceManager','AccountingManager','CurrentTenantAdmin','Manager'])
  self.assertEqual(total,22) #21 journal roots +nonposting setup-currency PATCH, not22 new journal roots
 def test_currency_mutations_start_exclusive_never_upgrade_from_shared(self):
  tree=ast.parse((ROOT/'app/api/v1/company_currencies.py').read_text())
  for name in ['update_company_currency_settings','change_accounting_currency']:
   fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name);self.assertEqual(ast.unparse(fn.body[0]),'acquire_accounting_period_gate(db, tenant.organization_id, exclusive=True)');self.assertEqual(ast.unparse(fn.body[2]),'db.refresh(organization)')
 def test_all_three_functional_period_resolution_queries_refresh_cached_models(self):
  for name,args in [('ensure_initial_functional_currency_period',[tenant().organization,'user']),('current_functional_currency_period',['synthetic-org']),('functional_currency_period_for_date',['synthetic-org',date(2026,1,1)])]:
   db=DB();obj=NS(id='current');db.values=[obj];n=load_functions('app/services/functional_currency.py',[name],{'or_':lambda *args:args});self.assertIs(n[name](db,*args),obj);self.assertTrue(db.events[0][1].options['populate_existing'])
 def test_functional_transition_requires_exclusive_before_first_business_statement(self):
  fn=next(n for n in ast.parse((ROOT/'app/services/functional_currency.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='change_functional_currency');self.assertEqual(ast.unparse(fn.body[0]),'require_accounting_period_gate(db, organization.id, exclusive=True)');self.assertNotIn('acquire_accounting_period_gate',ast.unparse(fn));calls=[n for n in ast.walk(fn) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='ensure_accounting_period_open'];self.assertEqual(len(calls),1);self.assertIn('containing',ast.unparse(calls[0]));self.assertFalse(any(isinstance(n,ast.Call) and ast.unparse(n.func) in ['db.commit','db.rollback'] for n in ast.walk(fn)))
 def test_manual_private_validator_is_canonical_no_late_gate_acquisition(self):
  tree=ast.parse((ROOT/'app/api/v1/accounting.py').read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_ensure_open_period');self.assertEqual(ast.unparse(fn.body[0]),'ensure_accounting_period_open(db, organization_id, entry_date)');self.assertEqual(len(fn.body),1)
 def test_stripe_invoice_refresh_does_not_add_attempt_refresh_or_commit(self):
  tree=ast.parse((ROOT/'app/services/stripe_accounting.py').read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='post_verified_live_stripe_settlement');refreshes=[n for n in ast.walk(fn) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='execution_options'];self.assertEqual(len(refreshes),1);self.assertIn('select(Invoice)',ast.unparse(refreshes[0]));self.assertEqual(sum(isinstance(n,ast.Call) and ast.unparse(n.func)=='db.commit' for n in ast.walk(fn)),1)

def account_guard_case(name,types,expected):
 def case(self):
  db=DB();t=tenant();n=wrapper_ns();db.values=[NS(id=str(i),account_type=kind) for i,kind in enumerate(types)]
  if expected:
   with self.assertRaises(HTTPException) as error:n[name](*wrapper_args(name,db,t))
   self.assertEqual(error.exception.status_code,400);self.assertIn(expected,error.exception.detail)
  else:
   with self.assertRaises(StopAtDomain):n[name](*wrapper_args(name,db,t))
  self.assertEqual(len(gate_sql(db)),1);self.assertEqual(db.commits,0);self.assertNotIn('add',effect_trace(db));self.assertEqual(effect_trace(db).count('query'),len(types))
 return case
for name,types,msg in [('safe_record_payment',['credit_card'],'Customer payments cannot'),('safe_create_expense',['credit_card'],'This expense workflow cannot safely'),('safe_record_transfer',['credit_card','bank'],'Credit card settlement'),('safe_record_transfer',['bank','credit_card'],'Credit card settlement'),('safe_record_payment',['bank'],None),('safe_create_expense',['cash'],None),('safe_record_transfer',['bank','cash'],None)]:setattr(ContractCoverage,'test_shared_guard_'+name+'_'+'_'.join(types),account_guard_case(name,types,msg))
