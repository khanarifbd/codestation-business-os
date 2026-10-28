"""Offline additive read-contract checks. No DB/server/provider/network is exercised."""
import ast
import hashlib
from pathlib import Path
from types import SimpleNamespace
import unittest
ROOT=Path(__file__).parents[1]
# Two exact authorized finance preimages: original and separately audited source-Order-lock slice.
ORIGINAL_SOURCE_HASHES={'app/api/v1/finance.py': ('e7695b332b2b1802443e68dde192f574c0352f4ac0c4b7dad98a41daacff838c', '993d2c18683afd118242a30d1f783c86dccbf132751397d4a51987b165bbdfca'), 'app/api/v1/customer_advances.py': 'c6c71ac5e86b71e712011f158c3ed4df61df03d0816296cd9dc8fd29fc6836e9', 'app/api/v1/accounting_money.py': '4bf953445af9ffeb17eca7f0304e4b21e3aadbaf6d0a315525bdc719e1015c5b'}
ENTRIES=[('finance.py','get_payment','Payment','payment_id','FinanceViewer','/payments/{payment_id}','_payment_read'),('customer_advances.py','get_customer_advance','CustomerAdvance','advance_id','Viewer','/{advance_id}','_read'),('accounting_money.py','get_money_entry','AccountingMoneyEntry','entry_id','AccountingViewer','/{entry_id}','_read')]
class Column:
 def __init__(self,name):self.name=name
 def __eq__(self,value):return(self.name,value)
class Query:
 def __init__(self):self.conditions=[]
 def where(self,*conditions):self.conditions.extend(conditions);return self
class HttpError(Exception):
 def __init__(self,status_code,detail):self.status_code=status_code;self.detail=detail
class MoneyInReadTests(unittest.TestCase):
 def call(self,entry,org='synthetic-A',found=True):
  filename,name,model,idarg,role,route,builder=entry
  source=(ROOT/'app/api/v1'/filename).read_text();fn=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name==name);fn.decorator_list=[]
  module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),fn],type_ignores=[]);ast.fix_missing_locations(module)
  q=Query();item=SimpleNamespace(id='synthetic-receipt') if found else None;db=SimpleNamespace(scalar=lambda query:item)
  ns={'select':lambda *_:q,model:SimpleNamespace(id=Column('id'),organization_id=Column('organization_id')),'HTTPException':HttpError,builder:lambda *args:args}
  exec(compile(module,filename,'exec'),ns)
  try:r=ns[name]('synthetic-receipt',db,SimpleNamespace(organization_id=org))
  except HttpError as error:r=error
  return r,q,db,item
 def test_all_three_require_exact_viewer_and_exact_routes(self):
  for filename,name,model,idarg,role,route,builder in ENTRIES:
   with self.subTest(name=name):
    s=(ROOT/'app/api/v1'/filename).read_text();fn=next(n for n in ast.parse(s).body if isinstance(n,ast.FunctionDef)and n.name==name)
    self.assertEqual(ast.unparse(fn.args.args[2].annotation),role);self.assertEqual(fn.decorator_list[0].args[0].value,route);self.assertIn('require_tenant_permission("finance.view")',s)
 def test_tenant_and_id_are_both_required_for_each_read(self):
  for entry in ENTRIES:
   with self.subTest(name=entry[1]):
    _,q,_,_=self.call(entry);self.assertEqual(q.conditions,[('organization_id','synthetic-A'),('id','synthetic-receipt')])
 def test_other_tenant_changes_scope_not_requested_id(self):
  for entry in ENTRIES:
   _,q,_,_=self.call(entry,'synthetic-B');self.assertEqual(q.conditions,[('organization_id','synthetic-B'),('id','synthetic-receipt')])
 def test_missing_and_cross_tenant_rows_are_404(self):
  for entry in ENTRIES:
   r,_,_,_=self.call(entry,found=False);self.assertEqual(r.status_code,404)
 def test_exact_existing_dto_builder_is_reused(self):
  for entry in ENTRIES:
   r,_,db,item=self.call(entry);self.assertEqual(r,(db,item) if entry[1]=='get_payment' else (db,'synthetic-A',item))
 def test_removing_marked_reads_and_exact_approved_lock_delta_restores_original_bytes(self):
  manifest=ORIGINAL_SOURCE_HASHES
  # Later period-safety work changes only these exact writer fragments.
  # Undo that approved layer before enforcing the unchanged original read baseline.
  for entry in ENTRIES:
   p='app/api/v1/'+entry[0];s=(ROOT/p).read_text()
   if entry[0]=='finance.py':
    changes=[
     ('from app.services.financial_account_constraints import ensure_payment_receipt_account_supported\n',''),
     ('    ensure_payment_receipt_account_supported(account.account_type)\n',''),
     ('    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == payload.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update().execution_options(populate_existing=True))','    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == payload.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update())'),
    ]
    for approved,original_fragment in changes:
     self.assertEqual(s.count(approved),1);s=s.replace(approved,original_fragment,1)
   original=s[:s.index('\n\n# BEGIN MONEY IN RECEIPT READ')]
   self.assertIn(hashlib.sha256(original.encode()).hexdigest(),manifest[p] if isinstance(manifest[p],tuple) else (manifest[p],))
 def test_reader_has_no_write_provider_or_internal_retry(self):
  for entry in ENTRIES:
   tree=ast.parse((ROOT/'app/api/v1'/entry[0]).read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name==entry[1]);calls=[ast.unparse(n.func)for n in ast.walk(fn)if isinstance(n,ast.Call)];self.assertFalse(any(c.endswith(('.commit','.add','.flush','.delete','.post','.patch'))for c in calls));self.assertFalse(any(isinstance(n,(ast.For,ast.While))for n in ast.walk(fn)))
 def test_money_read_does_not_invent_reversal_or_income_only_status(self):
  r,_,_,_=self.call(ENTRIES[2]);self.assertEqual(r[2].id,'synthetic-receipt');source=(ROOT/'app/api/v1/accounting_money.py').read_text().split('# BEGIN MONEY IN RECEIPT READ')[1];self.assertNotIn('item.status',source);self.assertNotIn('.kind',source)
if __name__=='__main__':unittest.main(verbosity=2)
