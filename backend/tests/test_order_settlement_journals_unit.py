"""Actual mounted route/service/posting helpers, explicit storage/transaction fakes.
No engine connection, database, provider, migration or concurrency proof.
"""
import ast
import copy
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from settlement_journal_test_support import restore_v31, V31, POSTING_BLOCK
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy.sql import operators
from sqlalchemy.sql.elements import BindParameter, BooleanClauseList, Null, True_, False_, BinaryExpression, UnaryExpression, Grouping, Case
from sqlalchemy.sql.functions import FunctionElement
from sqlalchemy.dialects import postgresql
from app.api.v1 import order_settlements as route
from app.services import order_settlement as service, operational_posting as posting, accounting_posting as journal
from app.services.accounting_period_gate import require_accounting_period_gate, AccountingPeriodGateError
from app.models.orders import Order, OrderItem
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, InvoiceItem, Payment
from app.models.expenses import Expense, ExpenseCategory
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount, OrganizationFunctionalCurrencyPeriod
from app.models.company_settings import OrganizationDocumentSequence
from app.models.company_defaults import OrganizationExchangeRateHistory
from app.models.finance_controls import AccountingPeriod
from app.models.activity_log import ActivityLog
from app.models.organization import Organization
from app.models.order_commercial import OrderBillingMilestone
from app.schemas.order_settlements import OrderSettlementCreate

D=Decimal; DAY=date(2026,10,27); NOW=datetime(2026,10,27,tzinfo=timezone.utc)
ROOT=Path(__file__).resolve().parents[1]

class Transaction:
    def __init__(self):self.is_active=True
class Connection:
    def __init__(self):
        self.closed=self.invalidated=False;self.dialect=NS(name='postgresql');self.connection=NS(driver_connection=NS(autocommit=False));self.tx=Transaction()
    def get_transaction(self):return self.tx
    def get_isolation_level(self):return 'READ COMMITTED'
class Result:
    def __init__(self,rows):self.rows=rows
    def all(self):return self.rows
    def first(self):return self.rows[0] if self.rows else None

class StorageFake:
    """SQL predicate-aware staged writes, committed rows and actual-root lifecycle.
    Implements only SQL used by this slice; unsupported expressions fail loudly.
    Does not simulate PostgreSQL locks, triggers, uniqueness or durability.
    """
    def __init__(self,rows):
        self.seed=list(rows);self.pending=[];self.committed=[];self.events=[];self.queries=[];self.info={};self.is_active=True;self.tx=Transaction();self.conn=Connection();self.counter=0
        self.snapshot=[(row,{k:copy.deepcopy(v) for k,v in row.__dict__.items() if k!='_sa_instance_state'}) for row in self.seed]
        self.commits=self.rollbacks=0;self.fail_add=None;self.fail_commit=None;self.authoritative_account_changes={};self.allow_reversal_refresh=False
    def get_transaction(self):return self.tx
    def get_nested_transaction(self):return None
    def connection(self):
        if self.tx is None:raise AssertionError('Unexpected helper autobegin')
        return self.conn
    def value(self,expr,row):
        if isinstance(expr,BindParameter):return expr.value
        if isinstance(expr,Null):return None
        if isinstance(expr,True_):return True
        if isinstance(expr,False_):return False
        if isinstance(expr,Grouping):return self.value(expr.element,row)
        if isinstance(expr,BooleanClauseList):
            values=[self.value(x,row) for x in expr.clauses]
            return all(values) if expr.operator is operators.and_ else any(values)
        if isinstance(expr,BinaryExpression):
            a,b=self.value(expr.left,row),self.value(expr.right,row);op=expr.operator
            if op in (operators.eq,operators.is_):return a==b
            if op in (operators.ne,operators.is_not):return a!=b
            if op is operators.le:return a is not None and a<=b
            if op is operators.ge:return a is not None and a>=b
            if op is operators.gt:return a is not None and a>b
            if op is operators.lt:return a is not None and a<b
            if op is operators.in_op:return a in b
            if op is operators.not_in_op:return a not in b
            if op is operators.like_op:
                if not isinstance(b,str) or not b.endswith('%'):raise AssertionError('Unsupported LIKE pattern')
                return a.startswith(b[:-1])
            raise AssertionError('Unsupported comparison '+str(op))
        if isinstance(expr,UnaryExpression):
            value=self.value(expr.element,row)
            if expr.operator is operators.neg:return -value
            if expr.modifier in (operators.desc_op,operators.asc_op):return value
            raise AssertionError('Unsupported unary')
        if isinstance(expr,Case):
            for condition,amount in expr.whens:
                if self.value(condition,row):return self.value(amount,row)
            return self.value(expr.else_,row)
        if getattr(expr,'table',None) is not None:return getattr(row,expr.key)
        raise AssertionError('Unsupported value '+str(expr))
    def all_rows(self):return self.seed+self.committed+self.pending
    def rows(self,model):return [x for x in self.all_rows() if isinstance(x,model)]
    def query(self,q):
        compiled=q.compile(dialect=postgresql.dialect());sql=str(compiled);self.queries.append((q,sql,compiled.params));lock=q._for_update_arg is not None
        self.events.append(('lock' if lock else 'read',sql))
        froms=q.get_final_froms()
        if len(froms)!=1 or not hasattr(froms[0],'name'):
            # Payment carrying-base joins must exclude the current new receipt.
            if 'JOIN journal_entries' in sql and 'JOIN journal_lines' in sql:
                current=compiled.params.get('id_1')
                if any(x.id!=current for x in self.rows(Payment)):raise AssertionError('Prior-payment fixture not implemented')
                return []
            raise AssertionError('Unsupported join '+sql)
        table=froms[0].name
        if lock and table=='financial_accounts' and q.get_execution_options().get('populate_existing'):
            for row in self.rows(FinancialAccount):row.__dict__.update(self.authoritative_account_changes)
        rows=[r for r in self.all_rows() if getattr(r,'__tablename__',None)==table]
        for predicate in q._where_criteria:rows=[r for r in rows if self.value(predicate,r)]
        for order in reversed(list(q._order_by_clauses)):
            reverse=isinstance(order,UnaryExpression) and order.modifier is operators.desc_op
            rows.sort(key=lambda r:(self.value(order,r) is not None,self.value(order,r)),reverse=reverse)
        if q._limit_clause is not None:rows=rows[:q._limit_clause.value]
        desc=q.column_descriptions[0];expr=desc['expr']
        if isinstance(expr,type):return rows
        if isinstance(expr,FunctionElement):
            def aggregate(f):
                if isinstance(f,BindParameter):return f.value
                if f.name=='coalesce':
                    for c in f.clauses:
                        result=aggregate(c)
                        if result is not None:return result
                if f.name=='count':return len(rows)
                if f.name=='sum':return sum((self.value(next(iter(f.clauses)),r) for r in rows),D('0')) if rows else None
                if f.name=='max':return max((self.value(next(iter(f.clauses)),r) for r in rows),default=None)
                raise AssertionError('Unsupported aggregate '+str(f))
            return [aggregate(expr)]
        return [self.value(expr,r) for r in rows]
    def scalar(self,q):
        rows=self.query(q);return rows[0] if rows else None
    def scalars(self,q):return Result(self.query(q))
    def execute(self,q,params=None):
        if params is not None:
            if str(q)!='SELECT pg_advisory_xact_lock_shared(:lock_key)' or set(params)!={'lock_key'}:raise AssertionError('Unexpected SQL gate')
            self.events.append(('gate',dict(params)));return None
        return Result(self.query(q))
    def add(self,row):
        if self.fail_add and self.fail_add(row):raise RuntimeError('Synthetic staged-write failure')
        self.counter+=1
        if not getattr(row,'id',None):row.id='new-'+str(self.counter)
        if hasattr(row,'created_at') and row.created_at is None:row.created_at=NOW
        if hasattr(row,'updated_at') and row.updated_at is None:row.updated_at=NOW
        self.pending.append(row);self.events.append(('add',type(row).__name__,getattr(row,'source_type',None)))
    def flush(self):self.events.append(('flush',))
    def refresh(self,*a,**kw):
        if not self.allow_reversal_refresh:raise AssertionError('No blanket ORM refresh permitted in settlement')
        if not isinstance(a[0],Organization) or kw.get('attribute_names')!=['currency','timezone']:raise AssertionError('Unexpected reversal refresh')
        self.events.append(('reversal-context-refresh',))
    def begin_next(self):
        if self.tx is not None:raise AssertionError('Root still active')
        self.tx=Transaction();self.conn.tx=Transaction()
    def finish(self):
        if self.tx:self.tx.is_active=False
        if self.conn.tx:self.conn.tx.is_active=False
        self.tx=self.conn.tx=None
    def commit(self):
        if self.info.get('deferred_commit_depth',0):self.events.append(('deferred_commit',));self.flush();return
        self.commits+=1;self.events.append(('commit',))
        if self.fail_commit=='before':self.finish();raise RuntimeError('Synthetic unknown commit before acknowledgement')
        self.committed+=self.pending;self.pending=[];self.finish()
        if self.fail_commit=='after':raise RuntimeError('Synthetic unknown commit after persistence')
    def rollback(self):
        self.rollbacks+=1;self.events.append(('rollback',));self.pending=[]
        for row,values in self.snapshot:
            for k,v in values.items():setattr(row,k,copy.deepcopy(v))
        self.finish()


def fixture(*,currency='USD',base='USD',inclusive=False,mixed=False,cost_type='financial',fx=True,period=True):
    total=D('110') if inclusive else D('100');tax=D('10') if inclusive else D('0')
    organization=Organization(id='org',name='Synthetic',currency=base,timezone='UTC')
    order=Order(id='order',organization_id='org',order_number='ORD-SYN',client_id='client',status='completed',order_date=date(2026,10,1),currency=currency,total=total,subtotal=total,discount_total=D(0),tax_total=tax,tax_calculation_mode='inclusive' if inclusive else 'exclusive',subject='Synthetic sale',external_order_id=None,seller_name_snapshot='Synthetic Seller',client_name_snapshot='Synthetic Client')
    items=[]
    for i in range(2 if mixed else 1):
        n=2 if mixed else 1;amount=total/n;line_tax=tax/n
        items.append(OrderItem(id='oi-'+str(i),organization_id='org',order_id='order',sort_order=i,created_at=NOW,product_id=None,item_name_snapshot='Synthetic '+str(i),sku_snapshot='SKU'+str(i),item_type_snapshot='stock_item' if mixed and i==0 else 'service',unit_snapshot='unit',service_duration_months_snapshot=1,description=None,quantity=D(1),unit_price=amount,discount_percent=D(0),tax_rate=D('10') if inclusive else D(0),line_subtotal=amount,discount_amount=D(0),taxable_amount=amount,tax_amount=line_tax,line_total=amount))
    account=FinancialAccount(id='cash',organization_id='org',name='Synthetic Bank',account_type='bank',currency=currency,opening_balance=D(0),is_active=True,created_by_user_id='actor')
    category=ExpenseCategory(id='category',organization_id='org',name='Synthetic fee',cost_type=cost_type,is_active=True,sort_order=1)
    rows=[organization,order,account,category,*items]
    for name in ('invoice','payment','expense'):
        rows.append(OrganizationDocumentSequence(id='seq-'+name,organization_id='org',document_type=name,next_number=1,prefix=name.upper(),separator='-',padding=3))
    for key in ['accounts_receivable','service_revenue','sales_revenue','taxes_payable','bank_fees','cost_of_sales','operating_expenses','cash_equivalents','realized_fx_gain','realized_fx_loss','financial_account:cash']:
        rows.append(LedgerAccount(id=key,organization_id='org',code=key,name=key,system_key=key,category='asset' if key in ('accounts_receivable','cash_equivalents','financial_account:cash') else 'expense',normal_balance='debit',is_active=True,allow_manual_posting=False))
    if period:rows.append(OrganizationFunctionalCurrencyPeriod(id='functional',organization_id='org',currency=base,effective_from=date(1900,1,1),effective_to=None))
    if currency!=base and fx:rows.append(OrganizationExchangeRateHistory(id='rate',organization_id='org',base_currency=currency,quote_currency=base,effective_date=date(2026,10,1),effective_rate=D('1.1'),updated_at=NOW))
    return StorageFake(rows),NS(organization_id='org',user_id='actor',organization=organization)


def call(db,tenant,fee='0',**changes):
    values=dict(account_id='cash',settlement_date=DAY,expense_amount=fee,expense_category_id='category' if D(fee)>0 else None)
    values.update(changes)
    return route.create_order_settlement('order',OrderSettlementCreate(**values),None,db,tenant)

class JournalCompletenessTests(unittest.TestCase):
    def assert_balanced(self,db,expected):
        entries=db.rows(JournalEntry);self.assertEqual({e.source_type for e in entries},set(expected));self.assertEqual(len(entries),len(expected))
        for entry in entries:
            lines=[l for l in db.rows(JournalLine) if l.journal_entry_id==entry.id]
            self.assertGreaterEqual(len(lines),2);self.assertEqual(sum((l.debit for l in lines),D(0)),sum((l.credit for l in lines),D(0)))
            self.assertGreater(sum((l.debit for l in lines),D(0)),0)
            self.assertEqual(entry.entry_date,DAY)
    def test_no_fee_posts_issue_and_receipt_without_double_cash(self):
        db,t=fixture();r=call(db,t);self.assert_balanced(db,['invoice_issue','invoice_payment'])
        self.assertEqual((r.gross_amount,r.expense_amount,r.net_amount),(D(100),D(0),D(100)))
        self.assertEqual(len(db.rows(FinancialTransaction)),1);self.assertEqual(len(db.rows(Expense)),0)
        self.assertEqual([(x.source_type,x.source_id,x.direction,x.amount) for x in db.rows(FinancialTransaction)],[('payment',r.payment_id,'credit',D(100))])
        self.assertEqual({e.source_type:e.source_id for e in db.rows(JournalEntry)},{'invoice_issue':r.invoice_id,'invoice_payment':r.payment_id})
        self.assertEqual(db.commits,1);self.assertEqual(db.rollbacks,0);self.assertEqual(sum(e[0]=='deferred_commit' for e in db.events),1)
        self.assertEqual(len(db.rows(ActivityLog)),3);self.assertEqual(db.events[-1],('commit',))
    def test_positive_fee_posts_three_sources_and_two_cash_movements(self):
        db,t=fixture();r=call(db,t,'10');self.assert_balanced(db,['invoice_issue','invoice_payment','expense_post'])
        self.assertEqual(r.net_amount,D(90));self.assertEqual(len(db.rows(FinancialTransaction)),2)
        self.assertEqual({e.source_type:e.source_id for e in db.rows(JournalEntry)},{'invoice_issue':r.invoice_id,'invoice_payment':r.payment_id,'expense_post':r.expense_id})
        self.assertEqual([(x.direction,x.amount) for x in db.rows(FinancialTransaction)],[('credit',D(100)),('debit',D(10))]);self.assertEqual(len(db.rows(ActivityLog)),4)
        fee=next(e for e in db.rows(JournalEntry) if e.source_type=='expense_post')
        self.assertEqual({l.ledger_account_id:l.debit for l in db.rows(JournalLine) if l.journal_entry_id==fee.id},{'bank_fees':D('10.00'),'financial_account:cash':D('0.00')})
    def test_fee_equal_gross_still_posts_three_balanced_journals(self):
        db,t=fixture();r=call(db,t,'100');self.assertEqual(r.net_amount,D(0));self.assert_balanced(db,['invoice_issue','invoice_payment','expense_post'])
    def test_existing_category_mapping_preserved_for_direct_and_operating(self):
        for kind,key in [('direct','cost_of_sales'),('operating','operating_expenses'),('financial','bank_fees')]:
            with self.subTest(kind=kind):
                db,t=fixture(cost_type=kind);call(db,t,'10');entry=next(e for e in db.rows(JournalEntry) if e.source_type=='expense_post')
                self.assertEqual([l.ledger_account_id for l in db.rows(JournalLine) if l.journal_entry_id==entry.id and l.debit>0],[key])
    def test_inclusive_tax_mixed_products_services_reuses_existing_split(self):
        db,t=fixture(inclusive=True,mixed=True);call(db,t,'10');self.assert_balanced(db,['invoice_issue','invoice_payment','expense_post'])
        entry=next(e for e in db.rows(JournalEntry) if e.source_type=='invoice_issue')
        amounts={l.ledger_account_id:(l.debit,l.credit) for l in db.rows(JournalLine) if l.journal_entry_id==entry.id}
        self.assertEqual(amounts,{'accounts_receivable':(D(110),D(0)),'sales_revenue':(D(0),D(50)),'service_revenue':(D(0),D(50)),'taxes_payable':(D(0),D(10))})
        self.assertEqual(sum((i.line_total for i in db.rows(InvoiceItem)),D(0)),D(110))
        self.assertEqual([i.source_order_item_id for i in db.rows(InvoiceItem)],['oi-0','oi-1'])
    def test_foreign_native_currency_uses_actual_effective_rate_not_one(self):
        db,t=fixture(currency='EUR',base='USD',inclusive=True,mixed=True);r=call(db,t,'10');self.assertEqual(r.currency,'EUR')
        self.assert_balanced(db,['invoice_issue','invoice_payment','expense_post']);self.assertEqual({e.functional_currency for e in db.rows(JournalEntry)},{'USD'})
        payment=next(e for e in db.rows(JournalEntry) if e.source_type=='invoice_payment');lines=[l for l in db.rows(JournalLine) if l.journal_entry_id==payment.id]
        self.assertEqual(sum((l.debit for l in lines),D(0)),D(121));self.assertEqual([x.amount for x in db.rows(FinancialTransaction)],[D(110),D(10)])
        self.assertEqual(db.rows(Payment)[0].exchange_rate,D('1.00000000'))
    def test_pending_new_invoice_payment_and_expense_not_refreshed_away(self):
        db,t=fixture();r=call(db,t,'10',reference='REF',mark_invoice_sent_to_client=True)
        self.assertTrue(r.invoice_sent_to_client);self.assertEqual(db.rows(Invoice)[0].status,'paid');self.assertEqual(db.rows(Payment)[0].reference,'REF');self.assertEqual(db.rows(Expense)[0].payment_id,r.payment_id)
    def test_ledger_source_helpers_reuse_existing_sources_without_new_cash(self):
        db,t=fixture();r=call(db,t,'10');before=(len(db.rows(JournalEntry)),len(db.rows(JournalLine)),len(db.rows(FinancialTransaction)))
        self.assertEqual(posting.post_invoice_payment(db,organization_id='org',user_id='actor',payment=db.rows(Payment)[0]).source_id,r.payment_id)
        self.assertEqual(posting.post_expense(db,organization_id='org',user_id='actor',expense=db.rows(Expense)[0]).source_id,r.expense_id)
        self.assertEqual(before,(len(db.rows(JournalEntry)),len(db.rows(JournalLine)),len(db.rows(FinancialTransaction))))

class AtomicFailureTests(unittest.TestCase):
    def assert_empty_failure(self,db):
        self.assertEqual(db.commits,0);self.assertEqual(db.rollbacks,1);self.assertFalse(db.pending or db.committed)
        self.assertEqual([s.next_number for s in db.rows(OrganizationDocumentSequence)],[1,1,1])
        self.assertNotIn('deferred_commit_depth',db.info)
    def test_missing_historical_fx_fails_atomically(self):
        db,t=fixture(currency='EUR',base='USD',fx=False)
        with self.assertRaises(HTTPException) as caught:call(db,t,'10')
        self.assertEqual(caught.exception.status_code,409);self.assertIn('Historical accounting exchange rate is missing',caught.exception.detail);self.assert_empty_failure(db)
    def test_missing_functional_period_fails_atomically(self):
        db,t=fixture(period=False)
        with self.assertRaises(HTTPException) as caught:call(db,t,'10')
        self.assertEqual(caught.exception.status_code,409);self.assertIn('No functional currency period',caught.exception.detail);self.assert_empty_failure(db)
    def test_failure_at_each_journal_stage_rolls_back_all_sources(self):
        for source in ('invoice_issue','invoice_payment','expense_post'):
            db,t=fixture();db.fail_add=lambda row:isinstance(row,JournalEntry) and row.source_type==source
            with self.assertRaisesRegex(RuntimeError,'staged-write'):call(db,t,'10')
            self.assert_empty_failure(db)
    def test_audit_failure_rolls_back_created_journals_and_operations(self):
        db,t=fixture();db.fail_add=lambda row:isinstance(row,ActivityLog)
        with self.assertRaisesRegex(RuntimeError,'staged-write'):call(db,t,'10')
        self.assert_empty_failure(db);self.assertTrue(any(e[0]=='add' and e[1]=='JournalEntry' for e in db.events))
    def test_response_validation_failure_is_before_outer_commit(self):
        db,t=fixture()
        with patch.object(service,'OrderSettlementRead',side_effect=ValueError('synthetic response failure')):
            with self.assertRaisesRegex(ValueError,'response'):call(db,t,'10')
        self.assert_empty_failure(db);self.assertTrue(any(e[0]=='deferred_commit' for e in db.events))
    def test_outer_commit_unknown_before_or_after_storage_is_never_retried(self):
        for mode in ('before','after'):
            db,t=fixture();db.fail_commit=mode
            with self.assertRaisesRegex(RuntimeError,'unknown commit'):call(db,t,'10')
            self.assertEqual(db.commits,1);self.assertEqual(db.rollbacks,0);self.assertNotIn('deferred_commit_depth',db.info)
            self.assertEqual(len(db.committed)>0,mode=='after')
    def test_closed_period_rejects_before_new_records_or_numbering(self):
        db,t=fixture();db.seed.append(AccountingPeriod(id='closed',organization_id='org',status='closed',start_date=DAY,end_date=DAY))
        with self.assertRaises(HTTPException) as caught:call(db,t,'10')
        self.assertEqual(caught.exception.status_code,409);self.assert_empty_failure(db)
    def test_sealed_functional_period_rejects_not_silently_relabelled(self):
        db,t=fixture();old=db.rows(OrganizationFunctionalCurrencyPeriod)[0];old.effective_to=DAY
        db.seed.append(OrganizationFunctionalCurrencyPeriod(id='new-functional',organization_id='org',currency='EUR',effective_from=date(2026,10,28),effective_to=None))
        with self.assertRaises(HTTPException) as caught:call(db,t,'10')
        self.assertEqual(caught.exception.status_code,409);self.assertIn('sealed',caught.exception.detail);self.assert_empty_failure(db)

class CompatibilityTests(unittest.TestCase):
    assert_empty_failure = AtomicFailureTests.assert_empty_failure
    def test_fresh_locked_card_rejected_before_any_sequence_or_write(self):
        db,t=fixture();db.authoritative_account_changes={'account_type':'credit_card'}
        with self.assertRaises(HTTPException) as caught:call(db,t)
        self.assertEqual(caught.exception.status_code,400);self.assertEqual(caught.exception.detail,'Customer payments cannot be received into a credit card account')
        self.assertFalse(any(e[0]=='add' for e in db.events));self.assertEqual(db.rollbacks,1)
        locks=[(q,sql,params) for q,sql,params in db.queries if q._for_update_arg is not None]
        self.assertIn('orders',locks[0][1]);self.assertIn('financial_accounts',locks[1][1]);self.assertTrue(locks[1][0].get_execution_options()['populate_existing']);self.assertIn('org',locks[1][2].values())
        self.assertEqual(db.events[0][0],'gate')
    def test_inactive_and_cross_currency_after_lock_still_reject(self):
        for change,code in [({'is_active':False},404),({'currency':'EUR'},400)]:
            db,t=fixture();db.authoritative_account_changes=change
            with self.assertRaises(HTTPException) as caught:call(db,t)
            self.assertEqual(caught.exception.status_code,code);self.assert_empty_failure(db)
    def test_meta_omits_card_but_keeps_same_currency_active_bank(self):
        db,t=fixture();db.seed.append(FinancialAccount(id='card',organization_id='org',name='Card',account_type='credit_card',currency='USD',opening_balance=D(0),is_active=True))
        meta=route.get_order_settlement_meta('order',db,t);self.assertEqual([a.id for a in meta.accounts],['cash']);self.assertEqual(db.commits,0)
        sql=next(sql for _,sql,_ in db.queries if 'FROM financial_accounts' in sql and 'ORDER BY' in sql);self.assertIn('account_type !=',sql)
    def test_staged_order_rejects_without_any_new_operations(self):
        db,t=fixture();db.seed.append(OrderBillingMilestone(id='milestone',organization_id='org',order_id='order'))
        with self.assertRaises(HTTPException) as caught:call(db,t)
        self.assertEqual(caught.exception.status_code,409);self.assertFalse(db.pending);self.assertEqual(db.commits,0)
    def test_order_status_positive_total_and_expense_bounds_preserved(self):
        for field,value,fee in [('status','active','0'),('total',D(0),'0'),('total',D(100),'101')]:
            db,t=fixture();setattr(db.rows(Order)[0],field,value)
            with self.assertRaises(HTTPException) as caught:call(db,t,fee)
            self.assertEqual(caught.exception.status_code,409 if field!='total' or fee=='0' else 400);self.assert_empty_failure(db)
    def test_existing_active_invoice_preserves_conflict_not_public_replay(self):
        db,t=fixture();db.seed.append(Invoice(id='old',organization_id='org',order_id='order',invoice_number='OLD',status='paid',created_at=NOW))
        with self.assertRaises(HTTPException) as caught:call(db,t)
        self.assertEqual(caught.exception.status_code,409);self.assertIn('active invoice OLD',caught.exception.detail);self.assert_empty_failure(db)
    def test_no_source_scope_bypass_for_wrong_tenant(self):
        db,t=fixture();t.organization_id='other'
        with self.assertRaises(HTTPException) as caught:call(db,t)
        self.assertEqual(caught.exception.status_code,404);self.assert_empty_failure(db)



class ExtendedBoundaryTests(unittest.TestCase):
    assert_empty_failure=AtomicFailureTests.assert_empty_failure
    def test_exclusive_tax_retains_existing_issue_formula(self):
        db,t=fixture();order=db.rows(Order)[0];order.total=D(110);order.subtotal=D(100);order.tax_total=D(10)
        item=db.rows(OrderItem)[0];item.tax_rate=D(10);item.tax_amount=D(10);item.line_total=D(110)
        call(db,t);entry=next(e for e in db.rows(JournalEntry) if e.source_type=='invoice_issue')
        lines={l.ledger_account_id:(l.debit,l.credit) for l in db.rows(JournalLine) if l.journal_entry_id==entry.id}
        self.assertEqual(lines,{'accounts_receivable':(D(110),D(0)),'service_revenue':(D(0),D(100)),'taxes_payable':(D(0),D(10))})
    def test_partial_journal_line_failure_rolls_back_earlier_journal_and_cash(self):
        db,t=fixture();seen=[]
        def fail(row):
            if isinstance(row,JournalLine):
                entry=next(e for e in db.rows(JournalEntry) if e.id==row.journal_entry_id)
                if entry.source_type=='invoice_payment':seen.append(row);return len(seen)==2
            return False
        db.fail_add=fail
        with self.assertRaisesRegex(RuntimeError,'staged-write'):call(db,t,'10')
        self.assertEqual(len(seen),2);self.assert_empty_failure(db)
    def test_missing_items_and_backdated_order_date_reject_before_writes(self):
        for mode in ('items','date'):
            db,t=fixture()
            if mode=='items':db.seed=[x for x in db.seed if not isinstance(x,OrderItem)]
            with self.assertRaises(HTTPException) as caught:call(db,t,settlement_date=date(2026,9,30) if mode=='date' else DAY)
            self.assertEqual(caught.exception.status_code,400 if mode=='date' else 409);self.assert_empty_failure(db)
    def test_missing_fee_category_rejects_before_numbering(self):
        db,t=fixture();db.seed=[x for x in db.seed if not isinstance(x,ExpenseCategory)]
        with self.assertRaises(HTTPException) as caught:call(db,t,'10')
        self.assertEqual(caught.exception.status_code,404);self.assert_empty_failure(db)
    def test_created_ledger_mapping_rolls_back_with_missing_fx(self):
        db,t=fixture(currency='EUR',base='USD',fx=False);db.seed=[x for x in db.seed if not isinstance(x,LedgerAccount) or x.system_key!='financial_account:cash']
        with self.assertRaises(HTTPException):call(db,t,'10')
        self.assert_empty_failure(db);self.assertFalse([x for x in db.rows(LedgerAccount) if x.system_key=='financial_account:cash'])
        self.assertTrue(any(e[:2]==('add','LedgerAccount') for e in db.events))
    def test_success_receipt_and_fee_resolve_through_actual_reversal_consumers(self):
        from app.api.v1 import financial_corrections as corrections
        db,t=fixture();r=call(db,t,'10');db.allow_reversal_refresh=True
        for source,identity in [('payment',r.payment_id),('expense',r.expense_id)]:
            db.begin_next()
            result=corrections.reverse_business_transaction(corrections.CorrectionRequest(source_type=source,source_id=identity,reason='Synthetic reversal',reversal_date=DAY),None,db,t)
            self.assertIsNotNone(result['reversal_journal_id']);self.assertEqual(result['accounting_note'],'Accounting journal reversed')
        self.assertEqual(db.rows(Payment)[0].status,'reversed');self.assertEqual(db.rows(Invoice)[0].amount_paid,D(0));self.assertEqual(db.rows(Expense)[0].status,'voided')
        self.assertEqual({x.source_type for x in db.rows(FinancialTransaction)},{'payment','expense','payment_reversal','expense_reversal'})
        originals={e.id:e for e in db.rows(JournalEntry) if e.source_type!='reversal'}
        reversals=[e for e in db.rows(JournalEntry) if e.source_type=='reversal'];self.assertEqual(len(reversals),2)
        self.assertEqual({originals[e.reversed_entry_id].source_type for e in reversals},{'invoice_payment','expense_post'})
    def test_only_existing_three_route_contracts_are_mounted(self):
        actual={(r.path,tuple(sorted(r.methods)),r.status_code) for r in route.router.routes}
        self.assertEqual(actual,{('/finance/orders/{order_id}/settlement',('GET',),None),('/finance/orders/{order_id}/settlement-meta',('GET',),None),('/finance/orders/{order_id}/settle',('POST',),201)})

class PreservationLayerTests(unittest.TestCase):
    def test_entire_two_source_files_restore_exact_v31_bytes(self):
        for path,digest in V31.items():
            restored=restore_v31(path,(ROOT/path).read_text())
            self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(),digest)
    def test_delta_normalization_rejects_changed_source_ids_amounts_or_category_logic(self):
        path='app/services/order_settlement.py';original=(ROOT/path).read_text()
        for old,new in [('payment=payment','payment=invoice'),('expense=expense','expense=payment'),('if expense is not None:\n        post_expense','if expense_amount >= 0:\n        post_expense'),('amount=gross_amount','amount=expense_amount'),('tax_amount=Decimal("0.00")','tax_amount=Decimal("1.00")'),('source_type="payment"','source_type="order_settlement"'),('ensure_payment_receipt_account_supported(account.account_type)','ensure_payment_receipt_account_supported("bank")'),('populate_existing=True','populate_existing=False')]:
            with self.subTest(change=old):
                self.assertIn(old,original)
                with self.assertRaises(AssertionError):restore_v31(path,original.replace(old,new,1))
    def test_wrapper_normalization_rejects_commit_inside_context_or_changed_payload(self):
        path='app/api/v1/order_settlements.py';original=(ROOT/path).read_text()
        for old,new in [('    db.commit()\n    return result','        db.commit()\n    return result'),('payload=payload','payload=None'),('with defer_commits(db):','with defer_commits(other_db):'),('acquire_accounting_period_gate(db, tenant.organization_id)','acquire_accounting_period_gate(db, "other")')]:
            self.assertIn(old,original)
            with self.assertRaises(AssertionError):restore_v31(path,original.replace(old,new,1))
    def test_mutating_unrelated_read_body_is_not_accepted_as_new_layer(self):
        path='app/services/order_settlement.py';original=(ROOT/path).read_text()
        with self.assertRaises(AssertionError):restore_v31(path,original.replace('eligible=False','eligible=True',1))

if __name__=='__main__':unittest.main()
