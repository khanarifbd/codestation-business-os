"""Portable seed/contract checks. Mocked service boundaries only; never connects a DB."""
import importlib.util
import json
from pathlib import Path
from datetime import date
from contextlib import ExitStack
from types import SimpleNamespace as NS
import sys
import unittest
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import seed_admin_readonly_hr as seed


class HRSeedTests(unittest.TestCase):
    def setUp(self):
        self.stack=ExitStack();self.addCleanup(self.stack.close)
        self.gate=self.stack.enter_context(patch.object(seed,'assert_financial_fixture_target'))
        self.db=Mock();self.db.in_transaction.return_value=False
        self.db.scalar.return_value=NS(id='employee',employment_status='active')
        self.db.get.return_value=NS(full_name='Synthetic Owner')
        self.tenant=NS(organization_id='org',membership_id='member',user_id='owner',organization=NS(name='Read-only admin sweep synthetic',timezone='UTC'))
        self.calls=[];self.period_count=0;self.run_count=0
        def service(name):
            def invoke(*args):
                self.calls.append((name,args))
                if name=='create_period':
                    self.period_count+=1;return NS(id='period-'+str(self.period_count))
                if name=='create_run':
                    self.run_count+=1;return NS(id='run-'+str(self.run_count),status='draft',entries=[NS(id='entry-'+str(self.run_count))])
                if name=='approve_run':return NS(id='run-2',status='approved')
                if name=='pay_payroll_withholding':return NS(id='payment',account_name='Synthetic payroll bank')
                if name=='create_office':return {'id':'office'}
                return NS(id=name+'-id')
            return invoke
        for module,names in [(seed.hr,['create_shift','assign_shift','create_attendance','create_leave_type','create_leave_request','create_document','create_lifecycle','create_job','create_candidate']),
            (seed.hr_attendance,['create_office','upsert_policy','create_request']),
            (seed.payroll,['create_salary_profile','create_period','create_run','update_entry','approve_run','pay_payroll_withholding'])]:
            for name in names:self.stack.enter_context(patch.object(module,name,side_effect=service(name)))
        self.stack.enter_context(patch.object(seed,'create_account',side_effect=service('create_account')))
        self.audit=self.stack.enter_context(patch.object(seed,'audit_organization_accounting',return_value=NS(ok=True)))
        self.request=lambda method,path:NS(method=method,path=path)

    def run_seed(self):return seed.seed_hr(self.db,self.tenant,self.request,date.today())

    def test_gate_runs_before_any_mutation_and_failure_never_retries(self):
        self.gate.side_effect=RuntimeError('wrong target')
        with self.assertRaisesRegex(RuntimeError,'wrong target'):self.run_seed()
        self.assertEqual(self.calls,[]);self.db.scalar.assert_not_called()

    def test_missing_employee_date_and_partial_failure_fail_closed(self):
        self.db.scalar.return_value=None
        with self.assertRaisesRegex(RuntimeError,'active owner'):self.run_seed()
        self.assertEqual(self.calls,[])
        with self.assertRaisesRegex(RuntimeError,'calendar'):seed.seed_hr(self.db,self.tenant,self.request,'2026-10-30')
        self.db.scalar.return_value=NS(id='employee',employment_status='active')
        seed.hr.create_attendance.side_effect=RuntimeError('service failed')
        with self.assertRaisesRegex(RuntimeError,'service failed'):self.run_seed()
        seed.hr.create_attendance.assert_called_once();seed.payroll.create_run.assert_not_called()

    def test_normal_service_payloads_typed_registry_and_exact_routes(self):
        result=self.run_seed();self.gate.assert_called_once_with(self.db,self.tenant)
        manifest=json.loads((Path(__file__).parents[2]/'frontend/e2e-admin-readonly/routes.json').read_text())
        expected={x['pattern'] for x in manifest['routes'] if x['pattern'].startswith(('/dashboard/hr','/dashboard/payroll'))}
        self.assertEqual(set(result['route_contracts']),expected)
        self.assertEqual(set(result['route_overrides']),expected)
        self.assertEqual(len(expected),48)
        for url in result['route_overrides'].values():self.assertNotIn('[',url)
        self.assertEqual(result['route_overrides']['/dashboard/payroll/runs/[runId]/pay'],'/dashboard/payroll/runs/run-2/pay')
        self.assertEqual(result['route_overrides']['/dashboard/payroll/runs/[runId]/approve'],'/dashboard/payroll/runs/run-1/approve')
        self.assertNotEqual(result['typed_ids']['runId'],result['typed_ids']['approvedRunId'])
        self.assertEqual(seed.hr.create_document.call_args.args[0].file_url,None)
        self.assertEqual(seed.hr.create_lifecycle.call_args.args[0].event_type,'confirmation')
        self.assertEqual(seed.hr.create_leave_type.call_args.args[0].annual_allowance_days,12)
        self.assertEqual(seed.payroll.update_entry.call_args.args[2].tax_amount,2)
        self.assertEqual(seed.payroll.pay_payroll_withholding.call_args.args[0].amount,1)
        self.assertTrue(result['accounting_integrity']);self.audit.assert_called_once_with(self.db,'org')
        self.assertEqual(result['synthetic_seed_states']['approvedRunId'],'approved')
        self.assertEqual(len([n for n,_ in self.calls if n=='approve_run']),1)
        self.assertFalse(any('invite' in n or 'pay_run'==n for n,_ in self.calls))

    def test_integrity_failure_and_wrong_approval_never_return_registry(self):
        self.audit.return_value=NS(ok=False)
        with self.assertRaisesRegex(RuntimeError,'integrity'):self.run_seed()
        seed.payroll.approve_run.return_value=NS(id='run-2',status='draft')
        seed.payroll.approve_run.side_effect=None
        with self.assertRaisesRegex(RuntimeError,'Approved synthetic'):self.run_seed()

    def test_fresh_contracts_are_json_safe_and_variants_honest(self):
        result=self.run_seed();json.dumps(result)
        contracts=result['route_contracts']
        self.assertIn('designation remains',contracts['/dashboard/hr/people/structure/new']['variant'])
        self.assertIn('shift and holiday remain',contracts['/dashboard/hr/settings/catalog/[kind]/new']['variant'])
        for c in contracts.values():
            self.assertTrue(c['heading']);self.assertEqual(c['expected_mode'],'ready')
            self.assertTrue(c['source'].startswith('frontend/src/'))
            self.assertTrue(all(p.startswith('/api/') for p in c['expected_get_paths']))


if __name__=='__main__':unittest.main()
