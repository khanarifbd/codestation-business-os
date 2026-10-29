"""Actual Stripe handler/service control flow with synthetic provider facts only."""
import asyncio,unittest
from types import SimpleNamespace as NS
from decimal import Decimal
from datetime import date
from period_entrypoint_harness import *

def connection():return NS(id='connection',organization_id='synthetic-org',secret_key_ciphertext='synthetic-placeholder',webhook_secret_ciphertext='synthetic-placeholder',connection_method='api_key',payouts_enabled=True)
def webhook_ns(extra=None):
 values={**gate_namespace(),'REVIEW_TYPES':{'checkout.session.completed'},'decrypt_gateway_secret':lambda x:'synthetic-not-a-secret','verify_stripe_signature':lambda *args:{'id':'evt_synthetic','type':'other.event','livemode':True,'data':{'object':{}}},'record_activity':lambda *a,**k:None}
 values.update(extra or {});return load_functions('app/api/v1/stripe_lifecycle.py',['review_live_stripe_event'],values)
class Request:
 headers={'stripe-signature':'synthetic-not-a-signature'}
 async def body(self):return b'{"synthetic":true}'
class StripeAdoption(unittest.TestCase):
 def test_webhook_resolves_scalar_tenant_without_lock_then_gate_then_fresh_connection(self):
  db=DB();db.values=['synthetic-org',connection(),NS(id='prior')];n=webhook_ns();out=asyncio.run(n['review_live_stripe_event']('connection',Request(),db));self.assertTrue(out['duplicate']);q0=db.events[0][1];self.assertEqual(q0.target,'PaymentGatewayConnection.organization_id');self.assertFalse(q0.lock);self.assertEqual(db.events[1][0],'execute');q1=db.events[2][1];self.assertTrue(q1.lock);self.assertTrue(q1.options['populate_existing']);self.assertIn(('PaymentGatewayConnection.organization_id','=','synthetic-org'),q1.conditions);self.assertEqual(db.commits,0)
 def test_webhook_unknown_tenant_does_not_acquire_or_verify(self):
  db=DB();db.values=[None];n=webhook_ns({'verify_stripe_signature':stop})
  with self.assertRaises(HTTPException) as e:asyncio.run(n['review_live_stripe_event']('connection',Request(),db))
  self.assertEqual(e.exception.status_code,404);self.assertEqual(gate_sql(db),[]);self.assertEqual(db.commits,0)
 def test_webhook_connection_revoked_after_wait_fails_before_signature_or_event(self):
  db=DB();db.values=['synthetic-org',None];n=webhook_ns({'verify_stripe_signature':stop})
  with self.assertRaises(HTTPException) as e:asyncio.run(n['review_live_stripe_event']('connection',Request(),db))
  self.assertEqual(e.exception.status_code,404);self.assertEqual(len(gate_sql(db)),1);self.assertNotIn('add',effect_trace(db));self.assertEqual(db.commits,0)
 def test_webhook_uses_fresh_locked_secret_and_ignores_payload_tenant(self):
  db=DB();conn=connection();conn.webhook_secret_ciphertext='fresh-synthetic-placeholder';db.values=['synthetic-org',conn,None];verified=[]
  def decrypt(value):self.assertEqual(value,'fresh-synthetic-placeholder');GATE.require_accounting_period_gate(db,'synthetic-org');return 'synthetic'
  def verify(*args):verified.append(args);return{'id':'evt_synthetic','type':'other.event','livemode':True,'organization_id':'attacker-ignored','data':{'object':{}}}
  n=webhook_ns({'decrypt_gateway_secret':decrypt,'verify_stripe_signature':verify});out=asyncio.run(n['review_live_stripe_event']('connection',Request(),db));self.assertEqual(out['result'],'ignored');added=[x[1] for x in db.events if x[0]=='add'];self.assertEqual(added[0].organization_id,'synthetic-org');self.assertEqual(db.commits,1);self.assertEqual(len(verified),1)
 def test_webhook_nested_posting_commit_is_flush_until_outer_event_commit(self):
  db=DB();db.values=['synthetic-org',connection(),None]
  def post(db,conn,obj):GATE.require_accounting_period_gate(db,conn.organization_id);db.commit();return'live_paid_posted','attempt'
  n=webhook_ns({'verify_stripe_signature':lambda *a:{'id':'evt_synthetic','type':'checkout.session.completed','livemode':True,'data':{'object':{}}},'_verify_live_checkout_and_post':post});out=asyncio.run(n['review_live_stripe_event']('connection',Request(),db));self.assertEqual(out['result'],'live_paid_posted');self.assertEqual(db.commits,1);self.assertEqual(effect_trace(db).count('flush'),1);self.assertLess(effect_trace(db).index('flush'),effect_trace(db).index('add'))
 def test_webhook_signature_failure_keeps_no_effect_or_commit(self):
  db=DB();db.values=['synthetic-org',connection()]
  def verify(*a):raise HTTPException(status_code=400,detail='Synthetic invalid signature')
  n=webhook_ns({'verify_stripe_signature':verify})
  with self.assertRaises(HTTPException) as e:asyncio.run(n['review_live_stripe_event']('connection',Request(),db))
  self.assertEqual(e.exception.status_code,400);self.assertNotIn('add',effect_trace(db));self.assertEqual(db.commits,0)
 def test_manual_reconcile_gate_before_attempt_lock_provider_and_nested_commit(self):
  db=DB();t=tenant();attempt=NS(id='attempt',connection_id='connection',stripe_session_id='cs_live_synthetic');db.values=[attempt,connection()];calls=[]
  def provider(*args):GATE.require_accounting_period_gate(db,t.organization_id);calls.append('provider');return{'id':'cs_live_synthetic'}
  def verify(db,*a):GATE.require_accounting_period_gate(db,t.organization_id);db.commit();return'live_paid_posted','attempt'
  n=load_functions('app/api/v1/stripe_checkout.py',['reconcile_live_checkout'],{**gate_namespace(),'settings':NS(stripe_live_collection_enabled=True),'decrypt_gateway_secret':lambda x:'synthetic','stripe_retrieve':provider,'_verify_live_checkout_and_post':verify,'record_activity':lambda *a,**k:None})
  out=n['reconcile_live_checkout']('invoice','attempt',None,db,t);self.assertEqual(out['result'],'live_paid_posted');self.assertEqual(db.events[0][0],'execute');self.assertEqual(db.events[1],('refresh',t.organization));q=db.events[2][1];self.assertTrue(q.lock);self.assertTrue(q.options['populate_existing']);self.assertEqual(db.commits,1);self.assertEqual(effect_trace(db).count('flush'),1);self.assertEqual(calls,['provider'])
 def test_manual_reconcile_disabled_still_rejects_without_gate_or_provider(self):
  db=DB();n=load_functions('app/api/v1/stripe_checkout.py',['reconcile_live_checkout'],{**gate_namespace(),'settings':NS(stripe_live_collection_enabled=False)})
  with self.assertRaises(HTTPException) as e:n['reconcile_live_checkout']('i','a',None,db,tenant())
  self.assertEqual(e.exception.status_code,409);self.assertEqual(db.events,[])
 def payout_ns(self,extra=None):
  values={**gate_namespace(),'decrypt_gateway_secret':lambda x:'synthetic','stripe_retrieve':stop,'record_activity':lambda *a,**k:None,'_as_json':lambda row:row}
  values.update(extra or {});return load_functions('app/api/v1/stripe_payouts.py',['confirm_live_payout'],values)
 def payout_payload(self):return NS(source_account_id='source',bank_account_id='bank',bank_statement_reference='SYNTHETIC-STATEMENT',stripe_payout_id='po_synthetic')
 def test_payout_gate_precedes_source_read_and_existing_gateway_protocol(self):
  db=DB();t=tenant();n=self.payout_ns()
  with self.assertRaises(StopAtDomain):n['confirm_live_payout'](self.payout_payload(),None,db,t)
  self.assertEqual(db.events[0][0],'execute');self.assertEqual(db.events[1],('refresh',t.organization));self.assertEqual(db.events[2][1].target,'FinancialAccount')
 def test_payout_pure_invalid_input_does_not_take_gate(self):
  db=DB();p=self.payout_payload();p.bank_account_id=p.source_account_id
  with self.assertRaises(HTTPException) as e:self.payout_ns()['confirm_live_payout'](p,None,db,tenant())
  self.assertEqual(e.exception.status_code,400);self.assertEqual(db.events,[])
 def test_payout_completed_replay_does_not_revalidate_historical_period_or_call_provider(self):
  db=DB(closed=True);t=tenant();source=NS(id='source',gateway_connection_id='connection');previous=NS(id='prior',stripe_account_id='source',bank_account_id='bank',bank_statement_reference='SYNTHETIC-STATEMENT',transfer_id='transfer');db.values=[source,connection(),previous,NS(status='confirmed')];out=self.payout_ns()['confirm_live_payout'](self.payout_payload(),None,db,t);self.assertIs(out,previous);self.assertEqual(db.commits,0);self.assertNotIn('period_read',effect_trace(db));self.assertTrue(db.events[3][1].options['populate_existing'])
 def test_payout_new_flow_keeps_transfer_and_link_in_single_outer_commit(self):
  db=DB();t=tenant();source=NS(id='source',gateway_connection_id='connection',currency='USD');bank=NS(id='bank',currency='USD');transfer=NS(id='transfer');db.values=[source,connection(),None,None,bank,transfer]
  def provider(*a):GATE.require_accounting_period_gate(db,t.organization_id);return{'id':'po_synthetic','amount':5000,'livemode':True,'status':'paid','currency':'usd'}
  def record(*a):GATE.require_accounting_period_gate(db,t.organization_id);db.commit();return transfer
  n=self.payout_ns({'stripe_retrieve':provider,'AccountTransferCreate':lambda **k:NS(**k),'record_transfer':record,'post_transfer':lambda *a,**k:GATE.require_accounting_period_gate(db,t.organization_id)})
  out=n['confirm_live_payout'](self.payout_payload(),None,db,t);self.assertEqual(out.amount_minor,5000);self.assertEqual(db.commits,1);self.assertEqual(len(gate_sql(db)),1);self.assertEqual(effect_trace(db).count('flush'),2)
 def test_stripe_service_refreshes_invoice_at_lock_without_overwriting_pending_attempt(self):
  db=DB();t=tenant();GATE.acquire_accounting_period_gate(db,t.organization_id);attempt=NS(id='attempt',connection_id='connection',invoice_id='invoice',mode='live',status='live_paid',stripe_payment_intent_id='pi_synthetic',currency='USD',amount_minor=5000)
  snapshot=NS(id='snapshot',attempt_id='attempt',connection_id='connection',stripe_payment_intent_id='pi_synthetic',currency='USD',gross_minor=5000,fee_minor=0,net_minor=5000)
  invoice=NS(id='invoice',status='paid',currency='USD',balance_due=Decimal('0'),payment_method='stripe',payment_account_id='account');account=NS(id='account',currency='USD');payment=NS(id='payment',payment_date=date(2026,10,27));seen=[]
  def scalar(query):
   seen.append(query)
   if query.target=='StripeSettlementSnapshot':return snapshot
   if query.target=='StripeAccountingPosting':return None
   if query.target=='StripeCheckoutAttempt':
    # This object has legitimate unflushed lifecycle updates; a blind refresh would erase them.
    if query.options.get('populate_existing'):attempt.status='pending';attempt.stripe_payment_intent_id=None
    return attempt
   if query.target=='PaymentGatewayConnection':return connection()
   if query.target=='Invoice':
    if query.lock and query.options.get('populate_existing'):invoice.status='sent';invoice.balance_due=Decimal('50')
    return invoice
   if query.target=='FinancialAccount':return account
   if query.target=='Payment':return payment
   raise AssertionError(query.target)
  db.on_scalar=scalar
  def record(*args):self.assertEqual(invoice.balance_due,Decimal('50'));db.commit();return payment
  n=load_functions('app/services/stripe_accounting.py',['post_verified_live_stripe_settlement'],{**gate_namespace(),'money':lambda value:Decimal(value).quantize(Decimal('.01')),'PaymentCreate':lambda **k:NS(**k),'record_payment':record,'post_invoice_payment':lambda *a,**k:GATE.require_accounting_period_gate(db,t.organization_id),'record_activity':lambda *a,**k:None})
  out=n['post_verified_live_stripe_settlement'](db,organization_id=t.organization_id,actor=t,snapshot_id='snapshot',request=None);self.assertEqual(out.payment_id,'payment');self.assertEqual(attempt.status,'live_paid');self.assertEqual(attempt.stripe_payment_intent_id,'pi_synthetic');self.assertEqual(db.commits,1);invoice_query=next(q for q in seen if q.target=='Invoice');attempt_query=next(q for q in seen if q.target=='StripeCheckoutAttempt');self.assertTrue(invoice_query.options['populate_existing']);self.assertEqual(attempt_query.options,{})


class WebhookBodyOrdering(unittest.TestCase):
    def test_slow_body_holds_no_gate_or_database_lock_until_body_resolves(self):
        async def scenario():
            db = DB()
            db.values = ['synthetic-org', connection(), NS(id='prior')]
            started = asyncio.Event()
            release = asyncio.Event()
            body_calls = []

            class SlowRequest(Request):
                async def body(self):
                    body_calls.append('read')
                    started.set()
                    await release.wait()
                    return b'{"synthetic":true}'

            task = asyncio.create_task(webhook_ns()['review_live_stripe_event']('connection', SlowRequest(), db))
            await started.wait()
            self.assertFalse(task.done())
            self.assertEqual(db.events, [])
            self.assertEqual(gate_sql(db), [])
            release.set()
            result = await task
            self.assertTrue(result['duplicate'])
            self.assertEqual(body_calls, ['read'])
            self.assertEqual(len(gate_sql(db)), 1)
            self.assertEqual(db.events[0][1].target, 'PaymentGatewayConnection.organization_id')
            self.assertFalse(db.events[0][1].lock)
            self.assertTrue(db.events[2][1].lock)

        asyncio.run(scenario())

    def test_body_failure_does_not_acquire_gate_or_touch_database(self):
        class FailedRequest(Request):
            async def body(self):
                raise RuntimeError('Synthetic disconnected request')

        db = DB()
        with self.assertRaisesRegex(RuntimeError, 'Synthetic disconnected request'):
            asyncio.run(webhook_ns()['review_live_stripe_event']('connection', FailedRequest(), db))
        self.assertEqual(db.events, [])

    def test_unknown_connection_still_404_before_oversized_body_413(self):
        class OversizedRequest(Request):
            async def body(self):
                return b'x' * (256 * 1024 + 1)

        db = DB()
        db.values = [None]
        with self.assertRaises(HTTPException) as error:
            asyncio.run(webhook_ns({'verify_stripe_signature': stop})['review_live_stripe_event']('connection', OversizedRequest(), db))
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(error.exception.detail, 'Live Stripe webhook is unavailable')
        self.assertEqual(gate_sql(db), [])

    def test_connection_revoked_after_gate_still_404_before_body_limit(self):
        class OversizedRequest(Request):
            async def body(self):
                return b'x' * (256 * 1024 + 1)

        db = DB()
        db.values = ['synthetic-org', None]
        with self.assertRaises(HTTPException) as error:
            asyncio.run(webhook_ns({'verify_stripe_signature': stop})['review_live_stripe_event']('connection', OversizedRequest(), db))
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(len(gate_sql(db)), 1)
        self.assertNotIn('add', effect_trace(db))

    def test_known_connection_body_limit_still_413_before_signature(self):
        class OversizedRequest(Request):
            async def body(self):
                return b'x' * (256 * 1024 + 1)

        db = DB()
        db.values = ['synthetic-org', connection()]
        with self.assertRaises(HTTPException) as error:
            asyncio.run(webhook_ns({'verify_stripe_signature': stop})['review_live_stripe_event']('connection', OversizedRequest(), db))
        self.assertEqual(error.exception.status_code, 413)
        self.assertEqual(error.exception.detail, 'Stripe webhook request too large')
        self.assertEqual(len(gate_sql(db)), 1)
        self.assertNotIn('add', effect_trace(db))
        self.assertEqual(db.commits, 0)

    def test_body_limit_boundary_retains_signature_verification_under_gate(self):
        class BoundaryRequest(Request):
            async def body(self):
                return b'x' * (256 * 1024)

        db = DB()
        db.values = ['synthetic-org', connection(), NS(id='prior')]
        verified = []

        def verify(body, signature, secret):
            GATE.require_accounting_period_gate(db, 'synthetic-org')
            self.assertEqual(len(body), 256 * 1024)
            verified.append(body)
            return {'id': 'evt_synthetic', 'type': 'other.event', 'livemode': True, 'data': {'object': {}}}

        result = asyncio.run(webhook_ns({'verify_stripe_signature': verify})['review_live_stripe_event']('connection', BoundaryRequest(), db))
        self.assertTrue(result['duplicate'])
        self.assertEqual(len(verified), 1)
