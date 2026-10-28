"""Actual helper + extracted actual callables with explicit fake transaction/session.

No app/config import, DB engine, network or live provider. SQL/model collaborators
are deliberate fakes; ordering assertions are NOT PostgreSQL concurrency proof.
"""
from __future__ import annotations
import ast,contextlib,importlib.util,sys,types
from pathlib import Path
from types import SimpleNamespace as NS
from datetime import date,datetime,timezone
from decimal import Decimal
from fastapi import HTTPException,status
from sqlalchemy import Table,Column,MetaData,String,Date
ROOT=Path(__file__).resolve().parents[1]
class StopAtDomain(Exception):pass
class Expr:
 def __init__(self,name):self.name=name
 def __eq__(self,value):return (self.name,'=',value)
 def __ne__(self,value):return (self.name,'!=',value)
 def __le__(self,value):return (self.name,'<=',value)
 def __ge__(self,value):return (self.name,'>=',value)
 def __lt__(self,value):return (self.name,'<',value)
 def __gt__(self,value):return (self.name,'>',value)
 def is_(self,value):return(self.name,'is',value)
 def in_(self,value):return(self.name,'in',value)
 def is_not(self,value):return(self.name,'isnot',value)
 def desc(self):return self
 def asc(self):return self
class ModelMeta(type):
 def __getattr__(cls,name):return Expr(cls.__name__+'.'+name)
class Model(metaclass=ModelMeta):
 def __init__(self,**values):self.__dict__.update(values);self.id=values.get('id','synthetic-row')
MODELS={name:ModelMeta(name,(Model,),{}) for name in ['FinancialAccount','Payment','Invoice','Expense','AccountTransfer','CustomerAdvance','AccountingMoneyEntry','ActivityLog','LoanDisbursement','LoanRepayment','CompanyLoan','PayablePayment','JournalEntry','JournalLine','LedgerAccount','OrganizationFunctionalCurrencyPeriod','OrganizationFinancialSettings','OrganizationSystemDefaults','Organization','User','Membership','PaymentGatewayConnection','StripeCheckoutAttempt','StripeSettlementSnapshot','StripeAccountingPosting','StripeWebhookEvent','StripePayoutReconciliation']}
class Query:
 def __init__(self,*columns):self.columns=columns;self.conditions=[];self.lock=False;self.options={}
 def where(self,*conditions):self.conditions.extend(conditions);return self
 def with_for_update(self,**options):self.lock=True;self.lock_options=options;return self
 def execution_options(self,**options):self.options.update(options);return self
 def order_by(self,*args):return self
 def limit(self,*args):return self
 def join(self,*args,**kwargs):return self
 @property
 def target(self):
  x=self.columns[0];return x.name if isinstance(x,Expr) else getattr(x,'__name__',str(x))
def select(*columns):return Query(*columns)
def load_functions(relative,names,extra=None):
 """Compile original function ASTs, dropping route decorators/import statements only."""
 tree=ast.parse((ROOT/relative).read_text());selected=[]
 class StripImports(ast.NodeTransformer):
  def visit_ImportFrom(self,node):return None
  def visit_Import(self,node):return None
 for node in tree.body:
  if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in names:
   node.decorator_list=[];selected.append(StripImports().visit(node))
 if set(names)!={node.name for node in selected}:raise AssertionError('Callable missing from source')
 module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),*selected],type_ignores=[]);ast.fix_missing_locations(module)
 namespace={'HTTPException':HTTPException,'status':status,'select':select,'Decimal':Decimal,'date':date,'datetime':datetime,'timezone':timezone,**MODELS}
 namespace.update(extra or {});exec(compile(module,str(ROOT/relative),'exec'),namespace);return namespace

def load_real_gate():
 # Only this module's inert model declaration is substituted; all gate code runs unchanged.
 table=Table('accounting_periods',MetaData(),Column('id',String),Column('organization_id',String),Column('status',String),Column('start_date',Date),Column('end_date',Date))
 placeholder=types.ModuleType('app.models.finance_controls');placeholder.AccountingPeriod=NS(**{c.name:c for c in table.c});name='app.models.finance_controls';previous=sys.modules.get(name);sys.modules[name]=placeholder
 try:
  spec=importlib.util.spec_from_file_location('isolated_real_accounting_period_gate',ROOT/'app/services/accounting_period_gate.py');module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module);return module
 finally:
  if previous is None:sys.modules.pop(name,None)
  else:sys.modules[name]=previous
GATE=load_real_gate()
class Base:
 def commit(self):
  self.events.append(('commit',));self.commits+=1;self.root.is_active=False;self.connection_root.is_active=False;self.root=None;self.connection_root=None
session_source=ROOT/'app/db/session.py'
# The parent retains an exact source-only copy of the existing commit/defer implementation.
tree=ast.parse(session_source.read_text());nodes=[]
for n in tree.body:
 if isinstance(n,ast.ClassDef) and n.name=='BusinessSession':nodes.append(n)
 if isinstance(n,ast.FunctionDef) and n.name=='defer_commits':nodes.append(n)
m=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),*nodes],type_ignores=[]);ast.fix_missing_locations(m);ns={'Session':Base,'contextmanager':contextlib.contextmanager};exec(compile(m,str(session_source),'exec'),ns)
BusinessSession=ns['BusinessSession'];defer_commits=ns['defer_commits']
class DB(BusinessSession):
 def __init__(self,*,closed=False,isolation='READ COMMITTED'):
  self.events=[];self.info={};self.is_active=True;self.root=NS(is_active=True);self.connection_root=NS(is_active=True);self.commits=0;self.closed_period=closed;self.values=[];self.on_scalar=None;self.on_refresh=None
  self.conn=NS(closed=False,invalidated=False,dialect=NS(name='postgresql'),connection=NS(driver_connection=NS(autocommit=False)),get_transaction=lambda:self.connection_root,get_isolation_level=lambda:isolation)
 def get_transaction(self):return self.root
 def get_nested_transaction(self):return None
 def connection(self):return self.conn
 def execute(self,statement,parameters=None):
  text=str(statement);self.events.append(('execute',text,parameters));return NS(scalar_one_or_none=lambda:None,all=lambda:[])
 def scalar(self,statement):
  if not isinstance(statement,Query):self.events.append(('period_read',str(statement)));return 'closed-id' if self.closed_period else None
  self.events.append(('query',statement));
  if self.on_scalar:return self.on_scalar(statement)
  if self.values:return self.values.pop(0)
  raise StopAtDomain(statement.target)
 def scalars(self,statement):
  value=self.scalar(statement);return NS(all=lambda:value or [])
 def refresh(self,item,*args,**kwargs):
  self.events.append(('refresh',item))
  if self.on_refresh:self.on_refresh(item)
 def flush(self):self.events.append(('flush',))
 def rollback(self):
  self.events.append(('rollback',));
  if self.root:self.root.is_active=False
  if self.connection_root:self.connection_root.is_active=False
  self.root=None;self.connection_root=None
 def add(self,item):self.events.append(('add',item))
def tenant(currency='OLD'):
 return NS(organization_id='synthetic-org',user_id='synthetic-user',organization=NS(id='synthetic-org',currency=currency,timezone='UTC'))
def gate_namespace():return {'acquire_accounting_period_gate':GATE.acquire_accounting_period_gate,'require_accounting_period_gate':GATE.require_accounting_period_gate,'ensure_accounting_period_open':GATE.ensure_accounting_period_open,'defer_commits':defer_commits}
def gate_sql(db):return [x for x in db.events if x[0]=='execute' and 'pg_advisory_xact_lock' in x[1]]
def effect_trace(db):return [x[0] for x in db.events]
def stop(*args,**kwargs):raise StopAtDomain('delegate')

_constraint_ns={}
exec(compile((ROOT/"app/services/financial_account_constraints.py").read_text(),str(ROOT/"app/services/financial_account_constraints.py"),"exec"),_constraint_ns)
CONSTRAINTS={key:value for key,value in _constraint_ns.items() if key.startswith("ensure_")}
