"""Compose actual family metadata using their existing mocked service fixtures.
This verifies routing contracts only, not actual database execution or UI readiness.
"""
from datetime import date
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import test_admin_readonly_financial_seed_unit as financial
import test_admin_readonly_commercial_seed_unit as commercial
import test_admin_readonly_hr_seed_unit as hr
from scripts.seed_admin_readonly_sweep import merge_registry, validate_registry
from scripts.admin_readonly_shared_contracts import shared_route_contracts
from scripts.admin_readonly_accounting_contracts import accounting_route_contracts

class RegistryCompositionTests(unittest.TestCase):
    def capture_case(self, module, case_type, method, function):
        captured=[]; original=getattr(module.seed,function)
        def capture(*args,**kwargs):
            value=original(*args,**kwargs);captured.append(value);return value
        result=unittest.TestResult()
        with patch.object(module.seed,function,side_effect=capture):case_type(method).run(result)
        self.assertTrue(result.wasSuccessful(),str(result.errors+result.failures))
        self.assertEqual(len(captured),1)
        return captured[0]
    def test_all_194_patterns_resolve_once_without_guessed_ids(self):
        base=self.capture_case(financial,financial.SeedBoundaryTests,'test_only_existing_service_calls_exact_payloads_and_route_identity','seed_financial')
        remaining=self.capture_case(financial,financial.RemainingSeedTests,'test_remaining_service_sequence_is_balanced_bounded_and_nonautomatic','seed_remaining_financial')
        # Invoke portable fixture setup directly: no database connection is created.
        c=commercial.CommercialSeedTests();c.setUp()
        try: commerce=c.run_seed()
        finally:c.doCleanups()
        h=hr.HRSeedTests();h.setUp()
        try: people=h.run_seed()
        finally:h.doCleanups()
        registry={'route_contracts':{},'route_overrides':{}}
        for section in [base,commerce,remaining,people]:merge_registry(registry,section)
        ids={**base,**commerce['typed_ids'],**remaining}
        labels={**base['fixture_labels'],**commerce['fixture_labels'],**remaining['fixture_labels']}
        merge_registry(registry,accounting_route_contracts(ids,labels,date(2026,10,30)))
        merge_registry(registry,{'route_contracts':shared_route_contracts('Read-only admin sweep synthetic','Synthetic Owner')})
        manifest=json.loads((Path(__file__).parents[2]/'frontend/e2e-admin-readonly/routes.json').read_text())
        validate_registry(registry,manifest)
        self.assertEqual(len(registry['route_contracts']),194)
        self.assertTrue(all('source' in c for c in registry['route_contracts'].values()))
        level_two={route for route,c in registry['route_contracts'].items() if c['heading_level']==2}
        expected={f'/dashboard/inventory/{section}/[recordId]' for section in ['items','suppliers','warehouses','purchases']}
        expected.update(f'/dashboard/projects/[projectId]/{section}/[recordId]' for section in ['tasks','milestones'])
        self.assertEqual(level_two,expected)
        self.assertEqual(sum(c['heading_level']==1 for c in registry['route_contracts'].values()),188)
        contracts=registry['route_contracts']
        for suffix in ['', '/edit']:
            checks=contracts['/dashboard/quotations/[quotationId]'+suffix]['expected_response_identities']
            self.assertEqual([c['field_path'] for c in checks],[['id'],['id']])
        self.assertEqual(contracts['/dashboard/orders/[orderId]/commercial']['expected_response_identities'][0]['field_path'],['order_id'])
        self.assertEqual(contracts['/dashboard/clients/[clientId]']['expected_response_identities'][0]['field_path'],['client','id'])
        for section in ['tasks','milestones','documents','credentials']:
            pattern='/dashboard/projects/[projectId]/'+section+'/[recordId]/edit'
            checks=contracts[pattern]['expected_response_identities']
            self.assertEqual(checks[0]['field_path'],['id'])
            self.assertEqual(checks[1]['collection_path'],[section])
            self.assertNotIn('field_path',checks[1])
        self.assertNotIn('expected_response_identities',contracts['/dashboard/accounting/invoices/[invoiceId]'])
        for contract in contracts.values():
            for check in contract.get('expected_response_identities',[]):
                self.assertIn(check['pathname'],contract['expected_get_paths'])
                self.assertTrue(check['expected_value'])

if __name__=='__main__':unittest.main()
