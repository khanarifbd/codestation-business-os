"""Actual payment schema boundaries; no DB, providers or posting execution.

Public financial_safety defers commits and journal guards reject zero-sided
lines. This fixes validation timing, not a demonstrated durable corrupt posting.
"""
from decimal import Decimal
import unittest
from pydantic import ValidationError
from app.schemas.finance import PaymentCreate


class PaymentConversionPositiveDerivedTests(unittest.TestCase):
    def payload(self, **values):
        return PaymentCreate(invoice_id='synthetic-invoice', account_id='synthetic-account',
                             invoice_amount='1', **values)

    def test_explicit_account_amount_rounds_to_zero_rejected_with_existing_message(self):
        with self.assertRaisesRegex(ValidationError, 'account_amount must be at least 0.01'):
            self.payload(account_amount='0.004')

    def test_explicit_rate_rounds_to_zero_rejected_with_existing_message(self):
        with self.assertRaisesRegex(ValidationError, 'exchange_rate is too small'):
            self.payload(exchange_rate='0.000000004')

    def test_rate_only_derived_account_rounds_to_zero_rejected(self):
        with self.assertRaisesRegex(ValidationError, 'account_amount must be at least 0.01'):
            self.payload(exchange_rate='0.004')

    def test_small_invoice_rate_only_derived_account_rounds_to_zero_rejected(self):
        with self.assertRaisesRegex(ValidationError, 'account_amount must be at least 0.01'):
            PaymentCreate(invoice_id='synthetic', account_id='synthetic',
                          invoice_amount='0.01', exchange_rate='0.00000001')

    def test_amount_only_derived_rate_rounds_to_zero_rejected(self):
        with self.assertRaisesRegex(ValidationError, 'exchange_rate is too small'):
            PaymentCreate(invoice_id='synthetic', account_id='synthetic',
                          invoice_amount='10000000', account_amount='0.01')

    def test_explicit_account_half_cent_rounds_up(self):
        value = self.payload(account_amount='0.005')
        self.assertEqual(value.account_amount, Decimal('0.01'))
        self.assertEqual(value.exchange_rate, Decimal('0.01000000'))

    def test_derived_account_half_cent_rounds_up(self):
        value = self.payload(exchange_rate='0.005')
        self.assertEqual(value.account_amount, Decimal('0.01'))
        self.assertEqual(value.exchange_rate, Decimal('0.00500000'))

    def test_smallest_explicit_rate_can_make_positive_receipt(self):
        value = PaymentCreate(invoice_id='synthetic', account_id='synthetic',
                              invoice_amount='1000000', exchange_rate='0.00000001')
        self.assertEqual(value.account_amount, Decimal('0.01'))
        self.assertEqual(value.exchange_rate, Decimal('0.00000001'))

    def test_smallest_derived_rate_can_make_positive_receipt(self):
        value = PaymentCreate(invoice_id='synthetic', account_id='synthetic',
                              invoice_amount='1000000', account_amount='0.01')
        self.assertEqual(value.exchange_rate, Decimal('0.00000001'))

    def test_ordinary_fx_unchanged(self):
        value = self.payload(exchange_rate='120.12345678')
        self.assertEqual(value.account_amount, Decimal('120.12'))
        self.assertEqual(value.exchange_rate, Decimal('120.12345678'))

    def test_explicit_matching_fx_unchanged(self):
        value = self.payload(account_amount='120.12', exchange_rate='120.12345678')
        self.assertEqual(value.account_amount, Decimal('120.12'))

    def test_explicit_mismatch_still_rejected(self):
        with self.assertRaisesRegex(ValidationError, 'account_amount must match'):
            self.payload(account_amount='2', exchange_rate='3')

    def test_no_conversion_inputs_remain_optional(self):
        value = self.payload()
        self.assertIsNone(value.account_amount); self.assertIsNone(value.exchange_rate)

    def test_invoice_amount_positive_floor_unchanged(self):
        with self.assertRaisesRegex(ValidationError, 'invoice_amount must be at least 0.01'):
            PaymentCreate(invoice_id='synthetic', account_id='synthetic', invoice_amount='0.004')


if __name__ == '__main__': unittest.main()
