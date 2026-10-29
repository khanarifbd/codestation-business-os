"""Offline actual-handler/SQL contracts. These are not PostgreSQL concurrency tests."""
import ast
import hashlib
import importlib.util
import json
from datetime import date
from decimal import Decimal
from pathlib import Path
import socket
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine

ROOT = Path(__file__).resolve().parents[1]
def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module; spec.loader.exec_module(module)
    return module
api = load('asset_lock_review_api', 'app/api/v1/accounting_assets.py')
corrections = load('asset_correction_lock_review_api', 'app/api/v1/financial_corrections.py')

class StopAfterBoundary(Exception): pass
class Rows:
    def __init__(self, values): self.values = values
    def all(self): return self.values
class PeriodTransaction:
    def __init__(self): self.is_active = True

class PeriodConnection:
    def __init__(self):
        self.closed = self.invalidated = False
        self.dialect = NS(name='postgresql')
        self.connection = NS(driver_connection=NS(autocommit=False))
        self.transaction = PeriodTransaction()
        self.isolation = 'READ COMMITTED'
    def get_transaction(self): return self.transaction
    def get_isolation_level(self): return self.isolation

class PeriodTransactionFake:
    """Strict active-root/connection protocol for the real period gate, not a mock."""
    def initialize_period_transaction(self):
        self.info = {}; self.is_active = True
        self.transaction = PeriodTransaction(); self.period_connection = PeriodConnection()
        self.period_events = []; self.boundary_trace = []
    def get_transaction(self): return self.transaction
    def get_nested_transaction(self): return None
    def connection(self):
        if self.transaction is None: raise AssertionError('Unexpected implicit transaction')
        return self.period_connection
    def execute(self, statement, params):
        sql = str(statement)
        if sql != 'SELECT pg_advisory_xact_lock_shared(:lock_key)':
            raise AssertionError('Unexpected financial SQL in period fake: '+sql)
        if set(params) != {'lock_key'} or type(params['lock_key']) is not int:
            raise AssertionError('Expected one bound integer gate key')
        if not self.transaction or not self.transaction.is_active:
            raise AssertionError('Gate SQL outside active transaction')
        self.period_events.append(('gate',sql,dict(params)))
        self.boundary_trace.append('gate')
    def refresh(self, item, attribute_names=None):
        # No queued domain response is consumed by ORM attribute refresh.
        self.period_events.append(('refresh', tuple(attribute_names) if attribute_names is not None else None))
        self.boundary_trace.append('refresh')
    def end_period_transaction(self):
        if self.transaction: self.transaction.is_active = False
        if self.period_connection.transaction: self.period_connection.transaction.is_active = False
        self.transaction = self.period_connection.transaction = None
    def begin_next_period_transaction(self):
        if self.transaction is not None: raise AssertionError('Root still active')
        self.transaction = PeriodTransaction(); self.period_connection.transaction = PeriodTransaction()

class FakeDB(PeriodTransactionFake):
    def __init__(self, scalar_values=(), assets=()):
        self.initialize_period_transaction()
        self.values=list(scalar_values); self.assets=list(assets); self.queries=[]; self.events=[]; self.added=[]
    def capture(self,q):
        self.boundary_trace.append('query')
        compiled=q.compile(dialect=postgresql.dialect()); row=(str(compiled),compiled.params,q.get_execution_options()); self.queries.append(row); self.events.append(('query',row[0])); return row
    def scalar(self,q):
        self.capture(q)
        if not self.values: raise AssertionError('Unexpected scalar query')
        return self.values.pop(0)
    def scalars(self,q): self.capture(q); return Rows(self.assets)
    def add(self,item): self.added.append(item); self.events.append(('add',type(item).__name__))
    def flush(self): self.events.append(('flush',))
    def commit(self):
        if self.info.get('deferred_commit_depth',0): self.flush(); return
        self.events.append(('commit',)); self.end_period_transaction()
    def rollback(self): self.events.append(('rollback',)); self.end_period_transaction()

def asset(**changes):
    values=dict(id='asset-a',organization_id='org-a',asset_code='FA-A',name='Synthetic asset',record_mode='purchase',opening_balance_date=None,opening_accumulated_depreciation=Decimal('0'),status='active',in_service_date=date(2026,1,1),acquisition_date=date(2026,1,1),acquisition_cost=Decimal('1200'),salvage_value=Decimal('0'),accumulated_depreciation=Decimal('200'),useful_life_months=12,currency='USD')
    values.update(changes); return NS(**values)
def account(**changes):
    values=dict(id='account-a',organization_id='org-a',is_active=True,currency='USD',account_type='bank',opening_balance=Decimal('2000'))
    values.update(changes); return NS(**values)

class AssetLockTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(Engine,'connect',side_effect=AssertionError('No database')).start()
        patch.object(socket.socket,'connect',side_effect=AssertionError('No network')).start()
        self.tenant=NS(organization_id='org-a',user_id='synthetic-actor',organization=NS(currency='USD',timezone='UTC'))
    def expect(self,status,fn):
        with self.assertRaises(HTTPException) as caught: fn()
        self.assertEqual(caught.exception.status_code,status)
    def assert_lock(self,row,table,identity=None):
        sql,params,options=row; self.assertIn(table,sql); self.assertIn('FOR UPDATE',sql); self.assertIn('org-a',params.values()); self.assertIs(options.get('populate_existing'),True)
        if identity: self.assertIn(identity,params.values())
    def create_body(self,**changes):
        values=dict(asset_code='FA-A',name='Synthetic asset',category='equipment',currency='USD',acquisition_cost=Decimal('1200'),salvage_value=Decimal('0'),acquisition_date=date(2026,1,1),in_service_date=date(2026,1,2),useful_life_months=12,purchase_account_id='account-a')
        values.update(changes); return api.AssetCreate(**values)
    def test_purchase_account_query_scoped_locked_refreshed(self):
        fresh=account(); db=FakeDB([fresh]); self.assertIs(api._lock_asset_purchase_account(db,'org-a','account-a'),fresh); self.assert_lock(db.queries[0],'financial_accounts','account-a')
    def test_purchase_account_missing(self):
        db=FakeDB([None]); self.expect(404,lambda:api._lock_asset_purchase_account(db,'org-a','account-a'))
    def test_purchase_account_inactive_after_wait(self):
        db=FakeDB([account(is_active=False)]); self.expect(404,lambda:api._lock_asset_purchase_account(db,'org-a','account-a')); self.assert_lock(db.queries[0],'financial_accounts','account-a')
    def test_purchase_account_other_tenant_predicate(self):
        db=FakeDB([None]); self.expect(404,lambda:api._lock_asset_purchase_account(db,'org-b','account-a')); self.assertIn('org-b',db.queries[0][1].values())
    def test_purchase_locks_before_ledger_or_balance_or_write(self):
        a=account(); db=FakeDB([None,a])
        def ledger(*args): db.events.append(('ledger',)); raise StopAfterBoundary()
        with patch.object(api,'financial_ledger_account',side_effect=ledger),patch.object(api,'account_balance') as balance:
            with self.assertRaises(StopAfterBoundary): api.create_asset(self.create_body(),None,db,self.tenant)
            balance.assert_not_called()
        self.assert_lock(db.queries[1],'financial_accounts','account-a'); self.assertEqual(db.events[-1],('ledger',)); self.assertFalse(db.added)
    def test_purchase_inactive_after_wait_blocks_ledger(self):
        db=FakeDB([None,account(is_active=False)])
        with patch.object(api,'financial_ledger_account') as ledger:
            self.expect(404,lambda:api.create_asset(self.create_body(),None,db,self.tenant)); ledger.assert_not_called()
    def test_purchase_fresh_insufficient_balance_blocks_posting(self):
        a=account(); db=FakeDB([None,a])
        with patch.object(api,'financial_ledger_account',return_value=(a,NS(id='cash'))),patch.object(api,'account_balance',return_value=Decimal('5')),patch.object(api,'post_journal') as journal:
            self.expect(409,lambda:api.create_asset(self.create_body(),None,db,self.tenant)); journal.assert_not_called()
        self.assert_lock(db.queries[1],'financial_accounts','account-a'); self.assertFalse(db.added)
    def test_purchase_credit_card_rejection_unchanged(self):
        a=account(account_type='credit_card'); db=FakeDB([None,a])
        with patch.object(api,'financial_ledger_account',return_value=(a,NS(id='cash'))),patch.object(api,'account_balance') as balance:
            self.expect(400,lambda:api.create_asset(self.create_body(),None,db,self.tenant)); balance.assert_not_called()
    def test_purchase_currency_rejection_unchanged(self):
        a=account(currency='EUR'); db=FakeDB([None,a])
        with patch.object(api,'financial_ledger_account',return_value=(a,NS(id='cash'))),patch.object(api,'account_balance') as balance:
            self.expect(400,lambda:api.create_asset(self.create_body(),None,db,self.tenant)); balance.assert_not_called()
    def test_duplicate_code_stops_before_account_lock(self):
        db=FakeDB(['asset-existing'])
        self.expect(409,lambda:api.create_asset(self.create_body(),None,db,self.tenant)); self.assertEqual(len(db.queries),1)
    def test_opening_never_locks_cash_account(self):
        db=FakeDB([None])
        with patch.object(db,'add',side_effect=StopAfterBoundary()),patch.object(api,'_lock_asset_purchase_account') as lock,patch.object(api,'financial_ledger_account') as ledger:
            with self.assertRaises(StopAfterBoundary): api.create_asset(self.create_body(record_mode='opening',purchase_account_id=None,opening_balance_date=date(2026,1,2)),None,db,self.tenant)
            lock.assert_not_called(); ledger.assert_not_called()
    def run_fixture(self,db,period='2026-03-20'):
        def system(*args): db.events.append(('system',args[-1])); return NS(id=args[-1])
        def post(*args,**kwargs): db.events.append(('journal',kwargs)); return NS(id='journal-a')
        with patch.object(api,'system_account',side_effect=system),patch.object(api,'post_journal',side_effect=post),patch.object(api,'to_base_amount',return_value=(Decimal('100'),Decimal('1'))),patch.object(api,'record_activity'):
            return api.run_depreciation(api.DepreciationRun(period_date=date.fromisoformat(period)),None,db,self.tenant)
    def test_run_first_locks_eligible_assets_in_total_order(self):
        db=FakeDB(assets=[]); result=self.run_fixture(db); self.assertEqual(result['posted'],[]); row=db.queries[0]; self.assert_lock(row,'fixed_assets'); self.assertIn('active',row[1].values()); self.assertIn(date(2026,3,20),row[1].values()); self.assertIn('ORDER BY fixed_assets.asset_code, fixed_assets.id',row[0]); self.assertEqual(db.events[0][0],'query'); self.assertEqual(db.events[1],('system','depreciation_expense'))
    def test_run_does_not_lock_existing_depreciation_rows(self):
        db=FakeDB([None,None],assets=[asset()]); self.run_fixture(db); self.assert_lock(db.queries[0],'fixed_assets'); self.assertEqual(len(db.queries),3)
        for row in db.queries[1:]: self.assertIn('asset_depreciation_entries',row[0]); self.assertNotIn('FOR UPDATE',row[0])
    def test_run_current_amounts_and_separate_month_posting_date(self):
        fresh=asset(accumulated_depreciation=Decimal('1150')); db=FakeDB([None,None],assets=[fresh]); result=self.run_fixture(db)
        self.assertEqual(result['period_date'],date(2026,3,1)); self.assertEqual(result['posting_date'],date(2026,3,20)); self.assertEqual(result['posted'][0]['amount'],Decimal('50.00')); self.assertEqual(fresh.accumulated_depreciation,Decimal('1200.00')); self.assertEqual(fresh.status,'fully_depreciated')
        journal=next(x[1] for x in db.events if x[0]=='journal'); self.assertEqual(journal['entry_date'],date(2026,3,20)); self.assertEqual(db.events[-1],('commit',))
    def test_later_posted_period_rejects_before_post_or_commit(self):
        db=FakeDB([date(2026,4,1)],assets=[asset()]); self.expect(409,lambda:self.run_fixture(db)); self.assertFalse(db.added); self.assertFalse(any(x[0] in ('journal','commit') for x in db.events))
    def test_same_posted_month_is_skipped(self):
        db=FakeDB([date(2026,3,1),'entry-existing'],assets=[asset()]); result=self.run_fixture(db); self.assertEqual(result['skipped'],[{'asset_id':'asset-a','reason':'already_posted_this_month'}]); self.assertFalse(any(x[0]=='journal' for x in db.events))
    def test_opening_same_month_skips_without_history_lookup(self):
        db=FakeDB(assets=[asset(record_mode='opening',opening_balance_date=date(2026,3,2))]); result=self.run_fixture(db); self.assertEqual(result['skipped'][0]['reason'],'before_or_at_opening_balance'); self.assertEqual(len(db.queries),1)
    def test_zero_remaining_marks_fully_depreciated_and_skips(self):
        row=asset(accumulated_depreciation=Decimal('1200')); db=FakeDB([None,None],assets=[row]); result=self.run_fixture(db); self.assertEqual(result['skipped'][0]['reason'],'fully_depreciated'); self.assertEqual(row.status,'fully_depreciated'); self.assertFalse(any(x[0]=='journal' for x in db.events))
    def test_reversed_history_not_used_for_period_conflicts(self):
        db=FakeDB([None,None],assets=[asset()]); self.run_fixture(db)
        for query in db.queries[1:]: self.assertIn('posted',query[1].values()); self.assertIn('org-a',query[1].values()); self.assertIn('asset-a',query[1].values())
    def test_depreciation_correction_locks_entry_then_asset_with_refresh(self):
        entry=NS(id='entry-a',asset_id='asset-a',period_date=date(2026,3,1)); db=FakeDB([entry,asset(),None])
        with patch.object(corrections,'_journal_reversed',return_value=False),patch.object(corrections,'reverse_source_journal',side_effect=StopAfterBoundary()):
            with self.assertRaises(StopAfterBoundary): corrections.reverse_business_transaction(corrections.CorrectionRequest(source_type='asset_depreciation',source_id='entry-a',reason='Synthetic correction',reversal_date=date(2026,3,21)),None,db,self.tenant)
        self.assert_lock(db.queries[0],'asset_depreciation_entries','entry-a'); self.assert_lock(db.queries[1],'fixed_assets','asset-a'); self.assertNotIn('FOR UPDATE',db.queries[2][0]); self.assertFalse(db.added)
    def test_depreciation_correction_later_entry_rejection_retained(self):
        entry=NS(id='entry-a',asset_id='asset-a',period_date=date(2026,3,1)); db=FakeDB([entry,asset(),'later-entry'])
        with patch.object(corrections,'_journal_reversed',return_value=False),patch.object(corrections,'reverse_source_journal') as reverse:
            self.expect(409,lambda:corrections.reverse_business_transaction(corrections.CorrectionRequest(source_type='asset_depreciation',source_id='entry-a',reason='Synthetic correction',reversal_date=date(2026,3,21)),None,db,self.tenant)); reverse.assert_not_called()
    def test_acquisition_correction_locks_asset_with_refresh_before_history(self):
        db=FakeDB([asset(),None])
        with patch.object(corrections,'_journal_reversed',return_value=False),patch.object(corrections,'reverse_source_journal',side_effect=StopAfterBoundary()):
            with self.assertRaises(StopAfterBoundary): corrections.reverse_business_transaction(corrections.CorrectionRequest(source_type='fixed_asset',source_id='asset-a',reason='Synthetic correction',reversal_date=date(2026,3,21)),None,db,self.tenant)
        self.assert_lock(db.queries[0],'fixed_assets','asset-a'); self.assertNotIn('FOR UPDATE',db.queries[1][0])
    def test_acquisition_correction_posted_depreciation_blocks_reversal(self):
        db=FakeDB([asset(),'posted-entry'])
        with patch.object(corrections,'_journal_reversed',return_value=False),patch.object(corrections,'reverse_source_journal') as reverse:
            self.expect(409,lambda:corrections.reverse_business_transaction(corrections.CorrectionRequest(source_type='fixed_asset',source_id='asset-a',reason='Synthetic correction',reversal_date=date(2026,3,21)),None,db,self.tenant)); reverse.assert_not_called()

BASELINE_AST_HASHES = {'accounting_assets.py': '0f80090e8625483b93a6628367493cc05761d68707e7e45ba8fb400ff90bfc84', 'financial_corrections.py': '91e8cd59d32af28795bee0081485830fe3a7c379bedbf6e4161ecebf01b71bec'}
def syntax_hash(value):
    def normalize(node):
        if isinstance(node,ast.AST): return [type(node).__name__,{key:normalize(item) for key,item in ast.iter_fields(node) if not(key=='type_params' and not item)}]
        if isinstance(node,list): return [normalize(item) for item in node]
        return node
    return hashlib.sha256(json.dumps(normalize(value),sort_keys=True,separators=(',',':')).encode()).hexdigest()

def strip_exact_period_prefix(test, tree, prefixes):
    imports=[n for n in tree.body if isinstance(n,ast.ImportFrom) and n.module=='app.services.accounting_period_gate']
    test.assertEqual(len(imports),1)
    expected=ast.parse('from app.services.accounting_period_gate import acquire_accounting_period_gate').body[0]
    test.assertEqual(ast.dump(imports[0]),ast.dump(expected))
    tree.body.remove(imports[0])
    for name,refresh in prefixes.items():
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
        exact=ast.parse('acquire_accounting_period_gate(db, tenant.organization_id)\n'+refresh).body
        test.assertEqual([ast.dump(n) for n in fn.body[:len(exact)]],[ast.dump(n) for n in exact],name)
        fn.body=fn.body[len(exact):]
    return tree

class SourcePreservationTests(unittest.TestCase):
    def test_only_documented_asset_lock_changes_exist(self):
        tree=ast.parse((ROOT/'app/api/v1/accounting_assets.py').read_text())
        strip_exact_period_prefix(self,tree,{name:'db.refresh(tenant.organization, attribute_names=["currency"])' for name in ('create_asset','run_depreciation')})
        tree.body=[n for n in tree.body if not(isinstance(n,ast.FunctionDef) and n.name=='_lock_asset_purchase_account')]
        class StripLocks(ast.NodeTransformer):
            def visit_FunctionDef(self,node):
                if node.name=='create_asset':
                    node.body=[n for n in node.body if not(isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='_lock_asset_purchase_account')]
                if node.name in ('create_asset','run_depreciation'): return self.generic_visit(node)
                return node
            def visit_Expr(self,node):
                if isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id=='_lock_asset_purchase_account': return None
                return self.generic_visit(node)
            def visit_Call(self,node):
                node=self.generic_visit(node)
                if isinstance(node.func,ast.Attribute) and node.func.attr in ('with_for_update','execution_options'): return node.func.value
                if isinstance(node.func,ast.Attribute) and node.func.attr=='order_by' and len(node.args)==2 and ast.unparse(node.args[-1])=='FixedAsset.id': node.args=node.args[:-1]
                return node
        self.assertEqual(syntax_hash(StripLocks().visit(tree)),BASELINE_AST_HASHES['accounting_assets.py'])
    def test_corrections_only_refresh_three_existing_locks(self):
        tree=ast.parse((ROOT/'app/api/v1/financial_corrections.py').read_text()); count=0
        strip_exact_period_prefix(self,tree,{'reverse_business_transaction':'db.refresh(tenant.organization, attribute_names=["currency", "timezone"])'})
        # v28 adds only the separately reviewed Tax coordination boundary. Prove
        # and remove that exact delta before the original v27 Assets invariant;
        # do not rebaseline unrelated correction handlers or broaden count=3.
        imports=[n for n in tree.body if isinstance(n,ast.ImportFrom) and n.module=='app.services.tax_settlement_safety']
        self.assertEqual(len(imports),1)
        self.assertEqual(ast.dump(imports[0]),ast.dump(ast.parse('from app.services.tax_settlement_safety import lock_tax_settlements, lock_tax_reversal_accounts').body[0]))
        functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='reverse_business_transaction']
        self.assertEqual(len(functions),1)
        branches=[n for n in ast.walk(functions[0]) if isinstance(n,ast.If) and ast.unparse(n.test)=="payload.source_type == 'tax_settlement'"]
        self.assertEqual(len(branches),1); branch=branches[0]
        self.assertEqual(syntax_hash(branch.body),'ba4cca7d73430f766dab33f6d7dabed3a043b2c2b1c52f0c346853a663b78b5c')
        self.assertEqual(ast.unparse(branch.body[0]),'lock_tax_settlements(db, tenant.organization_id)')
        self.assertEqual(ast.unparse(branch.body[4]),'lock_tax_reversal_accounts(db, tenant.organization_id, settlement.id)')
        del branch.body[4]; del branch.body[0]
        assignment=branch.body[0]
        self.assertIsInstance(assignment,ast.Assign)
        self.assertEqual(ast.unparse(assignment.targets[0]),'settlement')
        refresh=assignment.value.args[0]
        self.assertIsInstance(refresh,ast.Call); self.assertIsInstance(refresh.func,ast.Attribute)
        self.assertEqual(refresh.func.attr,'execution_options'); self.assertEqual(refresh.args,[])
        self.assertEqual(len(refresh.keywords),1); self.assertEqual(refresh.keywords[0].arg,'populate_existing')
        self.assertIsInstance(refresh.keywords[0].value,ast.Constant); self.assertIs(refresh.keywords[0].value.value,True)
        assignment.value.args[0]=refresh.func.value
        self.assertEqual(syntax_hash(branch.body),'0b0dc7a2c8722a445ba3a9f65039b5f45dacb880c7019196141d82e7394e44f9')
        tree.body.remove(imports[0])
        class StripRefresh(ast.NodeTransformer):
            def visit_Call(self,node):
                nonlocal count
                node=self.generic_visit(node)
                if isinstance(node.func,ast.Attribute) and node.func.attr=='execution_options' and len(node.keywords)==1 and node.keywords[0].arg=='populate_existing' and isinstance(node.keywords[0].value,ast.Constant) and node.keywords[0].value.value is True:
                    count+=1; return node.func.value
                return node
        stripped=StripRefresh().visit(tree); self.assertEqual(count,3); self.assertEqual(syntax_hash(stripped),BASELINE_AST_HASHES['financial_corrections.py'])



class PeriodGateAdapterTests(unittest.TestCase):
    def test_real_gate_precedes_asset_query_and_targeted_currency_refresh(self):
        db=FakeDB(['duplicate'])
        tenant=NS(organization_id='org-a',organization=NS(currency='USD'))
        with self.assertRaises(HTTPException):
            api.create_asset(NS(asset_code='SYNTHETIC'),None,db,tenant)
        self.assertEqual(db.boundary_trace,['gate','refresh','query'])
        self.assertEqual(db.period_events[1],('refresh',('currency',)))
        from app.services.accounting_period_gate import accounting_period_gate_key
        self.assertEqual(db.period_events[0][2],{'lock_key':accounting_period_gate_key('org-a')})
    def test_real_gate_missing_root_fails_before_any_asset_query(self):
        from app.services.accounting_period_gate import AccountingPeriodGateError
        db=FakeDB();db.end_period_transaction()
        with self.assertRaises(AccountingPeriodGateError):
            api.create_asset(NS(),None,db,NS(organization_id='org-a'))
        self.assertEqual(db.boundary_trace,[]);self.assertEqual(db.queries,[])
    def test_real_gate_rejects_changed_connection_root(self):
        from app.services.accounting_period_gate import acquire_accounting_period_gate,require_accounting_period_gate,AccountingPeriodGateError
        db=FakeDB();acquire_accounting_period_gate(db,'org-a')
        db.period_connection.transaction=PeriodTransaction()
        with self.assertRaises(AccountingPeriodGateError):require_accounting_period_gate(db,'org-a')
        self.assertEqual(len(db.period_events),1)
    def test_deferred_commit_retains_gate_real_commit_invalidates(self):
        from app.services.accounting_period_gate import acquire_accounting_period_gate,require_accounting_period_gate,AccountingPeriodGateError
        from app.db.session import defer_commits
        db=FakeDB();acquire_accounting_period_gate(db,'org-a')
        with defer_commits(db):
            db.commit();require_accounting_period_gate(db,'org-a')
            acquire_accounting_period_gate(db,'org-a')
        self.assertEqual(db.events,[('flush',)]);self.assertEqual(len(db.period_events),1)
        db.commit()
        with self.assertRaises(AccountingPeriodGateError):require_accounting_period_gate(db,'org-a')
        db.begin_next_period_transaction()
        with self.assertRaises(AccountingPeriodGateError):require_accounting_period_gate(db,'org-a')
        acquire_accounting_period_gate(db,'org-a');self.assertEqual(len(db.period_events),2)
    def test_rollback_does_not_allow_reuse_of_old_ownership(self):
        from app.services.accounting_period_gate import acquire_accounting_period_gate,require_accounting_period_gate,AccountingPeriodGateError
        db=FakeDB();acquire_accounting_period_gate(db,'org-a');db.rollback();db.begin_next_period_transaction()
        with self.assertRaises(AccountingPeriodGateError):require_accounting_period_gate(db,'org-a')
        acquire_accounting_period_gate(db,'org-a');self.assertEqual(len(db.period_events),2)
    def test_protocol_rejects_repeatable_read_without_issuing_gate_sql(self):
        from app.services.accounting_period_gate import acquire_accounting_period_gate,AccountingPeriodGateError
        db=FakeDB();db.period_connection.isolation='REPEATABLE READ'
        with self.assertRaises(AccountingPeriodGateError):acquire_accounting_period_gate(db,'org-a')
        self.assertEqual(db.period_events,[])
    def test_source_normalization_rejects_wrong_tenant_or_refresh_scope(self):
        original=(ROOT/'app/api/v1/accounting_assets.py').read_text()
        for replacement in ('acquire_accounting_period_gate(db, "other-tenant")','db.flush()'):
            tree=ast.parse(original.replace('acquire_accounting_period_gate(db, tenant.organization_id)',replacement,1))
            with self.assertRaises(AssertionError):strip_exact_period_prefix(self,tree,{name:'db.refresh(tenant.organization, attribute_names=["currency"])' for name in ('create_asset','run_depreciation')})
        tree=ast.parse(original.replace('attribute_names=["currency"]','attribute_names=["currency", "timezone"]',1))
        with self.assertRaises(AssertionError):strip_exact_period_prefix(self,tree,{name:'db.refresh(tenant.organization, attribute_names=["currency"])' for name in ('create_asset','run_depreciation')})
    def test_correction_gate_precedes_existing_domain_locks(self):
        db=FakeDB([None]);tenant=NS(organization_id='org-a',organization=NS(currency='USD',timezone='UTC'))
        with self.assertRaises(HTTPException):
            corrections.reverse_business_transaction(corrections.CorrectionRequest(source_type='fixed_asset',source_id='missing',reason='Synthetic correction',reversal_date=date(2026,3,21)),None,db,tenant)
        self.assertEqual(db.boundary_trace,['gate','refresh','query'])
        self.assertEqual(db.period_events[1],('refresh',('currency','timezone')))

if __name__=='__main__': unittest.main()
