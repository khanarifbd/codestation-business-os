"""Actual inventory arithmetic/helpers against recording balances, no SQL/network.

Checks carrying-value conservation, not PostgreSQL locks or persisted rollback.
"""
from datetime import date
from decimal import Decimal as D, ROUND_HALF_UP
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from period_entrypoint_harness import DB, HTTPException, Model, load_functions


class InventoryDepletionCostTests(unittest.TestCase):
    def setUp(self):
        for name in ('connect', 'connect_ex'):
            self.enterContext(patch('socket.socket.' + name, side_effect=AssertionError('network forbidden')))
        for name in ('create_connection', 'getaddrinfo'):
            self.enterContext(patch('socket.' + name, side_effect=AssertionError('network forbidden')))
        self.balances = {'source': NS(on_hand_quantity=D('3'), average_unit_cost=D('.3333'),
            inventory_value=D('1'), average_unit_cost_base=D('.3333'), inventory_value_base=D('1'))}
        self.ns = load_functions('app/api/v1/inventory.py',
            ['money', 'qty', 'cost', '_require_known_base_cost', '_stock_out', '_stock_in'],
            {'MONEY': D('.01'), 'QTY': D('.0001'), 'COST': D('.0001'),
             'ROUND_HALF_UP': ROUND_HALF_UP, 'StockMovement': Model,
             '_balance': lambda db, org, product, warehouse: self.balances[warehouse],
             'movement_base_currency': lambda *a: 'USD'})
        self.db = DB()
        self.product = NS(id='product', sku='SYN', allow_negative_stock=False,
                          standard_cost=D('.3333'), last_purchase_cost=D('.3333'))

    def out(self, quantity='1'):
        return self.ns['_stock_out'](self.db, organization_id='org', user_id='user',
            product=self.product, warehouse=NS(id='source'), movement_date=date(2026, 10, 29),
            quantity=D(quantity), source_type='order_fulfillment', source_id='synthetic',
            reference=None, reason='synthetic')

    def incoming(self, warehouse, quantity, source_cost, base_cost):
        return self.ns['_stock_in'](self.db, organization_id='org', user_id='user',
            product=self.product, warehouse=NS(id=warehouse), movement_date=date(2026, 10, 29),
            quantity=quantity, incoming_total_cost=source_cost, incoming_total_cost_base=base_cost,
            base_currency='USD', source_type='warehouse_transfer', source_id='synthetic',
            reference=None)

    def test_repeated_single_unit_issues_preserve_source_carrying_value(self):
        moves = [self.out() for _ in range(3)]
        self.assertEqual(-sum(m.total_cost for m in moves), D('1'))
        self.assertEqual(self.balances['source'].inventory_value, D('0'))

    def test_repeated_single_unit_issues_preserve_base_carrying_value(self):
        moves = [self.out() for _ in range(3)]
        self.assertEqual(-sum(m.total_cost_base for m in moves), D('1'))
        self.assertEqual(self.balances['source'].inventory_value_base, D('0'))
        self.assertEqual(-moves[-1].total_cost_base, D('.34'))

    def test_partial_issue_retains_existing_average_policy(self):
        movement = self.out()
        self.assertEqual(movement.total_cost, D('-.3333'))
        self.assertEqual(movement.total_cost_base, D('-.33'))
        self.assertEqual(self.balances['source'].on_hand_quantity, D('2'))
        self.assertEqual(self.balances['source'].inventory_value_base, D('.67'))
        self.assertEqual(self.balances['source'].average_unit_cost_base, D('.3333'))

    def test_single_full_issue_relives_exact_source_and_base(self):
        movement = self.out('3')
        self.assertEqual(movement.total_cost, D('-1'))
        self.assertEqual(movement.total_cost_base, D('-1'))
        self.assertEqual(self.balances['source'].on_hand_quantity, D('0'))

    def test_foreign_costs_are_conserved_independently(self):
        bal = self.balances['source']
        bal.inventory_value_base, bal.average_unit_cost_base = D('1.01'), D('.3367')
        moves = [self.out() for _ in range(3)]
        self.assertEqual(-sum(m.total_cost for m in moves), D('1'))
        self.assertEqual(-sum(m.total_cost_base for m in moves), D('1.01'))

    def test_final_unit_cost_snapshot_keeps_average_while_total_absorbs_residual(self):
        self.out(); self.out()
        movement = self.out()
        self.assertEqual(movement.unit_cost, D('.3333'))
        self.assertEqual(movement.unit_cost_base, D('.3333'))
        self.assertEqual(-movement.total_cost, D('.3334'))
        self.assertEqual(-movement.total_cost_base, D('.34'))

    def test_fractional_quantity_final_issue_preserves_both_values(self):
        bal = self.balances['source']
        bal.on_hand_quantity = D('.3')
        bal.average_unit_cost = bal.average_unit_cost_base = D('3.3333')
        moves = [self.out('.1') for _ in range(3)]
        self.assertEqual(-sum(m.total_cost for m in moves), D('1'))
        self.assertEqual(-sum(m.total_cost_base for m in moves), D('1'))
        self.assertEqual(bal.on_hand_quantity, D('0'))

    def test_transfer_last_unit_preserves_combined_warehouse_value(self):
        self.out(); self.out()
        source = self.balances['source']
        before_source, before_base = source.inventory_value, source.inventory_value_base
        self.balances['target'] = NS(on_hand_quantity=D('0'), average_unit_cost=D('0'),
            inventory_value=D('0'), average_unit_cost_base=D('0'), inventory_value_base=D('0'))
        movement = self.out()
        self.incoming('target', D('1'), -movement.total_cost, -movement.total_cost_base)
        self.assertEqual(source.inventory_value + self.balances['target'].inventory_value, before_source)
        self.assertEqual(source.inventory_value_base + self.balances['target'].inventory_value_base, before_base)

    def test_full_reversal_restores_original_carrying_values(self):
        moves = [self.out() for _ in range(3)]
        for movement in moves:
            self.incoming('source', -movement.quantity, -movement.total_cost, -movement.total_cost_base)
        self.assertEqual(self.balances['source'].on_hand_quantity, D('3'))
        self.assertEqual(self.balances['source'].inventory_value, D('1'))
        self.assertEqual(self.balances['source'].inventory_value_base, D('1'))

    def test_insufficient_stock_fails_before_mutation(self):
        original = vars(self.balances['source']).copy()
        with self.assertRaises(HTTPException) as error:
            self.out('4')
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(vars(self.balances['source']), original)
        self.assertEqual(self.db.events, [])

    def test_missing_historical_base_cost_fails_before_mutation(self):
        self.balances['source'].inventory_value_base = None
        original = vars(self.balances['source']).copy()
        with self.assertRaises(HTTPException) as error:
            self.out()
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(vars(self.balances['source']), original)
        self.assertEqual(self.db.events, [])

    def test_allowed_negative_stock_retains_existing_average_policy(self):
        self.product.allow_negative_stock = True
        movement = self.out('4')
        self.assertEqual(movement.total_cost, D('-1.3332'))
        self.assertEqual(movement.total_cost_base, D('-1.33'))
        self.assertEqual(self.balances['source'].on_hand_quantity, D('-1'))


if __name__ == '__main__':
    unittest.main()
