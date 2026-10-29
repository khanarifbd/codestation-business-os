"""Actual inventory route failure ordering with recording collaborators.

No persistence/concurrency claim: verify exceptions cannot reach the commit or
idempotency-completion boundary; PostgreSQL rollback remains a separate gate.
"""
from datetime import date
from decimal import Decimal as D, ROUND_HALF_UP
from types import SimpleNamespace as NS
from uuid import uuid4
import unittest
from unittest.mock import patch

from period_entrypoint_harness import DB, HTTPException, Model, ModelMeta, load_functions, tenant

MODELS = {name: ModelMeta(name, (Model,), {}) for name in
          ['Product', 'Warehouse', 'PurchaseReceipt', 'PurchaseReceiptItem', 'Order', 'OrderItem', 'OrderFulfillment']}


class InventoryFailurePathTests(unittest.TestCase):
    def setUp(self):
        for name in ('connect', 'connect_ex'):
            self.enterContext(patch('socket.socket.' + name, side_effect=AssertionError('network forbidden')))
        for name in ('create_connection', 'getaddrinfo'):
            self.enterContext(patch('socket.' + name, side_effect=AssertionError('network forbidden')))
        self.db, self.tenant = DB(), tenant('USD')
        self.product = NS(id='product', currency='USD', sku='SYN', unit='each')
        self.source = NS(id='source', name='Source')
        self.target = NS(id='target', name='Target')
        self.effects = []
        arithmetic = load_functions('app/api/v1/inventory.py', ['money', 'qty', 'cost', 'clean'],
            {'ROUND_HALF_UP': ROUND_HALF_UP, 'MONEY': D('.01'), 'QTY': D('.0001'), 'COST': D('.0001')})
        self.base = {**MODELS, **{k: arithmetic[k] for k in ['money', 'qty', 'cost', 'clean']},
            'uuid4': uuid4, 'acquire_accounting_period_gate': lambda *a: None,
            '_tax': lambda *a: None, 'to_base_amount': lambda *a, **k: (a[3], D('1')),
            '_ledger': lambda *a, **k: NS(id='ledger'), 'system_account': lambda *a: NS(id='payable'),
            'PostingLine': lambda **k: NS(**k),
            '_stock_in': lambda *a, **k: self.effects.append('stock_in'),
            'post_journal': lambda *a, **k: self.effects.append('journal'),
            'create_purchase_payable': lambda *a: self.effects.append('payable'),
            'record_activity': lambda *a, **k: self.effects.append('audit')}

    def failure(self, point):
        def fail(*a, **k):
            self.effects.append(point)
            raise RuntimeError(point)
        return fail

    def purchase(self, changes=None, duplicate=False):
        self.db.on_scalar = lambda q: self.source if q.target == 'Warehouse' else self.product
        line = NS(product_id='product', quantity=D('2'), unit_cost=D('5'), tax_code_id=None)
        payload = NS(warehouse_id='source', vendor_id=None, currency='USD',
            items=[line, line] if duplicate else [line], receipt_date=date(2026, 10, 29),
            supplier_name='Synthetic', reference=None, notes=None)
        f = load_functions('app/api/v1/inventory.py', ['receive_purchase'],
                           {**self.base, **(changes or {})})['receive_purchase']
        return f(payload, NS(), self.db, self.tenant)

    def test_duplicate_purchase_line_rejected_before_receipt_or_stock_write(self):
        with self.assertRaises(HTTPException) as error:
            self.purchase(duplicate=True)
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(self.effects, [])
        self.assertFalse(any(e[0] == 'add' for e in self.db.events))
        self.assertEqual(self.db.commits, 0)

    def test_purchase_journal_failure_does_not_commit_receipt_stock_or_payable(self):
        with self.assertRaisesRegex(RuntimeError, 'journal'):
            self.purchase({'post_journal': self.failure('journal')})
        self.assertEqual(self.effects, ['stock_in', 'journal'])
        self.assertEqual(self.db.commits, 0)

    def test_purchase_payable_failure_does_not_commit(self):
        with self.assertRaisesRegex(RuntimeError, 'payable'):
            self.purchase({'create_purchase_payable': self.failure('payable')})
        self.assertEqual(self.effects, ['stock_in', 'journal', 'payable'])
        self.assertEqual(self.db.commits, 0)

    def test_purchase_audit_failure_does_not_commit(self):
        with self.assertRaisesRegex(RuntimeError, 'audit'):
            self.purchase({'record_activity': self.failure('audit')})
        self.assertEqual(self.db.commits, 0)

    def test_successful_purchase_has_single_commit_after_all_effects(self):
        result = self.purchase()
        self.assertEqual(result['status'], 'received')
        self.assertEqual(self.effects, ['stock_in', 'journal', 'payable', 'audit'])
        self.assertEqual(self.db.commits, 1)

    def transfer(self, changes=None):
        self.db.on_scalar = lambda q: self.product if q.target == 'Product' else [self.source, self.target]
        def stock_out(*a, **k):
            self.effects.append('stock_out')
            return NS(total_cost=D('-1'), total_cost_base=D('-1'), unit_cost=D('1'))
        values = {**self.base, '_balance': lambda *a, **k: NS(on_hand_quantity=D('2')),
                  '_stock_out': stock_out, '_stock_in': lambda *a, **k: NS(), **(changes or {})}
        payload = NS(product_id='product', from_warehouse_id='source', to_warehouse_id='target',
            quantity=D('1'), transfer_date=date(2026, 10, 29), reference=None, reason='Synthetic')
        f = load_functions('app/api/v1/inventory_workflows.py', ['transfer_stock'], values)['transfer_stock']
        return f(payload, NS(), self.db, self.tenant)

    def test_transfer_destination_failure_does_not_commit_source_decrement(self):
        with self.assertRaisesRegex(RuntimeError, 'destination'):
            self.transfer({'_stock_in': self.failure('destination')})
        self.assertEqual(self.effects, ['stock_out', 'destination'])
        self.assertEqual(self.db.commits, 0)

    def test_transfer_audit_failure_does_not_commit_movements(self):
        with self.assertRaisesRegex(RuntimeError, 'audit'):
            self.transfer({'record_activity': self.failure('audit')})
        self.assertEqual(self.db.commits, 0)

    def test_transfer_success_commits_once(self):
        self.assertEqual(self.transfer()['status'], 'posted')
        self.assertEqual(self.db.commits, 1)

    def fulfillment(self, *, repeated=False, resource='old-fulfillment', duplicate=False):
        completed = load_functions('app/services/posting_idempotency.py', ['completed_resource'])['completed_resource']
        idem = NS(resource_id=resource, resource_type='order_fulfillment')
        self.db.on_scalar = lambda q: NS(id='order', status='confirmed', currency='USD') if q.target == 'Order' else self.source
        line = NS(order_item_id='line', quantity=D('1'))
        payload = NS(items=[line, line] if duplicate else [line], warehouse_id='source', model_dump=lambda **k: {})
        f = load_functions('app/api/v1/inventory_fulfillment.py', ['fulfill_order'],
            {**self.base, 'reserve_posting': lambda *a, **k: (idem, repeated),
             'completed_resource': completed,
             '_fulfillment_read': lambda *a: {'id': a[-1]}})['fulfill_order']
        return f('order', payload, NS(), self.db, self.tenant)

    def test_completed_fulfillment_retry_returns_original_before_stock_work(self):
        self.assertEqual(self.fulfillment(repeated=True), {'id': 'old-fulfillment'})
        self.assertEqual(self.db.events, [])
        self.assertEqual(self.effects, [])

    def test_incomplete_fulfillment_retry_rejected_without_stock_work(self):
        with self.assertRaises(HTTPException) as error:
            self.fulfillment(repeated=True, resource=None)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.db.events, [])

    def test_duplicate_fulfillment_items_rejected_before_stock_work(self):
        with self.assertRaises(HTTPException) as error:
            self.fulfillment(duplicate=True)
        self.assertEqual(error.exception.status_code, 400)
        self.assertFalse(any(e[0] == 'add' for e in self.db.events))
        self.assertEqual(self.effects, [])
        self.assertEqual(self.db.commits, 0)


if __name__ == '__main__':
    unittest.main()
