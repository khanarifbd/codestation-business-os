"""Owner-only registered HTTP + PostgreSQL HR guards. All writes roll back.
No self-service, employee portals, mail, invitations, payment or external calls.
"""
from decimal import Decimal
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app.core.security import create_access_token
from app.core.config import settings
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.user import User
from app.models.organization import Organization
from app.services.activity_log import record_activity


def assert_local_test_database():
    assert settings.environment=='test', 'Only explicit test environment is permitted'
    assert engine.url.get_backend_name()=='postgresql', 'Only PostgreSQL test databases are permitted'
    assert engine.url.host in {'127.0.0.1','::1','localhost'}, 'Only loopback database is permitted'
    name=engine.url.database or ''
    assert name=='codestation_business_os' or name.startswith('business_os_qc'), 'Only named CI/QC test databases are permitted'


def main():
    assert_local_test_database()
    assert not app.dependency_overrides
    connection = engine.connect(); outer = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode='create_savepoint')
    def local_db():
        with SessionLocal(bind=connection, join_transaction_mode='create_savepoint') as session:
            yield session
    app.dependency_overrides[get_db] = local_db
    http = TestClient(app)
    headers = {}
    def call(method, path, payload=None, expected=200):
        response = http.request(method, '/api/v1' + path, headers=headers, json=payload)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        return response.json()
    try:
        user = User(email=f'qc-hr-extended-{uuid4().hex}@example.invalid', full_name='Synthetic HR owner', is_active=True, is_verified=True)
        db.add(user); db.flush(); user_id = user.id
        record_activity(db, action='qc.hr_extended.fixture', scope='system', actor_type='system'); db.commit()
        headers['Authorization'] = 'Bearer ' + create_access_token(user.id, int(user.auth_token_version or 0))
        org = call('POST', '/organizations', {'name':'QC HR extended '+uuid4().hex[:8], 'currency':'USD','country_code':'US','timezone':'UTC'}, 201)['organization']
        headers['X-Organization-ID'] = org['id']
        employee = call('GET', '/hr/people')['people'][0]
        eid = employee['id']
        dep = call('POST','/team/departments',{'name':'Synthetic Engineering','code':'QCE'},201)
        des = call('POST','/team/designations',{'name':'Synthetic Engineer','code':'QCS'},201)
        call('PATCH',f'/hr/people/{eid}',{'department_id':dep['id'],'designation_id':des['id']})
        read = call('GET','/hr/people')['people'][0]
        assert read['department_id']==dep['id'] and read['designation_id']==des['id'],read
        print('PASS HR01 owner-admin structure and employee association persist via fresh HTTP read')
        call('POST','/hr/attendance/offices',{'name':'Invalid office','latitude':91,'longitude':0},422)
        modes=['office']*5+['off','off']
        call('PUT',f'/hr/attendance/policies/{eid}',{'weekly_modes':modes},400)
        office=call('POST','/hr/attendance/offices',{'name':'Synthetic office','latitude':23.75,'longitude':90.39,'radius_meters':100},201)
        call('PUT',f'/hr/attendance/policies/{eid}',{'office_id':office['id'],'weekly_modes':modes})
        policy=next(x for x in call('GET','/hr/attendance/policies') if x['employee_id']==eid)
        assert policy['weekly_modes']==modes and policy['office_id']==office['id'],policy
        print('PASS HR07 latitude validation, office prerequisite and weekly policy persistence; no self-service request')
        profile=call('POST','/payroll/salary-profiles',{'employee_id':eid,'currency':'USD','base_salary':'1000','effective_from':'2026-10-01'},201)
        def period(name,start,end):
            return call('POST','/payroll/periods',{'name':name,'period_start':start,'period_end':end,'pay_date':end},201)
        sept=period('September','2026-09-01','2026-09-30')
        call('POST','/payroll/runs',{'period_id':sept['id'],'currency':'USD'},409)
        assert not call('GET','/payroll/runs')
        print('PASS HR20 pre-effective salary ineligible; rejected generation leaves no payroll run')
        octo=period('October','2026-10-01','2026-10-31')
        before=call('GET','/payroll/periods')
        call('POST','/payroll/periods',{'name':'Overlap','period_start':'2026-10-01','period_end':'2026-10-15','pay_date':'2026-10-15'},409)
        assert call('GET','/payroll/periods')==before
        print('PASS HR21 overlapping payroll period rejected without persistence')
        run=call('POST','/payroll/runs',{'period_id':octo['id'],'currency':'USD'},201)
        path=f"/payroll/runs/{run['id']}/entries/{run['entries'][0]['id']}"
        call('PATCH',path,{'deductions':[{'name':'Excess','amount':'1000.01'}]},400)
        assert call('GET',f"/payroll/runs/{run['id']}")==run
        call('POST','/payroll/runs',{'period_id':octo['id'],'currency':'USD'},409)
        assert len(call('GET','/payroll/runs'))==1
        print('PASS HR15 negative net rejected server-side with unchanged draft; duplicate run rejected')
        run=call('PATCH',path,{'deductions':[{'name':'Synthetic recovery','amount':'25.20'}],'tax_amount':'100.15'})
        assert Decimal(run['net_total'])==Decimal('874.65')
        call('POST',f"/payroll/runs/{run['id']}/approve")
        early=call('GET','/payroll/withholdings/meta?payment_date=2026-10-20')
        end=call('GET','/payroll/withholdings/meta?payment_date=2026-10-31')
        assert Decimal(str(early['liability_balance']))==0 and Decimal(str(end['liability_balance']))==Decimal('125.35'),(early,end)
        early_report=call('GET','/accounting/reports/financial-statements?date_from=2026-10-01&date_to=2026-10-20')
        end_report=call('GET','/accounting/reports/financial-statements?date_from=2026-10-01&date_to=2026-10-31')
        assert Decimal(str(early_report['total_expenses']))==0 and Decimal(str(end_report['total_expenses']))==1000
        assert Decimal(str(early_report['total_liabilities']))==0 and Decimal(str(end_report['total_liabilities']))==1000
        early_payroll={row['code']:Decimal(str(row['amount'])) for row in early_report['liabilities'] if row['code'] in {'2400','2410'}}
        end_payroll={row['code']:Decimal(str(row['amount'])) for row in end_report['liabilities'] if row['code'] in {'2400','2410'}}
        assert sum(early_payroll.values())==0 and end_payroll=={'2400':Decimal('125.35'),'2410':Decimal('874.65')},(early_payroll,end_payroll)
        print('PASS HR23 same-date cutoff: expense/liabilities0 October20 then1000 October31; payroll payable874.65 + withholding125.35; HR24 withholding0 then125.35; no payment')
        for cutoff,statement,expected in [('2026-10-20',early_report,Decimal('0')),('2026-10-31',end_report,Decimal('1000'))]:
            trial=call('GET',f'/accounting/trial-balance?as_of={cutoff}')
            assert Decimal(str(trial['total_debit']))==expected and Decimal(str(trial['total_credit']))==expected,trial
            statement_payroll={row['code']:Decimal(str(row['amount'])) for row in statement['liabilities'] if row['code'] in {'2400','2410'}}
            trial_payroll={row['code']:Decimal(str(row['credit']))-Decimal(str(row['debit'])) for row in trial['rows'] if row['code'] in {'2400','2410'}}
            assert set(trial_payroll)=={'2400','2410'}
            for code,value in trial_payroll.items():
                assert value==statement_payroll.get(code,Decimal('0')),(cutoff,code,trial_payroll,statement_payroll)
            trial_expenses=sum((Decimal(str(row['debit']))-Decimal(str(row['credit'])) for row in trial['rows'] if row['category']=='expense'),Decimal('0'))
            assert trial_expenses==Decimal(str(statement['total_expenses']))==expected
            assert Decimal(str(statement['current_earnings']))==-expected and Decimal(str(statement['total_equity']))==-expected
            assert Decimal(str(statement['total_assets']))==Decimal(str(statement['total_liabilities_and_equity']))==0
            assert Decimal(str(statement['total_assets']))==Decimal(str(statement['total_liabilities']))+Decimal(str(statement['total_equity']))
        print('PASS FIN28 same payroll fixture: TB debit/credit0/0 Oct20 then1000/1000 Oct31; payroll payable/withholdings and expenses reconcile with statements; equity/current earnings-1000 balance zero assets')
        # PRJ12: preserve the original stock+draft-invoice state invariant on a
        # fresh bounded owner fixture, not the historical tenant/order IDs.
        today='2026-10-22'
        client=call('POST','/crm/clients',{'display_name':'Synthetic project stock client','currency':'USD'},201)
        warehouse=call('POST','/inventory/warehouses',{'code':'QC-RESTORE','name':'Synthetic restoration stock'},201)
        product=call('POST','/inventory/products',{'sku':'QC-RESTORE','name':'Synthetic restored stock','currency':'USD','standard_cost':'6','selling_price':'15.75'},201)
        call('POST','/inventory/purchases',{'supplier_name':'Synthetic local supplier','warehouse_id':warehouse['id'],'receipt_date':today,'currency':'USD','items':[{'product_id':product['id'],'quantity':'10','unit_cost':'6'}]},201)
        order=call('POST','/sales/orders',{'client_id':client['id'],'order_date':today,'currency':'USD','items':[{'product_id':product['id'],'description':'Synthetic fulfilled stock','quantity':'3','unit_price':'15.75'}]},201)
        op=f"/sales/orders/{order['id']}"
        fulfillment=call('POST',op+'/fulfillments',{'warehouse_id':warehouse['id'],'fulfillment_date':today,'items':[{'order_item_id':order['items'][0]['id'],'quantity':'3'}]},201)
        invoice=call('POST',f"/finance/invoices/from-order/{order['id']}",expected=201)
        assert invoice['status']=='draft' and Decimal(str(invoice['total']))==Decimal('47.25'),invoice
        call('PATCH',op+'/status',{'status':'in_progress'})
        completed=call('PATCH',op+'/status',{'status':'completed'})
        assert Decimal(str(completed['total']))==Decimal('47.25') and Decimal(str(completed['items'][0]['fulfilled_quantity']))==3
        invoice_before=call('GET',f"/finance/invoices/{invoice['id']}")
        stock_before=call('GET','/inventory/stock');fulfillments_before=call('GET',op+'/fulfillments')
        def preserved(stage):
            current=call('GET',op)
            assert current['items']==completed['items'] and current['total']==completed['total'],(stage,current)
            assert Decimal(str(current['items'][0]['fulfilled_quantity']))==3
            assert call('GET',f"/finance/invoices/{invoice['id']}")==invoice_before,stage
            assert call('GET',op+'/fulfillments')==fulfillments_before and call('GET','/inventory/stock')==stock_before,stage
        call('PATCH',op+'/status',{'status':'in_progress'});preserved('reopened')
        project=call('POST',f"/projects/from-order/{order['id']}",{'name':'Synthetic stock restoration project','project_manager_employee_id':eid},201)
        assert project['order_id']==order['id'];preserved('project created')
        call('PATCH',op+'/status',{'status':'completed'});preserved('restored')
        assert call('GET',op)['status']=='completed'
        print('PASS PRJ12 H-app+PG: fulfilled stock3,total47.25,exact items,posted fulfillment,stock balance and existing draft invoice unchanged through reopen/project-create/restore Completed')
    finally:
        http.close(); app.dependency_overrides.clear(); db.close(); outer.rollback(); connection.close()
    with SessionLocal() as check:
        assert check.scalar(select(func.count()).select_from(User).where(User.id==user_id))==0
        assert check.scalar(select(func.count()).select_from(Organization).where(Organization.id==org['id']))==0
    print('PASS outer rollback removed synthetic user and organization; all business records were HTTP-created')

def seed_pending_review(org_id):
    """Explicit local browser fixture only: no personal routes, mail or login.
    The browser owns and freshly created this synthetic organization. Seed a
    separate non-login subject and pending correction, then test only owner UI.
    """
    import json
    from datetime import datetime, timedelta, timezone
    from app.models.membership import Membership
    from app.models.team import Employee, OrganizationRole
    from app.models.hr_attendance import HRAttendanceRequest
    assert_local_test_database()
    with SessionLocal() as session:
        org=session.get(Organization,org_id)
        assert org and org.name.startswith('QC manager review '), 'Only dedicated fresh synthetic browser org'
        owner=session.get(User,org.created_by_user_id)
        assert owner.email=='qc-hr-project@example.com'
        role=session.scalar(select(OrganizationRole).where(OrganizationRole.organization_id==org_id,OrganizationRole.slug=='user'))
        assert role
        subject=User(email=f'qc-review-subject-{uuid4().hex}@example.invalid',full_name='Synthetic independent review subject',is_active=True,is_verified=True)
        session.add(subject);session.flush()
        membership=Membership(organization_id=org_id,user_id=subject.id,role_id=role.id,role='user',status='active')
        session.add(membership);session.flush()
        employee=Employee(organization_id=org_id,membership_id=membership.id,employee_code='QC-REVIEW-SUBJECT')
        session.add(employee);session.flush()
        start=(datetime.now(timezone.utc)-timedelta(days=1)).replace(hour=9,minute=0,second=0,microsecond=0)
        correction=HRAttendanceRequest(organization_id=org_id,employee_id=employee.id,work_date=start.date(),request_type='correction',reason='Synthetic direct fixture for independent owner review',proposed_check_in_at=start,proposed_check_out_at=start+timedelta(hours=8),status='pending')
        session.add(correction);session.flush()
        record_activity(session,action='qc.hr_pending_review.fixture',scope='tenant',organization_id=org_id,actor_type='system')
        result={'id':correction.id,'employee_id':employee.id,'work_date':str(start.date())}
        session.commit();print(json.dumps(result))

def verify_persisted_review(request_id):
    import json
    from app.models.hr_attendance import HRAttendanceRequest
    from app.models.hr import AttendanceRecord
    assert_local_test_database()
    with SessionLocal() as session:
        request=session.get(HRAttendanceRequest,request_id)
        assert request and request.reason=='Synthetic direct fixture for independent owner review'
        org=session.get(Organization,request.organization_id)
        record=session.scalar(select(AttendanceRecord).where(AttendanceRecord.organization_id==org.id,AttendanceRecord.employee_id==request.employee_id,AttendanceRecord.attendance_date==request.work_date))
        assert request.status=='approved' and request.reviewed_by_user_id==org.created_by_user_id
        assert record.work_minutes==480 and record.source=='correction' and record.verification_method=='hr_correction' and record.approved_by_user_id==org.created_by_user_id
        print(json.dumps({'status':request.status,'owner_reviewed':True,'work_minutes':record.work_minutes,'source':record.source,'verification_method':record.verification_method}))

def verify_mail_disabled():
    import json, socket, os
    assert_local_test_database()
    assert not settings.smtp_host.strip() and not settings.smtp_configured
    guarded=socket.socket.connect.__module__=='sitecustomize' and socket.socket.connect_ex.__module__=='sitecustomize'
    # Local QA requires its existing guard; portable CI has no SMTP transport
    # configured and account_email._send_message returns False before sockets.
    if 'no-network' in os.environ.get('PYTHONPATH',''):
        assert guarded
    print(json.dumps({'environment':'test','loopback_database':True,'smtp_host_empty':True,'email_delivery_disabled':True,'outbound_socket_guard':guarded}))

if __name__=='__main__':
    import sys
    if len(sys.argv)==3 and sys.argv[1]=='--seed-pending-review':seed_pending_review(sys.argv[2])
    elif len(sys.argv)==3 and sys.argv[1]=='--verify-persisted-review':verify_persisted_review(sys.argv[2])
    elif len(sys.argv)==2 and sys.argv[1]=='--verify-mail-disabled':verify_mail_disabled()
    else:main()
