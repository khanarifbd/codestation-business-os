"""Offline date-capacity/SQL/actual-handler boundary checks, not PostgreSQL proof."""
import ast
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql
from app.api.v1 import tax, financial_corrections as corrections
from app.services import tax_settlement_safety as safety

D=lambda day: date(2026,10,day)
class Stop(Exception): pass
class Rows:
    def __init__(self,rows): self.rows=rows
    def all(self): return self.rows
class DB:
    """Explicit transaction lifecycle plus separate period-gate SQL recording."""
    def __init__(self,rows=(),scalar=(),sets=()):
        self.rows=list(rows);self.values=list(scalar);self.sets=list(sets)
        self.queries=[];self.events=[];self.added=[];self.gate_queries=[]
        self.info={};self.is_active=True;self.transaction=NS(is_active=True)
        self.connection_transaction=NS(is_active=True)
        self.conn=NS(closed=False,invalidated=False,dialect=NS(name='postgresql'),
            connection=NS(driver_connection=NS(autocommit=False)),
            get_transaction=lambda:self.connection_transaction,
            get_isolation_level=lambda:'READ COMMITTED')
    def get_transaction(self): return self.transaction
    def get_nested_transaction(self): return None
    def connection(self): return self.conn
    def capture(self,q):
        c=q.compile(dialect=postgresql.dialect());item=(str(c),c.params,q.get_execution_options());self.queries.append(item);self.events.append('query');return item
    def execute(self,q,params=None):
        if str(q)=='SELECT pg_advisory_xact_lock_shared(:lock_key)':
            self.gate_queries.append((str(q),dict(params)));self.events.append('period-gate')
            return Rows([])
        self.capture(q);self.params=params;return Rows(self.rows)
    def scalar(self,q): self.capture(q);return self.values.pop(0)
    def scalars(self,q): self.capture(q);return Rows(self.sets.pop(0))
    def add(self,row):
        if type(row).__name__ == "TaxSettlement":
            row.id="settlement-synthetic";row.created_at=datetime(2026,10,26,tzinfo=timezone.utc)
        self.added.append(row)
    def flush(self): pass
    def refresh(self,organization,*,attribute_names):
        assert attribute_names==['currency','timezone']
        self.events.append('tenant-refresh')
    def commit(self):
        self.events.append('commit')
        self.transaction.is_active=False;self.connection_transaction.is_active=False


def period(**kw): return NS(**({'id':'period-a','currency':'USD','effective_from':D(1),'effective_to':None}|kw))
def account(**kw): return NS(**({'id':'account-a','currency':'USD','account_type':'bank','opening_balance':Decimal('200'),'organization_id':'org-a'}|kw))
class CapacityTests(unittest.TestCase):
    def capacity(self,rows,day=10,normal='credit'): return safety.minimum_date_capacity([(D(d),Decimal(str(debit)),Decimal(str(credit)))for d,debit,credit in rows],D(day),normal_balance=normal)
    def test_no_postings_zero(self):self.assertEqual(self.capacity([]),Decimal('0.00'))
    def test_asof_credit_balance(self):self.assertEqual(self.capacity([(1,0,100),(11,0,50)]),100)
    def test_future_consumption_limits_backdated_settlement(self):self.assertEqual(self.capacity([(1,0,100),(20,80,0)]),20)
    def test_future_credit_cannot_rescue_negative_prefix(self):self.assertEqual(self.capacity([(1,0,100),(15,120,0),(20,0,500)]),-20)
    def test_future_reversal_restores_only_from_its_date(self):self.assertEqual(self.capacity([(1,0,100),(15,80,0),(20,0,80)]),20)
    def test_same_day_consumption_and_reversal_net_before_minimum(self):self.assertEqual(self.capacity([(1,0,100),(15,120,0),(15,0,120)]),100)
    def test_asof_includes_all_same_day(self):self.assertEqual(self.capacity([(10,0,100),(10,80,0)]),20)
    def test_input_receivable_uses_debit_normal(self):self.assertEqual(self.capacity([(1,100,0),(20,0,70)],normal='debit'),30)
    def test_future_only_credit_not_available_before_date(self):self.assertEqual(self.capacity([(20,0,100)]),0)
    def test_futureless_current_capacity(self):self.assertEqual(self.capacity([(1,0,100),(2,30,0)]),70)
    def test_later_than_today_not_capped(self):
        rows=[(D(1),0,100),(date(2030,1,1),90,0)];self.assertEqual(safety.minimum_date_capacity(rows,D(10),normal_balance='credit'),10)
    def test_unsorted_rows_same_result(self):self.assertEqual(self.capacity([(20,80,0),(1,0,100),(15,0,10)]),30)
    def test_exact_decimal_no_float(self):self.assertEqual(self.capacity([(1,0,'0.30'),(20,'0.10',0)]),Decimal('0.20'))
    def test_date_boundary_current_day(self):self.assertEqual(self.capacity([(1,0,100),(20,80,0)],day=20),20)
    def test_tomorrow_does_not_reduce_past_balance_twice(self):self.assertEqual(self.capacity([(1,0,100),(20,80,0),(25,10,0)]),10)
    def test_negative_initial_cannot_be_rescued(self):self.assertEqual(self.capacity([(1,10,0),(20,0,100)]),-10)

class SQLTests(unittest.TestCase):
    def test_period_currency_lower_bound_status_ledger_and_tenant_predicates(self):
        db=DB([(D(1),0,100)]);self.assertEqual(safety.tax_ledger_capacity(db,'org-a','ledger-a',D(10),period=period(),normal_balance='credit'),100)
        sql,params,_=db.queries[0]
        for fragment in ['journal_lines.organization_id =','journal_entries.organization_id =','ledger_account_id =','functional_currency =','entry_date >=','status =','GROUP BY journal_entries.entry_date','ORDER BY journal_entries.entry_date']:self.assertIn(fragment,sql)
        for value in ['org-a','ledger-a','USD','posted',D(1)]:self.assertIn(value,params.values())
        self.assertNotIn('LIMIT',sql);self.assertNotIn('source_type !=',sql);self.assertNotIn('entry_date <=',sql)
    def test_closed_period_has_inclusive_end(self):
        db=DB();safety.tax_ledger_capacity(db,'org-a','ledger-a',D(10),period=period(effective_to=D(31)),normal_balance='credit');self.assertIn('entry_date <=',db.queries[0][0]);self.assertIn(D(31),db.queries[0][1].values())
    def test_returned_currency_alone_not_enough_period_start_retained(self):
        db=DB();safety.tax_ledger_capacity(db,'org-a','ledger-a',D(10),period=period(effective_from=D(5)),normal_balance='credit');self.assertIn(D(5),db.queries[0][1].values())
    def test_stable_namespaced_signed_tenant_mutex(self):
        first=DB();safety.lock_tax_settlements(first,'org-a');other=DB();safety.lock_tax_settlements(other,'org-b');same=DB();safety.lock_tax_settlements(same,'org-a');self.assertIn('pg_advisory_xact_lock',first.queries[0][0]);self.assertEqual(first.params,same.params);self.assertNotEqual(first.params,other.params);self.assertTrue(-(2**63)<=first.params['lock_key']<2**63)
    def test_reversal_locks_actual_accounts_sorted_and_refreshed(self):
        db=DB(sets=[['a','z'],[account(id='a'),account(id='z',currency='OLD')]]);safety.lock_tax_reversal_accounts(db,'org-a','settlement-a');source,locked=db.queries
        self.assertIn('DISTINCT',source[0]);self.assertIn('ORDER BY financial_transactions.account_id',source[0]);self.assertIn('settlement-a',source[1].values());self.assertIn('org-a',source[1].values());self.assertIn('tax_settlement',source[1].values())
        self.assertIn('ORDER BY financial_accounts.id',locked[0]);self.assertIn('FOR UPDATE',locked[0]);self.assertIs(locked[2]['populate_existing'],True);self.assertNotIn('is_active',locked[0].split('WHERE')[1]);self.assertNotIn('currency =',locked[0]);self.assertIn('org-a',locked[1].values())
    def test_offset_reversal_has_no_account_lock(self):
        db=DB(sets=[[]]);safety.lock_tax_reversal_accounts(db,'org-a','offset-a');self.assertEqual(len(db.queries),1)
    def test_missing_historical_account_fails_closed(self):
        db=DB(sets=[['a'],[]])
        with self.assertRaises(HTTPException)as caught:safety.lock_tax_reversal_accounts(db,'org-a','s-a')
        self.assertEqual(caught.exception.status_code,409)
    def test_no_commit_or_retry_in_safety_service(self):
        text=(Path(safety.__file__)).read_text();self.assertNotIn('db.commit(',text);self.assertNotIn('db.rollback(',text)

class HandlerTests(unittest.TestCase):
    def setUp(self):self.tenant=NS(organization_id='org-a',user_id='user-a',organization=NS(timezone='UTC'))
    def body(self,kind='indirect_tax_payment'):return tax.TaxSettlementCreate(settlement_type=kind,settlement_date=D(10),amount=Decimal('80'),account_id=None if kind=='input_tax_offset' else 'account-a')
    def test_mutex_then_current_period_then_cash_account_before_ledger_read(self):
        db=DB(scalar=[account()]);events=db.events
        def ledger(*a):events.append('ledger');raise Stop()
        with patch.object(tax,'lock_tax_settlements',side_effect=lambda*d:events.append('mutex')),patch.object(tax,'assert_current_functional_posting_period',side_effect=lambda*d:(events.append('period')or period())),patch.object(tax,'financial_ledger_account',side_effect=ledger):
            with self.assertRaises(Stop):tax.create_settlement(self.body(),None,db,self.tenant)
        self.assertEqual(events,['period-gate','mutex','period','query','ledger']);self.assertIn('FOR UPDATE',db.queries[0][0]);self.assertIs(db.queries[0][2]['populate_existing'],True);self.assertIn('org-a',db.queries[0][1].values());self.assertFalse(db.added)
    def test_sealed_period_rejected_before_account_or_write(self):
        db=DB()
        with patch.object(tax,'lock_tax_settlements'),patch.object(tax,'assert_current_functional_posting_period',side_effect=HTTPException(409,'sealed')):
            with self.assertRaises(HTTPException)as caught:tax.create_settlement(self.body(),None,db,self.tenant)
        self.assertEqual(caught.exception.status_code,409);self.assertFalse(db.queries);self.assertFalse(db.added)
    def rejected_capacity(self,kind,values):
        db=DB(scalar=[] if kind=='input_tax_offset' else [account()]);p=period();seen=[]
        def cap(*args,**kwargs):seen.append(kwargs);return Decimal(values[len(seen)-1])
        with patch.object(tax,'lock_tax_settlements'),patch.object(tax,'assert_current_functional_posting_period',return_value=p),patch.object(tax,'financial_ledger_account',return_value=(account(),NS(id='cash'))),patch.object(tax,'system_account',return_value=NS(id='payable')),patch.object(tax,'_tax_ledger_existing',return_value=NS(id='input')),patch.object(tax,'tax_ledger_capacity',side_effect=cap),patch.object(tax,'_financial_balance',return_value=Decimal('200')),patch.object(tax,'post_journal')as posted:
            with self.assertRaises(HTTPException)as caught:tax.create_settlement(self.body(kind),None,db,self.tenant)
            self.assertEqual(caught.exception.status_code,409);posted.assert_not_called()
        self.assertFalse(db.added);self.assertNotIn('commit',db.events);self.assertTrue(all(row['period']is p for row in seen));return seen
    def test_indirect_consumption_uses_credit_capacity(self):self.assertEqual(self.rejected_capacity('indirect_tax_payment',['20'])[0]['normal_balance'],'credit')
    def test_withholding_consumption_uses_credit_capacity(self):self.assertEqual(self.rejected_capacity('withholding_tax_payment',['20'])[0]['normal_balance'],'credit')
    def test_refund_consumption_uses_debit_capacity(self):self.assertEqual(self.rejected_capacity('input_tax_refund',['20'])[0]['normal_balance'],'debit')
    def test_offset_checks_payable_and_input_capacity(self):self.assertEqual([x['normal_balance']for x in self.rejected_capacity('input_tax_offset',['100','20'])],['credit','debit'])
    def test_offset_cannot_exceed_payable_even_if_input_sufficient(self):self.rejected_capacity('input_tax_offset',['20','100'])
    def test_correction_mutex_source_refresh_accounts_then_journal(self):
        db=DB(scalar=[NS(id='s-a')]);events=db.events
        def reverse(*a,**kw):events.append('journal');raise Stop()
        payload=corrections.CorrectionRequest(source_type='tax_settlement',source_id='s-a',reason='Synthetic reversal',reversal_date=D(20))
        with patch.object(corrections,'lock_tax_settlements',side_effect=lambda*a:events.append('mutex')),patch.object(corrections,'_journal_reversed',return_value=False),patch.object(corrections,'lock_tax_reversal_accounts',side_effect=lambda*a:events.append('accounts')),patch.object(corrections,'reverse_source_journal',side_effect=reverse):
            with self.assertRaises(Stop):corrections.reverse_business_transaction(payload,None,db,self.tenant)
        self.assertEqual(events,['period-gate','tenant-refresh','mutex','query','accounts','journal']);self.assertIn('FOR UPDATE',db.queries[0][0]);self.assertIs(db.queries[0][2]['populate_existing'],True);self.assertIn('org-a',db.queries[0][1].values())
    def test_duplicate_correction_rejected_before_accounts_or_mirror(self):
        db=DB(scalar=[NS(id='s-a')]);payload=corrections.CorrectionRequest(source_type='tax_settlement',source_id='s-a',reason='Synthetic reversal',reversal_date=D(20))
        with patch.object(corrections,'lock_tax_settlements'),patch.object(corrections,'_journal_reversed',return_value=True),patch.object(corrections,'lock_tax_reversal_accounts')as accounts,patch.object(corrections,'_mirror_transactions')as mirror:
            with self.assertRaises(HTTPException)as caught:corrections.reverse_business_transaction(payload,None,db,self.tenant)
            self.assertEqual(caught.exception.status_code,409);accounts.assert_not_called();mirror.assert_not_called()
    def test_correction_missing_source_retains404(self):
        db=DB(scalar=[None]);payload=corrections.CorrectionRequest(source_type='tax_settlement',source_id='s-a',reason='Synthetic reversal',reversal_date=D(20))
        with patch.object(corrections,'lock_tax_settlements'),patch.object(corrections,'lock_tax_reversal_accounts')as accounts:
            with self.assertRaises(HTTPException)as caught:corrections.reverse_business_transaction(payload,None,db,self.tenant)
            self.assertEqual(caught.exception.status_code,404);accounts.assert_not_called()
    def accepted(self,kind,post_error=False):
        db=DB(scalar=[] if kind=='input_tax_offset' else [account()]);p=period();calls=[]
        def journal(*args,**kw):
            calls.append(kw)
            if post_error:raise HTTPException(409,'Closed period')
            return NS(id='journal-a')
        with patch.object(tax,'lock_tax_settlements'),patch.object(tax,'assert_current_functional_posting_period',return_value=p),patch.object(tax,'financial_ledger_account',return_value=(account(),NS(id='cash'))),patch.object(tax,'system_account',return_value=NS(id='payable')),patch.object(tax,'_tax_ledger_existing',return_value=NS(id='input')),patch.object(tax,'tax_ledger_capacity',return_value=Decimal('100')),patch.object(tax,'_financial_balance',return_value=Decimal('200')),patch.object(tax,'post_journal',side_effect=journal),patch.object(tax,'record_activity'):
            if post_error:
                with self.assertRaises(HTTPException):tax.create_settlement(self.body(kind),None,db,self.tenant)
                self.assertNotIn('commit',db.events)
            else:
                result=tax.create_settlement(self.body(kind),None,db,self.tenant)
                self.assertEqual(result['amount'],Decimal('80.00'));self.assertEqual(result['settlement_type'],kind);self.assertEqual(result['currency'],'USD');self.assertEqual(db.events.count('commit'),1)
        self.assertEqual(calls[0]['entry_date'],D(10));self.assertEqual(calls[0]['source_type'],'tax_settlement')
        movements=[x for x in db.added if type(x).__name__=='FinancialTransaction']
        return calls,movements
    def test_accepted_indirect_preserves_debit_cash_and_journal_amount(self):
        calls,movements=self.accepted('indirect_tax_payment');self.assertEqual(movements[0].direction,'debit');self.assertEqual(movements[0].amount,Decimal('80'));self.assertEqual(calls[0]['lines'][0].debit,Decimal('80'))
    def test_accepted_withholding_preserves_debit_cash(self):
        _,movements=self.accepted('withholding_tax_payment');self.assertEqual(movements[0].direction,'debit')
    def test_accepted_refund_preserves_credit_cash(self):
        calls,movements=self.accepted('input_tax_refund');self.assertEqual(movements[0].direction,'credit');self.assertEqual(calls[0]['lines'][0].ledger_account_id,'cash')
    def test_accepted_offset_remains_noncash(self):
        _,movements=self.accepted('input_tax_offset');self.assertEqual(movements,[])
    def test_failed_journal_does_not_commit_partial_settlement(self):
        # The outer request transaction owns rollback; this fake proves no commit,
        # not PostgreSQL rollback/visibility behavior.
        _,movements=self.accepted('indirect_tax_payment',post_error=True);self.assertEqual(movements,[])
    def test_only_tax_correction_branch_uses_tax_mutex(self):
        tree=ast.parse(Path(corrections.__file__).read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='reverse_business_transaction');calls=[n for n in ast.walk(fn)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='lock_tax_settlements'];self.assertEqual(len(calls),1)

if __name__=='__main__':unittest.main()
