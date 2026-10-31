"""No database execution: resolve seed callables against the actual public router,
then exercise unchanged wrapper/gate code with explicit fake transaction objects.
This is not a substitute for PostgreSQL seed execution in disposable CI.
"""
import ast
import importlib
import inspect
from pathlib import Path
import unittest
from app.api.v1.router import api_router
from app.api.v1 import financial_safety
from period_entrypoint_harness import DB, GATE, StopAtDomain, gate_sql, tenant
from test_period_entrypoint_adoption_offline import wrapper_ns, wrapper_args

ROOT = Path(__file__).resolve().parents[1]

def routes(router):
    # FastAPI supports both eagerly flattened and included-router representations.
    for route in router.routes:
        if hasattr(route, 'endpoint'):
            yield route
        elif hasattr(route, 'original_router'):
            yield from routes(route.original_router)


def seed_bindings(source):
    bindings = {}
    tree = ast.parse(source)
    modules = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith('app.api.v1'):
            module = importlib.import_module(node.module)
            for alias in node.names:
                value = getattr(module, alias.name)
                if inspect.isfunction(value): bindings[alias.asname or alias.name] = value
                elif inspect.ismodule(value): modules[alias.asname or alias.name] = value
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in modules:
            value = getattr(modules[node.value.id], node.attr)
            if inspect.isfunction(value): bindings[node.value.id+'.'+node.attr] = value
    return bindings


# Reviewed full dispatch matrix; changing router registration requires explicit review.
EXPECTED = {
'financial': {
    'create_account': ('POST', '/finance/accounts'),
    'disburse_loan': ('POST', '/accounting/loans/{loan_id}/disburse'),
    'repay_loan': ('POST', '/accounting/loans/{loan_id}/repay'),
    'create_accounting_loan': ('POST', '/accounting/loans'),
    'approve_loan': ('POST', '/accounting/loans/{loan_id}/approve'),
    'create_code': ('POST', '/accounting/tax/codes'),
    'create_settlement': ('POST', '/accounting/tax/settlements'),
    'create_payable_bill': ('POST', '/accounting/payables'),
    'create_reconciliation': ('POST', '/accounting/reconciliations'),
    'record_transfer': ('POST', '/finance/transfers'),
    'create_invoice': ('POST', '/finance/invoices'),
    'get_invoice': ('GET', '/finance/invoices/{invoice_id}'),
    'change_invoice_status': ('PATCH', '/finance/invoices/{invoice_id}/status'),
    'record_payment': ('POST', '/finance/payments'),
    'create_advance': ('POST', '/accounting/customer-advances'),
    'create_ledger_account': ('POST', '/accounting/chart-of-accounts'),
    'create_manual_journal': ('POST', '/accounting/journals'),
    'create_asset': ('POST', '/accounting/assets'),
    'create_recurring_expense': ('POST', '/finance/recurring-expenses'),
    'create_accounting_period': ('POST', '/finance/accounting-periods'),
    'close_accounting_period': ('POST', '/finance/accounting-periods/{period_id}/close'),
},
'commercial': {
    'create_client': ('POST', '/crm/clients'),
    'create_quotation': ('POST', '/sales/quotations'),
    'change_quotation_status': ('PATCH', '/sales/quotations/{quotation_id}/status'),
    'create_order_from_quotation': ('POST', '/sales/orders/from-quotation/{quotation_id}'),
    'change_order_status': ('PATCH', '/sales/orders/{order_id}/status'),
    'create_manual_order': ('POST', '/sales/orders'),
    'create_project_from_order': ('POST', '/projects/from-order/{order_id}'),
    'create_milestone': ('POST', '/projects/{project_id}/milestones'),
    'create_task': ('POST', '/projects/{project_id}/tasks'),
    'create_credential': ('POST', '/projects/{project_id}/credentials'),
    'upload_project_document': ('POST', '/projects/{project_id}/documents/upload'),
    'create_category': ('POST', '/inventory/categories'),
    'create_warehouse': ('POST', '/inventory/warehouses'),
    'create_product': ('POST', '/inventory/products'),
    'receive_purchase': ('POST', '/inventory/purchases'),
    'create_supplier': ('POST', '/inventory/suppliers'),
    'create_expense_category': ('POST', '/finance/expense-categories'),
    'create_expense': ('POST', '/finance/expenses'),
},
'hr': {
    'hr.create_shift': ('POST', '/hr/shifts'),
    'hr.assign_shift': ('POST', '/hr/shift-assignments'),
    'hr.create_attendance': ('POST', '/hr/attendance'),
    'hr.create_leave_type': ('POST', '/hr/leave-types'),
    'hr.create_leave_request': ('POST', '/hr/leave-requests'),
    'hr.create_document': ('POST', '/hr/documents'),
    'hr.create_lifecycle': ('POST', '/hr/lifecycle'),
    'hr_attendance.create_office': ('POST', '/hr/attendance/offices'),
    'hr_attendance.upsert_policy': ('PUT', '/hr/attendance/policies/{employee_id}'),
    'hr_attendance.create_request': ('POST', '/hr/self/attendance-requests'),
    'hr.create_job': ('POST', '/hr/jobs'),
    'hr.create_candidate': ('POST', '/hr/candidates'),
    'payroll.create_salary_profile': ('POST', '/payroll/salary-profiles'),
    'payroll.create_period': ('POST', '/payroll/periods'),
    'payroll.create_run': ('POST', '/payroll/runs'),
    'payroll.update_entry': ('PATCH', '/payroll/runs/{run_id}/entries/{entry_id}'),
    'payroll.approve_run': ('POST', '/payroll/runs/{run_id}/approve'),
    'payroll.pay_payroll_withholding': ('POST', '/payroll/withholdings/payments'),
},
}

def assert_financial_request(test, name, args):
    """Verify the request emitted by the actual seed, not a guessed route name."""
    import re
    if name == 'get_invoice':
        return  # Direct read has no Request parameter.
    method, path = args[-3]
    expected_method, template = EXPECTED['financial'][name]
    test.assertEqual(expected_method, method)
    expression = re.sub(r'\{[^}]+\}', '[^/]+', template)
    test.assertRegex(path, '^'+expression+'$')


class RegisteredSeedEntrypoints(unittest.TestCase):
    def test_every_seed_endpoint_is_current_registered_public_callable(self):
        registered = {route.endpoint for route in routes(api_router)}
        count = 0
        for family in ('financial','commercial','hr'):
            source = (ROOT/f'scripts/seed_admin_readonly_{family}.py').read_text()
            bindings = seed_bindings(source)
            self.assertEqual(set(EXPECTED[family]), set(bindings))
            for name, callable_ in bindings.items():
                with self.subTest(family=family, name=name):
                    self.assertIn(callable_, registered)
                    method,path = EXPECTED[family][name]
                    matches = [r.endpoint for r in routes(api_router) if r.path == path and method in r.methods]
                    self.assertEqual([callable_], matches)
                count += 1
        self.assertGreaterEqual(count, 50)

    def test_shadowed_operations_bind_exact_method_path_and_wrapper(self):
        source = (ROOT/'scripts/seed_admin_readonly_financial.py').read_text()
        bindings = seed_bindings(source)
        expected = [
            ('create_account','POST','/finance/accounts','safe_create_account'),
            ('disburse_loan','POST','/accounting/loans/{loan_id}/disburse','safe_disburse_loan'),
            ('repay_loan','POST','/accounting/loans/{loan_id}/repay','safe_repay_loan'),
            ('record_transfer','POST','/finance/transfers','safe_record_transfer'),
            ('change_invoice_status','PATCH','/finance/invoices/{invoice_id}/status','safe_change_invoice_status'),
            ('record_payment','POST','/finance/payments','safe_record_payment'),
            ('create_advance','POST','/accounting/customer-advances','safe_create_customer_advance'),
        ]
        public = list(routes(api_router))
        for name, method, path, safe_name in expected:
            matches = [r for r in public if r.path == path and method in r.methods]
            self.assertEqual(1,len(matches),path)
            self.assertIs(bindings[name],matches[0].endpoint)
            self.assertIs(bindings[name],getattr(financial_safety,safe_name))
        old = source.replace('safe_disburse_loan as disburse_loan','safe_disburse_loan as unused_safe_disburse')+'\nfrom app.api.v1.accounting_loans import disburse_loan\n'
        self.assertNotIn(seed_bindings(old)['disburse_loan'],{r.endpoint for r in public})

    def test_actual_wrapper_gate_precedes_first_domain_boundary_and_rolls_back(self):
        for name in ('safe_create_account','safe_disburse_loan','safe_repay_loan','safe_record_transfer',
                     'safe_change_invoice_status','safe_record_payment','safe_create_customer_advance','safe_create_expense'):
            with self.subTest(name=name):
                db, context = DB(), tenant()
                ns = wrapper_ns()
                with self.assertRaises(StopAtDomain): ns[name](*wrapper_args(name,db,context))
                self.assertEqual(1,len(gate_sql(db)))
                self.assertEqual('execute',db.events[0][0])
                self.assertEqual(('refresh',context.organization),db.events[1])
                self.assertIn(('rollback',),db.events)
                self.assertEqual(0,db.commits)
                self.assertNotIn('deferred_commit_depth',db.info)

    def test_posting_gate_still_fails_closed_without_ownership(self):
        db = DB()
        with self.assertRaises(GATE.AccountingPeriodGateError):
            GATE.require_accounting_period_gate(db,tenant().organization_id)
        self.assertEqual([],gate_sql(db))

if __name__ == '__main__': unittest.main()
