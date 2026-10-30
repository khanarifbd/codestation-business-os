import json
from datetime import date
from pathlib import Path
import unittest
from scripts.admin_readonly_accounting_contracts import accounting_route_contracts

ROOT = Path(__file__).resolve().parents[2]

class AccountingContracts(unittest.TestCase):
    def setUp(self):
        self.ids = {key:key.replace('_id','')+'-fixture' for key in ('account_id','invoice_id','payment_id','expense_id','payable_bill_id','asset_id','journal_id','transfer_id')}
        self.labels = {key:'Synthetic '+key for key in ('account','invoice','payment_number','expense_number','expense','bill_number','asset','asset_code','journal','transfer','destination','client')}
        self.result = accounting_route_contracts(self.ids,self.labels,date(2026,10,30))
    def test_exact_manifest_35_and_real_source_paths(self):
        routes=json.loads((ROOT/'frontend/e2e-admin-readonly/routes.json').read_text())['routes']
        expected={r['pattern'] for r in routes if r['module']=='accounting' and not any('/'+s in r['pattern'] for s in ('loans','tax','reconciliation','controls'))}
        self.assertEqual(35,len(expected)); self.assertEqual(expected,set(self.result['route_contracts']))
        for contract in self.result['route_contracts'].values():
            self.assertTrue((ROOT/contract['source']).is_file(),contract['source'])
            self.assertEqual('ready',contract['expected_mode'])
            self.assertTrue(contract['ready_text'] or contract.get('ready_fields'))
            self.assertTrue(all(p.startswith('/api/') and '?' not in p for p in contract['expected_get_paths']))
    def test_missing_or_unsafe_fixture_identity_fails_closed(self):
        for key in self.ids:
            for bad in (None,'','../other','id?x=1','[id]'):
                with self.subTest(key=key,bad=bad),self.assertRaises(RuntimeError):
                    accounting_route_contracts({**self.ids,key:bad},self.labels,date(2026,10,30))
        for key in self.labels:
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                accounting_route_contracts(self.ids,{**self.labels,key:''},date(2026,10,30))
        with self.assertRaises(RuntimeError): accounting_route_contracts(self.ids,self.labels,'2026-10-30')
    def test_dynamic_records_proved_and_receipt_override_not_clobbered(self):
        c=self.result['route_contracts']; o=self.result['route_overrides']; root='/dashboard/accounting'
        self.assertNotIn(root+'/money-in/receipts/[kind]/[receiptId]',o)
        self.assertEqual(['/api/finance/payments/payment-fixture'],c[root+'/money-in/receipts/[kind]/[receiptId]']['expected_get_paths'])
        self.assertEqual([{'label':'Account name','value':'Synthetic account'}],c[root+'/accounts/[accountId]/edit']['ready_fields'])
        self.assertIn('asset-fixture',c[root+'/assets/[assetId]']['ready_text'])
        self.assertIn('journal-fixture',c[root+'/advanced/journals/[journalId]/reverse']['ready_text'])
        self.assertIn('payment-fixture',c[root+'/advanced/corrections/[sourceType]/[sourceId]']['ready_text'])
        self.assertTrue(o[root+'/reports/account-statement'].endswith('?account=account-fixture'))
        self.assertTrue(all('[' not in url and url.startswith(root) for url in o.values()))
    def test_only_selected_tab_requests_are_required(self):
        c=self.result['route_contracts'];root='/dashboard/accounting'
        self.assertEqual(['/api/accounting/journals'],c[root+'/advanced']['expected_get_paths'])
        self.assertEqual(['/api/accounting/corrections/candidates'],c[root+'/advanced/corrections']['expected_get_paths'])
        self.assertEqual(['/api/finance/expenses'],c[root+'/money-out']['expected_get_paths'])
        self.assertEqual('Review depreciation',c[root+'/assets/depreciation']['ready_button'])
    def test_static_headings_and_buttons_exist_in_actual_components(self):
        for contract in self.result['route_contracts'].values():
            source=(ROOT/contract['source']).read_text()
            if not contract['heading'].startswith(('Synthetic ','Edit Synthetic ','Settle Synthetic ','Record ')):
                self.assertIn(contract['heading'],source)
            if contract.get('ready_button'): self.assertIn(contract['ready_button'],source)

if __name__=='__main__':unittest.main()
