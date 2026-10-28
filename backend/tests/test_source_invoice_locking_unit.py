"""Source-invoice serialization contracts; fake sessions, never PostgreSQL execution.

SQL is compiled with the real PostgreSQL dialect. These tests prove handler/query
ordering and compatibility, NOT database concurrency, isolation or deadlock safety.
"""
import ast
from settlement_journal_test_support import restore_v31
import hashlib
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine

from app.api.v1 import finance, projects, order_settlements
from app.models.finance import Invoice, InvoiceItem
from app.schemas.finance import InvoiceSourceCreate
from app.schemas.invoice_payment import InvoicePaymentInstructionsUpdate
from app.schemas.projects import ProjectStatusChange
from app.schemas.order_settlements import OrderSettlementCreate
from app.services import order_settlement
from app.services.accounting_period_gate import acquire_accounting_period_gate, AccountingPeriodGateError

ROOT = Path(__file__).resolve().parents[1]
BASELINE_HASHES = {
    'app/api/v1/finance.py': 'e7695b332b2b1802443e68dde192f574c0352f4ac0c4b7dad98a41daacff838c',
    'app/api/v1/projects.py': 'f2fb099b3b3f4811bbb64e3806afbf9488c16c4b6ecf5aa2d5b2e7fc77452f29',
    'app/services/order_settlement.py': '4a4a1ebd82ed6f1116f51a4738f4d1e6f75a9bff6b9267b0485ecd298e3af077',
    'app/schemas/finance.py': '2f347d589f7812b85521eca1d422fb7ef2d2dfb8625dd6344db36f9713eb2668',
    'app/models/finance.py': '7557bf5b6fc608339ce07bc4e0fd047904706c832518eab97585218aa8a6ebb0',
    'app/models/projects.py': '777be569ab94ea6529faa8c9349c83a1ca2288d5106522f90183d662710f3e07',
    'app/api/v1/order_commercial.py': '2c484c11d65e9ab0bc4d6b7e9dd094208d1ac6a579678330e12da555e59e1a49',
    'app/services/order_commercial.py': '5bcd1014474fcae8042530763dc82c3a9130255937c2d5963365c8f2bd71d340',
    'app/api/v1/manual_orders.py': '61514e713fcdf88543cea62242c8198b3b956c11d2a92f60def2bcde22080b70',
    'app/api/v1/orders.py': 'f25e599cfb1ddb88f2243dd6636df651a2e41ee0d1c3aa61aabc577f7e46fec4',
    'app/api/v1/order_settlements.py': '0c66da897f83dc959fd154e4511ec24a1faa9f7aa509ad793c6ea01a058f8a51',
    'app/api/v1/router.py': '23d87d93c518b9ae00a9699ce90cd580a980b9050d15017e6da74cafcc41943c',
}


def verified_baseline_backend():
    """Require verified original inputs, even when restored at another location."""
    override = os.environ.get('BASELINE_BACKEND')
    if override is not None and not override.strip():
        raise RuntimeError('BASELINE_BACKEND must be a non-empty path to the verified original backend source')
    candidate = (Path(override).expanduser() if override is not None else
                 ROOT.parents[1] / 'business-os-my-work-recovery-20261026/baseline-source/backend')
    if not candidate.is_dir():
        raise RuntimeError(f'Baseline backend is missing: {candidate}. Set BASELINE_BACKEND to the verified original backend source.')
    for relative, expected in BASELINE_HASHES.items():
        path = candidate / relative
        if not path.is_file():
            raise RuntimeError(f'Baseline input is missing: {path}. BASELINE_BACKEND must contain the verified original source files.')
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            raise RuntimeError(f'Baseline SHA256 mismatch for {relative}: expected {expected}, got {actual}. Set BASELINE_BACKEND to the verified original backend source, not a modified working copy.')
    return candidate.resolve()


BASE = verified_baseline_backend()
NOW = datetime(2096, 1, 1, tzinfo=timezone.utc)


def order(**changes):
    values = dict(id='order-one', organization_id='org-one', status='confirmed',
        order_number='ORDER-TEST', client_id='client-one', quotation_id=None,
        assigned_employee_id=None, subject='Synthetic source', currency='USD',
        tax_calculation_mode='inclusive', seller_name_snapshot='Synthetic seller',
        seller_email_snapshot=None, seller_address_snapshot=None, seller_tax_identifier_snapshot=None,
        client_name_snapshot='Synthetic client', client_contact_snapshot=None,
        client_email_snapshot=None, client_address_snapshot=None, client_tax_identifier_snapshot=None,
        subtotal=Decimal('110.00'), discount_total=Decimal('0.00'), tax_total=Decimal('10.00'),
        total=Decimal('110.00'), notes='Original note', terms_conditions=None, internal_notes=None,
        order_date=date(2095, 12, 1))
    values.update(changes)
    return NS(**values)


def project(**changes):
    values = dict(id='project-one', organization_id='org-one', order_id='order-one',
        project_number='PROJECT-TEST', status='active', actual_started_at=None,
        completed_at=None, cancelled_at=None, progress_percent=12)
    values.update(changes)
    return NS(**values)


def item():
    return NS(id='item-one', product_id=None, sort_order=0, item_name_snapshot='Synthetic service',
        sku_snapshot=None, item_type_snapshot='service', unit_snapshot='unit',
        service_duration_months_snapshot=12, description='Original line', quantity=Decimal('1.0000'),
        unit_price=Decimal('110.0000'), discount_percent=Decimal('0.0000'), tax_rate=Decimal('10.0000'),
        line_subtotal=Decimal('110.00'), discount_amount=Decimal('0.00'), taxable_amount=Decimal('110.00'),
        tax_amount=Decimal('10.00'), line_total=Decimal('110.00'))


class StrictGateSession:
    """Explicit root/connection model; never fabricate gate ownership via MagicMock."""
    def __init__(self, events):
        self.events = events
        self.info = {}
        self.is_active = True
        self.root = NS(is_active=True)
        self.connection_root = NS(is_active=True)
        self.driver = NS(autocommit=False)
        self.conn = NS(closed=False, invalidated=False,
            dialect=NS(name='postgresql'),
            connection=NS(driver_connection=self.driver),
            get_transaction=lambda: self.connection_root,
            get_isolation_level=lambda: 'READ COMMITTED')
        self.scalar = Mock()
        self.scalars = Mock()
        self.add = Mock()
        self.flush = Mock(side_effect=lambda: self.events.append('flush'))
        self.commit = Mock(side_effect=self._commit)
        self.rollback = Mock(side_effect=self._rollback)
        self.refresh = Mock()

    def get_transaction(self):
        return self.root

    def get_nested_transaction(self):
        return None

    def connection(self):
        return self.conn

    def execute(self, statement, parameters=None):
        if str(statement) != 'SELECT pg_advisory_xact_lock_shared(:lock_key)':
            raise AssertionError('Unexpected execute SQL: ' + str(statement))
        if not isinstance(parameters, dict) or type(parameters.get('lock_key')) is not int:
            raise AssertionError('Expected real integer advisory key')
        self.events.append('gate')
        return NS()

    def _commit(self):
        if self.info.get('deferred_commit_depth', 0):
            self.flush()
            return
        self.events.append('commit')
        if self.root is not None:
            self.root.is_active = False
        if self.connection_root is not None:
            self.connection_root.is_active = False
        self.root = None
        self.connection_root = None

    def _rollback(self):
        self.events.append('rollback')
        if self.root is not None: self.root.is_active = False
        if self.connection_root is not None: self.connection_root.is_active = False
        self.root = None
        self.connection_root = None


class SourceInvoiceLockingTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(Engine, 'connect', side_effect=AssertionError('Database prohibited')).start()
        patch.object(socket.socket, 'connect', side_effect=AssertionError('Network prohibited')).start()
        self.tenant = NS(organization_id='org-one', user_id='actor-one', organization=NS(timezone='UTC'))
        self.events = []
        self.db = StrictGateSession(self.events)
        self.queries = []
        self.added = []
        self.results = []
        self.db.scalar.side_effect = self.scalar
        self.db.scalars.side_effect = self.scalars
        self.db.add.side_effect = self.add
        self.db.flush.side_effect = lambda: self.events.append('flush')
        self.detail = object()
        self.staged = patch.object(finance, 'staged_billing_enabled', side_effect=lambda *a: self.event_result('staged', False)).start()
        self.number = patch.object(finance, 'next_sequence_code', side_effect=lambda *a: self.event_result('number', 'INV-TEST')).start()
        self.defaults = patch.object(finance, '_financial_defaults', return_value=NS(default_payment_terms_days=30)).start()
        patch.object(finance, '_tenant_today', return_value=date(2096, 1, 1)).start()
        self.invoice_detail = patch.object(finance, '_invoice_detail', return_value=self.detail).start()
        self.activity = patch.object(finance, 'record_activity').start()
        self.instructions = patch.object(finance, 'apply_invoice_payment_instructions').start()
        self.project_detail = patch.object(projects, '_detail', return_value=self.detail).start()
        self.project_activity = patch.object(projects, 'record_activity').start()
        self.completion = patch.object(projects, 'complete_project_execution', return_value={'auto_completed_tasks': 2}).start()
        self.settlement_staged = patch.object(order_settlement, 'staged_billing_enabled', side_effect=lambda *a: self.event_result('settlement-staged', False)).start()
        self.active_invoice = patch.object(order_settlement, '_active_invoice', side_effect=lambda *a: self.event_result('active-invoice', None)).start()

    def event_result(self, label, result):
        self.events.append(label)
        return result

    def scalar(self, statement):
        sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={'literal_binds': True}))
        self.events.append('sql')
        self.queries.append((statement, sql))
        if not self.results:
            raise AssertionError('Unexpected scalar SQL: ' + sql)
        return self.results.pop(0)

    def scalars(self, statement):
        sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={'literal_binds': True}))
        self.events.append('items')
        self.queries.append((statement, sql))
        return NS(all=lambda: [item()])

    def add(self, value):
        if getattr(value, 'id', None) is None:
            value.id = f'synthetic-{len(self.added)}'
        self.added.append(value)

    def expect_http(self, code, callback, text=None):
        with self.assertRaises(HTTPException) as raised:
            callback()
        self.assertEqual(raised.exception.status_code, code)
        if text:
            self.assertIn(text, str(raised.exception.detail))
        return raised.exception

    def create(self, source=None, project_id=None, payment_details=None):
        return finance._create_invoice_from_order(source or order(), project_id, None, self.db, self.tenant, payment_details)

    def assert_order_lock(self, index=0):
        statement, sql = self.queries[index]
        self.assertIn('orders.id = \'order-one\'', sql)
        self.assertIn('orders.organization_id = \'org-one\'', sql)
        self.assertTrue(sql.endswith('FOR NO KEY UPDATE'), sql)
        self.assertTrue(statement.get_execution_options().get('populate_existing'))

    def invoice(self):
        return next(value for value in self.added if isinstance(value, Invoice))

    def test_actual_helper_compiles_tenant_no_key_update_before_checks_and_numbering(self):
        self.results = [order(), None]
        self.assertIs(self.create(), self.detail)
        self.assert_order_lock()
        self.assertEqual(self.events[:4], ['sql', 'staged', 'sql', 'items'])
        self.assertLess(self.events.index('items'), self.events.index('number'))
        self.assertLess(self.events.index('number'), self.events.index('commit'))
        self.db.commit.assert_called_once()
        self.assertFalse(self.results)

    def test_order_route_reloads_preloaded_stale_order(self):
        stale = order(status='confirmed', total=Decimal('999.00'), currency='EUR')
        fresh = order(status='in_progress')
        self.results = [stale, fresh, None]
        self.assertIs(finance.create_invoice_from_order('order-one', None, self.db, self.tenant), self.detail)
        self.assert_order_lock(1)
        self.assertEqual(self.invoice().currency, 'USD')
        self.assertEqual(self.invoice().total, Decimal('110.00'))
        self.assertEqual(self.invoice().balance_due, Decimal('110.00'))
        self.assertEqual(self.invoice().tax_total, Decimal('10.00'))
        self.assertEqual(self.invoice().tax_calculation_mode, 'inclusive')

    def test_existing_source_line_financial_fields_are_copied_without_calculation(self):
        self.results = [order(), None]
        self.create()
        copied = next(value for value in self.added if isinstance(value, InvoiceItem))
        original = item()
        for field in ['quantity', 'unit_price', 'discount_percent', 'tax_rate', 'line_subtotal',
                      'discount_amount', 'taxable_amount', 'tax_amount', 'line_total',
                      'description']:
            self.assertEqual(getattr(copied, field), getattr(original, field), field)

    def test_newly_cancelled_order_blocks_stale_preloaded_state(self):
        self.results = [order(status='cancelled')]
        self.expect_http(409, self.create, 'Cancelled orders')
        self.assert_order_lock()
        self.staged.assert_not_called()
        self.number.assert_not_called()
        self.db.commit.assert_not_called()

    def test_missing_locked_order_stops_without_creation(self):
        self.results = [None]
        self.expect_http(409, self.create, 'Source order')
        self.assert_order_lock()
        self.staged.assert_not_called()
        self.assertFalse(self.added)

    def test_staged_billing_is_checked_after_lock_and_preserves_rejection(self):
        self.results = [order()]
        self.staged.side_effect = lambda *a: self.event_result('staged', True)
        self.expect_http(409, self.create, 'Billing Schedule')
        self.assertEqual(self.events, ['sql', 'staged'])
        self.number.assert_not_called()

    def test_duplicate_statuses_all_reject_before_numbering(self):
        for status in ['draft', 'sent', 'partially_paid', 'paid']:
            with self.subTest(status=status):
                self.results = [order(), NS(status=status, invoice_number='EXISTING')]
                self.expect_http(409, self.create, 'Order already has active invoice EXISTING')
        self.number.assert_not_called()
        self.assertFalse(self.added)

    def test_cancelled_invoices_excluded_and_replacement_can_proceed(self):
        self.results = [order(), None]
        self.create()
        sql = self.queries[1][1]
        self.assertIn("invoices.status != 'cancelled'", sql)
        self.assertIn("invoices.organization_id = 'org-one'", sql)
        self.assertIn("invoices.order_id = 'order-one'", sql)
        self.assertEqual(self.invoice().status, 'draft')

    def test_project_route_revalidates_project_after_same_order_lock(self):
        self.results = [project(), order(), order(), project(), None, None]
        self.assertIs(finance.create_invoice_from_project('project-one', None, self.db, self.tenant), self.detail)
        self.assert_order_lock(2)
        fresh_statement, fresh_sql = self.queries[3]
        self.assertIn("projects.id = 'project-one'", fresh_sql)
        self.assertIn("projects.organization_id = 'org-one'", fresh_sql)
        self.assertTrue(fresh_statement.get_execution_options().get('populate_existing'))
        self.assertEqual(self.invoice().project_id, 'project-one')
        self.assertEqual(self.invoice().order_id, 'order-one')
        self.assertIn("invoices.project_id = 'project-one'", self.queries[4][1])
        self.assertIn("invoices.order_id = 'order-one'", self.queries[5][1])

    def test_project_newly_cancelled_blocks_after_lock(self):
        self.results = [project(), order(), order(), project(status='cancelled')]
        self.expect_http(409, lambda: finance.create_invoice_from_project('project-one', None, self.db, self.tenant), 'Cancelled projects')
        self.assert_order_lock(2)
        self.staged.assert_not_called()
        self.number.assert_not_called()

    def test_project_disappeared_after_discovery_is_not_invoiced(self):
        self.results = [order(), None]
        self.expect_http(404, lambda: self.create(project_id='project-one'), 'Project not found')
        self.staged.assert_not_called()

    def test_project_source_link_change_is_rejected(self):
        self.results = [order(), project(order_id='different-order')]
        self.expect_http(409, lambda: self.create(project_id='project-one'), 'source order has changed')
        self.number.assert_not_called()

    def test_project_duplicate_blocks_order_lookup_and_numbering(self):
        self.results = [order(), project(), NS(invoice_number='PROJECT-EXISTING')]
        self.expect_http(409, lambda: self.create(project_id='project-one'), 'Project already has active invoice')
        self.assertEqual(len(self.queries), 3)
        self.number.assert_not_called()

    def test_order_duplicate_also_blocks_project_caller(self):
        self.results = [order(), project(), None, NS(invoice_number='ORDER-EXISTING')]
        self.expect_http(409, lambda: self.create(project_id='project-one'), 'Order already has active invoice')
        self.number.assert_not_called()

    def test_order_missing_or_outside_tenant_retains_endpoint_404(self):
        self.results = [None]
        self.expect_http(404, lambda: finance.create_invoice_from_order('order-one', None, self.db, self.tenant), 'Order not found')
        self.assertIn("orders.organization_id = 'org-one'", self.queries[0][1])

    def test_project_missing_or_outside_tenant_retains_endpoint_404(self):
        self.results = [None]
        self.expect_http(404, lambda: finance.create_invoice_from_project('project-one', None, self.db, self.tenant), 'Project not found')
        self.assertIn("projects.organization_id = 'org-one'", self.queries[0][1])

    def test_project_missing_source_order_retains_409(self):
        self.results = [project(), None]
        self.expect_http(409, lambda: finance.create_invoice_from_project('project-one', None, self.db, self.tenant), 'Project source order is not available')

    def test_optional_payment_instructions_are_forwarded_unchanged(self):
        details = InvoicePaymentInstructionsUpdate(payment_method='bank_transfer', payment_account_id='account-one')
        self.results = [order(), order(), None]
        finance.create_invoice_from_order('order-one', None, self.db, self.tenant, InvoiceSourceCreate(payment_details=details))
        self.instructions.assert_called_once_with(self.db, organization_id='org-one', invoice=self.invoice(), payload=details)

    def test_completed_legacy_orders_still_allowed(self):
        self.results = [order(status='completed'), None]
        self.create()
        self.assertEqual(self.invoice().status, 'draft')

    def status(self, target):
        return projects.change_project_status('project-one', ProjectStatusChange(status=target), None, self.db, self.tenant)

    def assert_project_lock_order(self):
        self.assertNotIn('FOR UPDATE', self.queries[0][1])
        self.assertIn('SELECT projects.order_id', self.queries[0][1])
        for index, table in [(1, 'orders'), (2, 'projects')]:
            statement, sql = self.queries[index]
            self.assertTrue(sql.endswith('FOR UPDATE'), sql)
            self.assertIn(f"{table}.organization_id = 'org-one'", sql)
            self.assertTrue(statement.get_execution_options().get('populate_existing'))

    def test_project_status_locks_order_then_fresh_project(self):
        current = project()
        self.results = ['order-one', order(), current]
        self.assertIs(self.status('on_hold'), self.detail)
        self.assert_project_lock_order()
        self.assertEqual(current.status, 'on_hold')
        self.project_activity.assert_called_once()
        self.db.commit.assert_called_once()

    def test_project_transition_matrix_preserved(self):
        allowed = {'planned': {'active', 'cancelled'}, 'active': {'on_hold', 'completed', 'cancelled'},
                   'on_hold': {'active', 'cancelled'}, 'completed': set(), 'cancelled': set()}
        statuses = list(allowed)
        for initial in statuses:
            for target in ['active', 'on_hold', 'completed', 'cancelled']:
                with self.subTest(initial=initial, target=target):
                    current = project(status=initial)
                    self.results = ['order-one', order(status='cancelled' if target == 'cancelled' else 'confirmed'), current]
                    if initial == target or target in allowed[initial]:
                        self.assertIs(self.status(target), self.detail)
                    else:
                        self.expect_http(409, lambda: self.status(target), 'Project cannot move')

    def test_project_status_schema_still_rejects_planned_as_target(self):
        with self.assertRaises(ValidationError):
            ProjectStatusChange(status='planned')

    def test_project_missing_discovery_404_without_order_lock(self):
        self.results = [None]
        self.expect_http(404, lambda: self.status('on_hold'), 'Project not found')
        self.assertEqual(len(self.queries), 1)

    def test_project_missing_after_order_lock_404(self):
        self.results = ['order-one', order(), None]
        self.expect_http(404, lambda: self.status('on_hold'), 'Project not found')
        self.assert_project_lock_order()

    def test_project_relinked_after_discovery_stops(self):
        self.results = ['order-one', order(), project(order_id='another-order')]
        self.expect_http(409, lambda: self.status('on_hold'), 'source order has changed')
        self.db.commit.assert_not_called()

    def test_project_missing_order_retains_conflict(self):
        self.results = ['order-one', None, project()]
        self.expect_http(409, lambda: self.status('on_hold'), 'Linked order is no longer available')

    def test_cancel_project_requires_cancelled_order(self):
        self.results = ['order-one', order(), project()]
        self.expect_http(409, lambda: self.status('cancelled'), 'Cancel the linked order')

    def test_cancelled_order_blocks_non_cancel_project_transition(self):
        self.results = ['order-one', order(status='cancelled'), project()]
        self.expect_http(409, lambda: self.status('on_hold'), 'linked order is cancelled')

    def test_project_completion_retains_cascade_and_audit(self):
        current = project()
        self.results = ['order-one', order(), current]
        self.status('completed')
        self.completion.assert_called_once()
        self.assertIs(self.completion.call_args.args[1], current)
        self.assertEqual(self.project_activity.call_args.kwargs['metadata'], {'completion_cascade': {'auto_completed_tasks': 2}})

    def settle(self):
        # A direct service caller must establish the same boundary as its route.
        acquire_accounting_period_gate(self.db, self.tenant.organization_id)
        return order_settlement.settle_order(self.db, organization_id='org-one', user_id='actor-one',
            organization_timezone='UTC', order_id='order-one',
            payload=OrderSettlementCreate(account_id='account-one'), request=None)

    def test_settlement_staged_recheck_follows_order_lock(self):
        self.results = [order(status='completed')]
        self.settlement_staged.side_effect = lambda *a: self.event_result('settlement-staged', True)
        self.expect_http(409, self.settle, 'Billing Schedule')
        self.assertEqual(self.events, ['gate', 'sql', 'settlement-staged'])
        self.assertTrue(self.queries[0][1].endswith('FOR UPDATE'))
        self.assertIn("orders.organization_id = 'org-one'", self.queries[0][1])
        self.active_invoice.assert_not_called()
        self.db.commit.assert_not_called()

    def test_settlement_non_staged_still_requires_completed_order(self):
        self.results = [order()]
        self.expect_http(409, self.settle, 'Complete the order')
        self.settlement_staged.assert_called_once()
        self.active_invoice.assert_not_called()

    def test_settlement_existing_invoice_conflict_unchanged(self):
        self.results = [order(status='completed')]
        self.active_invoice.side_effect = lambda *a: self.event_result('active-invoice', NS(invoice_number='EXISTING'))
        self.expect_http(409, self.settle, 'Order already has active invoice EXISTING')
        self.assertEqual(self.events, ['gate', 'sql', 'settlement-staged', 'active-invoice'])

    def test_settlement_missing_tenant_order_is_404(self):
        self.results = [None]
        self.expect_http(404, self.settle, 'Order not found')
        self.settlement_staged.assert_not_called()

    def test_settlement_route_still_performs_early_check_then_service_rechecks(self):
        with patch.object(order_settlements, 'staged_billing_enabled', return_value=False):
            self.results = [order(status='completed')]
            self.settlement_staged.return_value = True
            self.settlement_staged.side_effect = None
            self.expect_http(409, lambda: order_settlements.create_order_settlement('order-one', OrderSettlementCreate(account_id='account-one'), None, self.db, self.tenant), 'Billing Schedule')
            self.settlement_staged.assert_called_once()
            self.db.rollback.assert_called_once()
            self.db.commit.assert_not_called()
            self.assertIsNone(self.db.get_transaction())


    def test_settlement_service_missing_gate_rejects_before_source_lock(self):
        with self.assertRaises(AccountingPeriodGateError):
            order_settlement.settle_order(self.db, organization_id='org-one', user_id='actor-one',
                organization_timezone='UTC', order_id='order-one',
                payload=OrderSettlementCreate(account_id='account-one'), request=None)
        self.assertEqual(self.events, [])
        self.assertEqual(self.queries, [])

    def test_settlement_route_rejects_autocommit_before_early_check(self):
        self.db.driver.autocommit = True
        with patch.object(order_settlements, 'staged_billing_enabled') as early:
            with self.assertRaises(AccountingPeriodGateError):
                order_settlements.create_order_settlement('order-one',
                    OrderSettlementCreate(account_id='account-one'), None, self.db, self.tenant)
        early.assert_not_called()
        self.assertEqual(self.events, [])



class PreservationTests(unittest.TestCase):
    def text(self, root, path):
        return (root / path).read_text()

    def functions(self, root, path):
        source = self.text(root, path)
        if root == ROOT:
            source = restore_v31(path, source)
        if root == ROOT and path == 'app/api/v1/finance.py':
            # The independently reviewed Money In receipt GET is the only
            # additional route accepted when this lock patch is composed.
            # Pin its entire appended byte block, not merely its function name.
            marker = '\n\n# BEGIN MONEY IN RECEIPT READ'
            if marker in source:
                original, extension = source.split(marker, 1)
                self.assertEqual(
                    hashlib.sha256((marker + extension).encode()).hexdigest(),
                    'c81654d74b6488e85f8b250b9a11d4948a688ce6adb3271314d08b5683a199bb',
                    'Only the exact approved additive payment receipt GET is allowed',
                )
                source = original
            old_lock = 'account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == payload.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update())'
            fresh_lock = old_lock[:-1] + '.execution_options(populate_existing=True))'
            guard = '    ensure_payment_receipt_account_supported(account.account_type)\n'
            payment = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == 'record_payment')
            payment_text = ast.get_source_segment(source, payment)
            self.assertEqual(payment_text.count(fresh_lock), 1)
            self.assertEqual(payment_text.count(guard), 1)
            self.assertIn('detail="Active financial account not found")\n' + guard + '    if account.currency == invoice.currency:', payment_text)
            # Strip only those exact, separately asserted additions; all remaining
            # record_payment AST, route, permission, payload and formulas still compare.
            source = source.replace(fresh_lock, old_lock, 1).replace(guard, '', 1)
        return {node.name: node for node in ast.parse(source).body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def test_other_functions_routes_and_permissions_in_three_files_unchanged(self):
        paths = {'app/api/v1/finance.py': {'_create_invoice_from_order', 'create_invoice_from_project'},
                 'app/api/v1/projects.py': {'change_project_status'},
                 'app/services/order_settlement.py': {'settle_order'}}
        for path, changed in paths.items():
            old, new = self.functions(BASE, path), self.functions(ROOT, path)
            self.assertEqual(set(old), set(new))
            for name in old:
                self.assertEqual([ast.dump(n) for n in old[name].decorator_list], [ast.dump(n) for n in new[name].decorator_list], name)
                self.assertEqual(ast.dump(old[name].args), ast.dump(new[name].args), name)
                if name not in changed:
                    self.assertEqual(ast.dump(old[name]), ast.dump(new[name]), name)

    def test_composed_receipt_reader_changes_are_not_ignored(self):
        source = self.text(ROOT, 'app/api/v1/finance.py')
        marker = '\n\n# BEGIN MONEY IN RECEIPT READ'
        self.assertIn(marker, source)
        original, extension = source.split(marker, 1)
        actual_text = self.text
        for old, new in [('FinanceViewer', 'FinanceManager'),
                         ('Payment.organization_id == tenant.organization_id', 'Payment.id == payment_id'),
                         ('return _payment_read(db, item)', 'return None')]:
            with self.subTest(change=old):
                self.assertIn(old, extension)
                changed = original + marker + extension.replace(old, new, 1)
                with patch.object(self, 'text', side_effect=lambda root, path: changed if root == ROOT and path == 'app/api/v1/finance.py' else actual_text(root, path)):
                    with self.assertRaises(AssertionError):
                        self.test_other_functions_routes_and_permissions_in_three_files_unchanged()

    def test_unapproved_function_outside_pinned_reader_still_fails_preservation(self):
        source = self.text(ROOT, 'app/api/v1/finance.py')
        marker = '\n\n# BEGIN MONEY IN RECEIPT READ'
        self.assertIn(marker, source)
        changed = source.replace(marker, '\n\ndef unapproved_reader():\n    return None\n' + marker, 1)
        actual_text = self.text
        with patch.object(self, 'text', side_effect=lambda root, path: changed if root == ROOT and path == 'app/api/v1/finance.py' else actual_text(root, path)):
            with self.assertRaises(AssertionError):
                self.test_other_functions_routes_and_permissions_in_three_files_unchanged()

    def test_financial_source_invoice_body_is_byte_identical(self):
        marker = '    if order.status == "cancelled":'
        end = '\n\n\n@router.get("/summary"'
        def tail(root):
            text = self.text(root, 'app/api/v1/finance.py').split('def _create_invoice_from_order(', 1)[1]
            return marker + text.split(marker, 1)[1].split(end, 1)[0]
        self.assertEqual(tail(ROOT), tail(BASE))

    def test_project_status_tail_is_byte_identical_except_relocated_order_query(self):
        marker = '    if project.status == payload.status:'
        old = self.text(BASE, 'app/api/v1/projects.py').split('def change_project_status(', 1)[1].split(marker, 1)[1]
        new = self.text(ROOT, 'app/api/v1/projects.py').split('def change_project_status(', 1)[1].split(marker, 1)[1]
        old_query = '''    order = db.scalar(
        select(Order)
        .where(Order.id == project.order_id, Order.organization_id == tenant.organization_id)
        .with_for_update()
    )
'''
        self.assertEqual(old.count(old_query), 1)
        self.assertEqual(new, old.replace(old_query, ''))

    def test_settlement_financial_body_after_existing_status_gate_unchanged(self):
        marker = '    if order.status != "completed":'
        def tail(root):
            source = self.text(root, 'app/services/order_settlement.py')
            if root == ROOT: source = restore_v31('app/services/order_settlement.py', source)
            text = source.split('def settle_order(', 1)[1]
            return text.split(marker, 1)[1]
        new = tail(ROOT)
        validator = '    ensure_accounting_period_open(db, organization_id, settlement_date)\n'
        self.assertEqual(new.count(validator), 1)
        self.assertIn(validator + '    current_balance = _account_balance(db, account)', new)
        self.assertEqual(new.replace(validator, '', 1), tail(BASE))
        function = next(node for node in ast.parse(self.text(ROOT, 'app/services/order_settlement.py')).body
                        if isinstance(node, ast.FunctionDef) and node.name == 'settle_order')
        self.assertEqual(ast.unparse(function.body[0]), 'require_accounting_period_gate(db, organization_id)')

    def test_manual_and_staged_invoice_schema_models_and_handlers_unchanged(self):
        for path in ['app/schemas/finance.py', 'app/models/finance.py', 'app/models/projects.py',
                     'app/api/v1/order_commercial.py', 'app/services/order_commercial.py',
                     'app/api/v1/manual_orders.py', 'app/api/v1/orders.py',
                     'app/api/v1/order_settlements.py', 'app/api/v1/router.py']:
            current = self.text(ROOT, path)
            if path == 'app/api/v1/order_settlements.py':
                current = restore_v31(path, current)
                addition = 'from app.services.accounting_period_gate import acquire_accounting_period_gate\n'
                prefix = '    acquire_accounting_period_gate(db, tenant.organization_id)\n'
                self.assertEqual(current.count(addition), 1)
                self.assertEqual(current.count(prefix), 1)
                route = next(node for node in ast.parse(current).body
                             if isinstance(node, ast.FunctionDef) and node.name == 'create_order_settlement')
                self.assertEqual(ast.unparse(route.body[0]), prefix.strip())
                current = current.replace(addition, '', 1).replace(prefix, '', 1)
            self.assertEqual(current, self.text(BASE, path), path)


    def test_approved_gate_additions_are_not_broad_preservation_waivers(self):
        cases = [
            ('app/api/v1/order_settlements.py',
             '    acquire_accounting_period_gate(db, tenant.organization_id)\n', '',
             self.test_manual_and_staged_invoice_schema_models_and_handlers_unchanged),
            ('app/api/v1/order_settlements.py',
             'acquire_accounting_period_gate(db, tenant.organization_id)',
             'acquire_accounting_period_gate(db, "another-tenant")',
             self.test_manual_and_staged_invoice_schema_models_and_handlers_unchanged),
            ('app/services/order_settlement.py',
             'ensure_accounting_period_open(db, organization_id, settlement_date)',
             'ensure_accounting_period_open(db, organization_id, date.today())',
             self.test_settlement_financial_body_after_existing_status_gate_unchanged),
            ('app/services/order_settlement.py',
             'require_accounting_period_gate(db, organization_id)',
             'require_accounting_period_gate(db, "another-tenant")',
             self.test_settlement_financial_body_after_existing_status_gate_unchanged),
            ('app/api/v1/finance.py',
             'ensure_payment_receipt_account_supported(account.account_type)',
             'ensure_payment_receipt_account_supported("bank")',
             self.test_other_functions_routes_and_permissions_in_three_files_unchanged),
            ('app/api/v1/finance.py',
             '.with_for_update().execution_options(populate_existing=True))',
             '.with_for_update().execution_options(populate_existing=False))',
             self.test_other_functions_routes_and_permissions_in_three_files_unchanged),
        ]
        actual_text = self.text
        for path, old, new, verify in cases:
            with self.subTest(path=path, change=old):
                source = actual_text(ROOT, path)
                self.assertIn(old, source)
                # Preserve all other bytes; any approval adapter must reject this mutation.
                changed = source.replace(old, new, 1)
                with patch.object(self, 'text', side_effect=lambda root, candidate,
                                  target=path, content=changed:
                                  content if root == ROOT and candidate == target else actual_text(root, candidate)):
                    with self.assertRaises(AssertionError):
                        verify()


if __name__ == '__main__':
    unittest.main()
