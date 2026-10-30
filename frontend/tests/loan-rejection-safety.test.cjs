const test = require('node:test'), assert = require('node:assert/strict');
const { hookHarness } = require('./reconciliation-harness.cjs');
const { deferred } = require('./reconciliation-fixtures.cjs');
const { validation, malformed, rejected } = require('./accounting-rejection-fixtures.cjs');
const confirmation = { title: 'Synthetic', description: 'Reviewed consequence', warning: 'Do not repeat', details: [], confirmLabel: 'Confirm' };
const command = keyed => ({ url: keyed ? '/api/accounting/loans/loan-a/repay' : '/api/accounting/loans', keyed, body: { principal_amount: '1.00' }, confirmation, validate: () => false });
const make = () => hookHarness({ file: 'src/hooks/use-loan-action.ts', target: 'useLoanAction', args: [true, true, '/dashboard/accounting/loans'] });
async function arm(h, keyed) { h.vm().arm(command(keyed)); await h.flush(); }
for (const keyed of [false, true]) for (const [name, body] of malformed) test(`loan ${keyed ? 'keyed' : 'unkeyed'} malformed 422 ${name} stays locked`, async () => {
  const h = make(); try { await h.flush(); await arm(h, keyed); h.respond(() => rejected(422, body)); await h.vm().confirm(); await h.flush();
    assert.equal(h.vm().phase, 'unknown'); assert.equal(h.vm().canEdit(), false); assert.equal(h.vm().arm(command(keyed)), false); await h.vm().confirm(); assert.equal(h.calls.length, 1);
    assert.equal(h.vm().retryAvailable, keyed); assert.equal(h.vm().operation.description, confirmation.description);
  } finally { h.cleanup(); }
});
for (const body of [{ detail: 'Amount exceeds available balance' }, validation]) for (const status of [400,401,403,404,409,422]) test(`loan valid rejection retains status ${status} ${typeof body.detail}`, async () => {
  const h = make(); try { await h.flush(); await arm(h, false); h.respond(() => rejected(status, body)); await h.vm().confirm(); await h.flush(); assert.equal(h.vm().phase, 'idle'); assert.equal(h.vm().canEdit(), true); } finally { h.cleanup(); }
});
for (const status of [408,429]) test(`loan ${status} cannot unlock with valid detail`, async () => { const h=make();try {await h.flush();await arm(h,true);h.respond(()=>rejected(status,validation));await h.vm().confirm();await h.flush();assert.equal(h.vm().phase,'unknown');assert.equal(h.vm().canEdit(),false);}finally{h.cleanup();} });
test('loan malformed JSON retains original bytes/key through valid later retry rejection', async () => {
  const h=make();try {await h.flush();await arm(h,true);h.respond(()=>({ok:false,status:422,json:async()=>{throw Error('Malformed JSON');}}));await h.vm().confirm();await h.flush();const original=h.calls[0];
    h.respond(()=>rejected(422,validation));await h.vm().retrySameRequest();await h.flush();assert.equal(h.vm().phase,'unknown');assert.equal(h.vm().arm(command(true)),false);assert.equal(h.calls.length,2);assert.equal(h.calls[1].init.body,original.init.body);assert.equal(h.calls[1].init.headers['Idempotency-Key'],original.init.headers['Idempotency-Key']);
  }finally{h.cleanup();}
});
test('loan stale unmounted owner cannot react to delayed rejection or send retained action', async () => {
  const h=make();try {await h.flush();await arm(h,true);const wait=deferred(),old=h.vm();h.respond(()=>wait.promise);const request=old.confirm();h.unmount();wait.resolve(rejected(401,validation));await request;await old.confirm();await old.retrySameRequest();assert.equal(h.calls.length,1);assert.equal(h.nav.length,0);}finally{h.cleanup();}
});
test('loan keyed valid Pydantic 422 remains a corrective first-attempt rejection', async () => { const h=make();try {await h.flush();await arm(h,true);h.respond(()=>rejected(422,validation));await h.vm().confirm();await h.flush();assert.equal(h.vm().phase,'idle');assert.equal(h.vm().canEdit(),true);}finally{h.cleanup();} });
