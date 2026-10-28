"""Mock/static integration seams. NO database, network or migration execution.

These tests are deliberately not PostgreSQL concurrency/migration certification.
"""
import ast
import hashlib
import os
from datetime import date, datetime, timezone
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine

from app.api.v1 import payroll as api
from app.api.v1 import hr_self
from app.db.base import Base
from app.models.payroll import PayrollEntry, PayrollRun
from app.models.payroll_policy import PayrollEntryAdjustment, PayrollPolicyVersion
from app.schemas.payroll import PayrollEntryUpdate, PayrollRunCreate
from app.schemas.payroll_policy import PayrollCalculationInput, PayrollPolicySnapshot, PayrollPolicyConfig, PayrollEmployeeInput, PayrollSalaryProfileInput, PayrollSetupIssue
from app.schemas.payroll_policy_api import PayrollPolicyVersionCreate, PayrollRunPreviewRequest
from app.services import payroll_policy_inputs as inputs
from app.services.payroll_policy import calculate_payroll, PayrollCalculationError

ROOT = Path(__file__).resolve().parents[1]
BASE = Path(os.environ.get('BASELINE_BACKEND', str(ROOT.parents[1] / 'business-os-my-work-recovery-20261026/baseline-source/backend'))).resolve()
BASELINE_HASHES = {'app/api/v1/payroll.py': 'a242d43f5b5185576ba903d3777f075b9cc7d2bc0a3d17ff5e71abd099ea75d0', 'app/api/v1/hr_extended.py': '9913e0cd1d1694b7b14e8eb07d6777a99e58bc8c56c327d6a13ba459eaeccbaa'}
NOW = datetime(2096, 1, 1, tzinfo=timezone.utc)


def fixture_policy(**kwargs):
    return NS(id='policy-one', version=1, effective_from=date(2096,1,1), configuration={'mode':'calendar_day'}, activation_reason='Explicit synthetic setup', created_by_user_id='actor', created_at=NOW, **kwargs)


def fixture_period():
    return NS(id='period', organization_id='org', period_start=date(2096,1,1), period_end=date(2096,1,31), status='open')


def calculation():
    return calculate_payroll(PayrollCalculationInput(organization_id='org',timezone='UTC',period_id='period',period_start=date(2096,1,1),period_end=date(2096,1,31),currency='USD',policy=PayrollPolicySnapshot(id='policy-one',version=1,effective_from=date(2096,1,1),config=PayrollPolicyConfig(mode='calendar_day')),employees=(PayrollEmployeeInput(id='employee',organization_id='org',employment_status='active',join_date=date(2096,1,1)),),profiles=(PayrollSalaryProfileInput(id='profile',organization_id='org',employee_id='employee',currency='USD',base_salary='1000',effective_from=date(2096,1,1)),)))


class PayrollIntegrationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if BASE == ROOT.resolve():
            raise RuntimeError('BASELINE_BACKEND must be the verified original baseline, not the current backend')
        for name, expected in BASELINE_HASHES.items():
            path = BASE / name
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise RuntimeError('Set BASELINE_BACKEND to the verified v9 source/backend; missing or mismatched baseline: ' + name)
        migrations = sorted((BASE / 'alembic/versions').glob('*.py'))
        fingerprint = ''.join(path.name + ' ' + hashlib.sha256(path.read_bytes()).hexdigest() + '\n' for path in migrations)
        if len(migrations) != 95 or hashlib.sha256(fingerprint.encode()).hexdigest() != '1b502f5728fab083b7a5813fb1ec2c3c38c90a388fa6ed3471a231077b8853a1':
            raise RuntimeError('BASELINE_BACKEND must include all95 byte-verified original migrations; no empty or partial baseline is accepted')

    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(Engine,'connect',side_effect=AssertionError('Database execution prohibited in unit test')).start()
        patch.object(socket.socket,'connect',side_effect=AssertionError('Network prohibited in unit test')).start()
        self.tenant=NS(organization_id='org',user_id='actor',organization=NS(id='org',timezone='UTC'))
        self.db=MagicMock()
        self.added=[]
        def add(item):
            if getattr(item,'id',None) is None:item.id='synthetic-'+str(len(self.added))
            if hasattr(item,'created_at') and item.created_at is None:item.created_at=NOW
            self.added.append(item)
        self.db.add.side_effect=add

    def test_legacy_financial_and_posting_functions_are_exact(self):
        current=ast.parse((ROOT/'app/api/v1/payroll.py').read_text())
        baseline=ast.parse((BASE/'app/api/v1/payroll.py').read_text())
        imports=[n for n in current.body if isinstance(n,ast.ImportFrom) and n.module=='app.services.accounting_period_gate']
        self.assertEqual(len(imports),1)
        self.assertEqual(ast.dump(imports[0]),ast.dump(ast.parse('from app.services.accounting_period_gate import acquire_accounting_period_gate').body[0]))
        names=['_money','_component_dicts','_component_total','_recalculate_run','_ensure_payroll_accrual','approve_run','pay_run','_account_balance','_payroll_withholding_balance']
        for name in names:
            old=next(n for n in baseline.body if isinstance(n,ast.FunctionDef) and n.name==name)
            new=next(n for n in current.body if isinstance(n,ast.FunctionDef) and n.name==name)
            if name in ('approve_run','pay_run'):
                # v32 adds only the exact earliest gate; retain every original
                # financial, permission, date and status node after that prefix.
                expected=ast.parse('acquire_accounting_period_gate(db, tenant.organization_id)').body[0]
                self.assertEqual(ast.dump(new.body[0]),ast.dump(expected),name)
                new.body=new.body[1:]
            self.assertEqual(ast.dump(new),ast.dump(old),name)

    def test_legacy_create_tail_is_byte_identical(self):
        start='    profiles = db.scalars(\n        select(SalaryProfile).where('
        end='\n\n\n@router.patch("/runs/{run_id}/entries/{entry_id}"'
        def tail(root):return (root/'app/api/v1/payroll.py').read_text().split(start,1)[1].split(end,1)[0]
        self.assertEqual(tail(ROOT),tail(BASE))

    def test_profile_and_period_writers_only_add_mutex(self):
        def functions(root):return {n.name:n for n in ast.parse((root/'app/api/v1/payroll.py').read_text()).body if isinstance(n,ast.FunctionDef)}
        old,new=functions(BASE),functions(ROOT)
        for name in ['create_salary_profile','update_salary_profile','create_period']:
            node=new[name];self.assertEqual(ast.unparse(node.body.pop(0)),'lock_payroll_inputs(db, tenant.organization_id)')
            self.assertEqual(ast.dump(node),ast.dump(old[name]),name)

    def test_holiday_writer_is_guard_only_delta(self):
        old=(BASE/'app/api/v1/hr_extended.py').read_text()
        expected=old.replace('from app.services.activity_log import record_activity','from app.services.activity_log import record_activity\nfrom app.services.payroll_policy_inputs import lock_payroll_inputs').replace('def create_holiday(payload: HolidayCreate, request: Request, db: DbSession, tenant: HRManager):\n','def create_holiday(payload: HolidayCreate, request: Request, db: DbSession, tenant: HRManager):\n    lock_payroll_inputs(db, tenant.organization_id)\n')
        self.assertEqual((ROOT/'app/api/v1/hr_extended.py').read_text(),expected)

    def test_mutex_is_transaction_scoped_stable_and_tenant_specific(self):
        inputs.lock_payroll_inputs(self.db,'org-A');inputs.lock_payroll_inputs(self.db,'org-A');inputs.lock_payroll_inputs(self.db,'org-B')
        calls=self.db.execute.call_args_list
        self.assertEqual(str(calls[0].args[0]),'SELECT pg_advisory_xact_lock(:lock_key)')
        self.assertEqual(calls[0].args[1],calls[1].args[1]);self.assertNotEqual(calls[0].args[1],calls[2].args[1]);self.db.commit.assert_not_called()

    def test_org_and_period_locks_refresh_existing_identity_and_filter_tenant(self):
        self.db.scalar.return_value=self.tenant.organization
        inputs.locked_payroll_organization(self.db,'org')
        statement=self.db.scalar.call_args.args[0]
        self.assertIn('FOR SHARE',str(statement.compile(dialect=postgresql.dialect())))
        self.assertTrue(statement.get_execution_options()['populate_existing'])
        self.db.scalar.return_value=fixture_period()
        inputs.locked_payroll_period(self.db,'org','period',for_create=True)
        statement=self.db.scalar.call_args.args[0];sql=str(statement.compile(dialect=postgresql.dialect()))
        self.assertIn('organization_id',sql);self.assertIn('FOR UPDATE',sql)

    def test_missing_or_closed_period_is_rejected(self):
        for row in [None,NS(status='closed')]:
            self.db.scalar.return_value=row
            with self.assertRaises(HTTPException) as error:inputs.locked_payroll_period(self.db,'org','x',for_create=True)
            self.assertEqual(error.exception.status_code,404 if row is None else 409)

    def test_policy_selection_is_tenant_date_and_highest_same_date_version(self):
        inputs.policy_for_date(self.db,'org',date(2096,1,1))
        statement=self.db.scalar.call_args.args[0];sql=str(statement.compile(dialect=postgresql.dialect()))
        self.assertIn('organization_id =',sql);self.assertIn('effective_from <=',sql)
        self.assertIn('effective_from DESC, payroll_policy_versions.version DESC',sql)

    def test_invalid_timezone_never_falls_back(self):
        with self.assertRaises(HTTPException):inputs.payroll_local_today(NS(timezone='Invalid/Synthetic'))

    def test_policy_payload_requires_reason_and_rejects_unknown_settings(self):
        for change in [{'activation_reason':'  '},{'configuration':{'mode':'automatic-guessed'}},{'unknown':True}]:
            payload={'configuration':{'mode':'manual'},'effective_from':'2096-01-01','expected_prior_version':0,'activation_reason':'Owner review',**change}
            with self.assertRaises(ValidationError):PayrollPolicyVersionCreate.model_validate(payload)

    def policy_call(self,latest,**changes):
        self.db.scalar.return_value=latest
        payload=PayrollPolicyVersionCreate(configuration={'mode':'manual'},effective_from=changes.get('effective_from',date(2096,2,1)),expected_prior_version=changes.get('expected_prior_version',latest.version if latest else 0),activation_reason='  Correct future schedule  ')
        with patch.object(api,'lock_payroll_inputs') as lock,patch.object(api,'locked_payroll_organization',return_value=self.tenant.organization),patch.object(api,'payroll_local_today',return_value=date(2096,1,1)),patch.object(api,'record_activity') as audit:
            result=api.create_payroll_policy_version(payload,None,self.db,self.tenant)
            lock.assert_called_once_with(self.db,'org');audit.assert_called_once()
        return result

    def test_same_effective_date_correction_appends_never_mutates(self):
        previous=fixture_policy();previous.effective_from=date(2096,2,1)
        result=self.policy_call(previous)
        self.assertEqual(result.version,2);self.assertEqual(result.effective_from,previous.effective_from)
        self.assertEqual(previous.version,1);self.assertEqual(len(self.added),1);self.assertEqual(self.added[0].activation_reason,'Correct future schedule');self.db.commit.assert_called_once()

    def test_policy_stale_retroactive_earlier_schedule_rejected_without_write(self):
        previous=fixture_policy();previous.effective_from=date(2096,2,1)
        for change in [{'expected_prior_version':0},{'effective_from':date(2095,12,1)},{'effective_from':date(2096,1,2)}]:
            with self.assertRaises(HTTPException) as error:self.policy_call(previous,**change)
            self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.added,[]);self.db.commit.assert_not_called()

    def test_preview_returns_structured_issue_without_writes_or_numbering(self):
        self.db.scalar.return_value=None
        with patch.object(api,'lock_payroll_inputs'),patch.object(api,'locked_payroll_organization',return_value=self.tenant.organization),patch.object(api,'locked_payroll_period',return_value=fixture_period()),patch.object(api,'policy_for_date',return_value=fixture_policy()),patch.object(api,'resolve_payroll_calculation',side_effect=PayrollCalculationError([PayrollSetupIssue(code='PROFILE_GAP',message='Missing interval',employee_id='employee')])),patch.object(api,'next_sequence_code') as number:
            result=api.preview_payroll_run(PayrollRunPreviewRequest(period_id='period',currency='USD'),self.db,self.tenant)
        self.assertFalse(result.ready);self.assertEqual(result.setup_issues[0]['code'],'PROFILE_GAP');self.assertIsNone(result.calculation_hash)
        self.db.add.assert_not_called();self.db.commit.assert_not_called();number.assert_not_called()

    def test_successful_preview_is_readonly_and_decodes_entry_breakdown(self):
        self.db.scalar.return_value=None
        with patch.object(api,'lock_payroll_inputs'),patch.object(api,'locked_payroll_organization',return_value=self.tenant.organization),patch.object(api,'locked_payroll_period',return_value=fixture_period()),patch.object(api,'policy_for_date',return_value=fixture_policy()),patch.object(api,'resolve_payroll_calculation',return_value=calculation()):
            result=api.preview_payroll_run(PayrollRunPreviewRequest(period_id='period',currency='usd'),self.db,self.tenant)
        self.assertTrue(result.ready);self.assertIn('calculation_snapshot',result.calculation['entries'][0]);self.assertNotIn('input_snapshot_json',result.calculation)
        self.db.add.assert_not_called();self.db.commit.assert_not_called()

    def test_missing_or_stale_confirmation_never_allocates_run(self):
        for digest in [None,'0'*64]:
            with patch.object(api,'_calculate_policy',return_value=calculation()),patch.object(api,'next_sequence_code') as number:
                with self.assertRaises(HTTPException) as error:api._create_versioned_run(PayrollRunCreate(period_id='period',currency='USD',expected_calculation_hash=digest),None,self.db,self.tenant,self.tenant.organization,fixture_period(),'USD',fixture_policy())
                self.assertEqual(error.exception.status_code,409);number.assert_not_called()
        self.assertEqual(self.added,[]);self.db.commit.assert_not_called()

    def test_confirmed_create_snapshots_inputs_output_and_each_source(self):
        calculated=calculation()
        def totals(db,run):
            for field in ['employee_count','gross_total','net_total','allowance_total','deduction_total','tax_total']:setattr(run,field,getattr(calculated,field))
        with patch.object(api,'_calculate_policy',return_value=calculated),patch.object(api,'_ensure_payroll_sequence'),patch.object(api,'next_sequence_code',return_value='PAY-00001'),patch.object(api,'_recalculate_run',side_effect=totals),patch.object(api,'record_activity') as audit,patch.object(api,'_run_read',return_value='saved'):
            result=api._create_versioned_run(PayrollRunCreate(period_id='period',currency='USD',expected_calculation_hash=calculated.calculation_hash),None,self.db,self.tenant,self.tenant.organization,fixture_period(),'USD',fixture_policy())
        self.assertEqual(result,'saved');self.assertEqual(len(self.added),2)
        run,entry=self.added;self.assertIsInstance(run,PayrollRun);self.assertIsInstance(entry,PayrollEntry)
        self.assertEqual(run.calculation_input_snapshot,calculated.input_snapshot_json);self.assertEqual(run.calculation_output_snapshot,calculated.output_snapshot_json)
        self.assertEqual(entry.base_salary,Decimal('1000'));self.assertEqual(entry.calculation_snapshot,calculated.entries[0].calculation_snapshot_json)
        audit.assert_called_once();self.db.commit.assert_called_once()

    def entry_call(self,payload,*,versioned=True,status='draft'):
        run=NS(id='run',organization_id='org',status=status,policy_version_id='policy' if versioned else None)
        entry=NS(id='entry',base_salary=Decimal('1000'),allowances=[],deductions=[],allowance_total=Decimal('0'),deduction_total=Decimal('0'),tax_amount=Decimal('0'),gross_pay=Decimal('1000'),net_pay=Decimal('1000'),notes=None,calculation_snapshot='immutable-initial' if versioned else None)
        self.db.scalar.side_effect=[run,entry]
        with patch.object(api,'_recalculate_run'),patch.object(api,'record_activity') as audit,patch.object(api,'_run_read',return_value='saved'):
            result=api.update_entry('run','entry',PayrollEntryUpdate(**payload),None,self.db,self.tenant)
        return result,entry,audit

    def test_v1_adjustment_requires_reason_and_finalized_is_locked(self):
        for values in [{'tax_amount':'10'},{'base_salary':'1200','adjustment_reason':'  '}]:
            with self.assertRaises(HTTPException) as error:self.entry_call(values)
            self.assertEqual(error.exception.status_code,422)
        for status in ['approved','paid','reversed']:
            with self.assertRaises(HTTPException) as error:self.entry_call({'tax_amount':'1','adjustment_reason':'x'},status=status)
            self.assertEqual(error.exception.status_code,409)
        self.db.commit.assert_not_called()

    def test_v1_adjustment_records_complete_before_after_and_keeps_initial_snapshot(self):
        result,entry,audit=self.entry_call({'base_salary':'1100','tax_amount':'10','adjustment_reason':'Correction supported by review'})
        self.assertEqual(result,'saved');self.assertEqual(entry.net_pay,Decimal('1090.00'));self.assertEqual(entry.calculation_snapshot,'immutable-initial')
        self.assertEqual(len(self.added),1);row=self.added[0];self.assertIsInstance(row,PayrollEntryAdjustment)
        self.assertEqual(row.created_by_user_id,'actor');self.assertEqual(row.before_values['base_salary'],'1000');self.assertEqual(row.after_values['base_salary'],'1100.00')
        self.assertEqual(audit.call_args.kwargs['metadata']['adjustment_reason'],'Correction supported by review')

    def test_legacy_adjustment_body_still_works_without_reason(self):
        _,entry,audit=self.entry_call({'tax_amount':'10'},versioned=False)
        self.assertEqual(entry.net_pay,Decimal('990.00'));self.assertEqual(self.added,[])
        self.assertIsNone(entry.calculation_snapshot)
        self.assertIsNone(audit.call_args.kwargs['before']);self.assertIsNone(audit.call_args.kwargs['metadata'])
        self.assertEqual(audit.call_args.kwargs['after'],{'net_pay':'990.00','tax_amount':'10.00'})

    def test_legacy_provided_reason_appends_real_adjustment_and_activity_metadata(self):
        _,entry,audit=self.entry_call({'tax_amount':'10','adjustment_reason':'  Reviewed manual correction  '},versioned=False)
        self.assertEqual(entry.net_pay,Decimal('990.00'));self.assertIsNone(entry.calculation_snapshot)
        self.assertEqual(len(self.added),1);row=self.added[0]
        self.assertIsInstance(row,PayrollEntryAdjustment)
        self.assertEqual((row.organization_id,row.entry_id,row.created_by_user_id,row.created_at),('org','entry','actor',NOW))
        self.assertEqual(row.reason,'Reviewed manual correction')
        self.assertEqual(row.before_values['net_pay'],'1000');self.assertEqual(row.after_values['net_pay'],'990.00')
        self.assertEqual(row.before_values['tax_amount'],'0');self.assertEqual(row.after_values['tax_amount'],'10.00')
        self.assertEqual(audit.call_args.kwargs['before'],row.before_values)
        self.assertEqual(audit.call_args.kwargs['after'],row.after_values)
        self.assertEqual(audit.call_args.kwargs['metadata'],{'adjustment_reason':row.reason})
        self.db.commit.assert_called_once()

    def test_blank_legacy_reason_keeps_omitted_reason_compatibility(self):
        _,entry,audit=self.entry_call({'tax_amount':'10','adjustment_reason':'  '},versioned=False)
        self.assertEqual(entry.net_pay,Decimal('990.00'));self.assertEqual(self.added,[])
        self.assertIsNone(audit.call_args.kwargs['metadata']);self.assertIsNone(audit.call_args.kwargs['before'])

    def test_legacy_notes_only_reason_does_not_invent_monetary_adjustment(self):
        _,entry,audit=self.entry_call({'notes':'  reviewed note  ','adjustment_reason':'Not a monetary change'},versioned=False)
        self.assertEqual(entry.notes,'reviewed note');self.assertEqual(entry.net_pay,Decimal('1000.00'))
        self.assertEqual(self.added,[]);self.assertIsNone(audit.call_args.kwargs['metadata'])

    def test_legacy_unchanged_money_reason_is_activity_only_not_fabricated_adjustment(self):
        # Money strings are normalized by the write even when their values match.
        run=NS(id='run',organization_id='org',status='draft',policy_version_id=None)
        entry=NS(id='entry',base_salary=Decimal('1000.00'),allowances=[],deductions=[],allowance_total=Decimal('0.00'),deduction_total=Decimal('0.00'),tax_amount=Decimal('0.00'),gross_pay=Decimal('1000.00'),net_pay=Decimal('1000.00'),notes=None,calculation_snapshot=None)
        self.db.scalar.side_effect=[run,entry]
        with patch.object(api,'_recalculate_run'),patch.object(api,'record_activity') as audit,patch.object(api,'_run_read',return_value='saved'):
            api.update_entry('run','entry',PayrollEntryUpdate(tax_amount='0',adjustment_reason='Reviewed, no monetary change'),None,self.db,self.tenant)
        self.assertEqual(self.added,[])
        self.assertEqual(audit.call_args.kwargs['metadata'],{'adjustment_reason':'Reviewed, no monetary change'})

    def test_legacy_reason_does_not_unlock_finalized_entry(self):
        for status in ['approved','paid','reversed']:
            with self.subTest(status=status):
                with self.assertRaises(HTTPException) as error:self.entry_call({'tax_amount':'1','adjustment_reason':'Review'},versioned=False,status=status)
                self.assertEqual(error.exception.status_code,409)
        self.db.add.assert_not_called();self.db.commit.assert_not_called()

    def test_manager_read_includes_legacy_adjustments_only_for_selected_run_entries(self):
        common=dict(base_salary=Decimal('1000'),allowances=[],deductions=[],allowance_total=Decimal('0'),deduction_total=Decimal('0'),tax_amount=Decimal('10'),gross_pay=Decimal('1000'),net_pay=Decimal('990'),currency='USD',notes=None,calculation_snapshot=None)
        entries=[NS(id='entry-a',employee_id='employee-a',**common),NS(id='entry-b',employee_id='employee-b',**common)]
        adjustments=[NS(id='audit-a',entry_id='entry-a',reason='Reason A',created_by_user_id='actor',created_at=NOW,before_values={'tax_amount':'0'},after_values={'tax_amount':'10'}),NS(id='audit-b',entry_id='entry-b',reason='Reason B',created_by_user_id='actor',created_at=NOW,before_values={'tax_amount':'1'},after_values={'tax_amount':'10'})]
        self.db.scalars.side_effect=[NS(all=lambda:entries),NS(all=lambda:adjustments)]
        with patch.object(api,'_employee_name_map',return_value={}):result=api._entry_reads(self.db,'org','run')
        self.assertIsNone(result[0].calculation_snapshot)
        self.assertEqual([r['reason'] for r in result[0].adjustments],['Reason A'])
        self.assertEqual([r['reason'] for r in result[1].adjustments],['Reason B'])
        entry_query,audit_query=[c.args[0] for c in self.db.scalars.call_args_list]
        self.assertEqual(set(entry_query.compile().params.values()),{'org','run'})
        params=audit_query.compile().params
        self.assertEqual(params['organization_id_1'],'org');self.assertEqual(params['entry_id_1'],['entry-a','entry-b'])
        sql=str(audit_query.compile(dialect=postgresql.dialect()))
        self.assertIn('payroll_entry_adjustments.organization_id =',sql);self.assertIn('payroll_entry_adjustments.entry_id IN',sql)

    def test_legacy_base_override_is_not_silently_enabled(self):
        with self.assertRaises(HTTPException) as error:self.entry_call({'base_salary':'100'},versioned=False)
        self.assertEqual(error.exception.status_code,409)

    def test_null_base_override_is_rejected_without_changing_old_nullable_notes(self):
        with self.assertRaises(ValidationError):PayrollEntryUpdate(base_salary=None)
        self.assertIsNone(PayrollEntryUpdate(notes=None).notes)

    def test_notes_only_v1_write_does_not_invent_monetary_audit(self):
        _,entry,_=self.entry_call({'notes':'  updated note '})
        self.assertEqual(entry.notes,'updated note');self.assertEqual(self.added,[])

    def test_snapshot_context_excludes_other_employee_inputs(self):
        value=inputs.snapshot_policy_context(NS(calculation_input_snapshot=json.dumps({'policy':{'version':1},'timezone':'UTC','employees':[{'id':'SYNTHETIC_OTHER_EMPLOYEE'}],'profiles':[{'base_salary':'999'}]}),calculation_engine_version='v1',calculation_hash='hash'))
        self.assertEqual(set(value),{'policy','timezone','engine_version','calculation_hash'})
        self.assertNotIn('SYNTHETIC_OTHER_EMPLOYEE',json.dumps(value))

    def test_nullable_legacy_metadata_and_tenant_composite_foreign_keys(self):
        runs=Base.metadata.tables['payroll_runs'];entries=Base.metadata.tables['payroll_entries']
        for key in ['policy_version_id','calculation_engine_version','calculation_hash','calculation_input_snapshot','calculation_output_snapshot']:self.assertTrue(runs.c[key].nullable)
        self.assertTrue(entries.c.calculation_snapshot.nullable)
        policy_fk=next(x for x in runs.foreign_key_constraints if x.name=='fk_payroll_run_tenant_policy')
        self.assertEqual(list(policy_fk.column_keys),['organization_id','policy_version_id'])
        audit_fk=next(x for x in Base.metadata.tables['payroll_entry_adjustments'].foreign_key_constraints if x.name=='fk_payroll_adjustment_tenant_entry')
        self.assertEqual(list(audit_fk.column_keys),['organization_id','entry_id'])
        policy=Base.metadata.tables['payroll_policy_versions']
        self.assertFalse(any(c.name=='uq_payroll_policy_org_effective' for c in policy.constraints))

    def test_migration_is_appended_no_backfill_or_unconditional_run_uniqueness(self):
        source=(ROOT/'alembic/versions/0096_payroll_policy.py').read_text()
        self.assertIn('down_revision = "0095_inventory_payables"',source)
        self.assertNotIn('UPDATE ',source);self.assertNotIn('INSERT INTO',source);self.assertNotIn('uq_payroll_runs_org_period_currency',source)
        for p in (BASE/'alembic/versions').glob('*.py'):self.assertEqual((ROOT/'alembic/versions'/p.name).read_bytes(),p.read_bytes(),p.name)

    def test_downgrade_refuses_populated_history_before_any_drop(self):
        spec=importlib.util.spec_from_file_location('payroll_migration',ROOT/'alembic/versions/0096_payroll_policy.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        fake=MagicMock();fake.get_bind.return_value.execute.return_value.scalar.return_value=True
        with patch.object(module,'op',fake):
            with self.assertRaisesRegex(RuntimeError,'Refusing to discard'):module.downgrade()
        fake.drop_table.assert_not_called();fake.drop_column.assert_not_called()


    def test_resolver_keeps_cross_currency_history_and_full_holiday_horizon(self):
        period=fixture_period();period.period_start=date(2096,1,10);period.period_end=date(2096,1,20)
        employee=NS(id='employee',organization_id='org',employment_status='active',join_date=date(2096,1,1),end_date=None)
        first=NS(id='profile-usd',organization_id='org',employee_id='employee',currency='USD',pay_frequency='monthly',base_salary=Decimal('1000'),default_allowances=[],default_deductions=[],effective_from=date(2096,1,1),effective_to=date(2096,1,15),is_active=False)
        second=NS(**{**vars(first),'id':'profile-eur','currency':'EUR','effective_from':date(2096,1,16),'effective_to':None,'is_active':True})
        holiday=NS(id='holiday',organization_id='org',holiday_date=date(2096,1,1),name='Synthetic holiday',is_paid=False)
        self.db.scalars.side_effect=[NS(all=lambda:['employee']),NS(all=lambda:[employee]),NS(all=lambda:[first,second]),NS(all=lambda:[holiday])]
        policy=fixture_policy();policy.configuration={'mode':'working_day','working_weekdays':[0,1,2,3,4],'holiday_treatment':'exclude'}
        result=inputs.resolve_payroll_calculation(self.db,self.tenant.organization,period,'USD',policy)
        snapshot=json.loads(result.input_snapshot_json)
        self.assertEqual({x['currency'] for x in snapshot['profiles']},{'USD','EUR'})
        self.assertEqual(snapshot['holidays'][0]['holiday_date'],'2096-01-01')
        statements=[x.args[0] for x in self.db.scalars.call_args_list]
        self.assertIn('DISTINCT',str(statements[0]));self.assertNotIn('effective_from',str(statements[0]))
        for statement in statements[1:3]:
            self.assertIn('FOR SHARE',str(statement.compile(dialect=postgresql.dialect())))
            self.assertTrue(statement.get_execution_options()['populate_existing'])
        holiday_query=statements[-1];params=holiday_query.compile().params
        self.assertIn(date(2096,1,1),params.values());self.assertIn(date(2096,1,31),params.values())
        self.assertIsNone(holiday_query._limit_clause)
        self.db.add.assert_not_called();self.db.commit.assert_not_called()

    def test_resolver_does_not_hide_whole_gap_or_ended_employee(self):
        employee=NS(id='employee',organization_id='org',employment_status='inactive',join_date=date(2095,1,1),end_date=date(2096,1,20))
        old=NS(id='old',organization_id='org',employee_id='employee',currency='USD',pay_frequency='monthly',base_salary=Decimal('1000'),default_allowances=[],default_deductions=[],effective_from=date(2095,1,1),effective_to=date(2095,12,31),is_active=False)
        self.db.scalars.side_effect=[NS(all=lambda:['employee']),NS(all=lambda:[employee]),NS(all=lambda:[old])]
        with self.assertRaises(PayrollCalculationError) as error:inputs.resolve_payroll_calculation(self.db,self.tenant.organization,fixture_period(),'USD',fixture_policy())
        self.assertEqual(error.exception.issues[0].code,'PROFILE_GAP')
        employee_query=self.db.scalars.call_args_list[1].args[0]
        sql=str(employee_query.compile(dialect=postgresql.dialect()))
        self.assertNotIn('memberships',sql);self.assertNotIn('employment_status =',sql)

    def test_invalid_saved_inputs_fail_named_without_echoing_salary(self):
        employee=NS(id='employee',organization_id='org',employment_status='active',join_date=None,end_date=None)
        profile=NS(id='bad',organization_id='org',employee_id='employee',currency='USD',pay_frequency='guessed',base_salary=Decimal('123456'),default_allowances=[],default_deductions=[],effective_from=date(2096,1,1),effective_to=None,is_active=True)
        self.db.scalars.side_effect=[NS(all=lambda:['employee']),NS(all=lambda:[employee]),NS(all=lambda:[profile])]
        with self.assertRaises(PayrollCalculationError) as error:inputs.resolve_payroll_calculation(self.db,self.tenant.organization,fixture_period(),'USD',fixture_policy())
        self.assertEqual(error.exception.code,'INVALID_PAYROLL_INPUT');self.assertNotIn('123456',str(error.exception))

    def test_create_duplicate_check_precedes_policy_dispatch_or_sequence(self):
        self.db.scalar.side_effect=[fixture_period(),'existing-run']
        with patch.object(api,'lock_payroll_inputs'),patch.object(api,'locked_payroll_organization',return_value=self.tenant.organization),patch.object(api,'policy_for_date') as policy,patch.object(api,'next_sequence_code') as number:
            with self.assertRaises(HTTPException) as error:api.create_run(PayrollRunCreate(period_id='period',currency='USD'),None,self.db,self.tenant)
        self.assertEqual(error.exception.status_code,409);policy.assert_not_called();number.assert_not_called();self.db.add.assert_not_called()

    def test_versioned_failure_does_not_fall_back_to_legacy_profiles(self):
        self.db.scalar.side_effect=[fixture_period(),None]
        with patch.object(api,'lock_payroll_inputs'),patch.object(api,'locked_payroll_organization',return_value=self.tenant.organization),patch.object(api,'policy_for_date',return_value=fixture_policy()),patch.object(api,'_create_versioned_run',side_effect=HTTPException(status_code=409,detail='setup')):
            with self.assertRaises(HTTPException):api.create_run(PayrollRunCreate(period_id='period',currency='USD'),None,self.db,self.tenant)
        self.db.scalars.assert_not_called();self.db.add.assert_not_called()

    def test_new_routes_keep_payroll_permission_dependencies(self):
        expected={'/payroll/policy':api.PayrollViewer,'/payroll/policy-versions':api.PayrollManager,'/payroll/runs/preview':api.PayrollManager}
        for path,annotation in expected.items():
            route=next(route for route in api.router.routes if route.path==path)
            self.assertIs(route.endpoint.__annotations__['tenant'],annotation)
        self.assertEqual(api.PayrollManager.__metadata__[0].dependency.__closure__[0].cell_contents,'payroll.manage')
        self.assertEqual(api.PayrollViewer.__metadata__[0].dependency.__closure__[0].cell_contents,'payroll.view')

    def payslip_call(self, *, versioned=True):
        employee=NS(id='own',employee_code='SYNTHETIC')
        entry=NS(id='entry-own',base_salary=Decimal('1000'),allowances=[],deductions=[],allowance_total=Decimal('0'),deduction_total=Decimal('0'),tax_amount=Decimal('10'),gross_pay=Decimal('1000'),net_pay=Decimal('990'),currency='USD',notes=None,calculation_snapshot=json.dumps({'employee':{'id':'own'},'slices':[]}) if versioned else None)
        run=NS(id='run',run_number='PAY-1',status='approved',calculation_engine_version='v1',calculation_hash='hash',calculation_input_snapshot=json.dumps({'policy':{'version':1},'timezone':'UTC','employees':[{'id':'DO_NOT_EXPOSE_OTHER'}]}) if versioned else None)
        period=fixture_period();period.name='Synthetic January';period.pay_date=period.period_end
        self.tenant.organization=NS(id='org',name='Synthetic company',country_code='US',currency='USD',timezone='UTC')
        self.db.execute.return_value.first.return_value=(entry,run,period,'Synthetic employee')
        self.db.scalars.return_value.all.return_value=[NS(reason='Synthetic reviewed change',created_at=NOW,before_values={'tax':'0'},after_values={'tax':'10'})]
        with patch.object(hr_self,'_employee',return_value=employee):result=hr_self.self_payslip('entry-own',self.db,self.tenant)
        self.assertNotIn('DO_NOT_EXPOSE_OTHER',json.dumps(result,default=str))
        self.assertEqual(result['entry']['adjustments'][0]['reason'],'Synthetic reviewed change')
        sql=str(self.db.execute.call_args.args[0].compile(dialect=postgresql.dialect()))
        self.assertIn('payroll_entries.employee_id =',sql);self.assertIn('payroll_runs.status IN',sql)
        audit_statement=self.db.scalars.call_args.args[0]
        self.assertEqual(set(audit_statement.compile().params.values()),{'org','entry-own'})
        return result

    def test_self_payslip_returns_only_selected_entry_breakdown_and_reasons(self):
        self.payslip_call()

    def test_self_legacy_payslip_returns_own_reason_without_fabricating_policy_snapshot(self):
        result=self.payslip_call(versioned=False)
        self.assertIsNone(result['entry']['calculation_snapshot']);self.assertIsNone(result['run']['calculation_context'])
        self.assertEqual(result['entry']['adjustments'][0]['reason'],'Synthetic reviewed change')
        self.assertNotIn('created_by_user_id',result['entry']['adjustments'][0])

    def test_self_payslip_missing_foreign_or_draft_entry_never_loads_audits(self):
        self.db.execute.return_value.first.return_value=None
        with patch.object(hr_self,'_employee',return_value=NS(id='own')):
            with self.assertRaises(HTTPException) as error:hr_self.self_payslip('not-owned',self.db,self.tenant)
        self.assertEqual(error.exception.status_code,404);self.db.scalars.assert_not_called()


    def test_irrelevant_ended_employee_does_not_require_weekly_anchor_in_resolver(self):
        current=NS(id='current',organization_id='org',employment_status='active',join_date=date(2096,1,1),end_date=None)
        ended=NS(id='ended',organization_id='org',employment_status='inactive',join_date=date(2095,1,1),end_date=date(2095,12,31))
        monthly=NS(id='monthly',organization_id='org',employee_id='current',currency='USD',pay_frequency='monthly',base_salary=Decimal('1000'),default_allowances=[],default_deductions=[],effective_from=date(2096,1,1),effective_to=None,is_active=True)
        weekly=NS(**{**vars(monthly),'id':'weekly','employee_id':'ended','pay_frequency':'weekly','effective_from':date(2095,1,1)})
        self.db.scalars.side_effect=[NS(all=lambda:['current','ended']),NS(all=lambda:[current,ended]),NS(all=lambda:[monthly,weekly]),NS(all=lambda:[])]
        policy=fixture_policy();policy.configuration={'mode':'working_day','working_weekdays':[0,1,2,3,4],'holiday_treatment':'exclude'}
        result=inputs.resolve_payroll_calculation(self.db,self.tenant.organization,fixture_period(),'USD',policy)
        self.assertEqual(len(result.entries),1);self.assertEqual(result.entries[0].employee_id,'current');self.assertEqual(result.net_total,Decimal('1000.00'))

    def test_all_new_model_ddl_compiles_for_postgres_without_execution(self):
        from sqlalchemy.schema import CreateTable
        for name in ['payroll_policy_versions','payroll_entry_adjustments','payroll_runs','payroll_entries']:
            sql=str(CreateTable(Base.metadata.tables[name]).compile(dialect=postgresql.dialect()))
            self.assertIn('CREATE TABLE '+name,sql)

    def test_new_base_override_rejects_nonfinite_or_storage_overflow(self):
        for value in ['NaN','Infinity','1000000000000000000','1.001','-1']:
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):PayrollEntryUpdate(base_salary=value)
        self.assertEqual(PayrollEntryUpdate(base_salary='0').base_salary,Decimal('0'))


    def test_other_currency_anchor_does_not_block_requested_currency_preview(self):
        current=NS(id='usd',organization_id='org',employment_status='active',join_date=date(2096,1,1),end_date=None)
        other=NS(**{**vars(current),'id':'eur'})
        monthly=NS(id='monthly',organization_id='org',employee_id='usd',currency='USD',pay_frequency='monthly',base_salary=Decimal('1000'),default_allowances=[],default_deductions=[],effective_from=date(2096,1,1),effective_to=None,is_active=True)
        weekly=NS(**{**vars(monthly),'id':'weekly','employee_id':'eur','currency':'EUR','pay_frequency':'weekly'})
        self.db.scalars.side_effect=[NS(all=lambda:['usd','eur']),NS(all=lambda:[current,other]),NS(all=lambda:[monthly,weekly]),NS(all=lambda:[])]
        policy=fixture_policy();policy.configuration={'mode':'working_day','working_weekdays':[0,1,2,3,4],'holiday_treatment':'exclude'}
        result=inputs.resolve_payroll_calculation(self.db,self.tenant.organization,fixture_period(),'USD',policy)
        self.assertEqual(result.net_total,Decimal('1000.00'));self.assertEqual(len(result.entries),1)
        snapshot=json.loads(result.input_snapshot_json)
        self.assertEqual({row['currency'] for row in snapshot['profiles']},{'USD','EUR'})
        self.assertEqual({row['id'] for row in snapshot['employees']},{'usd','eur'})


if __name__=='__main__':unittest.main()
