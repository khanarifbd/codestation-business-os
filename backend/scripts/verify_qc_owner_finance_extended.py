"""Authenticated owner HTTP gap checks against isolated local PostgreSQL only.
Only get_db overridden; domain fixtures created through HTTP, with one explicitly
audited legacy invalid-tax value injected locally; outer rollback.
No lifespan/background jobs, remote requests, payment providers or mail.
"""
import os
from datetime import date, timedelta
from decimal import Decimal as D
from uuid import uuid4
from fastapi.testclient import TestClient
from fastapi.routing import APIRoute
from app.api.v1.finance_controls import router as raw_controls_router
from app.api.v1.financial_safety import router as safety_router
from sqlalchemy import select, func
from app.core.security import create_access_token
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.user import User
from app.models.organization import Organization
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.activity_log import ActivityLog
from app.models.finance_controls import RecurringExpense
from app.services.activity_log import record_activity


def amounts(row, **expected):
    for key, val in expected.items():
        assert D(str(row[key])) == D(str(val)), (key, row, expected)


def main():
    assert os.environ.get('ENVIRONMENT')=='test' and engine.url.get_backend_name()=='postgresql'
    assert engine.url.host in {'localhost', '127.0.0.1'}
    assert not app.dependency_overrides
    recurring_path='/finance/recurring-expenses/{recurring_id}/post'
    matches=[r for r in safety_router.routes if isinstance(r,APIRoute) and r.path==recurring_path and 'POST' in r.methods]
    assert len(matches)==1 and matches[0].endpoint.__name__=='safe_post_recurring_expense'
    assert not any(isinstance(r,APIRoute) and r.path==recurring_path and 'POST' in r.methods for r in raw_controls_router.routes)
    assert 'safe_post_recurring_expense' in app.openapi()['paths']['/api/v1'+recurring_path]['post']['operationId']
    conn = engine.connect(); outer = conn.begin()
    db = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    orgs=[]; users=[]; failures=[]; marker=uuid4().hex[:10]
    current=date.today(); today=current.isoformat(); previous=(current-timedelta(days=1)).isoformat()
    prior_end_date=current.replace(day=1)-timedelta(days=1)
    prior_start_date=prior_end_date.replace(day=1)
    earlier_end_date=prior_start_date-timedelta(days=1)
    prior_start=prior_start_date.isoformat(); prior_end=prior_end_date.isoformat()
    earlier_start=earlier_end_date.replace(day=1).isoformat(); earlier_end=earlier_end_date.isoformat()
    def local_db():
        with SessionLocal(bind=conn, join_transaction_mode='create_savepoint') as s:
            yield s
    app.dependency_overrides[get_db]=local_db
    http=TestClient(app)
    def call(method,path,payload=None,expected=200):
        r=http.request(method,'/api/v1'+path,headers=headers,json=payload)
        assert r.status_code==expected,(method,path,r.status_code,r.text)
        return r.json()
    def post(path,payload=None,expected=201): return call('POST',path,payload,expected)
    def snap():
        # Every organization-owned table, including audit and idempotency rows.
        db.expire_all(); result={}
        for table in Organization.metadata.sorted_tables:
            if 'organization_id' in table.c:
                rows=db.execute(select(table).where(table.c.organization_id.in_(orgs))).all()
                result[table.name]=sorted(repr(tuple(r)) for r in rows)
        db.rollback(); return result
    def guard(path,payload,status=400,method='POST'):
        before=snap(); result=call(method,path,payload,status)
        assert snap()==before, ('Rejected request changed stored rows',path)
        return result
    def statements(start=None,end=None):
        return call('GET',f'/accounting/reports/financial-statements?date_from={start or today}&date_to={end or today}')
    def cash():
        return D(str(next(x for x in call('GET','/finance/accounts') if x['id']==account['id'])['current_balance']))
    def auto_failure_guard(schedule):
        before_schedule=next(x for x in call('GET','/finance/recurring-expenses') if x['id']==schedule['id'])
        log_ids=set(db.scalars(select(ActivityLog.id).where(ActivityLog.organization_id==org['id'])).all()); db.rollback()
        before=snap(); post('/finance/recurring-auto-post/'+schedule['id']+'/retry',expected=409); after=snap()
        for table in before:
            if table not in {'activity_logs','recurring_expenses'}:
                assert after[table]==before[table],('Auto failure changed',table)
        actions=db.scalars(select(ActivityLog.action).where(ActivityLog.organization_id==org['id'],ActivityLog.id.not_in(log_ids))).all(); db.rollback()
        assert actions==['finance.recurring_expense.auto_post_retry_failed'],actions
        persisted=next(x for x in call('GET','/finance/recurring-expenses') if x['id']==schedule['id'])
        for field in before_schedule:
            if field not in {'auto_post_last_attempt_at','auto_post_last_error','updated_at'}:
                assert persisted[field]==before_schedule[field],('Auto failure changed schedule',field)
        diagnostic=next(x for x in call('GET','/finance/recurring-auto-post') if x['id']==schedule['id'])
        assert diagnostic['last_error'] and diagnostic['retryable']
        assert persisted['auto_post'] is True and persisted['auto_post_last_error']==diagnostic['last_error'] and persisted['auto_post_last_attempt_at']
        return persisted,diagnostic
    def expense_journals(expense_id):
        count=db.scalar(select(func.count()).select_from(JournalEntry).where(JournalEntry.organization_id==orgs[0],JournalEntry.source_type=='expense_post',JournalEntry.source_id==expense_id,JournalEntry.status=='posted'))
        db.rollback(); assert count==1,('Expected one expense journal',expense_id,count)
    def ledger(key):
        value=db.scalar(select(func.coalesce(func.sum(JournalLine.debit-JournalLine.credit),0)).join(LedgerAccount,LedgerAccount.id==JournalLine.ledger_account_id).where(JournalLine.organization_id==orgs[0],LedgerAccount.system_key==key))
        db.rollback(); return D(value)
    try:
        user=User(email=f'qc-finance-extended-{marker}@example.invalid',full_name='Synthetic owner finance QC',is_active=True,is_verified=True)
        db.add(user); db.flush(); users.append(user.id)
        record_activity(db,action='qc.finance.fixture',scope='system',actor_type='system'); db.commit()
        headers={'Authorization':'Bearer '+create_access_token(user.id,int(user.auth_token_version or 0))}
        org=post('/organizations',{'name':'QC finance extended '+marker,'currency':'USD','country_code':'US','timezone':'UTC'})['organization']; orgs.append(org['id']); headers['X-Organization-ID']=org['id']
        account=post('/finance/accounts',{'name':'Fictional cash','account_type':'cash','currency':'USD','opening_balance':'1000'})
        client=post('/crm/clients',{'display_name':'Fictional stock client','currency':'USD'})
        # FIN05/06: transfer conserves carrying value, dispatch/reversal and limits.
        warehouses=[post('/inventory/warehouses',{'code':f'W{i}','name':f'Warehouse {i}'}) for i in range(2)]
        product=post('/inventory/products',{'sku':'STOCK','name':'Synthetic stock','currency':'USD','standard_cost':'6','selling_price':'15'})
        post('/inventory/purchases',{'supplier_name':'Fictional supplier','warehouse_id':warehouses[0]['id'],'receipt_date':today,'currency':'USD','items':[{'product_id':product['id'],'quantity':'10','unit_cost':'6'}]})
        transfer={'product_id':product['id'],'from_warehouse_id':warehouses[0]['id'],'to_warehouse_id':warehouses[1]['id'],'transfer_date':today,'quantity':'11','reason':'Synthetic stock transfer'}
        guard('/inventory/transfers',transfer,409)
        post('/inventory/transfers',{**transfer,'quantity':'3'})
        stock=call('GET','/inventory/stock'); assert sum(D(str(x['on_hand'])) for x in stock)==10,stock
        assert sum(D(str(x['inventory_value'])) for x in stock)==60,stock
        order=post('/sales/orders',{'client_id':client['id'],'order_date':today,'currency':'USD','items':[{'product_id':product['id'],'description':'Stock sale','quantity':'3','unit_price':'15'}]})
        fp=f"/sales/orders/{order['id']}/fulfillments"
        body={'warehouse_id':warehouses[1]['id'],'fulfillment_date':today,'items':[{'order_item_id':order['items'][0]['id'],'quantity':'1'}]}
        first=post(fp,body); amounts(first,total_cogs=6,total_cogs_base=6)
        reversed_row=post(fp+'/'+first['id']+'/reverse',{'reversal_date':today,'reason':'Synthetic reversal'},200); assert reversed_row['status']=='reversed'
        guard(fp+'/'+first['id']+'/reverse',{'reversal_date':today,'reason':'Repeat blocked'},409)
        final=post(fp,{**body,'items':[{'order_item_id':order['items'][0]['id'],'quantity':'3'}]}); amounts(final,total_cogs=18,total_cogs_base=18)
        guard(fp,body,409)
        assert sum(D(str(x['on_hand'])) for x in call('GET','/inventory/stock'))==7
        assert sum(D(str(x['inventory_value'])) for x in call('GET','/inventory/stock'))==42
        history=call('GET',fp); assert len(history)==2 and {x['status'] for x in history}=={'posted','reversed'}
        print('PASS FIN05 FIN06 HTTP: 10@6=60; reject transfer11 unchanged; transfer3 conserves60; dispatch1 cost6/reverse; dispatch3 cost18; stock7/value42; duplicate reversal and overdispatch rejected unchanged',flush=True)
        # FIN08 and FIN26: independent opening/purchase accounting, repeat guard.
        opening={'asset_code':'OPEN1','name':'Opening synthetic asset','currency':'USD','acquisition_cost':'120','salvage_value':'0','acquisition_date':prior_start,'in_service_date':prior_start,'useful_life_months':24,'record_mode':'opening','opening_balance_date':prior_end}
        before=cash()
        for code in ('OPEN1','OPEN2'): post('/accounting/assets',{**opening,'asset_code':code})
        assert cash()==before
        dep=post('/accounting/assets/depreciation',{'period_date':today}); assert len(dep['posted'])==2 and sum(D(x['amount']) for x in dep['posted'])==10
        journal_before=ledger('depreciation_expense')
        repeat=post('/accounting/assets/depreciation',{'period_date':today}); assert repeat['posted']==[] and len(repeat['skipped'])==2
        assert ledger('depreciation_expense')==journal_before==10
        before_report=statements(); before=cash()
        asset=post('/accounting/assets',{**opening,'asset_code':'BUY','record_mode':'purchase','opening_balance_date':None,'acquisition_date':today,'in_service_date':today,'acquisition_cost':'12','purchase_account_id':account['id']})
        assert cash()==before-12; amounts(asset,book_value=12)
        assert statements()['net_profit']==before_report['net_profit']
        guard('/accounting/assets',{**opening,'asset_code':'BAD','salvage_value':'121'},422)
        print('PASS FIN08 FIN26 HTTP; FIN27 backend guard only: opening cost240, depreciation10, repeat0, cash unchanged; purchase12 cash->asset no profit; invalid salvage rejected unchanged',flush=True)
        # FIN10: approve -> receipt -> full repayment including fees and interest.
        loan=post('/accounting/loans',{'lender_name':'Fictional lender','currency':'USD','approved_amount':'100','approval_date':today}); lp='/accounting/loans/'+loan['id']
        disburse={'account_id':account['id'],'disbursement_date':today,'principal_amount':'100','fee_withheld_amount':'3'}
        guard(lp+'/disburse',disburse,409); post(lp+'/approve',expected=200)
        guard(lp+'/disburse',{**disburse,'principal_amount':'101'},400)
        before=cash(); receipt=post(lp+'/disburse',disburse); amounts(receipt,principal_amount=100,fee_withheld_amount=3,net_received_amount=97); assert cash()==before+97
        repay={'account_id':account['id'],'payment_date':today,'principal_amount':'100','interest_amount':'4','fee_amount':'1'}
        guard(lp+'/repay',{**repay,'principal_amount':'101'},400)
        payment=post(lp+'/repay',repay); amounts(payment,cash_paid=105); amounts(payment['loan'],outstanding_principal=0); assert cash()==before-8
        post(lp+'/close',expected=200); guard(lp+'/repay',repay,409)
        assert ledger('loans_payable')==0
        print('PASS FIN10 HTTP: approval required; principal100/net97 with fee3; repay105 (100+4+1); loan payable0/cash delta-8; upper bounds and closed repayment rejected unchanged',flush=True)
        # FIN11/12/13: owner equity and investor principal are not operating income.
        before=cash(); profit=statements()['net_profit']
        for kind,value in [('contribution','50'),('drawing','10')]: post('/capital/owner-equity',{'transaction_type':kind,'account_id':account['id'],'transaction_date':today,'amount':value})
        assert cash()==before+40 and statements()['net_profit']==profit
        investor=post('/capital/company-investors',{'investor_name':'Fictional investor','currency':'USD','committed_amount':'40','agreement_date':today})
        ip='/capital/company-investors/'+investor['id']; funding={'account_id':account['id'],'funding_date':today,'amount':'40'}
        guard(ip+'/fundings',{**funding,'amount':'41'}); before=cash(); post(ip+'/fundings',funding)
        payout={'account_id':account['id'],'payout_date':today,'principal_return_amount':'40','profit_share_amount':'2'}
        guard(ip+'/payouts',{**payout,'principal_return_amount':'41'}); post(ip+'/payouts',payout)
        amounts(call('GET',ip+'/statement'),principal_returned=40,profit_paid=2,outstanding_capital=0); assert cash()==before-2
        before=cash(); inv=post('/capital/investments',{'investee_name':'Fictional investee','currency':'USD','invested_amount':'20','investment_date':today,'account_id':account['id']}); vp='/capital/investments/'+inv['id']
        ret={'account_id':account['id'],'return_date':today,'cash_amount':'23','principal_return_amount':'20','income_amount':'3'}
        guard(vp+'/returns',{**ret,'cash_amount':'24','principal_return_amount':'21'}); result=post(vp+'/returns',ret); amounts(result,carrying_value=0,income_amount=3); assert cash()==before+3 and ledger('investments')==0
        guard(vp+'/returns',ret)
        print('PASS FIN11 FIN12 FIN13 HTTP: equity50-10 cash+40/profit unchanged; company40 funding/40 principal+2 distribution, outstanding0; investment20 recovered+3 income, carrying0; limits/repeated recovery rejected unchanged',flush=True)
        # FIN14 use the real stock order to create a real linked project.
        project=post('/projects/from-order/'+order['id'],{'name':'Synthetic funded project'})
        pi=post('/capital/project-investors',{'project_id':project['id'],'investor_name':'Fictional project investor','currency':'USD','committed_amount':'10','investment_date':today,'share_type':'profit_percent','share_value':'20'})
        pp='/capital/project-investors/'+pi['id']; before=cash()
        post(pp+'/fundings',{**funding,'amount':'10'}); guard(pp+'/fundings',{**funding,'amount':'1'})
        post(pp+'/payouts',{**payout,'principal_return_amount':'10','profit_share_amount':'0'})
        amounts(call('GET',pp+'/statement'),outstanding_capital=0,principal_returned=10,profit_paid=0); assert cash()==before
        print('PASS FIN14 HTTP: project funding10/return10 outstanding0/cash net0; overfunding rejected unchanged',flush=True)
        # FIN15/24 noncash journal, reversal retention and close controls.
        ledgers=[post('/accounting/chart-of-accounts',{'code':str(900+i),'name':f'Synthetic noncash {i}','category':'asset','normal_balance':'debit'}) for i in range(2)]
        journal={'entry_date':today,'reference':'QC-noncash','lines':[{'ledger_account_id':ledgers[i]['id'],'currency':'USD','original_amount':'7',('debit' if i==0 else 'credit'):'7'} for i in range(2)]}
        before=cash(); je=post('/accounting/journals',journal); amounts(je,total_debit=7,total_credit=7)
        rv=post('/accounting/journals/'+je['id']+'/reverse'); amounts(rv,total_debit=7,total_credit=7)
        assert call('GET','/accounting/journals/'+je['id'])['source_type']=='manual' and cash()==before
        guard('/accounting/journals/'+je['id']+'/reverse',None,409)
        period=post('/finance/accounting-periods',{'name':'Synthetic one-day close','start_date':today,'end_date':today}); cp='/finance/accounting-periods/'+period['id']
        assert post(cp+'/close',{},200)['status']=='closed'; guard('/accounting/journals',journal,409); guard(cp+'/reopen',{'reason':'x'},422)
        reopened=post(cp+'/reopen',{'reason':'Synthetic reasoned QC reopen'},200); assert reopened['status']=='open' and reopened['reopen_reason']=='Synthetic reasoned QC reopen'
        print('PASS FIN15 FIN24 HTTP: noncash7 reversed7, original retained/cash unchanged/repeat blocked; closed-date posting blocked with exact stored-state preservation; short reopen reason rejected; reasoned reopen persisted',flush=True)
        # FIN16 recurring manual expense -> pause -> void, never auto-post.
        category=post('/finance/expense-categories',{'name':'Synthetic operating','cost_type':'operating'})
        recurring=post('/finance/recurring-expenses',{'name':'Synthetic monthly4','description':'Synthetic recurring expense','category_id':category['id'],'account_id':account['id'],'expense_currency':'USD','expense_amount':'4','frequency':'monthly','next_due_date':today,'auto_post':False})
        before=cash(); before_profit=D(statements()['net_profit'])
        headers['Idempotency-Key']='qc-recurring-'+marker
        posted=post('/finance/recurring-expenses/'+recurring['id']+'/post',{'expense_date':today},200)
        expense_journals(posted['expense_id'])
        before_retry=snap(); replay=post('/finance/recurring-expenses/'+recurring['id']+'/post',{'expense_date':today},200)
        assert replay['expense_id']==posted['expense_id'] and snap()==before_retry
        guard('/finance/recurring-expenses/'+recurring['id']+'/post',{'expense_date':today,'expense_amount':'5'},409)
        headers.pop('Idempotency-Key')
        recurring_actual=(cash(),D(statements()['net_profit']))
        if recurring_actual!=(before-4,before_profit-4):
            failures.append(('FIN16 recurring cash/accrual', (before-4,before_profit-4),recurring_actual))
            print('FAIL',failures[-1],flush=True)
        paused=call('PATCH','/finance/recurring-expenses/'+recurring['id'],{'is_active':False,'auto_post':False}); assert not paused['is_active'] and not paused['auto_post']
        guard('/finance/recurring-expenses/'+recurring['id']+'/post',{'expense_date':today},409)
        post('/finance/expenses/'+posted['expense_id']+'/void',expected=200)
        assert cash()==before and D(statements()['net_profit'])==before_profit
        assert call('GET','/finance/expenses/'+posted['expense_id'])['status']=='voided'
        print('PASS FIN16 manual cash/profit-4, one journal, explicit-key retry unchanged; pause rejects; void restores4/history' if not failures else 'FAIL FIN16 manual: see above',flush=True)
        # The specific authenticated auto retry endpoint invokes exactly this
        # synthetic due record, never a scheduler scan of preserved fixtures.
        auto=post('/finance/recurring-expenses',{'name':'Synthetic auto3','description':'Synthetic due record only','category_id':category['id'],'account_id':account['id'],'expense_currency':'USD','expense_amount':'3','frequency':'monthly','next_due_date':today,'auto_post':True})
        call('PATCH','/finance/recurring-auto-post/'+auto['id'],{'enabled':True})
        mapped=next(x for x in call('GET','/finance/recurring-expenses') if x['id']==auto['id'])
        assert mapped['auto_post'] is True, mapped
        before_auto=cash(); profit_auto=D(statements()['net_profit'])
        post('/finance/recurring-auto-post/'+auto['id']+'/retry',expected=200)
        actual_auto=(cash(),D(statements()['net_profit']))
        if actual_auto!=(before_auto-3,profit_auto-3):
            failures.append(('FIN16 auto cash/accrual',(before_auto-3,profit_auto-3),actual_auto)); print('FAIL',failures[-1],flush=True)
        guard('/finance/recurring-auto-post/'+auto['id']+'/retry',None,409)
        auto_state=next(x for x in call('GET','/finance/recurring-expenses') if x['id']==auto['id'])
        expense_journals(auto_state['last_posted_expense_id'])
        post('/finance/expenses/'+auto_state['last_posted_expense_id']+'/void',expected=200)
        assert cash()==before_auto and D(statements()['net_profit'])==profit_auto
        print('PASS FIN16 automatic cash/profit-3, one journal, next-period retry rejected unchanged; void restores cash/profit' if not failures else 'FAIL FIN16 automatic: see above',flush=True)
        tax_schedule={'name':'Synthetic recurring tax guard','description':'Synthetic invalid input only','category_id':category['id'],'account_id':account['id'],'expense_currency':'USD','expense_amount':'4','tax_amount':'5','frequency':'monthly','next_due_date':today}
        guard('/finance/recurring-expenses',tax_schedule,400)
        tax_valid=post('/finance/recurring-expenses',{**tax_schedule,'name':'Synthetic override tax guard','tax_amount':'3'})
        guard('/finance/recurring-expenses/'+tax_valid['id'],{'expense_amount':'2'},400,method='PATCH')
        guard('/finance/recurring-expenses/'+tax_valid['id'],{'tax_amount':'5'},400,method='PATCH')
        guard('/finance/recurring-expenses/'+tax_valid['id']+'/post',{'expense_date':today,'expense_amount':'2'},400)
        valid_post=post('/finance/recurring-expenses/'+tax_valid['id']+'/post',{'expense_date':today,'expense_amount':'3'},200)
        valid_detail=call('GET','/finance/expenses/'+valid_post['expense_id']); amounts(valid_detail,expense_amount=3,tax_amount=3)
        expense_journals(valid_post['expense_id']); post('/finance/expenses/'+valid_post['expense_id']+'/void',expected=200)
        # Explicit historical-compatibility fixture, not a financial repair:
        # all domain rows were HTTP-created; only this audited legacy invalid
        # value is injected inside the same rollback boundary.
        legacy=db.get(RecurringExpense,tax_valid['id']); legacy.tax_amount=D('5'); legacy.next_due_date=date.fromisoformat(today)
        record_activity(db,action='qc.finance.legacy_invalid_tax_fixture',scope='tenant',actor_type='system',organization_id=org['id'],entity_type='recurring_expense',entity_id=legacy.id)
        db.commit()
        call('PATCH','/finance/recurring-auto-post/'+tax_valid['id'],{'enabled':True})
        auto_failure_guard(tax_valid)
        paused_legacy=call('PATCH','/finance/recurring-expenses/'+tax_valid['id'],{'is_active':False})
        assert paused_legacy['is_active'] is False
        print('PASS legacy invalid recurring tax5>amount4: auto409, only failure diagnostic/audit retained; no financial or schedule success mutation; unsafe legacy schedule can still be paused',flush=True)
        print('PASS FIN16/20 recurring included tax: create5>4, update3>2 and5>4, override3>2 reject400 with all rows unchanged; tax3=amount3 posts once and voids',flush=True)
        # FIN18/36: receipt liability, bounded credit to an issued invoice.
        before=cash(); profit=statements()['net_profit']
        advance=post('/accounting/customer-advances',{'client_id':client['id'],'financial_account_id':account['id'],'advance_date':today,'amount':'10'})
        assert cash()==before+10 and statements()['net_profit']==profit and ledger('customer_advances')==-10
        invoice=post('/finance/invoices',{'client_id':client['id'],'issue_date':today,'currency':'USD','items':[{'item_name':'Service','description':'Synthetic service','quantity':'1','unit_price':'120'}]})
        call('PATCH','/finance/invoices/'+invoice['id']+'/status',{'action':'send'})
        application={'invoice_id':invoice['id'],'application_date':today,'amount':'11'}; ap='/accounting/customer-advances/'+advance['id']+'/apply'
        guard(ap,application,409); before=cash(); applied=post(ap,{**application,'amount':'10'},200)
        amounts(applied,remaining_amount=0); amounts(call('GET','/finance/invoices/'+invoice['id']),balance_due=110,amount_paid=10)
        assert cash()==before and ledger('customer_advances')==0 and ledger('accounts_receivable')==110
        print('PASS FIN18 FIN36 HTTP: advance10 liability not income; reject11 unchanged; apply10 -> invoice120 due110/advance0/AR110 without cash',flush=True)
        # FIN19/20 and FIN22: minimum amount, included tax and exact filters.
        income_ledger=post('/accounting/chart-of-accounts',{'code':'QCINC','name':'Synthetic direct income','category':'income','normal_balance':'credit'})
        income={'kind':'income','entry_date':today,'financial_account_id':account['id'],'category_ledger_account_id':income_ledger['id'],'amount':'5.55','description':'Synthetic direct income','reference':'QC-UNIQUE-INCOME'}
        guard('/accounting/money',{**income,'amount':'0'},422); before=cash(); direct=post('/accounting/money',income); amounts(direct,amount='5.55'); assert cash()==before+D('5.55')
        expense={'category_id':category['id'],'account_id':account['id'],'client_id':client['id'],'expense_date':today,'expense_currency':'USD','expense_amount':'6','tax_amount':'7','description':'Synthetic included tax expense','payment_method':'cash'}
        guard('/finance/expenses',expense,400); corrected=post('/finance/expenses',{**expense,'tax_amount':'6'}); amounts(corrected,expense_amount=6,tax_amount=6)
        path='/finance/accounts/'+account['id']+'/ledger-page'
        filtered=call('GET',path+'?search=QC-UNIQUE-INCOME&direction=credit&date_from='+today+'&date_to='+today)
        assert len(filtered['items'])==1; amounts(filtered['items'][0],amount='5.55')
        assert call('GET',path+'?search=QC-UNIQUE-INCOME&direction=debit')['items']==[]
        assert call('GET',path+'?search=QC-UNIQUE-INCOME&date_to='+previous)['items']==[]
        print('PASS FIN19 FIN20 HTTP; FIN22 filter subset: direct5.55 persists/zero rejected; included tax7 on6 rejected and6 accepted; unique incoming search/date/direction row exact, wrong direction/date empty',flush=True)
        # FIN21/34/40: 20 + tax2 (half recoverable) - withholding1 = AP21.
        tax=post('/accounting/tax/codes',{'code':'QCINPUT','name':'Synthetic purchase tax','tax_kind':'purchase','rate':'10','recoverable_percent':'50'})
        withholding=post('/accounting/tax/codes',{'code':'QCWITHHOLD','name':'Synthetic withholding','tax_kind':'withholding','rate':'5'})
        chart=call('GET','/accounting/chart-of-accounts'); expense_id=next(x['id'] for x in chart if x['system_key']=='operating_expenses')
        before_expenses=D(statements()['total_expenses']); before_ap=ledger('accounts_payable')
        bill=post('/accounting/payables',{'supplier_name':'Synthetic taxable supplier','bill_date':today,'currency':'USD','amount':'20','tax_code_id':tax['id'],'withholding_tax_code_id':withholding['id'],'expense_ledger_account_id':expense_id,'description':'Synthetic taxable bill'})
        amounts(bill,subtotal_amount=20,input_tax_amount=2,recoverable_tax_amount=1,withholding_tax_amount=1,balance_due=21)
        assert D(statements()['total_expenses'])==before_expenses+21 and ledger('accounts_payable')==before_ap-21
        assert ledger('input_tax_receivable')==1 and ledger('withholding_tax_payable')==-1
        bp='/accounting/payables/'+bill['id']+'/payments'; payment={'financial_account_id':account['id'],'payment_date':today,'amount':'22'}
        guard(bp,payment,400); before=cash(); profit=statements()['net_profit']
        post(bp,{**payment,'amount':'5'}); amounts(next(x for x in call('GET','/accounting/payables?include_paid=true') if x['id']==bill['id']),balance_due=16)
        post(bp,{**payment,'amount':'16'}); amounts(next(x for x in call('GET','/accounting/payables?include_paid=true') if x['id']==bill['id']),balance_due=0,amount_paid=21)
        assert cash()==before-21 and statements()['net_profit']==profit and ledger('accounts_payable')==before_ap
        # Output tax is required before offset can reduce it.
        taxed=post('/finance/invoices',{'client_id':client['id'],'issue_date':today,'currency':'USD','items':[{'item_name':'Tax service','description':'Synthetic taxable service','quantity':'1','unit_price':'20','tax_rate':'10'}]})
        call('PATCH','/finance/invoices/'+taxed['id']+'/status',{'action':'send'})
        offset={'settlement_type':'input_tax_offset','settlement_date':today,'amount':'2'}
        guard('/accounting/tax/settlements',offset,409); before=cash(); post('/accounting/tax/settlements',{**offset,'amount':'1'})
        assert cash()==before and ledger('input_tax_receivable')==0 and ledger('taxes_payable')==-1
        print('PASS FIN21 FIN34 FIN40 HTTP: subtotal20/input2 half recoverable -> expense21/input asset1/AP21/withholding1; reject22 then pay5+16 no double expense; offset2 rejected/offset1 no cash leaves input0/output-tax1',flush=True)
        # FIN23/25 EUR transfer, prerequisite, round trip and reconciliation locks.
        eur=post('/finance/accounts',{'name':'Fictional EUR','account_type':'bank','currency':'EUR','opening_balance':'0'})
        transfer={'from_account_id':account['id'],'to_account_id':eur['id'],'transfer_date':today,'source_amount':'10','fee_amount':'1','destination_amount':'8'}
        call('PATCH','/company-settings/exchange-rates/policy',{'mode':'manual','sync_frequency':'manual'})
        before=cash(); fees_before=ledger('bank_fees'); gains_before=ledger('realized_fx_gain'); out=post('/finance/transfers',transfer); amounts(out,source_amount=10,fee_amount=1,destination_amount=8)
        out_entry=db.scalar(select(JournalEntry.id).where(JournalEntry.organization_id==org['id'],JournalEntry.source_type=='account_transfer',JournalEntry.source_id==out['id']))
        eur_line=db.execute(select(JournalLine.debit,JournalLine.credit).where(JournalLine.journal_entry_id==out_entry,JournalLine.currency=='EUR')).one(); db.rollback()
        assert eur_line==(D('9'),D('0')),eur_line
        returning={'from_account_id':eur['id'],'to_account_id':account['id'],'transfer_date':today,'source_amount':'8','destination_amount':'10'}
        guard('/finance/transfers',{**returning,'source_amount':'9'},409)
        guard('/finance/transfers',returning,409)
        post('/company-settings/exchange-rates',{'base_currency':'EUR','quote_currency':'USD','manual_rate':'1.25'})
        # Late posting failure: foreign account is funded today, but no historical
        # EUR/USD snapshot exists yesterday. No mocked services or external calls.
        late={'name':'Synthetic FX rollback','description':'Synthetic missing historical FX','category_id':category['id'],'account_id':eur['id'],'expense_currency':'EUR','expense_amount':'1','frequency':'monthly','next_due_date':previous,'auto_post':False}
        late_manual=post('/finance/recurring-expenses',late)
        headers['Idempotency-Key']='qc-recurring-late-'+marker
        guard('/finance/recurring-expenses/'+late_manual['id']+'/post',{'expense_date':previous},409)
        headers.pop('Idempotency-Key')
        late_auto=post('/finance/recurring-expenses',{**late,'name':'Synthetic auto FX rollback','auto_post':True})
        call('PATCH','/finance/recurring-auto-post/'+late_auto['id'],{'enabled':True})
        failed_schedule,failed_diagnostic=auto_failure_guard(late_auto)
        assert failed_schedule['next_due_date']==previous and failed_schedule['last_posted_expense_id'] is None
        print('PASS recurring late-FX atomicity: manual all rows unchanged including idempotency/audit; specific auto retry retains failure metadata only, no expense/cash/journal/schedule advancement',flush=True)
        back=post('/finance/transfers',{'from_account_id':eur['id'],'to_account_id':account['id'],'transfer_date':today,'source_amount':'8','destination_amount':'10'})
        assert cash()==before and D(next(x for x in call('GET','/finance/accounts') if x['id']==eur['id'])['current_balance'])==0
        assert ledger('bank_fees')==fees_before+1 and ledger('realized_fx_gain')==gains_before-1
        # EUR starts/ends0; match incoming first to produce a deliberate difference.
        rec=post('/accounting/reconciliations',{'account_id':eur['id'],'statement_end_date':today,'statement_ending_balance':'0'}); rp='/accounting/reconciliations/'+rec['id']
        detail=call('GET',rp); txs=detail['transactions']; assert len(txs)==2,detail
        incoming=next(x for x in txs if x['direction']=='credit'); outgoing=next(x for x in txs if x['direction']=='debit')
        post(rp+'/transactions/'+incoming['id']); guard(rp+'/finalize',None,409)
        post(rp+'/transactions/'+outgoing['id']); finalized=post(rp+'/finalize',expected=200)
        amounts(finalized,difference=0,cleared_book_balance=0,matched_transactions=2); assert finalized['status']=='finalized'
        guard(rp+'/transactions/'+incoming['id'],None,409); guard(rp+'/transactions/'+incoming['id'],None,409,method='DELETE')
        print('PASS FIN23 FIN25 HTTP: USD10 fee1->EUR8 carrying9; rejectEUR9 overdraw and returnEUR8 missing historical rate unchanged; snapshot1.25, reverse EUR8->USD10 restores cash; two matched EUR rows difference0/finalized, nonzero difference and finalized edits rejected unchanged',flush=True)
        # FIN29/33 exact as-of boundary: previous-month opening240; earlier month zero.
        aug=statements(earlier_start,earlier_end); sep=statements(prior_start,prior_end)
        amounts(aug,total_assets=0,total_income=0,total_expenses=0,net_profit=0)
        amounts(sep,total_assets=240,total_income=0,total_expenses=0,net_profit=0)
        amounts(aug['cash_flow'],net_change=0); amounts(sep['cash_flow'],net_change=0)
        amounts(call('GET',f'/accounting/trial-balance?as_of={earlier_end}'),total_debit=0,total_credit=0)
        amounts(call('GET',f'/accounting/trial-balance?as_of={prior_end}'),total_debit=240,total_credit=240)
        print('PASS FIN33 HTTP and FIN29 as-of subset: Earlier-month assets/P&L/cash/TB0; prior-month opening assets240/TB240 balanced, income/expenses/cash0; current activity excluded',flush=True)
        # FIN17 quotation rounding and immutable revision lineage, HTTP not mocks.
        item={'item_name':'Precision service','description':'Synthetic rounded service','quantity':'3','unit_price':'18.8889'}
        quote=post('/sales/quotations',{'client_id':client['id'],'issue_date':today,'currency':'USD','items':[item]}); qp='/sales/quotations/'+quote['id']; amounts(quote,total='56.67')
        call('PATCH',qp+'/commercial',{'sections':[{'section_type':'scope','content':'Original scope retained'}]})
        guard(qp+'/commercial',{'payment_milestones':[{'title':'Incomplete schedule','payment_type':'fixed','amount':'1'}]},400,method='PATCH')
        call('PATCH',qp+'/status',{'status':'sent'})
        original=call('GET',qp+'/commercial')
        revised=post(qp+'/revisions',{'revision_reason':'Synthetic price revision'}); rp_quote='/sales/quotations/'+revised['id']
        updated=call('PATCH',rp_quote,{'items':[{**item,'unit_price':'18.9'}]}); amounts(updated,total='56.70')
        call('PATCH',rp_quote+'/status',{'status':'sent'}); rejected=call('PATCH',rp_quote+'/status',{'status':'rejected'}); assert rejected['status']=='rejected'
        retained=call('GET',qp+'/commercial'); amounts(retained,total='56.67'); assert retained['sections']==original['sections']
        assert len(call('GET',qp+'/revisions'))==2
        guard(qp,{'items':[{**item,'unit_price':'99'}]},409,method='PATCH')
        print('PASS FIN17 HTTP: 3*18.8889 rounds56.67; original scope/R1 retained; R2 3*18.9=56.70 rejected; incomplete payment schedule and superseded edit rejected unchanged',flush=True)
        # FIN38: replacement collection after applied advance, no double income.
        before=cash(); income_before=statements()['total_income']
        post('/finance/payments',{'invoice_id':invoice['id'],'account_id':account['id'],'payment_date':today,'invoice_amount':'110','method':'cash'})
        paid=call('GET','/finance/invoices/'+invoice['id']); amounts(paid,amount_paid=120,balance_due=0)
        assert paid['status']=='paid' and cash()==before+110 and statements()['total_income']==income_before
        print('PASS FIN38 HTTP alternate fixture: applied credit10 + replacement cash110 settles120, cash+110/income unchanged',flush=True)
        other=post('/organizations',{'name':'QC other tenant '+marker,'currency':'USD','country_code':'US','timezone':'UTC'})['organization']; orgs.append(other['id'])
        headers['X-Organization-ID']=other['id']; headers['Idempotency-Key']='qc-foreign-'+marker
        guard('/finance/recurring-expenses/'+recurring['id']+'/post',{'expense_date':today},404)
        headers['X-Organization-ID']=org['id']; headers.pop('Idempotency-Key')
        print('PASS recurring tenant isolation: owner of another tenant cannot post first tenant schedule; all tenant/audit/idempotency rows unchanged',flush=True)
        # Independent all-entry balance and cleanup evidence.
        rows=db.execute(select(JournalLine.journal_entry_id,func.sum(JournalLine.debit),func.sum(JournalLine.credit)).where(JournalLine.organization_id==orgs[0]).group_by(JournalLine.journal_entry_id)).all()
        assert rows and all(a==b for _,a,b in rows),rows; db.rollback()
        print(f'PASS independent PostgreSQL: all {len(rows)} synthetic journals balance',flush=True)
    finally:
        http.close(); app.dependency_overrides.pop(get_db,None); db.close(); outer.rollback(); conn.close()
    with SessionLocal() as check:
        assert check.scalar(select(func.count()).select_from(Organization).where(Organization.id.in_(orgs)))==0
        assert check.scalar(select(func.count()).select_from(User).where(User.id.in_(users)))==0
    print('PASS cleanup: every synthetic organization/user/business row rolled back',flush=True)
    assert not failures, failures

if __name__=='__main__': main()
