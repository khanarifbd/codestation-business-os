"""Actual fixture gate prefixes exercised against the real gate helper/fake PG.

No configured engine or provider. These are ownership/order contract regressions,
not a substitute for the real PostgreSQL verification scripts in CI.
"""
import ast
from datetime import date
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from sqlalchemy.orm import Session
from period_entrypoint_harness import DB, GATE, gate_namespace, gate_sql, load_functions

ROOT = Path(__file__).resolve().parents[1]
# Each anchor is the first accounting fixture effect/read in a new transaction.
CASES = (
    ('verify_reporting_currency.py', 'financial', 0),
    ('verify_functional_currency_change.py', 'ensure_default_chart', 0),
    ('verify_functional_currency_change.py', 'post_journal', 0),
    ('verify_functional_currency_change.py', 'cash', 1),
    ('verify_accounting_multicurrency.py', 'exchange_rate', 0),
    ('verify_financial_corrections_part2.py', 'expense', 0),
    ('verify_inventory_payables_migration.py', 'ensure_default_chart', 0),
    ('verify_v1_accounting_integrity.py', 'sync_result', 0),
    ('verify_financial_corrections.py', 'sync_result', 0),
    ('verify_finance_controls.py', 'posted', 0),
    ('verify_stripe_accounting_posting.py', 'posted', 0),
    ('verify_stripe_payout_lifecycle.py', 'post_financial_account_opening', 0),
    ('verify_transfers.py', 'post_financial_account_opening', 0),
    ('verify_transfers.py', 'post_financial_account_opening', 1),
    ('verify_transfers.py', 'transfer_row', 0),
    ('verify_transfers.py', 'same_transfer_row', 0),
    ('verify_finance.py', 'cancelled_direct', 0),
    ('verify_sales_catalog_flow.py', 'cancelled_invoice', 0),
)

def prefixes(filename, anchor):
    tree = ast.parse((ROOT / 'scripts' / filename).read_text())
    matches = []
    for parent in ast.walk(tree):
        for _, value in ast.iter_fields(parent):
            if not isinstance(value, list): continue
            for i, node in enumerate(value):
                is_assign = isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == anchor for t in node.targets)
                is_call = isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == anchor
                if is_assign or is_call:
                    previous = value[i-1] if i else None
                    matches.append((node.lineno, previous))
    return [previous for _,previous in sorted(matches)]

class JournalFixtureGateTests(unittest.TestCase):
    def test_fixture_prefixes_acquire_actual_ownership_before_accounting(self):
        for filename, anchor, index in CASES:
            with self.subTest(script=filename, anchor=anchor, index=index):
                previous = prefixes(filename, anchor)[index]
                self.assertIsInstance(previous, ast.Expr)
                self.assertIsInstance(previous.value, ast.Call)
                self.assertEqual(getattr(previous.value.func, 'id', None), 'acquire_accounting_period_gate')
                db = DB()
                ns = dict(gate_namespace(), db=db, organization=NS(id='synthetic-org'), org=NS(id='synthetic-org'),
                          tenant=NS(organization_id='synthetic-org'), organization_id='synthetic-org', o=NS(id='synthetic-org'))
                exec(compile(ast.Module(body=[previous], type_ignores=[]), '<actual fixture gate>', 'exec'), ns)
                GATE.require_accounting_period_gate(db, 'synthetic-org')
                self.assertEqual(len(gate_sql(db)), 1)

    def test_direct_sync_fixture_prefix_reaches_real_journal_date_guard(self):
        for filename in ('verify_v1_accounting_integrity.py', 'verify_financial_corrections.py'):
            with self.subTest(script=filename):
                tree = ast.parse((ROOT / 'scripts' / filename).read_text())
                call = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign)
                            and any(isinstance(target, ast.Name) and target.id == 'sync_result' for target in node.targets))
                previous = prefixes(filename, 'sync_result')[0]
                # Run the actual adjacent acquisition if present; otherwise the actual
                # call reaches the real leaf guard unowned, reproducing the CI failure.
                owned_prefix = (isinstance(previous, ast.Expr) and isinstance(previous.value, ast.Call)
                                and getattr(previous.value.func, 'id', None) == 'acquire_accounting_period_gate')
                db = DB()
                today = date(2026, 10, 29)
                def sync(db, *, organization_id, **kwargs):
                    GATE.ensure_accounting_period_open(db, organization_id, today)
                    return {'counts': {}, 'errors': []}
                ns = dict(gate_namespace(), db=db, business_today=today,
                          organization=NS(id='synthetic-org'), user=NS(id='synthetic-user'),
                          tenant=NS(organization_id='synthetic-org', user_id='synthetic-user',
                                    organization=NS(currency='BDT')), sync_operational_accounting=sync)
                body = ([previous] if owned_prefix else []) + [call]
                exec(compile(ast.Module(body=body, type_ignores=[]), '<actual direct sync boundary>', 'exec'), ns)
                self.assertEqual(len(gate_sql(db)), 1)
                self.assertTrue(any(item[0] == 'period_read' for item in db.events))

    def test_direct_cancellation_prefix_reaches_real_reversal_guard(self):
        # Compile the actual reversal, stopping at its first DB read: the missing
        # transaction ownership must be rejected before that read, not waived.
        class ReachedOriginalLookup(Exception):
            pass
        class ReversalDB(DB):
            def scalar(self, statement):
                raise ReachedOriginalLookup
        reverse = load_functions('app/services/journal_reversal.py', ['reverse_source_journal'],
                                 gate_namespace())['reverse_source_journal']
        for filename, anchor in (('verify_finance.py', 'cancelled_direct'),
                                 ('verify_sales_catalog_flow.py', 'cancelled_invoice')):
            with self.subTest(script=filename):
                db = ReversalDB()
                kwargs = dict(organization_id='synthetic-org', user_id='synthetic-user',
                              source_type='invoice_issue', source_id='synthetic-invoice',
                              reversal_date=date(2026, 10, 29), reason='Synthetic cancellation')
                with self.assertRaises(GATE.AccountingPeriodGateError):
                    reverse(db, **kwargs)
                self.assertEqual(db.events, [])
                previous = prefixes(filename, anchor)[0]
                owned = (isinstance(previous, ast.Expr) and isinstance(previous.value, ast.Call)
                         and getattr(previous.value.func, 'id', None) == 'acquire_accounting_period_gate')
                if owned:
                    ns = dict(gate_namespace(), db=db, tenant=NS(organization_id='synthetic-org'))
                    exec(compile(ast.Module(body=[previous], type_ignores=[]), '<actual cancel fixture gate>', 'exec'), ns)
                with self.assertRaises(ReachedOriginalLookup):
                    reverse(db, **kwargs)
                self.assertEqual(len(gate_sql(db)), 1)

    def test_catalog_cancel_after_rollback_starts_real_session_root(self):
        source = ast.parse((ROOT / 'scripts/verify_sales_catalog_flow.py').read_text())
        guard_source = ast.parse((ROOT / 'app/services/accounting_period_gate.py').read_text())
        nodes = [node for node in guard_source.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                 and node.name in {'AccountingPeriodGateError', '_active_root'}]
        guard = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual root guard>', 'exec'), guard)
        for parent in ast.walk(source):
            for _, body in ast.iter_fields(parent):
                if not isinstance(body, list):
                    continue
                end = next((i for i, node in enumerate(body) if isinstance(node, ast.Assign)
                            and any(isinstance(t, ast.Name) and t.id == 'cancelled_invoice' for t in node.targets)), None)
                if end is None:
                    continue
                start = max(i for i, node in enumerate(body[:end])
                            if ast.unparse(node) == 'db.rollback()')
                with Session() as db:
                    old_root = db.begin()
                    checked = []
                    def acquire(db, organization_id):
                        checked.append(guard['_active_root'](db))
                        self.assertEqual(organization_id, 'synthetic-org')
                    ns = dict(db=db, tenant=NS(organization_id='synthetic-org'),
                              acquire_accounting_period_gate=acquire)
                    exec(compile(ast.Module(body=body[start:end], type_ignores=[]), '<actual catalog rollback prefix>', 'exec'), ns)
                    self.assertEqual(len(checked), 1)
                    self.assertIsNot(checked[0], old_root)
                return
        self.fail('Cancellation fixture boundary not found')

    def test_direct_posting_fixture_prefixes_reach_real_journal_date_guard(self):
        tree = ast.parse((ROOT / 'app/services/accounting_posting.py').read_text())
        adapter = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'ensure_open_period')
        posting = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'post_journal')
        cases = [('verify_stripe_accounting_posting.py', 'posted', 0),
                 ('verify_stripe_payout_lifecycle.py', 'post_financial_account_opening', 0),
                 ('verify_transfers.py', 'post_financial_account_opening', 0),
                 ('verify_transfers.py', 'post_financial_account_opening', 1),
                 ('verify_transfers.py', 'transfer_row', 0),
                 ('verify_transfers.py', 'same_transfer_row', 0)]
        for filename, anchor, index in cases:
            with self.subTest(script=filename, anchor=anchor, index=index):
                db = DB()
                ns = dict(gate_namespace(), db=db, org=NS(id='synthetic-org'),
                          tenant=NS(organization_id='synthetic-org'),
                          organization_id='synthetic-org', entry_date=date(2026, 10, 29), date=date)
                exec(compile(ast.Module(body=[adapter], type_ignores=[]), '<actual period adapter>', 'exec'), ns)
                validation = compile(ast.Module(body=[posting.body[0]], type_ignores=[]), '<actual journal guard>', 'exec')
                with self.assertRaises(GATE.AccountingPeriodGateError):
                    exec(validation, ns)
                self.assertEqual(db.events, [])
                previous = prefixes(filename, anchor)[index]
                owned = (isinstance(previous, ast.Expr) and isinstance(previous.value, ast.Call)
                         and getattr(previous.value.func, 'id', None) == 'acquire_accounting_period_gate')
                if owned:
                    exec(compile(ast.Module(body=[previous], type_ignores=[]), '<actual posting fixture prefix>', 'exec'), ns)
                exec(validation, ns)
                self.assertEqual(len(gate_sql(db)), 1)
                self.assertTrue(any(event[0] == 'period_read' for event in db.events))

    def test_stripe_fixture_commit_patch_preserves_root_for_post_and_replay(self):
        tree = ast.parse((ROOT / 'scripts/verify_stripe_accounting_posting.py').read_text())
        context = next(node for node in ast.walk(tree) if isinstance(node, ast.With)
                       and any(isinstance(child, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'posted'
                               for t in child.targets) for child in node.body))
        # The real fixture supplies an active root from preceding ORM reads/flushes.
        # Exercise its exact patch context against real SQLAlchemy commit semantics.
        body = ast.parse('db.commit(); roots.append(db.get_transaction()); db.commit(); roots.append(db.get_transaction())').body
        wrapper = ast.With(items=context.items, body=body)
        module = ast.fix_missing_locations(ast.Module(body=[wrapper], type_ignores=[]))
        with Session() as db:
            original = db.begin()
            roots = []
            exec(compile(module, '<actual Stripe fixture commit patch>', 'exec'), dict(db=db, patch=patch, roots=roots))
            self.assertEqual(roots, [original, original])
            self.assertTrue(original.is_active)
            db.rollback()
            self.assertIsNone(db.get_transaction())

    def test_correction_fixture_tenants_use_same_session_mapped_organization(self):
        from dataclasses import dataclass
        from sqlalchemy import inspect
        from sqlalchemy.orm import make_transient_to_detached
        from app.models.organization import Organization
        files = ['transfers', 'fixed_assets', 'capital', 'accounting_loans',
                 'accounting_money_integrity', 'financial_corrections',
                 'financial_corrections_part2', 'payroll', 'reports', 'tax_center', 'financial_idempotency', 'sales_catalog_flow']
        fixture = dict(id='synthetic-org', organization_id='synthetic-org',
                       user_id='synthetic-user', created_by_user_id='synthetic-user',
                       membership_id='synthetic-member', timezone='UTC', currency='USD',
                       name='Synthetic fixture', country_code='US', financial_year_start_month=1)
        for name in files:
            with self.subTest(script=name):
                tree = ast.parse((ROOT / 'scripts' / f'verify_{name}.py').read_text())
                classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
                constructor = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign)
                                   and any(isinstance(t, ast.Name) and t.id == 'tenant' for t in node.targets))
                ns = dict(dataclass=dataclass, Organization=Organization, fixture=fixture, row=fixture, currency='USD')
                exec(compile(ast.Module(body=classes, type_ignores=[]), '<actual fixture classes>', 'exec'), ns)
                with Session() as db:
                    org = Organization(id='synthetic-org', timezone='UTC', currency='USD', name='Synthetic fixture')
                    make_transient_to_detached(org)
                    db.add(org)
                    # Execute the exact mapped lookup/absence check when present,
                    # then the original tenant constructor. Identity-map GET needs no DB.
                    bindings = []
                    for parent in ast.walk(tree):
                        for _, body in ast.iter_fields(parent):
                            if isinstance(body, list) and constructor in body:
                                idx = body.index(constructor)
                                bindings = body[max(0, idx-2):idx]
                    mapped = [node for node in bindings if isinstance(node, (ast.Assign, ast.If))
                              and ('organization = db.get(Organization' in ast.unparse(node)
                                   or ast.unparse(node).startswith('if organization is None:'))]
                    ns['db'] = db
                    exec(compile(ast.Module(body=mapped + [constructor], type_ignores=[]), '<actual fixture tenant>', 'exec'), ns)
                    tenant = ns['tenant']
                    self.assertIs(tenant.organization, org)
                    self.assertIs(inspect(tenant.organization).session, db)
                    self.assertTrue(inspect(tenant.organization).persistent)
                    self.assertEqual(tenant.organization_id, org.id)
                    self.assertEqual(tenant.user_id, 'synthetic-user')
                    self.assertEqual((tenant.organization.currency, tenant.organization.timezone), ('USD', 'UTC'))
                    with patch.object(db, 'get', return_value=None):
                        with self.assertRaisesRegex(AssertionError, 'Fixture organization is missing'):
                            exec(compile(ast.Module(body=mapped + [constructor], type_ignores=[]), '<missing fixture organization>', 'exec'), ns)

    def test_correction_actual_refresh_still_rejects_unmapped_organization(self):
        from sqlalchemy.orm.exc import UnmappedInstanceError
        tree = ast.parse((ROOT / 'app/api/v1/financial_corrections.py').read_text())
        handler = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'reverse_business_transaction')
        refresh = handler.body[1]
        self.assertEqual(ast.unparse(refresh), "db.refresh(tenant.organization, attribute_names=['currency', 'timezone'])")
        with Session() as db:
            with self.assertRaises(UnmappedInstanceError):
                exec(compile(ast.Module(body=[refresh], type_ignores=[]), '<actual correction refresh>', 'exec'),
                     dict(db=db, tenant=NS(organization=NS(currency='USD', timezone='UTC'))))

    def test_money_fixture_each_direct_request_owns_root_without_committing(self):
        self.assert_direct_request_roots('verify_accounting_money_integrity.py', 22)

    def test_idempotency_fixture_each_direct_request_owns_root_without_committing(self):
        self.assert_direct_request_roots('verify_financial_idempotency.py', 8)

    def test_fixed_assets_fixture_requests_own_roots(self):
        self.assert_direct_request_roots('verify_fixed_assets.py', 9, ['create_asset', 'run_depreciation', 'reverse_business_transaction'])

    def test_capital_fixture_requests_own_roots(self):
        self.assert_direct_request_roots('verify_capital.py', 14, ['reverse_business_transaction', 'add_investment_funding', 'add_return', 'company_investor_payout', 'create_investment', 'create_loan', 'create_owner_equity_transaction', 'fund_company_investor', 'fund_project_investor', 'payout', 'repay'])

    def test_accounting_loans_fixture_requests_own_roots(self):
        self.assert_direct_request_roots('verify_accounting_loans.py', 1, ['reverse_business_transaction'])

    def test_payroll_fixture_requests_own_roots(self):
        self.assert_direct_request_roots('verify_payroll.py', 5, ['reverse_business_transaction', 'approve_run', 'pay_run', 'pay_payroll_withholding'])

    def test_tax_fixture_requests_own_roots(self):
        self.assert_direct_request_roots('verify_tax_center.py', 3, ['create_payable_bill', 'create_settlement', 'reverse_business_transaction'])

    def test_reports_fixture_requests_own_roots(self):
        self.assert_direct_request_roots('verify_reports.py', 1, ['reverse_business_transaction'])

    def test_sales_catalog_fixture_sync_owns_root(self):
        self.assert_direct_request_roots('verify_sales_catalog_flow.py', 1, ['sync_accounting'])

    def assert_direct_request_roots(self, filename, expected_count, handlers=None):
        tree = ast.parse((ROOT / 'scripts' / filename).read_text())
        helper = next((node for node in tree.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'ensure_request_transaction'), None)
        guard_tree = ast.parse((ROOT / 'app/services/accounting_period_gate.py').read_text())
        guard_nodes = [node for node in guard_tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                       and node.name in {'AccountingPeriodGateError', '_active_root'}]
        ns = {}
        exec(compile(ast.Module(body=guard_nodes + ([helper] if helper else []), type_ignores=[]), '<actual request root>', 'exec'), ns)
        found = 0
        for parent in ast.walk(tree):
            for _, body in ast.iter_fields(parent):
                if not isinstance(body, list):
                    continue
                for index, node in enumerate(body):
                    call = node.value if isinstance(node, (ast.Assign, ast.Expr)) else None
                    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
                            and (call.func.id in handlers if handlers is not None else
                                 (call.func.id.startswith('safe_') or call.func.id == 'reverse_business_transaction'))):
                        continue
                    found += 1
                    previous = body[index-1] if index else None
                    owned = previous is not None and ast.unparse(previous) == 'ensure_request_transaction(db)'
                    for state in ('new', 'active', 'committed', 'rolled_back'):
                        with self.subTest(line=node.lineno, handler=call.func.id, state=state):
                            with Session() as db:
                                original = None
                                if state != 'new':
                                    original = db.begin()
                                if state == 'committed':
                                    db.commit()
                                elif state == 'rolled_back':
                                    db.rollback()
                                with patch.object(db, 'commit', side_effect=AssertionError('fixture must not commit')), \
                                     patch.object(db, 'rollback', side_effect=AssertionError('fixture must not rollback')):
                                    if owned:
                                        exec(compile(ast.Module(body=[previous], type_ignores=[]), '<actual request prefix>', 'exec'), dict(ns, db=db))
                                    current = ns['_active_root'](db)
                                    if state == 'active':
                                        self.assertIs(current, original)
                                    else:
                                        self.assertIsNot(current, original)
                    with self.subTest(line=node.lineno, prefix=True):
                        self.assertTrue(owned, 'Direct financial request lacks explicit root ownership')
        self.assertEqual(found, expected_count)

    def test_recurring_fixture_prefix_reaches_actual_period_adapter(self):
        adapter = load_functions('app/api/v1/finance_controls.py', ['_ensure_open_period'],
                                 gate_namespace())['_ensure_open_period']
        db = DB()
        with self.assertRaises(GATE.AccountingPeriodGateError):
            adapter(db, 'synthetic-org', date(2026, 10, 29))
        self.assertEqual(db.events, [])
        previous = prefixes('verify_finance_controls.py', 'posted')[0]
        owned = (isinstance(previous, ast.Expr) and isinstance(previous.value, ast.Call)
                 and getattr(previous.value.func, 'id', None) == 'acquire_accounting_period_gate')
        if owned:
            ns = dict(gate_namespace(), db=db, tenant=NS(organization_id='synthetic-org'))
            exec(compile(ast.Module(body=[previous], type_ignores=[]), '<actual recurring fixture gate>', 'exec'), ns)
        adapter(db, 'synthetic-org', date(2026, 10, 29))
        self.assertEqual(len(gate_sql(db)), 1)
        self.assertTrue(any(event[0] == 'period_read' for event in db.events))

    def test_missing_acquisition_still_rejected(self):
        with self.assertRaises(GATE.AccountingPeriodGateError):
            GATE.require_accounting_period_gate(DB(), 'synthetic-org')

    def test_actual_journal_validation_rejects_missing_gate_before_any_read(self):
        tree = ast.parse((ROOT / 'app/services/accounting_posting.py').read_text())
        adapter = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'ensure_open_period')
        posting = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'post_journal')
        db = DB()
        ns = dict(gate_namespace(), db=db, organization_id='synthetic-org', entry_date=date(2026, 10, 29), date=date)
        exec(compile(ast.Module(body=[adapter], type_ignores=[]), '<actual period adapter>', 'exec'), ns)
        validation = compile(ast.Module(body=[posting.body[0]], type_ignores=[]), '<actual journal validation>', 'exec')
        with self.assertRaisesRegex(GATE.AccountingPeriodGateError, 'must be acquired'):
            exec(validation, ns)
        self.assertEqual(db.events, [])
        GATE.acquire_accounting_period_gate(db, 'synthetic-org')
        exec(validation, ns)
        self.assertTrue(any(event[0] == 'period_read' for event in db.events))
