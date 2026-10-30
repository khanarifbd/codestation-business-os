"""Portable boundary tests; no engine connection, provider, or database writes."""
from contextlib import ExitStack
from datetime import date
from decimal import Decimal
import importlib.util
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
from sqlalchemy.engine import make_url

spec = importlib.util.spec_from_file_location('readonly_seed', Path(__file__).parents[1] / 'scripts/seed_admin_readonly_financial.py')
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

ENV = {'CI': 'true', 'GITHUB_ACTIONS': 'true', 'QC_BROWSER_FIXTURE': '1', 'E2E_EMAIL': 'fixture@example.com'}
DAY = date(2026, 10, 30)


def context():
    org = NS(id='org', name='Read-only admin sweep synthetic', created_by_user_id='owner', currency='USD')
    owner = NS(id='owner', email='fixture@example.com', is_active=True, is_verified=True)
    member = NS(id='member', organization_id='org', user_id='owner', status='active', is_owner=True)
    tenant = NS(organization_id='org', user_id='owner', membership_id='member', organization=org)
    db = Mock()
    db.get_bind.return_value.url = make_url('postgresql://localhost:5432/codestation_business_os')
    rows = {seed.Organization: org, seed.User: owner, seed.Membership: member}
    db.get.side_effect = lambda model, _id: rows[model]
    db.in_transaction.return_value = False
    return db, tenant, rows


class SeedBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict('os.environ', ENV, clear=True))
        self.stack.enter_context(patch.object(seed, 'settings', NS(environment='test', smtp_host='', smtp_configured=False)))
        self.db, self.tenant, self.rows = context()

    def test_valid_target_checks_actual_bind_and_owner(self):
        seed.assert_financial_fixture_target(self.db, self.tenant)
        self.db.get_bind.assert_called_once()

    def test_target_and_identity_matrix_fails_before_services(self):
        mutations = [
            lambda: setattr(seed.settings, 'environment', 'production'),
            lambda: setattr(seed.settings, 'smtp_host', 'mail.invalid'),
            lambda: setattr(seed.settings, 'smtp_configured', True),
            lambda: setattr(self.db.get_bind.return_value, 'url', make_url('postgresql://remote.invalid:5432/codestation_business_os')),
            lambda: setattr(self.db.get_bind.return_value, 'url', make_url('postgresql://localhost:5432/production')),
            lambda: setattr(self.db.get_bind.return_value, 'url', make_url('postgresql://localhost:55433/codestation_business_os')),
            lambda: setattr(self.db.get_bind.return_value, 'url', make_url('sqlite:///:memory:')),
            lambda: setattr(self.rows[seed.Organization], 'name', 'Real organization'),
            lambda: setattr(self.rows[seed.Organization], 'currency', 'GBP'),
            lambda: setattr(self.rows[seed.Organization], 'created_by_user_id', 'other'),
            lambda: setattr(self.rows[seed.User], 'email', 'other@example.com'),
            lambda: setattr(self.rows[seed.User], 'is_verified', False),
            lambda: setattr(self.rows[seed.User], 'is_active', False),
            lambda: setattr(self.rows[seed.Membership], 'organization_id', 'other'),
            lambda: setattr(self.rows[seed.Membership], 'user_id', 'other'),
            lambda: setattr(self.rows[seed.Membership], 'status', 'inactive'),
            lambda: setattr(self.rows[seed.Membership], 'is_owner', False),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                self.db, self.tenant, self.rows = context()
                seed.settings.environment, seed.settings.smtp_host, seed.settings.smtp_configured = 'test', '', False
                mutate()
                with patch.object(seed, 'create_account') as create:
                    with self.assertRaises(RuntimeError):
                        seed.seed_financial(self.db, self.tenant, Mock(), DAY)
                    create.assert_not_called()

    def test_every_explicit_environment_optin_is_required(self):
        for key in ENV:
            with self.subTest(key=key), patch.dict('os.environ', {key: ''}):
                with self.assertRaises(RuntimeError):
                    seed.assert_financial_fixture_target(self.db, self.tenant)

    def services(self, fail=None, integrity=True):
        calls, loans = [], []
        def service(name):
            def invoke(*args):
                calls.append((name, args))
                self.assertIs(args[-2], self.db)
                self.assertIs(args[-1], self.tenant)
                if name == fail:
                    raise RuntimeError('Synthetic service failure')
                if name == 'create_account':
                    self.assertEqual(args[0].opening_balance, Decimal('0'))
                    return NS(id='account', name='Synthetic account')
                if name == 'create_accounting_loan':
                    item = {'id': f'loan{len(loans)}', 'status': 'draft'}
                    loans.append(item)
                    return item
                if name == 'repay_loan':
                    paid = args[0] == 'loan2'
                    return {'loan': {'id': args[0], 'status': 'paid' if paid else 'active',
                            'outstanding_principal': Decimal('0' if paid else '9'),
                            'undisbursed_amount': Decimal('0' if paid else '10')}}
                if name == 'create_payable_bill': return NS(id='payable-bill', bill_number='BILL-SYNTHETIC')
                if name == 'create_code': return {'id': 'code'}
                if name == 'create_settlement': return {'id': 'settlement'}
                if name == 'create_reconciliation': return {'id': 'reconciliation', 'status': 'draft'}
                return {}
            return invoke
        for name in ('create_account', 'create_accounting_loan', 'approve_loan', 'disburse_loan',
                     'repay_loan', 'create_code', 'create_payable_bill', 'create_settlement', 'create_reconciliation'):
            self.stack.enter_context(patch.object(seed, name, side_effect=service(name)))
        self.stack.enter_context(patch.object(seed, 'system_account', return_value=NS(id='expense-ledger')))
        self.stack.enter_context(patch.object(seed, 'audit_organization_accounting', return_value=NS(ok=integrity)))
        return calls

    def test_only_existing_service_calls_exact_payloads_and_route_identity(self):
        calls = self.services()
        result = seed.seed_financial(self.db, self.tenant, lambda method, path: (method, path), DAY)
        names = [name for name, _ in calls]
        self.assertEqual(names, ['create_account', 'create_accounting_loan', 'create_accounting_loan',
            'approve_loan', 'disburse_loan', 'repay_loan', 'create_accounting_loan', 'approve_loan',
            'disburse_loan', 'repay_loan', 'create_code', 'create_payable_bill', 'create_settlement', 'create_reconciliation'])
        amounts = [(args[1].principal_amount, args[1].fee_withheld_amount) for name, args in calls if name == 'disburse_loan']
        self.assertEqual(amounts, [(Decimal('10'), Decimal('0')), (Decimal('2'), Decimal('0'))])
        repayments = [args[1].model_dump() for name, args in calls if name == 'repay_loan']
        self.assertEqual([r['principal_amount'] for r in repayments], [Decimal('1'), Decimal('2')])
        self.assertTrue(all(r['interest_amount'] == r['fee_amount'] == 0 for r in repayments))
        bill = next(args[0] for name, args in calls if name == 'create_payable_bill')
        self.assertEqual((bill.amount, bill.withholding_tax_code_id, bill.expense_ledger_account_id), (Decimal('10'), 'code', 'expense-ledger'))
        settlement = next(args[0] for name, args in calls if name == 'create_settlement')
        self.assertEqual((settlement.amount, settlement.settlement_type, settlement.account_id), (Decimal('1'), 'withholding_tax_payment', 'account'))
        rec = next(args[0] for name, args in calls if name == 'create_reconciliation')
        self.assertEqual(rec.statement_ending_balance, Decimal('8'))
        self.assertEqual(result['route_overrides']['/dashboard/accounting/loans/[loanId]/close'], '/dashboard/accounting/loans/loan2/close')
        self.assertEqual(result['route_overrides']['/dashboard/accounting/loans/[loanId]/approve'], '/dashboard/accounting/loans/loan0/approve')
        self.assertEqual(result['loan_active_id'], 'loan1')
        self.assertEqual(result['payable_bill_id'], 'payable-bill')
        self.assertTrue(result['accounting_integrity'])
        contracts = result['route_contracts']
        routes = Path(__file__).parents[2] / 'frontend/src/app/dashboard/accounting'
        patterns = {'/dashboard/accounting/' + str(p.relative_to(routes).parent) for family in ('loans', 'tax', 'reconciliation') for p in (routes / family).rglob('page.tsx')}
        self.assertEqual(set(contracts), patterns)
        self.assertEqual(len(contracts), 19)
        for contract in contracts.values():
            self.assertEqual(contract['expected_mode'], 'ready')
            self.assertTrue(contract['ready_text'] or contract.get('ready_button'))
            self.assertTrue((Path(__file__).parents[2] / contract['source']).is_file())
        self.assertEqual(contracts['/dashboard/accounting/loans/[loanId]/repay']['ready_button'], 'Review repayment')
        self.assertIn('/api/accounting/loans/loan1/history', contracts['/dashboard/accounting/loans/[loanId]/repay']['expected_get_paths'])
        self.assertEqual(result['route_overrides']['/dashboard/accounting/tax'], '/dashboard/accounting/tax?date_from=2026-10-30&date_to=2026-10-30')
        self.db.add.assert_not_called()
        self.db.add_all.assert_not_called()
        self.db.commit.assert_not_called()
        self.assertEqual(self.db.begin.call_count, len(calls))

    def test_service_failure_is_not_retried_and_no_registry_is_returned(self):
        calls = self.services(fail='disburse_loan')
        with self.assertRaisesRegex(RuntimeError, 'Synthetic service failure'):
            seed.seed_financial(self.db, self.tenant, Mock(), DAY)
        self.assertEqual(sum(name == 'disburse_loan' for name, _ in calls), 1)
        self.assertNotIn('create_settlement', [name for name, _ in calls])

    def test_integrity_failure_does_not_claim_ready(self):
        self.services(integrity=False)
        with self.assertRaisesRegex(RuntimeError, 'integrity'):
            seed.seed_financial(self.db, self.tenant, Mock(), DAY)

    def test_invalid_date_prevents_first_mutation(self):
        with patch.object(seed, 'create_account') as create:
            with self.assertRaisesRegex(RuntimeError, 'calendar'):
                seed.seed_financial(self.db, self.tenant, Mock(), '2026-10-30')
            create.assert_not_called()


class RemainingSeedTests(unittest.TestCase):
    setUp = SeedBoundaryTests.setUp
    def test_remaining_service_sequence_is_balanced_bounded_and_nonautomatic(self):
        from app.models.finance import FinancialAccount
        from app.models.crm import Client
        import app.api.v1.finance_transfers as transfers
        import app.api.v1.accounting as accounting
        import app.api.v1.accounting_assets as assets
        import app.api.v1.finance_controls as controls
        import app.api.v1.finance as finance
        import app.api.v1.customer_advances as advances
        self.rows[FinancialAccount] = NS(id='account', name='Synthetic account', organization_id='org', currency='USD', is_active=True, opening_balance=Decimal('0'))
        self.rows[Client] = NS(id='client', display_name='Synthetic client', organization_id='org')
        calls = []
        def handler(name, result):
            def run(*args):
                calls.append((name, args))
                if name == 'create_ledger_account': return NS(id='ledger-'+args[0].normal_balance)
                return result
            return run
        targets = [
            (seed, 'create_account', NS(id='destination', name='Synthetic destination')),
            (transfers, 'record_transfer', NS(id='transfer', transfer_number='TR-SYNTHETIC')),
            (accounting, 'create_ledger_account', NS(id='ledger')),
            (accounting, 'create_manual_journal', NS(id='journal', entry_number='JE-SYNTHETIC')),
            (assets, 'create_asset', {'id': 'asset', 'asset_code': 'ASSET-SYNTHETIC'}),
            (controls, 'create_recurring_expense', NS(id='recurring', name='Synthetic recurring', auto_post=False)),
            (controls, 'create_accounting_period', NS(id='period', name='Synthetic period', status='open')),
            (controls, 'close_accounting_period', NS(id='closed-period', name='Synthetic closed period', status='closed')),
            (finance, 'create_invoice', NS(id='invoice')),
            (finance, 'change_invoice_status', NS(id='invoice')),
            (finance, 'record_payment', NS(id='payment', payment_number='PAY-SYNTHETIC')),
            (advances, 'create_advance', NS(id='advance')),
            (finance, 'get_invoice', NS(id='invoice', invoice_number='INV-SYNTHETIC', balance_due=Decimal('9'), amount_paid=Decimal('1'))),
        ]
        for module, name, result in targets:
            self.stack.enter_context(patch.object(module, name, side_effect=handler(name, result)))
        self.stack.enter_context(patch.object(seed, 'audit_organization_accounting', return_value=NS(ok=True)))
        result = seed.seed_remaining_financial(self.db, self.tenant, lambda method, path: (method, path), DAY,
            {'account_id':'account', 'client_id':'client', 'expense_category_id':'category'})
        names = [name for name, _ in calls]
        self.assertEqual(names, ['create_account','record_transfer','create_ledger_account','create_ledger_account',
            'create_manual_journal','create_asset','create_recurring_expense','create_accounting_period',
            'create_accounting_period','close_accounting_period','create_invoice','change_invoice_status',
            'record_payment','create_advance','get_invoice'])
        by_name = lambda name: [args for n, args in calls if n == name]
        transfer = by_name('record_transfer')[0][0]
        self.assertEqual((transfer.source_amount, transfer.destination_amount, transfer.fee_amount), (Decimal('1.01'),Decimal('1.01'),Decimal('0')))
        journal = by_name('create_manual_journal')[0][0]
        self.assertEqual(sum(line.debit for line in journal.lines), Decimal('1.01'))
        self.assertEqual(sum(line.credit for line in journal.lines), Decimal('1.01'))
        self.assertEqual(len({line.ledger_account_id for line in journal.lines}), 2)
        self.assertTrue(all(line.currency == 'USD' and line.original_amount == Decimal('1.01') for line in journal.lines))
        asset = by_name('create_asset')[0][0]
        self.assertEqual(asset.record_mode, 'opening')
        self.assertIsNone(asset.purchase_account_id)
        self.assertEqual(asset.opening_balance_date, DAY)
        self.assertFalse(by_name('create_recurring_expense')[0][0].auto_post)
        periods = [args[0] for args in by_name('create_accounting_period')]
        self.assertNotEqual(periods[0].start_date, periods[1].start_date)
        self.assertTrue(all(p.start_date == p.end_date < DAY for p in periods))
        invoice = by_name('create_invoice')[0][0]
        self.assertEqual(invoice.client_id, 'client')
        self.assertEqual(invoice.items[0].quantity * invoice.items[0].unit_price, Decimal('10'))
        self.assertEqual(by_name('record_payment')[0][0].invoice_amount, Decimal('1'))
        self.assertEqual(by_name('create_advance')[0][0].amount, Decimal('1'))
        self.assertEqual(result['route_overrides']['/dashboard/accounting/money-in/receipts/[kind]/[receiptId]'], '/dashboard/accounting/money-in/receipts/payment/payment')
        self.assertEqual(len(result['route_contracts']), 18)
        app = Path(__file__).parents[2] / 'frontend/src/app'
        patterns = {'/' + str(p.relative_to(app).parent) for p in (app / 'dashboard/accounting/controls').rglob('page.tsx')}
        patterns.update('/' + str(p.relative_to(app).parent) for p in (app / 'dashboard/finance').rglob('page.tsx') if '/invoices/' not in str(p))
        self.assertEqual(set(result['route_contracts']), patterns)
        for contract in result['route_contracts'].values():
            self.assertTrue(contract['ready_text'] or contract.get('ready_button'))
            self.assertTrue((Path(__file__).parents[2] / contract['source']).is_file())
        self.assertEqual(result['route_contracts']['/dashboard/accounting/controls/automation/[recurringId]/retry']['expected_mode'], 'ineligible')
        self.assertNotIn('ready_button', result['route_contracts']['/dashboard/accounting/controls/automation/[recurringId]/retry'])
        self.db.add.assert_not_called()
        self.db.add_all.assert_not_called()

    def test_missing_shared_identity_fails_before_mutation(self):
        with patch.object(seed, 'create_account') as account:
            with self.assertRaisesRegex(RuntimeError, 'shared'):
                seed.seed_remaining_financial(self.db, self.tenant, Mock(), DAY, {})
            account.assert_not_called()


if __name__ == '__main__':
    unittest.main()
