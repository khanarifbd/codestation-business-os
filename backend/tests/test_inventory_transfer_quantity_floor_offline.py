"""Actual transfer, purchase and adjustment schemas; no DB, writes or HTTP."""
from decimal import Decimal, ROUND_HALF_UP
import unittest
from pydantic import ValidationError
from app.schemas.inventory_workflows import InventoryTransferCreate
from app.schemas.inventory import PurchaseLineInput, AdjustmentCreate


class InventoryTransferQuantityFloorTests(unittest.TestCase):
    def payload(self, quantity, **changes):
        values=dict(product_id='synthetic', from_warehouse_id='source', to_warehouse_id='destination',
                    transfer_date='2026-01-01', reason='Synthetic transfer', quantity=quantity)
        return InventoryTransferCreate(**(values | changes))

    def test_positive_input_rounding_to_zero_rejected(self):
        with self.assertRaisesRegex(ValidationError, 'at least 0.0001 after rounding'):
            self.payload('0.00001')

    def test_just_below_half_quantum_rejected(self):
        with self.assertRaisesRegex(ValidationError, 'at least 0.0001 after rounding'):
            self.payload('0.000049999')

    def test_half_quantum_accepted_without_mutating_input(self):
        result=self.payload('0.00005')
        self.assertEqual(result.quantity,Decimal('0.00005'))
        self.assertEqual(result.quantity.quantize(Decimal('.0001'),rounding=ROUND_HALF_UP),Decimal('.0001'))

    def test_minimum_stored_quantity_accepted(self):
        self.assertEqual(self.payload('0.0001').quantity,Decimal('0.0001'))

    def test_extra_decimal_precision_positive_result_still_accepted(self):
        self.assertEqual(self.payload('12.345678').quantity,Decimal('12.345678'))

    def test_large_normal_quantity_unchanged(self):
        self.assertEqual(self.payload('100000000.1234').quantity,Decimal('100000000.1234'))

    def test_large_input_does_not_gain_a_new_schema_quantize_exception(self):
        # Existing downstream numeric limits are outside this narrow floor fix.
        self.assertEqual(self.payload('1e100').quantity,Decimal('1e100'))

    def test_zero_still_rejected(self):
        with self.assertRaises(ValidationError):self.payload('0')

    def test_negative_still_rejected(self):
        with self.assertRaises(ValidationError):self.payload('-0.0001')

    def test_same_warehouse_rule_preserved(self):
        with self.assertRaisesRegex(ValidationError,'warehouses must be different'):
            self.payload('1',to_warehouse_id='source')


class SiblingInventoryQuantityFloorTests(unittest.TestCase):
    def purchase(self, quantity, unit_cost='100000'):
        return PurchaseLineInput(product_id='synthetic',quantity=quantity,unit_cost=unit_cost)

    def adjustment(self, delta):
        return AdjustmentCreate(product_id='synthetic',warehouse_id='synthetic',
                                adjustment_date='2026-01-01',quantity_delta=delta,reason='Synthetic check')

    def test_purchase_zero_stored_quantity_with_nonzero_cost_rejected(self):
        with self.assertRaisesRegex(ValidationError,'at least 0.0001 after rounding'):
            self.purchase('0.00001')

    def test_purchase_just_below_half_quantum_rejected(self):
        with self.assertRaises(ValidationError):self.purchase('0.000049999')

    def test_purchase_half_quantum_and_minimum_preserve_original_values(self):
        for value in ['0.00005','0.0001','12.345678','1e100']:
            with self.subTest(value=value):
                self.assertEqual(self.purchase(value).quantity,Decimal(value))

    def test_purchase_zero_negative_and_negative_cost_still_rejected(self):
        for value in ['0','-1']:
            with self.subTest(value=value),self.assertRaises(ValidationError):self.purchase(value)
        with self.assertRaises(ValidationError):self.purchase('1',unit_cost='-1')
        self.assertEqual(self.purchase('1',unit_cost='0').unit_cost,Decimal(0))

    def test_positive_adjustment_rounding_to_zero_rejected(self):
        with self.assertRaisesRegex(ValidationError,'Adjustment quantity cannot be zero'):
            self.adjustment('0.00001')

    def test_negative_adjustment_rounding_to_zero_rejected(self):
        with self.assertRaisesRegex(ValidationError,'Adjustment quantity cannot be zero'):
            self.adjustment('-0.00001')

    def test_adjustment_half_quantum_both_signs_and_other_values_preserved(self):
        for value in ['0.00005','-0.00005','0.0001','-0.0001','12.345678','-12.345678','1e100','-1e100']:
            with self.subTest(value=value):self.assertEqual(self.adjustment(value).quantity_delta,Decimal(value))

    def test_exact_zero_adjustment_message_preserved(self):
        for value in ['0','-0.0000']:
            with self.subTest(value=value),self.assertRaisesRegex(ValidationError,'Adjustment quantity cannot be zero'):
                self.adjustment(value)


if __name__=='__main__':unittest.main()
