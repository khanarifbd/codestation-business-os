"""Target/metadata tests only: never connect or seed a database."""
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import TestCase, main
from unittest.mock import Mock, patch
from sqlalchemy.engine import make_url
from scripts import seed_admin_readonly_sweep as seed
from scripts.admin_readonly_shared_contracts import shared_route_contracts

ENV = {'CI':'true','GITHUB_ACTIONS':'true','QC_BROWSER_FIXTURE':'1','E2E_EMAIL':'synthetic@example.com'}
class SweepGateTests(TestCase):
    def setUp(self):
        self.stack=ExitStack(); self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict('os.environ',ENV,clear=True))
        self.settings=NS(environment='test',smtp_host='',smtp_configured=False)
        self.stack.enter_context(patch.object(seed,'settings',self.settings))
        self.db=Mock(); self.db.get_bind.return_value.url=make_url('postgresql://localhost:5432/codestation_business_os')
    def test_exact_target(self):
        seed.assert_target_before_creation(self.db)
        self.db.commit.assert_not_called()
    def test_wrong_bound_database_never_admitted(self):
        for url in ['postgresql://example.com:5432/codestation_business_os','postgresql://localhost:5433/codestation_business_os','postgresql://localhost:5432/production','sqlite://']:
            self.db.get_bind.return_value.url=make_url(url)
            with self.subTest(url=url),self.assertRaises(RuntimeError):seed.assert_target_before_creation(self.db)
    def test_each_explicit_gate_required(self):
        for key in ENV:
            with self.subTest(key=key),patch.dict('os.environ',{key:''}),self.assertRaises(RuntimeError):seed.assert_target_before_creation(self.db)
        for name,value in [('environment','production'),('smtp_host','smtp.example.com'),('smtp_configured',True)]:
            with self.subTest(name=name),patch.object(self.settings,name,value),self.assertRaises(RuntimeError):seed.assert_target_before_creation(self.db)
    def test_duplicate_contract_never_partially_merges(self):
        registry={'route_overrides':{},'route_contracts':{'/existing':{}}}
        with self.assertRaises(RuntimeError):seed.merge_registry(registry,{'route_overrides':{'/new':'/new'},'route_contracts':{'/existing':{}}})
        self.assertEqual(registry['route_overrides'],{})
    def test_merge_only_metadata_no_credentials(self):
        registry={'route_overrides':{},'route_contracts':{}}
        result=seed.merge_registry(registry,{'account_id':'synthetic','route_contracts':{'/x':{'heading':'X'}}})
        self.assertEqual(result,{'account_id':'synthetic'})
        self.assertEqual(registry['route_contracts']['/x']['heading'],'X')
    def test_shared_contracts_exact_eighteen_source_paths(self):
        contracts=shared_route_contracts('Read-only admin sweep synthetic','Synthetic Owner')
        self.assertEqual(len(contracts),18)
        root=Path(__file__).resolve().parents[2]
        for route,contract in contracts.items():
            with self.subTest(route=route):
                self.assertTrue((root/contract['source']).is_file())
                self.assertTrue(contract['expected_get_paths'])
                self.assertEqual(contract['expected_mode'],'ready')
                self.assertNotIn('password',contract.keys())
    def test_no_credential_creation_or_retry_and_remaining_stage_order(self):
        source=Path(seed.__file__).read_text()
        self.assertLess(source.index('assert_target_before_creation(db)',source.index('def main')),source.index('response = create_organization'))
        self.assertLess(source.index('commercial = seed_commercial'),source.index('remaining = seed_remaining_financial'))
        self.assertLess(source.index('remaining = seed_remaining_financial'),source.index('hr = seed_hr'))
        self.assertIn("marker.open('x')",source)
        self.assertNotIn('hash_password(',source)
        self.assertNotIn('create_user(',source)
if __name__=='__main__':main()
