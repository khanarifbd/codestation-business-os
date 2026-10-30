"""Disposable CI HR/Payroll records for GET-only browser coverage.
No identities, invitations, external providers, uploads or credentials are created.
All financial fixtures use existing service handlers, never hand-written ledger rows.
"""
from datetime import date, timedelta, time
from decimal import Decimal
from typing import TypedDict
from uuid import uuid4
from sqlalchemy import select
from app.models.team import Employee
from app.models.user import User
from app.api.v1 import hr, hr_attendance, payroll
from app.models.finance import FinancialAccount
from app.schemas.payroll import (SalaryProfileCreate, PayrollPeriodCreate, PayrollRunCreate,
    PayrollEntryUpdate, PayrollWithholdingPaymentCreate)
from app.services.accounting_integrity_audit import audit_organization_accounting
from scripts.seed_admin_readonly_financial import assert_financial_fixture_target, _require


class HRRegistry(TypedDict):
    typed_ids: dict[str, str]
    route_overrides: dict[str, str]
    route_contracts: dict[str, dict]
    accounting_integrity: bool
    synthetic_seed_states: dict[str, str]


def _field(value, name):
    return value[name] if isinstance(value, dict) else getattr(value, name)


def seed_hr(db, tenant, request_factory, fixture_date: date, shared_ids=None) -> HRRegistry:
    # Shared strict actual-engine, loopback, environment, SMTP and owner gate runs FIRST.
    assert_financial_fixture_target(db, tenant)
    _require(type(fixture_date) is date, 'Explicit calendar fixture date required')
    _require(getattr(tenant.organization, 'timezone', None) == 'UTC', 'Dedicated UTC fixture organization required')
    _require(fixture_date == date.today(), 'Attendance fixture requires the current UTC CI date')
    employee = db.scalar(select(Employee).where(Employee.organization_id == tenant.organization_id,
                                               Employee.membership_id == tenant.membership_id))
    _require(employee is not None and employee.employment_status == 'active', 'Existing active owner employee required')
    owner = db.get(User, tenant.user_id)
    _require(owner is not None and bool(owner.full_name), 'Fixture owner display name required')
    account_id = (shared_ids or {}).get('account_id')
    _require(bool(account_id), 'Previously service-funded fixture account required')
    account = db.get(FinancialAccount, account_id)
    _require(account is not None and account.organization_id == tenant.organization_id
             and account.currency == 'USD' and account.is_active and account.account_type != 'credit_card',
             'Matching active USD fixture account required')
    marker = uuid4().hex[:8]
    names = {'owner': owner.full_name, 'office': f'Synthetic sweep office {marker}',
             'document': f'Synthetic metadata-only document {marker}', 'event': f'Synthetic confirmation {marker}',
             'job': f'Synthetic sweep job {marker}', 'candidate': f'Synthetic sweep candidate {marker}',
             'period': f'Synthetic draft period {marker}'}

    def call(fn, *args, path, method='POST'):
        if not db.in_transaction():
            db.begin()
        return fn(*args, request_factory(method, path), db, tenant)

    eid = employee.id
    shift = call(hr.create_shift, hr.ShiftCreate(name=f'Synthetic sweep shift {marker}',
        start_time=time(9), end_time=time(17), weekly_off_days=[5, 6]), path='/hr/shifts')
    call(hr.assign_shift, hr.ShiftAssign(employee_id=eid, shift_id=_field(shift, 'id'),
        effective_from=fixture_date), path='/hr/shift-assignments')
    attendance = call(hr.create_attendance, hr.AttendanceCreate(employee_id=eid,
        attendance_date=fixture_date, work_minutes=480), path='/hr/attendance')
    leave_type = call(hr.create_leave_type, hr.LeaveTypeCreate(name=f'Synthetic leave {marker}',
        code='RO'+marker[:6], annual_allowance_days=Decimal('12')), path='/hr/leave-types')
    leave = call(hr.create_leave_request, hr.LeaveRequestCreate(employee_id=eid,
        leave_type_id=_field(leave_type, 'id'), start_date=fixture_date+timedelta(days=7),
        end_date=fixture_date+timedelta(days=7), reason='Synthetic read-only pending review'), path='/hr/leave-requests')
    document = call(hr.create_document, hr.DocumentCreate(employee_id=eid, title=names['document'],
        document_type='other', notes='Synthetic metadata only; no file uploaded'), path='/hr/documents')
    event = call(hr.create_lifecycle, hr.LifecycleCreate(employee_id=eid, event_type='confirmation',
        effective_date=fixture_date, title=names['event']), path='/hr/lifecycle')
    office = call(hr_attendance.create_office, hr_attendance.OfficePayload(name=names['office'],
        latitude=0, longitude=0, radius_meters=100), path='/hr/attendance/offices')
    call(hr_attendance.upsert_policy, eid, hr_attendance.PolicyPayload(office_id=office['id'],
        weekly_modes=['office']*7), path=f'/hr/attendance/policies/{eid}', method='PUT')
    exception = call(hr_attendance.create_request, hr_attendance.AttendanceRequestCreate(request_type='mode',
        work_date=fixture_date+timedelta(days=1), reason='Synthetic remote request for read-only review'),
        path='/hr/attendance/requests')
    job = call(hr.create_job, hr.JobCreate(title=names['job'], location='Synthetic office'), path='/hr/jobs')
    candidate = call(hr.create_candidate, hr.CandidateCreate(job_opening_id=_field(job, 'id'),
        full_name=names['candidate'], email=f'readonly-{marker}@example.invalid'), path='/hr/candidates')
    first = fixture_date.replace(day=1)
    next_month = (first.replace(day=28)+timedelta(days=4)).replace(day=1)
    following = (next_month.replace(day=28)+timedelta(days=4)).replace(day=1)
    profile = call(payroll.create_salary_profile, SalaryProfileCreate(employee_id=eid, currency='USD',
        base_salary=Decimal('100'), effective_from=first, notes='Synthetic CI salary, not real payroll'),
        path='/payroll/salary-profiles')
    period = call(payroll.create_period, PayrollPeriodCreate(name=names['period'], period_start=first,
        period_end=next_month-timedelta(days=1), pay_date=next_month-timedelta(days=1)), path='/payroll/periods')
    draft = call(payroll.create_run, PayrollRunCreate(period_id=_field(period, 'id'), currency='USD'), path='/payroll/runs')
    _require(_field(draft, 'status') == 'draft' and len(_field(draft, 'entries')) == 1, 'Exactly one synthetic draft entry required')
    approved_period = call(payroll.create_period, PayrollPeriodCreate(name=f'Synthetic approved period {marker}',
        period_start=next_month, period_end=following-timedelta(days=1), pay_date=following-timedelta(days=1)), path='/payroll/periods')
    approved = call(payroll.create_run, PayrollRunCreate(period_id=_field(approved_period, 'id'), currency='USD'), path='/payroll/runs')
    approved_id = _field(approved, 'id')
    _require(len(_field(approved, 'entries')) == 1, 'Exactly one approval fixture entry required')
    call(payroll.update_entry, approved_id, _field(_field(approved, 'entries')[0], 'id'),
        PayrollEntryUpdate(tax_amount=Decimal('2'), adjustment_reason='Synthetic withholding fixture'),
        path=f'/payroll/runs/{approved_id}/entries/{_field(_field(approved, "entries")[0], "id")}', method='PATCH')
    approved = call(payroll.approve_run, approved_id, path=f'/payroll/runs/{approved_id}/approve')
    _require(_field(approved, 'status') == 'approved', 'Approved synthetic run required for read-only pay page')
    payment = call(payroll.pay_payroll_withholding, PayrollWithholdingPaymentCreate(account_id=account.id,
        payment_date=following-timedelta(days=1), amount=Decimal('1'), reference=f'SYNTHETIC-RO-{marker}',
        notes='Disposable CI withholding fixture, no external payment'), path='/payroll/withholdings/payments')
    _require(audit_organization_accounting(db, tenant.organization_id).ok, 'Synthetic payroll ledger integrity failed')
    ids = {'personId': eid, 'employeeId': eid, 'officeId':office['id'], 'requestId':_field(exception,'id'),
        'attendanceId':_field(attendance,'id'), 'leaveId':_field(leave,'id'), 'documentId':_field(document,'id'),
        'eventId':_field(event,'id'), 'jobId':_field(job,'id'), 'candidateId':_field(candidate,'id'),
        'profileId':_field(profile,'id'), 'periodId':_field(period,'id'), 'runId':_field(draft,'id'),
        'entryId':_field(_field(draft,'entries')[0],'id'), 'approvedRunId':approved_id,
        'paymentId':_field(payment,'id')}
    names['organization'] = tenant.organization.name
    names['payment'] = _field(payment,'account_name')
    contracts, overrides = hr_route_contracts(ids, names)
    return {'typed_ids':ids, 'route_overrides':overrides, 'route_contracts':contracts,
            'accounting_integrity':True, 'synthetic_seed_states':{'runId':'draft','approvedRunId':'approved',
            'paymentId':'synthetic internal withholding posting','documentId':'metadata only, no file'}}


def hr_route_contracts(ids, names):
    """One explicit rendered mode per manifest pattern; variants are NOT inferred covered."""
    contracts, overrides = {}, {}
    def add(pattern, heading, source, gets=(), texts=(), url=None, button=None):
        actual = url or pattern
        for key, value in ids.items():
            actual = actual.replace('['+key+']', value)
        _require('[' not in actual, 'Unresolved HR route placeholder')
        contracts[pattern] = {'heading':heading, 'ready_text':list(texts),
            'expected_get_paths':list(gets), 'source':source if source.startswith('frontend/') else 'frontend/src/components/'+source,
            'expected_mode':'ready'}
        if button: contracts[pattern]['ready_button']=button
        overrides[pattern]=actual
    h='/dashboard/hr'; p='/dashboard/payroll'
    add(h,'People & HR','hr-time/hr-overview.tsx',('/api/hr/workspace-summary',),('Needs attention',))
    people='people/people-workspace.tsx'
    for suffix,title,texts in [('/people','People',(names['owner'],)),('/people/[personId]',names['owner'],('Work & reporting',)),
        ('/people/[personId]/edit','Edit work profile',('Organization & employment',)),
        ('/people/new','Invite a person',('Person & access',)),('/people/structure/new','Add department',('Department details',))]:
        add(h+suffix,title,people,('/api/hr/people',),texts,url=h+suffix+'?kind=department' if suffix.endswith('structure/new') else None)
    contracts[h+'/people/structure/new']['variant']='department only; designation remains separate variant'
    add(h+'/records','Records','frontend/src/app/dashboard/hr/records/page.tsx',('/api/hr/documents',),(names['document'],))
    add(h+'/records/documents/[recordId]','Employee document','hr-records/records-document.tsx',('/api/hr/documents',),(names['document'],),url=h+'/records/documents/'+ids['documentId'])
    add(h+'/records/history/[recordId]','Employment event','hr-records/records-document.tsx',('/api/hr/lifecycle',),(names['event'],),url=h+'/records/history/'+ids['eventId'])
    add(h+'/records/history/new','Add employment event','hr-records/event-create.tsx',('/api/hr/meta',),('Event type',))
    add(h+'/settings','Company HR Setup','hr-settings/settings-register.tsx',('/api/hr/shift-assignments',),('Schedule assignments',))
    add(h+'/settings/assignments/new','Assign work schedule','hr-settings/assignment-create.tsx',('/api/hr/meta',),('Employee',))
    add(h+'/settings/catalog/[kind]/new','Add leave type','hr-settings/catalog-create.tsx',(),('Annual allowance (days)',),url=h+'/settings/catalog/leave/new')
    contracts[h+'/settings/catalog/[kind]/new']['variant']='leave only; shift and holiday remain separate variants'
    a=h+'/settings/attendance'; source='hr-attendance-setup/workspace.tsx'
    add(a,'Attendance setup',source,('/api/hr/attendance/offices',),(names['office'],))
    for kind,key,title,api in [('offices','officeId','Office locations','offices'),('policies','employeeId','Weekly work policies','policies'),('requests','requestId','Attendance requests','requests')]:
        root=a+'/'+kind; gets=('/api/hr/attendance/'+api,)
        add(root+'/['+key+']',title,source,gets,('Back to register',))
        action='review' if kind=='requests' else 'edit'
        add(root+'/['+key+']/'+action,title,source,gets,('Back to register',))
        if kind!='requests': add(root+'/new',title,source,gets,('Back to register',))
    add(h+'/talent','Talent','frontend/src/app/dashboard/hr/talent/page.tsx',('/api/hr/jobs',),(names['job'],))
    add(h+'/talent/hiring','Job openings','hr-talent-hiring/workspace.tsx',('/api/hr/jobs',),(names['job'],))
    add(h+'/talent/hiring/jobs/[jobId]','Hiring record','hr-talent-hiring/workspace.tsx',('/api/hr/jobs',),(names['job'],))
    add(h+'/talent/hiring/candidates/[candidateId]','Hiring record','hr-talent-hiring/workspace.tsx',('/api/hr/candidates',),(names['candidate'],))
    for suffix,title,path in [('/time','Time & Leave','attendance'),('/time/attendance/new','New attendance record','meta'),
        ('/time/attendance/[attendanceId]','Time & leave record','attendance'),('/time/leave/[leaveId]','Time & leave record','leave-requests'),
        ('/time/leave/[leaveId]/review','Review leave','leave-requests')]:
        add(h+suffix,title,'hr-time/hr-time-workspace.tsx',('/api/hr/'+path,))
    register='payroll/payroll-register.tsx'; editors='payroll/payroll-editors.tsx'; docs='payroll/payroll-documents.tsx'
    add(p,'Payroll, ready for review',register,('/api/payroll/runs',),(names['period'],))
    add(p+'/periods/[periodId]',names['period'],docs,('/api/payroll/periods',),('Start date',))
    add(p+'/periods/new','Create payroll period',editors,(),('Period dates',))
    add(p+'/policy','Rules for future drafts',register,('/api/payroll/policy',),('Legacy manual · version 0',))
    add(p+'/policy/new','Schedule a payroll policy version',editors,('/api/payroll/policy',),('Mode & effective date',))
    add(p+'/profiles/[profileId]',names['owner'],docs,('/api/payroll/salary-profiles',),('Profile base',))
    add(p+'/profiles/[profileId]/edit','Edit '+names['owner'],editors,('/api/payroll/salary-profiles',),('Employee',))
    add(p+'/profiles/new','Add salary profile',editors,('/api/payroll/meta',),('Employee',))
    getrun='/api/payroll/runs/'+ids['runId']
    add(p+'/runs/[runId]',names['period'],docs,(getrun,),('Employee payroll',))
    add(p+'/runs/[runId]/approve','Review payroll approval',editors,(getrun,),('Confirm & approve payroll',))
    add(p+'/runs/[runId]/entries/[entryId]',names['owner'],docs,(getrun,),('Current saved amounts',))
    add(p+'/runs/[runId]/entries/[entryId]/edit','Adjust '+names['owner'],editors,(getrun,),('Adjustment reason',))
    add(p+'/runs/[runId]/pay','Review payroll payment',editors,('/api/payroll/runs/'+ids['approvedRunId'],'/api/payroll/meta'),
        ('Confirm & pay payroll',),url=p+'/runs/'+ids['approvedRunId']+'/pay')
    add(p+'/runs/[runId]/payslip/[entryId]',names['organization'],'payroll/manager-payslip.tsx',(getrun,'/api/tenant'),(names['owner'],))
    add(p+'/runs/new','Prepare a payroll draft',editors,('/api/payroll/meta','/api/payroll/periods'),('Period & currency',))
    add(p+'/withholdings/[paymentId]',names['payment'],docs,('/api/payroll/withholdings/payments',),('Amount settled',))
    add(p+'/withholdings/new','Pay payroll withholdings',editors,('/api/payroll/withholdings/meta',),('Payment context',))
    return contracts,overrides
