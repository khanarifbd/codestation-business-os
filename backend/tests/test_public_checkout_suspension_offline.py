"""Actual public-pay and checkout functions, with synthetic storage/provider fakes.

No application config, database, network or real Stripe call. These tests prove
route authorization ordering, not concurrent PostgreSQL suspension semantics.
"""
import hashlib
import hmac
from decimal import Decimal
from types import SimpleNamespace as NS
from uuid import UUID
import unittest
from unittest.mock import patch

from fastapi.responses import RedirectResponse
from period_entrypoint_harness import DB, HTTPException, load_functions

ORG = '11111111-1111-4111-8111-111111111111'
INVOICE = '22222222-2222-4222-8222-222222222222'


class PublicCheckoutSuspensionTests(unittest.TestCase):
    def setUp(self):
        for name in ('connect', 'connect_ex'):
            self.enterContext(patch('socket.socket.' + name, side_effect=AssertionError('network forbidden')))
        for name in ('create_connection', 'getaddrinfo'):
            self.enterContext(patch('socket.' + name, side_effect=AssertionError('network forbidden')))
        self.settings = NS(stripe_live_collection_enabled=True, environment='test',
                           public_app_url='https://app.example.invalid',
                           public_api_url='https://api.example.invalid',
                           payment_gateway_encryption_key='synthetic-not-real-signing-key-' + 'x' * 40)
        links = load_functions('app/services/invoice_stripe_payment_link.py',
            ['_signing_key', '_canonical_uuid', '_signature', 'verify_public_invoice_link'],
            {'settings': self.settings, 'hmac': hmac, 'hashlib': hashlib, 'UUID': UUID})
        self.signature = links['_signature'](ORG, INVOICE)
        self.provider_calls = []

        def provider(**values):
            self.provider_calls.append(values)
            return {'id': 'cs_live_synthetic', 'url': 'https://checkout.example.invalid/new',
                    'expires_at': 2000000000}

        self.functions = load_functions('app/api/v1/stripe_checkout.py',
            ['open_public_live_invoice_checkout', '_create_checkout'],
            {'settings': self.settings, 'RedirectResponse': RedirectResponse,
             'verify_public_invoice_link': links['verify_public_invoice_link'],
             'ORGANIZATION_STATUS_ACTIVE': 'active',
             'to_usd_minor_units': lambda amount, currency: int(amount * 100),
             '_stripe_connection': lambda *a, **k: NS(id='gateway', connection_method='api_key',
                 secret_key_ciphertext='synthetic-key', charges_enabled=True, webhook_secret_ciphertext='synthetic-hook'),
             '_linked_stripe_account': lambda *a: NS(id='receipt-account'),
             '_attempt_json': lambda row: {'checkout_url': row.checkout_url},
             'stripe_checkout_request': provider,
             'decrypt_gateway_secret': lambda value: 'synthetic-key',
             'record_activity': lambda *a, **k: None})

    def database(self, status='active', reused=True):
        db = DB()
        organization_status = status
        invoice = NS(id=INVOICE, organization_id=ORG, status='sent', balance_due=Decimal('15'),
                     currency='USD', created_by_user_id='synthetic-owner', invoice_number='SYN-1',
                     client_email_snapshot='synthetic@example.invalid')

        def scalar(query):
            if query.target == 'Organization.status':
                self.assertIn(('Organization.id', '=', ORG), query.conditions)
                return organization_status
            if query.target == 'Invoice':
                self.assertIn(('Invoice.organization_id', '=', ORG), query.conditions)
                return invoice
            if query.target == 'StripeCheckoutAttempt':
                return NS(checkout_url='https://checkout.example.invalid/reused') if reused else None
            self.fail('Unexpected query ' + query.target)

        db.on_scalar = scalar
        return db

    def call(self, db, signature=None):
        return self.functions['open_public_live_invoice_checkout'](
            ORG, INVOICE, self.signature if signature is None else signature, NS(), db)

    def test_suspended_workspace_cannot_reuse_existing_session(self):
        db = self.database('suspended', True)
        with self.assertRaises(HTTPException) as error:
            self.call(db)
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(self.provider_calls, [])
        self.assertEqual(db.commits, 0)
        self.assertEqual([e[1].target for e in db.events if e[0] == 'query'], ['Organization.status'])

    def test_suspended_workspace_cannot_create_session(self):
        db = self.database('suspended', False)
        with self.assertRaises(HTTPException) as error:
            self.call(db)
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(self.provider_calls, [])
        self.assertFalse(any(e[0] in {'add', 'flush', 'commit'} for e in db.events))

    def test_missing_workspace_cannot_reach_checkout(self):
        db = self.database(None)
        with self.assertRaises(HTTPException) as error:
            self.call(db)
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(self.provider_calls, [])

    def test_only_active_status_is_accepted_like_authenticated_workspace_guard(self):
        for status in ('inactive', 'disabled', '', 'ACTIVE'):
            with self.subTest(status=status):
                db = self.database(status, False)
                with self.assertRaises(HTTPException) as error:
                    self.call(db)
                self.assertEqual(error.exception.status_code, 403)
                self.assertEqual(self.provider_calls, [])
                self.assertEqual(db.commits, 0)

    def test_malformed_organization_id_is_rejected_before_workspace_read(self):
        db = self.database()
        with self.assertRaises(HTTPException) as error:
            self.functions['open_public_live_invoice_checkout'](
                'not-a-uuid', INVOICE, self.signature, NS(), db)
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(db.events, [])

    def test_signed_link_cannot_be_reused_for_another_invoice(self):
        db = self.database()
        with self.assertRaises(HTTPException) as error:
            self.functions['open_public_live_invoice_checkout'](
                ORG, '33333333-3333-4333-8333-333333333333', self.signature, NS(), db)
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(db.events, [])

    def test_active_workspace_reuses_session_without_provider(self):
        db = self.database()
        response = self.call(db)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers['location'], 'https://checkout.example.invalid/reused')
        self.assertEqual(self.provider_calls, [])
        self.assertEqual(db.commits, 0)

    def test_active_workspace_creates_new_session(self):
        db = self.database(reused=False)
        response = self.call(db)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers['location'], 'https://checkout.example.invalid/new')
        self.assertEqual(len(self.provider_calls), 1)
        self.assertEqual(db.commits, 1)

    def test_invalid_signature_is_rejected_before_workspace_read(self):
        db = self.database()
        with self.assertRaises(HTTPException) as error:
            self.call(db, '0' * 64)
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(db.events, [])
        self.assertEqual(self.provider_calls, [])

    def test_disabled_live_collection_stays_closed_before_workspace_read(self):
        db = self.database()
        self.settings.stripe_live_collection_enabled = False
        with self.assertRaises(HTTPException) as error:
            self.call(db)
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(db.events, [])
        self.assertEqual(self.provider_calls, [])


if __name__ == '__main__':
    unittest.main()
