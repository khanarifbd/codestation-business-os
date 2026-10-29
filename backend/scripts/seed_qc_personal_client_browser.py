"""Local dedicated QC database fixture; no external providers or business API mocks."""
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
from app.models.team import Employee, OrganizationRole
from app.models.crm import Client
from app.models.client_access import ClientMembership
from app.models.finance import Invoice
from app.models.sales import Quotation
from app.models.orders import Order
from app.models.projects import Project, ProjectMilestone
from app.models.hr import PerformanceReview
from app.services.activity_log import record_activity


import json, os
from app.core.security import hash_password
def assert_browser_fixture_target():
    """Retain the dedicated local target; admit only the explicit disposable CI target."""
    assert settings.environment == 'test', 'Explicit test environment required'
    assert engine.url.get_backend_name() == 'postgresql', 'PostgreSQL fixture required'
    assert engine.url.host in {'127.0.0.1', 'localhost'}, 'Loopback database required'
    local_target = engine.url.port == 55433 and engine.url.database == 'business_os_qc_expanded20261022'
    ci_target = (
        os.environ.get('GITHUB_ACTIONS') == 'true'
        and os.environ.get('QC_BROWSER_FIXTURE') == '1'
        and engine.url.port == 5432
        and engine.url.database == 'codestation_business_os'
    )
    assert local_target or ci_target, 'Only dedicated local QC or explicitly opted-in disposable CI database is permitted'
    assert not settings.smtp_host.strip() and not settings.smtp_configured, 'Mail must remain disabled'


def main():
    assert_browser_fixture_target()
    assert not app.dependency_overrides
    fixture_path = os.environ.get('BROWSER_FIXTURE', '').strip()
    assert fixture_path, 'BROWSER_FIXTURE output path is required before creating synthetic records'
    password='E2E-Launch-Password-123!'
    db=SessionLocal(); http=TestClient(app); headers={}
    def call(method,path,payload=None,expected=200):
        r=http.request(method,'/api/v1'+path,headers=headers,json=payload)
        assert r.status_code==expected,(path,r.status_code,r.text)
        return r.json()
    def persist(*rows):
        db.add_all(rows);db.flush();record_activity(db,action='qc.browser.fixture',scope='system',actor_type='system');db.commit()
    try:
        owner = User(email=f'personal-qc-{uuid4().hex}@example.com',full_name='Synthetic owner',password_hash=hash_password(password),is_active=True,is_verified=True)
        persist(owner)
        headers['Authorization']='Bearer '+create_access_token(owner.id, int(owner.auth_token_version or 0))
        org = call('POST','/organizations',{'name':'Expanded portal QC '+uuid4().hex[:8],'currency':'USD','country_code':'US','timezone':'UTC'},201)['organization']
        oid=org['id']; headers['X-Organization-ID']=oid
        owner_eid=call('GET','/hr/people')['people'][0]['id']
        employee_user=User(email=f'employee-browser-{uuid4().hex}@example.com',full_name='Synthetic standard employee',password_hash=hash_password(password),is_active=True,is_verified=True);persist(employee_user)
        employee_role=db.scalar(select(OrganizationRole).where(OrganizationRole.organization_id==oid,OrganizationRole.slug=='user'))
        assert set(employee_role.permissions)=={'dashboard.view','projects.work','hr.self'}
        employee_membership=Membership(organization_id=oid,user_id=employee_user.id,role_id=employee_role.id,role='user',status='active');persist(employee_membership)
        employee=Employee(organization_id=oid,membership_id=employee_membership.id,employee_code='BROWSER-EMPLOYEE',employment_status='active');persist(employee)
        eid=employee.id
        linked=Client(organization_id=oid,client_code='LINKED',display_name='Visible customer',currency='USD')
        other=Client(organization_id=oid,client_code='OTHER',display_name='Hidden customer',currency='USD');persist(linked,other)
        q=Quotation(organization_id=oid,quotation_number='Q-EXP',client_id=linked.id,created_by_user_id=owner.id,status='sent',issue_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot='Visible',total=100)
        persist(q)
        order=Order(organization_id=oid,order_number='O-EXP',quotation_id=q.id,client_id=linked.id,created_by_user_id=owner.id,status='confirmed',order_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot='Visible',total=100);persist(order)
        project=Project(organization_id=oid,project_number='P-EXP',order_id=order.id,client_id=linked.id,created_by_user_id=owner.id,project_manager_employee_id=owner_eid,name='Personal test project',status='active',currency='USD',contract_value=100);persist(project)
        # Match normal project creation's team invariant: the manager is also a member.
        # Direct ORM project fixtures must not bypass the normal team synchronization.
        team=call('PUT',f'/projects/{project.id}/team',{'project_manager_employee_id':owner_eid,'member_employee_ids':[eid]})
        assert {m['employee_id'] for m in team['members']} == {owner_eid,eid}
        assert next(m for m in team['members'] if m['employee_id']==owner_eid)['role_label']=='Project Manager'
        print('PASS normal team synchronization includes manager and standard employee')
        task=call('POST',f'/projects/{project.id}/tasks',{'title':'Assigned personal task','assignee_employee_id':eid,'due_date':str(date.today()-timedelta(days=1))},201)
        tasks=[task]
        for status,percent in [('in_progress',30),('blocked',20),('review',90)]:
            row=call('POST',f'/projects/{project.id}/tasks',{'title':'Board '+status,'assignee_employee_id':eid},201)
            call('POST',f"/projects/{project.id}/tasks/{row['id']}/progress",{'progress_percent':percent,'status':status,'note':'Board fixture status'})
            tasks.append(row)
        role=OrganizationRole(organization_id=oid,name='Portal only',slug='portal-qc',permissions=[],is_active=True)
        customer=User(email=f'customer-qc-{uuid4().hex}@example.com',full_name='Synthetic customer',password_hash=hash_password(password),is_active=True,is_verified=True);persist(role,customer)
        member=Membership(organization_id=oid,user_id=customer.id,role_id=role.id,role='user',status='active');persist(member)
        access=ClientMembership(organization_id=oid,client_id=linked.id,membership_id=member.id,created_by_user_id=owner.id,status='active');persist(access)
        public=ProjectMilestone(organization_id=oid,project_id=project.id,title='Public update',client_visible=True,created_by_user_id=owner.id)
        private=ProjectMilestone(organization_id=oid,project_id=project.id,title='Private update',client_visible=False,created_by_user_id=owner.id);persist(public,private)
        invoices=[]
        for number,status,client in [('INV-SENT','sent',linked),('INV-DRAFT','draft',linked),('INV-CANCELLED','cancelled',linked),('INV-OTHER','sent',other)]:
            invoice=Invoice(organization_id=oid,invoice_number=number,client_id=client.id,project_id=project.id if client==linked else None,created_by_user_id=owner.id,status=status,issue_date=date.today(),currency='USD',seller_name_snapshot='Test',client_name_snapshot=client.display_name,total=100,balance_due=100)
            persist(invoice);invoices.append(invoice)
        office=call('POST','/hr/attendance/offices',{'name':'Browser office','latitude':0,'longitude':0,'radius_meters':100},201)
        call('PUT',f'/hr/attendance/policies/{eid}',{'office_id':office['id'],'weekly_modes':['office']*7})
        persist(PerformanceReview(organization_id=oid,employee_id=eid,period_start=date.today()-timedelta(days=30),period_end=date.today(),status='completed',self_review='Locked browser review original'))
        result={'owner_email' :owner.email,'employee_email':employee_user.email,'customer_email':customer.email,'password':password,'organization_id':oid,'project_id':project.id,'quotation_id':q.id,'order_id':order.id,'task_id':task['id'],'tasks':tasks,'invoice_id':invoices[0].id}
        # Exercise the real credential/response path before calling this a browser fixture.
        # Reserved .invalid domains are rejected by UserRead EmailStr even when ORM insertion succeeds.
        login_tokens = {}
        for actor in (owner, employee_user, customer):
            response = http.post('/api/v1/auth/login', json={'identifier': actor.email, 'password': password})
            assert response.status_code == 200, ('fixture login', response.status_code)
            payload = response.json()
            assert payload['user']['id'] == actor.id and payload['user']['email'] == actor.email
            login_tokens[actor.id] = payload['access_token']
            me = http.get('/api/v1/auth/me', headers={'Authorization': 'Bearer ' + payload['access_token']})
            assert me.status_code == 200 and me.json()['id'] == actor.id
        print('PASS normal owner/employee/customer login and serialized identity responses')
        employee_headers={'Authorization':'Bearer '+login_tokens[employee_user.id],'X-Organization-ID':oid}
        for path in ['/workspace/me','/hr/self/home']:
            r=http.get('/api/v1'+path,headers=employee_headers);assert r.status_code==200,(path,r.text)
        for path in ['/hr/people','/hr/attendance/requests']:
            r=http.get('/api/v1'+path,headers=employee_headers);assert r.status_code==403,(path,r.text)
        r=http.get('/api/v1/workspace/me',headers=employee_headers)
        assert len(r.json()['tasks'])==4
        print('PASS standard non-admin employee workspace/self-service access and manager endpoint denial')
        with open(fixture_path,'w') as f:json.dump(result,f)
        print('Created isolated synthetic persistent browser fixtures')
    finally:
        http.close();db.close()
if __name__=='__main__':main()
