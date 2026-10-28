"""Real owner HTTP/PG collection eligibility, receipt reversal, tenant isolation.

Only get_db is overridden for an outer rollback transaction. All business records
are created through normal authenticated routes. No mail/payment providers run.
"""
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.user import User
from app.models.organization import Organization
from app.models.finance import Invoice
from app.services.activity_log import record_activity


def main():
    assert settings.environment == "test", "Explicit test environment required"
    assert engine.url.get_backend_name() == 'postgresql' and engine.url.host in {'127.0.0.1', 'localhost'}
    assert not app.dependency_overrides
    marker=uuid4().hex[:12]; today=date.today(); yesterday=today-timedelta(days=1)
    conn=engine.connect(); outer=conn.begin(); db=SessionLocal(bind=conn,join_transaction_mode='create_savepoint')
    def local_db():
        with SessionLocal(bind=conn,join_transaction_mode='create_savepoint') as session: yield session
    app.dependency_overrides[get_db]=local_db
    http=TestClient(app); orgs=[]; users=[]
    def call(method,path,headers,payload=None,code=200):
        r=http.request(method,'/api/v1'+path,headers=headers,json=payload)
        assert r.status_code==code,(method,path,r.status_code,r.text)
        return r.json() if r.content else None
    def fixture(label):
        u=User(email=f'qc-collections-{label}-{marker}@example.invalid',full_name='Synthetic collections owner',is_active=True,is_verified=True)
        db.add(u);db.flush();users.append(u.id)
        record_activity(db,action='qc.collections.fixture',scope='system',actor_type='system');db.commit()
        h={'Authorization':'Bearer '+create_access_token(u.id,int(u.auth_token_version or 0))}
        org=call('POST','/organizations',h,{'name':f'QC collections {label} {marker}','currency':'USD','country_code':'US','timezone':'UTC'},201)['organization']
        orgs.append(org['id']);h['X-Organization-ID']=org['id']
        client=call('POST','/crm/clients',h,{'display_name':'Synthetic collections client','currency':'USD'},201)
        account=call('POST','/finance/accounts',h,{'name':'Synthetic cash','account_type':'cash','currency':'USD','opening_balance':'0'},201)
        return h,client,account
    def invoice(h,client,total,overdue=False,action='send'):
        item=call('POST','/finance/invoices',h,{'client_id':client['id'],'issue_date':yesterday.isoformat(),'due_date':(yesterday if overdue else today+timedelta(days=7)).isoformat(),'currency':'USD','items':[{'item_name':'Synthetic service','description':'Synthetic service','quantity':'1','unit_price':str(total)}]},201)
        if action:call('PATCH',f'/finance/invoices/{item["id"]}/status',h,{'action':action,'reason':'Synthetic cancelled draft' if action=='cancel' else None})
        return item
    def pay(h,item,account,total):
        return call('POST','/finance/payments',h,{'invoice_id':item['id'],'account_id':account['id'],'payment_date':today.isoformat(),'invoice_amount':str(total),'method':'cash'},201)
    def pulse(h,count,total,overdue_count,overdue_total):
        actual=call('GET','/dashboard-pulse/finance',h)
        expected=(count,overdue_count,Decimal(str(total)),Decimal(str(overdue_total)))
        amounts=(actual['open_invoices'],actual['overdue_invoices'],sum((Decimal(r['amount']) for r in actual['outstanding']),Decimal(0)),sum((Decimal(r['amount']) for r in actual['overdue']),Decimal(0)))
        assert amounts==expected,{'expected':str(expected),'actual':actual}
        assert all(r['currency']=='USD' for r in actual['outstanding']+actual['overdue'])
        assert call('GET','/dashboard-pulse/overview',h)['finance']==actual
    try:
        a,client,cash=fixture('A');b,other,other_cash=fixture('B')
        invoice(b,other,'9999',True)
        invoice(a,client,'24.68')
        draft=invoice(a,client,'47.25',True,None)
        cancelled=invoice(a,client,'24.68',True,'cancel')
        settled=invoice(a,client,'30',True);pay(a,settled,cash,'30')
        partial=invoice(a,client,'200',True);pay(a,partial,cash,'80')
        pulse(a,2,'144.68',1,'120');pulse(b,1,'9999',1,'9999')
        print('PASS partially paid plus sent:2 invoices/144.68; overdue1/120; draft/cancelled/paid excluded; foreign9999 isolated',flush=True)
        receipt=pay(a,partial,cash,'120');pulse(a,1,'24.68',0,'0')
        call('POST','/accounting/corrections/reverse',a,{'source_type':'payment','source_id':receipt['id'],'reason':'Synthetic mistaken receipt'},201)
        pulse(a,2,'144.68',1,'120')
        print('PASS full settlement removes collection; real receipt reversal restores120 and overdue count without losing partial invoice',flush=True)
        call('GET','/dashboard-pulse/finance',{},code=401)
        # Legacy residual values must not turn excluded lifecycle states into debt.
        for item in [draft,cancelled,settled]:
            db.get(Invoice,item['id']).balance_due=Decimal('999')
        record_activity(db,action='qc.collections.legacy_fixture',scope='organization',organization_id=orgs[0],actor_type='system');db.commit()
        pulse(a,2,'144.68',1,'120')
        print('PASS legacy residual control: draft/cancelled/paid999 remain excluded; unauthenticated401',flush=True)
    finally:
        http.close();app.dependency_overrides.clear();db.close();outer.rollback();conn.close()
    with SessionLocal() as check:
        assert check.scalar(select(func.count()).select_from(Organization).where(Organization.id.in_(orgs)))==0
        assert check.scalar(select(func.count()).select_from(User).where(User.id.in_(users)))==0
    print('PASS independent PostgreSQL readback: all synthetic users/organizations rolled back',flush=True)

if __name__=='__main__':main()
