"""Isolated rollback-only PostgreSQL/registered-HTTP portal and personal QC.
Browser search/board rendering is deliberately not claimed by this API verifier.
"""
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.user import User
from app.models.membership import Membership
from app.models.team import OrganizationRole, Employee
from app.models.crm import Client
from app.models.client_access import ClientMembership
from app.models.payroll import PayrollRun, PayrollEntry
from app.models.finance import Invoice
from app.models.sales import Quotation
from app.models.orders import Order
from app.models.projects import Project, ProjectMilestone, ProjectMember
from app.models.hr import PerformanceReview, HRAnnouncement, AttendanceRecord
from app.services.activity_log import record_activity


def main():
    assert settings.environment == 'test'
    assert engine.url.get_backend_name() == 'postgresql' and engine.url.host in {'127.0.0.1','localhost','::1'}
    assert (engine.url.database or '').startswith('business_os_qc')
    assert not app.dependency_overrides
    connection = engine.connect(); outer = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode='create_savepoint')
    def local_db():
        with SessionLocal(bind=connection, join_transaction_mode='create_savepoint') as session:
            yield session
    app.dependency_overrides[get_db] = local_db
    http = TestClient(app); headers = {}
    def call(method,path,payload=None,expected=200,custom=None):
        response = http.request(method,'/api/v1'+path,headers=headers if custom is None else custom,json=payload)
        assert response.status_code == expected, (method,path,response.status_code,response.text)
        return response.json() if response.content else None
    def persist(*rows):
        db.add_all(rows); db.flush(); record_activity(db, action='qc.portal.fixture',scope='system',actor_type='system'); db.commit()
    try:
        owner = User(email=f'personal-qc-{uuid4().hex}@example.invalid',full_name='Synthetic owner',is_active=True,is_verified=True)
        persist(owner)
        headers['Authorization']='Bearer '+create_access_token(owner.id, int(owner.auth_token_version or 0))
        org = call('POST','/organizations',{'name':'Expanded portal QC '+uuid4().hex[:8],'currency':'USD','country_code':'US','timezone':'UTC'},201)['organization']
        oid=org['id']; headers['X-Organization-ID']=oid
        owner_eid=call('GET','/hr/people')['people'][0]['id']
        employee_role=db.scalar(select(OrganizationRole).where(OrganizationRole.organization_id==oid,OrganizationRole.slug=='user'))
        assert employee_role and set(employee_role.permissions)=={'dashboard.view','projects.work','hr.self'}
        staff=User(email=f'staff-qc-{uuid4().hex}@example.invalid',full_name='Non-admin employee',is_active=True,is_verified=True);persist(staff)
        staff_member=Membership(organization_id=oid,user_id=staff.id,role_id=employee_role.id,role='user',status='active');persist(staff_member)
        staff_employee=Employee(organization_id=oid,membership_id=staff_member.id,employee_code='EMP-QC-NONADMIN',employment_status='active');persist(staff_employee)
        eid=staff_employee.id
        staff_headers={'Authorization':'Bearer '+create_access_token(staff.id,int(staff.auth_token_version or 0)),'X-Organization-ID':oid}
        def personal(method,path,payload=None,expected=200):return call(method,path,payload,expected,staff_headers)
        for path in ['/hr/people','/hr/attendance/requests','/hr/attendance/policies']:
            personal('GET',path,expected=403)
        personal('POST','/hr/attendance/offices',{'name':'Forbidden','latitude':0,'longitude':0},403)
        linked=Client(organization_id=oid,client_code='LINKED',display_name='Visible customer',currency='USD')
        other=Client(organization_id=oid,client_code='OTHER',display_name='Hidden customer',currency='USD');persist(linked,other)
        q=Quotation(organization_id=oid,quotation_number='Q-EXP',client_id=linked.id,created_by_user_id=owner.id,status='sent',issue_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot='Visible',total=100)
        persist(q)
        order=Order(organization_id=oid,order_number='O-EXP',quotation_id=q.id,client_id=linked.id,created_by_user_id=owner.id,status='confirmed',order_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot='Visible',total=100);persist(order)
        project=Project(organization_id=oid,project_number='P-EXP',order_id=order.id,client_id=linked.id,created_by_user_id=owner.id,project_manager_employee_id=owner_eid,name='Personal test project',status='active',currency='USD',contract_value=100);persist(project)
        persist(ProjectMember(organization_id=oid,project_id=project.id,employee_id=eid,added_by_user_id=owner.id),ProjectMember(organization_id=oid,project_id=project.id,employee_id=owner_eid,added_by_user_id=owner.id))
        milestone=call('POST',f'/projects/{project.id}/milestones',{'title':'Personal task milestone'},201)
        task_fields={'title':'Assigned personal task','assignee_employee_id':eid,'milestone_id':milestone['id'],'planned_start_date':str(date.today()-timedelta(days=3)),'due_date':str(date.today()-timedelta(days=1)),'estimated_minutes':135}
        task=call('POST',f'/projects/{project.id}/tasks',task_fields,201)
        workspace=personal('GET','/workspace/me')
        personal_task=next(t for t in workspace['tasks'] if t['id']==task['id'])
        for field in ('milestone_id','planned_start_date','due_date','estimated_minutes'):
            assert personal_task[field]==task_fields[field],(field,personal_task)
        assert personal_task['milestone_title']=='Personal task milestone'
        assert workspace['summary']['overdue_tasks']==1
        alerts=personal('GET','/workspace/notifications')
        assert any(item['href']==f"/dashboard/my-work?task={task['id']}" for item in alerts['items']),alerts
        assert personal('GET',f"/workspace/tasks/{task['id']}")['task']['id']==task['id']
        print('PASS MW01 + NT03 HTTP assignment, overdue count, notification task identity and deep-link target data')
        progress=f"/projects/{project.id}/tasks/{task['id']}/progress"
        personal('POST',progress,{'progress_percent':101,'note':'Invalid high'},422)
        personal('POST',progress,{'progress_percent':40,'status':'completed','note':'Invalid complete'},400)
        completed=personal('POST',progress,{'progress_percent':100,'note':'Complete work'})
        assert completed['status']=='completed' and completed['completed_at']
        assert not personal('GET','/workspace/me')['tasks']
        assert not personal('GET','/workspace/notifications')['items']
        reopened=personal('POST',progress,{'progress_percent':60,'note':'Additional work identified'})
        assert reopened['status']=='in_progress' and reopened['completed_at'] is None,reopened
        assert personal('GET','/workspace/me')['summary']['assigned_tasks']==1
        print('PASS MW04/MW05 progress bounds, completion removal, reopening consistency')
        office=call('POST','/hr/attendance/offices',{'name':'Test office','latitude':0,'longitude':0,'radius_meters':100},201)
        call('PUT',f'/hr/attendance/policies/{eid}',{'office_id':office['id'],'weekly_modes':['office']*7})
        tomorrow=date.today()+timedelta(days=1)
        remote={'request_type':'mode','work_date':str(tomorrow),'reason':'Synthetic remote request'}
        remote_row=personal('POST','/hr/self/attendance-requests',remote,201)
        assert remote_row['status']=='pending'
        personal('POST','/hr/self/attendance-requests',remote,409)
        assert remote_row['id'] in str(call('GET','/hr/attendance/requests'))
        print('PASS HR08 self remote request reaches manager queue and duplicate rejected')
        yesterday=date.today()-timedelta(days=1)
        # Nontrivial unchanged-state baseline: an existing absence for the correction
        # date, a prior worked day, and a generated payroll run with a nonzero entry.
        persist(AttendanceRecord(organization_id=oid,employee_id=eid,attendance_date=yesterday,status='absent',work_minutes=0,source='manual',notes='Awaiting approved correction'),
                AttendanceRecord(organization_id=oid,employee_id=eid,attendance_date=yesterday-timedelta(days=1),status='present',work_minutes=437,overtime_minutes=17,source='manual'))
        month_start=date.today().replace(day=1)
        next_month=(month_start.replace(day=28)+timedelta(days=4)).replace(day=1)
        month_end=next_month-timedelta(days=1)
        call('POST','/payroll/salary-profiles',{'employee_id':eid,'currency':'USD','base_salary':'1234.50','effective_from':str(month_start)},201)
        period=call('POST','/payroll/periods',{'name':'Correction unchanged payroll','period_start':str(month_start),'period_end':str(month_end),'pay_date':str(month_end)},201)
        payroll=call('POST','/payroll/runs',{'period_id':period['id'],'currency':'USD'},201)
        assert len(payroll['entries'])==1 and float(payroll['net_total'])>0
        def protected_state():
            return {model.__tablename__: [dict(row) for row in db.execute(select(model.__table__).where(model.organization_id==oid).order_by(model.id)).mappings()]
                    for model in (AttendanceRecord,PayrollRun,PayrollEntry)}
        before_correction=protected_state()
        correction={'request_type':'correction','work_date':str(yesterday),'reason':'Missed check in correction','proposed_check_in_at':f'{yesterday}T09:00:00+00:00','proposed_check_out_at':f'{yesterday}T17:00:00+00:00'}
        personal('POST','/hr/self/attendance-requests',{**correction,'proposed_check_out_at':f'{yesterday}T08:00:00+00:00'},400)
        correction_row=personal('POST','/hr/self/attendance-requests',correction,201)
        personal('POST','/hr/self/attendance-requests',correction,409)
        assert correction_row['status']=='pending',correction_row
        request_queue=call('GET','/hr/attendance/requests')
        assert any(row['id']==correction_row['id'] and row['status']=='pending' for row in request_queue)
        assert protected_state()==before_correction, 'Pending or rejected correction mutated attendance/payroll rows'
        assert call('GET',f"/payroll/runs/{payroll['id']}")==payroll, 'Payroll HTTP state changed before approval'
        print('PASS HR26 invalid correction rejected; pending status verified in response and manager queue; existing attendance absence/worked-day and nonzero payroll run/entry unchanged before approval')
        review=PerformanceReview(organization_id=oid,employee_id=eid,period_start=yesterday,period_end=date.today(),status='draft',self_review='Original');persist(review)
        personal('PATCH',f'/hr/self/performance/{review.id}',{'self_review':'Locked original'})
        db.refresh(review); assert review.self_review=='Locked original'
        call('PATCH',f'/hr/performance/{review.id}',{'rating':6,'status':'completed'},422)
        db.refresh(review);assert review.status=='draft'
        call('PATCH',f'/hr/performance/{review.id}',{'rating':4,'manager_review':'Manager approved feedback','status':'completed'})
        persisted_review=next(row for row in call('GET','/hr/performance') if row['id']==review.id)
        assert persisted_review['status']=='completed' and float(persisted_review['rating'])==4
        assert persisted_review['self_review']=='Locked original' and persisted_review['manager_review']=='Manager approved feedback'
        print('PASS HR12 rating6 rejected; employee self-review, manager feedback/rating4 and completion persisted via HTTP readback')
        personal('PATCH',f'/hr/self/performance/{review.id}',{'self_review':'Unexpected mutation'},409)
        db.refresh(review); assert review.self_review=='Locked original'
        print('PASS HR27 completed self review lock preserves original')
        other_review=PerformanceReview(organization_id=oid,employee_id=owner_eid,period_start=yesterday,period_end=date.today(),status='draft',self_review='Owner private');persist(other_review)
        personal('PATCH',f'/hr/self/performance/{other_review.id}',{'self_review':'Cross employee mutation'},404)
        owner_task=call('POST',f'/projects/{project.id}/tasks',{'title':'Owner private task','assignee_employee_id':owner_eid},201)
        personal('GET',f"/workspace/tasks/{owner_task['id']}",expected=404)
        personal('POST',f"/projects/{project.id}/tasks/{owner_task['id']}/progress",{'progress_percent':20,'note':'Not assigned to me'},403)
        personal('POST',f'/projects/{project.id}/tasks',{'title':'Forbidden manager operation'},403)
        personal('POST',f"/hr/attendance/requests/{remote_row['id']}/review",{'status':'approved'},403)
        policy_id=call('POST','/hr/announcements',{'title':'Published staff policy','body':'Synthetic policy','is_policy':True,'publish_now':True},201)['id']
        assert personal('GET','/hr/self/home')['policies_to_acknowledge']==1
        personal('POST',f'/hr/self/announcements/{policy_id}/acknowledge')
        personal('POST',f'/hr/self/announcements/{policy_id}/acknowledge')
        assert personal('GET','/hr/self/home')['policies_to_acknowledge']==0
        acknowledgements=call('GET',f'/hr/announcements/{policy_id}/acknowledgements')
        assert acknowledgements['count']==1 and acknowledgements['items'][0]['employee_id']==eid
        personal('GET',f'/hr/announcements/{policy_id}/acknowledgements',expected=403)
        print('PASS HR13 owner-published policy employee unread1 to0; idempotent acknowledgement verified in owner readback')
        print('PASS genuine default-role employee: own task/worklog + HR self-service; other employee task/review and manager actions denied; policy acknowledgement idempotent with owner readback')
        role=OrganizationRole(organization_id=oid,name='Portal only',slug='portal-qc',permissions=[],is_active=True)
        customer=User(email=f'customer-qc-{uuid4().hex}@example.invalid',full_name='Synthetic customer',is_active=True,is_verified=True);persist(role,customer)
        member=Membership(organization_id=oid,user_id=customer.id,role_id=role.id,role='user',status='active');persist(member)
        access=ClientMembership(organization_id=oid,client_id=linked.id,membership_id=member.id,created_by_user_id=owner.id,status='active');persist(access)
        public=ProjectMilestone(organization_id=oid,project_id=project.id,title='Public update',client_visible=True,created_by_user_id=owner.id)
        private=ProjectMilestone(organization_id=oid,project_id=project.id,title='Private update',client_visible=False,created_by_user_id=owner.id);persist(public,private)
        customer_headers={'Authorization':'Bearer '+create_access_token(customer.id,int(customer.auth_token_version or 0)),'X-Organization-ID':oid}
        def portal(method,path,payload=None,expected=200):return call(method,path,payload,expected,customer_headers)
        for path in ['/hr/people','/workspace/me',f'/projects/{project.id}/workspace']:
            portal('GET',path,expected=403)
        foreign_org=call('POST','/organizations',{'name':'Other tenant '+uuid4().hex[:8],'currency':'USD','country_code':'US','timezone':'UTC'},201)['organization']
        call('GET','/client-portal/context',expected=404,custom={**customer_headers,'X-Organization-ID':foreign_org['id']})
        hidden_q=Quotation(organization_id=oid,quotation_number='Q-OTHER',client_id=other.id,created_by_user_id=owner.id,status='sent',issue_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot='Hidden',total=900)
        persist(hidden_q)
        hidden_order=Order(organization_id=oid,order_number='O-OTHER',quotation_id=hidden_q.id,client_id=other.id,created_by_user_id=owner.id,status='confirmed',order_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot='Hidden',total=900);persist(hidden_order)
        hidden_project=Project(organization_id=oid,project_number='P-OTHER',order_id=hidden_order.id,client_id=other.id,created_by_user_id=owner.id,name='Other client private project',status='active',currency='USD',contract_value=900);persist(hidden_project)
        portal('GET',f'/client-portal/orders/{hidden_order.id}',expected=404)
        portal('GET',f'/client-portal/projects/{hidden_project.id}',expected=404)
        assert hidden_order.id not in [row['id'] for row in portal('GET','/client-portal/orders')]
        assert hidden_project.id not in [row['id'] for row in portal('GET','/client-portal/projects')]
        reject_quote=Quotation(organization_id=oid,quotation_number='Q-REJECT-FIRST',client_id=linked.id,created_by_user_id=owner.id,status='sent',issue_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot='Visible',total=50);persist(reject_quote)
        rejected=portal('POST',f'/client-portal/quotations/{reject_quote.id}/decision',{'status':'rejected','reason':'Synthetic client rejection'})
        assert rejected['status']=='rejected' and rejected['rejected_at'] is not None
        db.refresh(reject_quote);assert reject_quote.status=='rejected' and reject_quote.rejected_at is not None
        portal('POST',f'/client-portal/quotations/{reject_quote.id}/decision',{'status':'accepted'},409)
        print('PASS CP04 real other-client order/project IDs blocked and omitted; CP05 reject-first quotation propagates and blocks reversal')
        portal('GET',f'/client-portal/quotations/{hidden_q.id}',expected=404)
        portal('POST',f'/client-portal/quotations/{hidden_q.id}/decision',{'status':'accepted'},404)
        invoices=[]
        for number,status,client in [('INV-SENT','sent',linked),('INV-DRAFT','draft',linked),('INV-CANCELLED','cancelled',linked),('INV-OTHER','sent',other)]:
            invoice=Invoice(organization_id=oid,invoice_number=number,client_id=client.id,project_id=project.id if client==linked else None,created_by_user_id=owner.id,status=status,issue_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot=client.display_name,total=100,balance_due=100)
            persist(invoice);invoices.append(invoice)
        assert [i['id'] for i in portal('GET','/client-portal/invoices')]==[invoices[0].id]
        assert portal('GET',f'/client-portal/invoices/{invoices[0].id}')['project_id']==project.id
        for invoice in invoices[1:]:portal('GET',f'/client-portal/invoices/{invoice.id}',expected=404)
        context=portal('GET','/client-portal/context'); assert [c['id'] for c in context['clients']]==[linked.id]
        assert context['financials'][0]['invoice_count']==1 and float(context['financials'][0]['balance_due'])==100
        detail=portal('GET',f'/client-portal/projects/{project.id}');assert [m['id'] for m in detail['milestones']]==[public.id]
        assert portal('GET',f'/client-portal/orders/{order.id}')['id']==order.id
        portal('POST',f'/client-portal/quotations/{q.id}/decision',{'status':'accepted'})
        db.refresh(q);assert q.status=='accepted'
        portal('POST',f'/client-portal/quotations/{q.id}/decision',{'status':'rejected'},409)
        portal('GET',f'/client-portal/projects/{uuid4()}',expected=404)
        print('PASS portal cross-tenant header blocked; other-client quotation read/write blocked; draft/cancelled/other-client invoices hidden; financial context reconciles visible invoice')
        member.status='suspended';persist(member)
        portal('GET','/client-portal/context',expected=404)
        member.status='active';persist(member)
        access.status='inactive';persist(access)
        portal('GET','/client-portal/context',expected=403)
        print('PASS client portal role separation, relationship scope, internal milestone suppression, order/quotation visibility, decision propagation/replay guard and access revocation')
        print('GAP MW02/MW03: search and board are client-side presentation; no browser sign-off asserted')
    finally:
        http.close();app.dependency_overrides.clear();db.close();outer.rollback();connection.close()
    print('PASS expanded portal/personal HTTP PostgreSQL regression; all synthetic changes rolled back')

if __name__=='__main__':main()
