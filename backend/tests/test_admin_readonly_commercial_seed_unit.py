"""Offline orchestration/schema tests; actual PostgreSQL/service execution remains a CI gate."""
from contextlib import ExitStack
from datetime import date
from decimal import Decimal
import json
import ast
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
from scripts import seed_admin_readonly_commercial as seed

SERVICES = ['create_client', 'create_quotation', 'change_quotation_status', 'create_order_from_quotation',
            'create_manual_order', 'change_order_status', 'create_project_from_order', 'create_milestone',
            'create_task', 'upload_project_document', 'create_credential', 'create_category', 'create_warehouse',
            'create_product', 'create_supplier', 'receive_purchase', 'create_expense_category', 'create_expense']
DAY = date(2026, 10, 30)


class CommercialPublicBindingTests(unittest.TestCase):
    def test_expense_binding_is_public_atomic_handler_not_shadowed_core(self):
        from app.api.v1.financial_safety import safe_create_expense
        self.assertIs(seed.create_expense, safe_create_expense)
        source = Path(seed.__file__).read_text()
        def binding(text):
            imports = [(node.module, alias.name, alias.asname or alias.name)
                       for node in ast.walk(ast.parse(text)) if isinstance(node, ast.ImportFrom)
                       for alias in node.names if (alias.asname or alias.name) == 'create_expense']
            self.assertEqual([('app.api.v1.financial_safety', 'safe_create_expense', 'create_expense')], imports)
        binding(source)
        with self.assertRaises(AssertionError):
            binding(source.replace('from app.api.v1.financial_safety import safe_create_expense as create_expense',
                                   'from app.api.v1.finance_expenses import create_expense'))


class CommercialSeedTests(unittest.TestCase):
    def test_request_paths_match_registered_routes_without_double_api_prefix(self):
        from app.main import app
        from starlette.routing import compile_path
        routes = app.openapi()["paths"]
        seed.seed_commercial(self.db, self.tenant, self.req, DAY, {'account_id': 'account'})
        for method, path in self.requests:
            self.assertFalse(path.startswith('/api/'), path)
            matches = [route for route, operations in routes.items()
                       if method.lower() in operations and compile_path(route)[0].fullmatch('/api/v1'+path)]
            self.assertEqual(1, len(matches), (method, path))

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.gate = self.stack.enter_context(patch.object(seed, 'assert_financial_fixture_target'))
        self.audit = self.stack.enter_context(patch.object(seed, 'audit_organization_accounting', return_value=NS(ok=True)))
        self.db, self.tenant = Mock(), NS(organization_id='org')
        self.account = NS(organization_id='org', currency='USD', is_active=True)
        self.db.get.return_value = self.account
        self.requests = []
        self.req = lambda method, path: self.requests.append((method, path)) or Mock()
        self.calls = []
        self.services = {}
        counts = {}
        for name in SERVICES:
            def response(*args, _name=name, **kwargs):
                self.calls.append((_name, args, kwargs))
                counts[_name] = counts.get(_name, 0)+1
                ident = f'{_name}-{counts[_name]}'
                if _name in ['change_quotation_status', 'change_order_status']:
                    ident = args[0]
                return NS(id=ident, quotation_number='Q-'+ident, order_number='O-'+ident,
                          task_code='T-'+ident, receipt_number='R-'+ident, expense_number='E-'+ident)
            self.services[name] = self.stack.enter_context(patch.object(seed, name, side_effect=response))

    def run_seed(self, day=DAY, shared=None):
        return seed.seed_commercial(self.db, self.tenant, self.req, day, shared if shared is not None else {'account_id':'account'})

    def test_strict_shared_gate_precedes_any_record_creation(self):
        self.gate.side_effect = RuntimeError('unverified target')
        with self.assertRaises(RuntimeError): self.run_seed()
        self.db.get.assert_not_called()
        for service in self.services.values(): service.assert_not_called()

    def test_bad_date_account_and_identity_fail_before_writes(self):
        for change in [lambda: setattr(self.account, 'organization_id', 'other'),
                       lambda: setattr(self.account, 'currency', 'EUR'), lambda: setattr(self.account, 'is_active', False)]:
            self.account.organization_id, self.account.currency, self.account.is_active = 'org', 'USD', True
            change()
            with self.assertRaises(RuntimeError): self.run_seed()
            self.assertEqual(self.calls, [])
        self.account.organization_id, self.account.currency, self.account.is_active = 'org', 'USD', True
        with self.assertRaises(RuntimeError): self.run_seed(day='2026-10-30')
        with self.assertRaises(RuntimeError): self.run_seed(shared={})
        self.assertEqual(self.calls, [])

    def test_normal_service_sequence_preserves_distinct_edit_and_settlement_states(self):
        result = self.run_seed()
        self.gate.assert_called_once_with(self.db, self.tenant)
        self.assertEqual([args[1].status for name,args,_ in self.calls if name=='change_quotation_status'], ['sent','accepted'])
        self.assertEqual([args[1].status for name,args,_ in self.calls if name=='change_order_status'], ['in_progress','completed'])
        ids = result['typed_ids']
        self.assertNotEqual(ids['order_id'], ids['settlement_order_id'])
        self.assertNotEqual(ids['quotation_id'], ids['accepted_quotation_id'])
        self.assertNotEqual(ids['project_order_id'], ids['order_id'])
        self.assertTrue(result['accounting_integrity'])
        self.assertNotEqual(ids['warehouse_id'], ids['secondary_warehouse_id'])
        self.assertEqual(self.services['create_warehouse'].call_count, 2)
        self.audit.assert_called_once_with(self.db, 'org')
        self.assertEqual(result['route_overrides']['/dashboard/orders/[orderId]/settlement'], '/dashboard/orders/'+ids['settlement_order_id']+'/settlement')
        self.assertEqual(result['route_overrides']['/dashboard/projects/new'], '/dashboard/projects/new?order_id='+ids['order_id'])

    def test_posted_inventory_and_expense_are_small_exact_normal_service_payloads(self):
        self.run_seed()
        receipt = self.services['receive_purchase'].call_args.args[0]
        self.assertEqual(receipt.items[0].quantity, Decimal('1'))
        self.assertEqual(receipt.items[0].unit_cost, Decimal('1.01'))
        self.assertEqual(receipt.currency, 'USD')
        expense = self.services['create_expense'].call_args.args[0]
        self.assertEqual((expense.expense_amount, expense.account_amount), (Decimal('1.01'),Decimal('1.01')))
        self.assertEqual(expense.account_id, 'account')
        self.assertEqual(expense.vendor_id, self.services['receive_purchase'].call_args.args[0].vendor_id)
        self.db.add.assert_not_called()
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()

    def test_no_plaintext_vault_or_document_content_in_registry_and_no_reveal(self):
        result = self.run_seed()
        vault = self.services['create_credential'].call_args.args[1]
        self.assertEqual(vault.environment, 'test')
        self.assertEqual(vault.access_level, 'manager_only')
        self.assertIn('NONFUNCTIONAL', vault.secret)
        self.assertNotIn(vault.secret, json.dumps(result))
        file = self.services['upload_project_document'].call_args.args[4]
        self.assertTrue(file.file.closed)
        self.assertFalse(any('/reveal' in path for _,path in self.requests))
        self.assertEqual(set(result), {'typed_ids','route_overrides','route_contracts','accounting_integrity','fixture_labels'})

    def test_every_assigned_route_has_typed_actual_path_and_read_contract(self):
        result = self.run_seed()
        route_file = Path(__file__).parents[2]/'frontend/e2e-admin-readonly/routes.json'
        routes = json.loads(route_file.read_text())['routes']
        expected = {r['pattern'] for r in routes if r['module'] in ['quotations','orders','projects','inventory','expenses','clients','crm']}
        self.assertEqual(set(result['route_overrides']), expected)
        self.assertEqual(set(result['route_contracts']), expected)
        for pattern, actual in result['route_overrides'].items():
            self.assertNotIn('[', actual)
            contract = result['route_contracts'][pattern]
            self.assertTrue(contract['heading'])
            self.assertEqual(contract['expected_mode'], 'ready')
            self.assertTrue(all(path.startswith('/api/') and '?' not in path for path in contract['expected_get_paths']))

    def test_loaded_record_fields_not_static_editor_shells_are_required(self):
        contracts = self.run_seed()['route_contracts']
        for kind in ['items','suppliers','warehouses','categories']:
            fields = contracts[f'/dashboard/inventory/{kind}/[recordId]/edit']['ready_fields']
            self.assertEqual(len(fields), 1)
            self.assertTrue(fields[0]['value'].startswith('Read-only synthetic '))
        self.assertEqual(contracts['/dashboard/inventory/transfers/new']['ready_fields'], [{'label':'Reason','value':'Stock transfer'}])
        self.assertEqual(contracts['/dashboard/inventory/adjustments/new']['ready_fields'], [{'label':'Reason','value':''}])
        credential = contracts['/dashboard/projects/[projectId]/credentials/[recordId]/edit']
        self.assertEqual(credential['ready_fields'][0]['label'], 'Name')
        self.assertIn('The current secret is not loaded into this editor. Leave the new secret blank to keep it unchanged.', credential['ready_text'])
        self.assertNotIn('secret', str(credential['ready_fields']).lower())
        for kind in ['milestones','tasks','documents','credentials']:
            self.assertTrue(contracts[f'/dashboard/projects/[projectId]/{kind}/[recordId]/edit']['ready_fields'][0]['value'])

    def test_partial_service_failure_is_fatal_without_repeat_or_fake_registry(self):
        self.services['receive_purchase'].side_effect = RuntimeError('failed receipt')
        with self.assertRaises(RuntimeError): self.run_seed()
        self.services['receive_purchase'].assert_called_once()
        self.services['create_expense'].assert_not_called()
        self.audit.assert_not_called()

    def test_malformed_service_identity_never_becomes_a_fake_route(self):
        self.services['create_expense'].side_effect = None
        self.services['create_expense'].return_value = NS(id=None, expense_number='Synthetic')
        with self.assertRaisesRegex(RuntimeError, 'invalid fixture record ID'):
            self.run_seed()

    def test_integrity_failure_does_not_return_success(self):
        self.audit.return_value = NS(ok=False)
        with self.assertRaises(RuntimeError): self.run_seed()
        self.services['create_expense'].assert_called_once()


if __name__ == '__main__': unittest.main()
