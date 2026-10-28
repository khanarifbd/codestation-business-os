"""Deterministic authenticated recurring concurrency check, local test PostgreSQL only.

Creates and preserves one uniquely labeled synthetic organization because separate
HTTP sessions require committed fixtures. No provider, lifespan or scheduler scan.
"""
import os
from datetime import date
from decimal import Decimal as D
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app.core.security import create_access_token
from app.db.session import SessionLocal, engine
from app.main import app
from app.models.user import User
from app.models.accounting import JournalEntry
from app.services.activity_log import record_activity

def verify_auto_concurrency():
    """Two real requests, separate PG sessions, one bounded synthetic account.

    Fixture is deliberately committed because a rollback transaction cannot be
    seen by independent HTTP sessions. Preserve its labeled rows for evidence.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy import text
    from app.models.finance import FinancialAccount
    assert os.environ.get('ENVIRONMENT')=='test' and engine.url.get_backend_name()=='postgresql'
    assert engine.url.host in {'localhost','127.0.0.1'}
    assert not app.dependency_overrides
    marker=uuid4().hex[:10]; today=date.today().isoformat()
    with SessionLocal() as db:
        user=User(email=f'qc-recurring-race-{marker}@example.invalid',full_name='Synthetic recurring race owner',is_active=True,is_verified=True)
        db.add(user); db.flush(); uid=user.id; version=int(user.auth_token_version or 0)
        record_activity(db,action='qc.finance.race_fixture',scope='system',actor_type='system'); db.commit()
    headers={'Authorization':'Bearer '+create_access_token(uid,version)}
    with_client=TestClient(app)
    def request(method,path,payload=None,status=201):
        r=with_client.request(method,'/api/v1'+path,headers=headers,json=payload)
        assert r.status_code==status,(path,r.status_code,r.text)
        return r.json()
    org=request('POST','/organizations',{'name':'QC PRESERVED recurring race '+marker,'currency':'USD','country_code':'US','timezone':'UTC'})['organization']
    headers['X-Organization-ID']=org['id']
    account=request('POST','/finance/accounts',{'name':'Synthetic bounded five','account_type':'cash','currency':'USD','opening_balance':'5'})
    category=request('POST','/finance/expense-categories',{'name':'Synthetic race expenses'})
    schedules=[]
    for index in range(2):
        item=request('POST','/finance/recurring-expenses',{'name':f'Synthetic race {index}','description':'Local concurrency fixture','category_id':category['id'],'account_id':account['id'],'expense_currency':'USD','expense_amount':'4','frequency':'monthly','next_due_date':today})
        request('PATCH','/finance/recurring-auto-post/'+item['id'],{'enabled':True},200); schedules.append(item)
    def retry(item):
        client=TestClient(app)
        try:
            response=client.post('/api/v1/finance/recurring-auto-post/'+item['id']+'/retry',headers=headers)
            return response.status_code,response.json()
        finally: client.close()
    blocker=SessionLocal()
    try:
        blocker.scalar(select(FinancialAccount).where(FinancialAccount.id==account['id']).with_for_update())
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(retry,item) for item in schedules]
            deadline=time.monotonic()+15; waiting=0
            try:
                while time.monotonic()<deadline:
                    with SessionLocal() as observation:
                        waiting=observation.scalar(text("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid <> pg_backend_pid()"))
                    if waiting>=2: break
                    time.sleep(.05)
            finally:
                blocker.rollback()
            results=[f.result(timeout=20) for f in futures]
        assert waiting>=2,('Did not establish two concurrent waiting sessions',waiting)
    finally: blocker.close()
    cash=D(next(x for x in request('GET','/finance/accounts',status=200) if x['id']==account['id'])['current_balance'])
    from app.models.expenses import Expense
    with SessionLocal() as evidence:
        expense_count=evidence.scalar(select(func.count()).select_from(Expense).where(Expense.organization_id==org['id'],Expense.status=='posted'))
        journal_count=evidence.scalar(select(func.count()).select_from(JournalEntry).where(JournalEntry.organization_id==org['id'],JournalEntry.source_type=='expense_post',JournalEntry.status=='posted'))
    codes=sorted(code for code,_ in results)
    print('CONCURRENCY EVIDENCE',{'organization_id':org['id'],'user_id':uid,'account_id':account['id'],'statuses':codes,'cash':str(cash),'expenses':expense_count,'journals':journal_count,'waiting_sessions':waiting,'fixture':'preserved synthetic only'},flush=True)
    for item in schedules:
        request('PATCH','/finance/recurring-auto-post/'+item['id'],{'enabled':False},200)
    with_client.close()
    assert codes==[200,409] and cash==1 and expense_count==journal_count==1,results
    print('PASS real-PG concurrent recurring: two schedules4 against5, one200/one409, cash1, one expense and one journal',flush=True)

if __name__=='__main__': verify_auto_concurrency()
