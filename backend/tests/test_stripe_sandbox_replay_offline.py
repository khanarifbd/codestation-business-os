"""Sandbox webhook replay ordering with actual handler and synthetic collaborators.

No app settings/engine import, sockets, provider calls or database writes. The
contended connection is a deterministic interleaving model, not PG concurrency.
"""
import asyncio
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch

from period_entrypoint_harness import DB, HTTPException, effect_trace, load_functions


def connection():
    return NS(id='test-connection', organization_id='synthetic-org',
              webhook_secret_ciphertext='synthetic-placeholder')


def event():
    return {'id': 'evt_synthetic_replay', 'type': 'other.event', 'livemode': False,
            'data': {'object': {}}}


class Request:
    headers = {'stripe-signature': 'synthetic-placeholder'}

    async def body(self):
        return b'synthetic-body'


def handler(extra=None):
    values = {
        'decrypt_gateway_secret': lambda value: 'synthetic-placeholder',
        'verify_stripe_signature': lambda *args: event(),
        'record_activity': lambda *args, **kwargs: None,
    }
    values.update(extra or {})
    return load_functions('app/api/v1/stripe_checkout.py',
                          ['stripe_sandbox_webhook'], values)['stripe_sandbox_webhook']


class SandboxReplayTests(unittest.TestCase):
    def setUp(self):
        # Catch any accidental network access added to this offline harness.
        for name in ('connect', 'connect_ex'):
            self.enterContext(patch('socket.socket.' + name,
                                    side_effect=AssertionError('network forbidden')))
        for name in ('create_connection', 'getaddrinfo'):
            self.enterContext(patch('socket.' + name,
                                    side_effect=AssertionError('network forbidden')))

    def test_contended_duplicate_observes_event_after_connection_lock(self):
        db = DB()
        waited = False

        def scalar(query):
            nonlocal waited
            if query.target == 'PaymentGatewayConnection':
                # Model first delivery committing while this request waits.
                waited = query.lock
                return connection()
            if query.target == 'StripeWebhookEvent':
                return NS(id='committed-first-event') if waited else None
            self.fail(query.target)

        db.on_scalar = scalar
        result = asyncio.run(handler()('test-connection', Request(), db))
        self.assertTrue(result['duplicate'])
        self.assertNotIn('add', effect_trace(db))
        self.assertEqual(db.commits, 0)

    def test_connection_lock_refreshes_active_merchant_before_dedup(self):
        db = DB()
        db.values = [connection(), NS(id='prior')]
        asyncio.run(handler()('test-connection', Request(), db))
        query = db.events[0][1]
        self.assertEqual(query.target, 'PaymentGatewayConnection')
        self.assertTrue(query.lock)
        self.assertTrue(query.options.get('populate_existing'))
        self.assertIn(('PaymentGatewayConnection.mode', '=', 'test'), query.conditions)
        self.assertIn(('PaymentGatewayConnection.is_active', 'is', True), query.conditions)

    def test_body_is_read_before_any_connection_lock(self):
        async def scenario():
            db = DB()
            db.values = [connection(), NS(id='prior')]
            started, release = asyncio.Event(), asyncio.Event()

            class SlowRequest(Request):
                async def body(self):
                    started.set()
                    await release.wait()
                    return b'synthetic-body'

            task = asyncio.create_task(handler()('test-connection', SlowRequest(), db))
            await started.wait()
            try:
                self.assertEqual(db.events, [])
            finally:
                release.set()
                await task

        asyncio.run(scenario())

    def test_unknown_or_revoked_connection_fails_before_signature(self):
        db = DB()
        db.values = [None]
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(handler({'verify_stripe_signature': lambda *a: self.fail('signature called')})(
                'test-connection', Request(), db))
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(db.commits, 0)
        self.assertNotIn('add', effect_trace(db))

    def test_valid_new_ignored_event_records_once(self):
        db = DB()
        db.values = [connection(), None]
        result = asyncio.run(handler()('test-connection', Request(), db))
        self.assertFalse(result['duplicate'])
        rows = [item for action, *items in db.events if action == 'add' for item in items]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].stripe_event_id, 'evt_synthetic_replay')
        self.assertEqual(rows[0].organization_id, 'synthetic-org')
        self.assertEqual(db.commits, 1)

    def test_paid_sandbox_event_updates_attempt_but_never_invoice_or_payment(self):
        db = DB()
        attempt = NS(id='attempt', invoice_id='invoice', currency='USD',
                     amount_minor=5000, status='open')
        invoice = NS(id='invoice', status='sent', balance_due=50)
        db.values = [connection(), None, attempt, invoice]
        paid = {**event(), 'type': 'checkout.session.completed', 'data': {'object': {
            'id': 'cs_synthetic', 'livemode': False, 'currency': 'usd',
            'amount_total': 5000, 'client_reference_id': 'attempt',
            'metadata': {'checkout_attempt_id': 'attempt'},
            'payment_status': 'paid', 'payment_intent': 'pi_synthetic',
        }}}
        result = asyncio.run(handler({'verify_stripe_signature': lambda *a: paid})(
            'test-connection', Request(), db))
        self.assertFalse(result['duplicate'])
        self.assertEqual(attempt.status, 'sandbox_paid')
        self.assertEqual(invoice.status, 'sent')
        self.assertEqual(invoice.balance_due, 50)
        added = [row[1] for row in db.events if row[0] == 'add']
        self.assertEqual([type(row).__name__ for row in added], ['StripeWebhookEvent'])
        self.assertEqual(db.commits, 1)

    def test_event_commit_failure_does_not_return_success(self):
        db = DB()
        db.values = [connection(), None]
        def fail_commit():
            raise RuntimeError('synthetic commit failed')
        db.commit = fail_commit
        with self.assertRaisesRegex(RuntimeError, 'synthetic commit failed'):
            asyncio.run(handler()('test-connection', Request(), db))
        self.assertEqual(db.commits, 0)

    def test_signature_failure_does_not_record_event_or_commit(self):
        db = DB()
        db.values = [connection()]
        def fail_signature(*args):
            raise HTTPException(status_code=400, detail='synthetic bad signature')
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(handler({'verify_stripe_signature': fail_signature})(
                'test-connection', Request(), db))
        self.assertEqual(raised.exception.status_code, 400)
        self.assertNotIn('add', effect_trace(db))
        self.assertEqual(db.commits, 0)

    def test_signed_live_event_stays_rejected_without_mutation(self):
        db = DB()
        db.values = [connection()]
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(handler({'verify_stripe_signature': lambda *a: {**event(), 'livemode': True}})(
                'test-connection', Request(), db))
        self.assertEqual(raised.exception.status_code, 400)
        self.assertNotIn('add', effect_trace(db))
        self.assertEqual(db.commits, 0)


if __name__ == '__main__':
    unittest.main()
