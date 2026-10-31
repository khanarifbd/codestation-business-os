const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = (p = '/api/auth/session/activity') => ({ url: () => `http://localhost:3000${p}` });
const create = async () => (await import('../e2e-admin-readonly/support/drain.mjs')).requestDrain();
test('wait includes heartbeat started before response headers and its later body completion', async () => {
  const drain = await create(), pending = new Set(), req = request();
  drain.started(req);
  let resolved = false;
  const waiting = drain.wait(pending, { timeoutMs: 500 }).then(() => { resolved = true; });
  await new Promise(r => setTimeout(r, 20)); assert.equal(resolved, false);
  const body = Promise.resolve(); pending.add(body); drain.settled(req);
  await new Promise(r => setTimeout(r, 20)); assert.equal(resolved, false);
  pending.delete(body); await waiting; assert.equal(resolved, true);
});
test('new request during drain cannot escape the initial snapshot', async () => {
  const drain = await create(), pending = new Set(), a = request('/api/a'), b = request('/api/b');
  drain.started(a); let done = false;
  const waiting = drain.wait(pending, { timeoutMs: 500 }).then(() => { done = true; });
  drain.started(b); drain.settled(a);
  await new Promise(r => setTimeout(r, 20)); assert.equal(done, false);
  drain.settled(b); await waiting;
});
test('stuck API request fails boundedly; no retry/cancellation or silent drop', async () => {
  const drain = await create(); drain.started(request());
  await assert.rejects(drain.wait(new Set(), { timeoutMs: 20, pollMs: 2 }), /drain timed out/);
});
test('settled failure unblocks drain without erasing external error evidence', async () => {
  const drain = await create(), req = request(), errors = ['response_body_incomplete'];
  drain.started(req); drain.settled(req); await drain.wait(new Set());
  assert.deepEqual(errors, ['response_body_incomplete']);
});
test('unrelated asset request does not stall API drain; idle API set completes', async () => {
  const drain = await create(); drain.started(request('/logo.png')); await drain.wait(new Set());
});
test('suite observes both request ends and emits terminal only after context cleanup', () => {
  const source = fs.readFileSync(path.join(__dirname, '../e2e-admin-readonly/route-sweep.spec.mjs'), 'utf8');
  assert.match(source, /ownership.started\(request, routeId\); inFlight.started\(request\)/);
  assert.match(source, /requestfinished', request => inFlight.settled\(request\)/);
  assert.match(source, /requestfailed', request => \{\s+inFlight.settled\(request\)/);
  const cleanup = source.slice(source.indexOf('test.afterAll'), source.indexOf('for (const [index, group]'));
  assert.ok(cleanup.includes('await finishReadOnlyBatch({'));
  assert.ok(cleanup.includes('close: async () => { if (context) await context.close(); }'));
  assert.ok(cleanup.includes("event: 'api_read_failure'"));
  assert.ok(cleanup.includes('errors.push(failure); emit(failure)'));
  assert.ok(cleanup.includes("expect(errors, 'All API responses must complete before read-only teardown').toEqual([])"));
  assert.ok(cleanup.includes('errors: errors.length'));
});

test('request arriving during quiet interval restarts stability and must settle', async () => {
  const drain = await create(), req = request(); let done = false;
  const waiting = drain.wait(new Set(), { timeoutMs: 500, quietMs: 50 }).then(() => { done = true; });
  await new Promise(r => setTimeout(r, 20)); drain.started(req);
  await new Promise(r => setTimeout(r, 60)); assert.equal(done, false);
  drain.settled(req); await waiting;
});

test('short request entirely between polls resets quiet generation', async () => {
  const drain=await create(),req=request(),start=Date.now();
  const waiting=drain.wait(new Set(),{timeoutMs:500,pollMs:40,quietMs:60});
  await new Promise(resolve=>setTimeout(resolve,15));drain.started(req);drain.settled(req);
  await waiting;
  // First observation is at40ms: fresh60ms quiet cannot complete at80ms.
  assert.ok(Date.now()-start>=100);
});
async function lifecycle(overrides={},options={}) {
 const {finishReadOnlyBatch}=await import('../e2e-admin-readonly/support/drain.mjs');
 const errors=[],events=[],pendingResponses=new Set();
 const context={errors,events,pendingResponses};
 const callbacks={drain:{wait:async()=>{events.push('drain');}},pendingResponses,persist:async()=>events.push('persist'),close:async()=>events.push('close'),reconcile:()=>events.push('reconcile'),recordFailure:classification=>{errors.push(classification);events.push('failure');},terminal:()=>events.push(['terminal',errors.length])};
 Object.assign(callbacks,typeof overrides==='function'?overrides(context):overrides);
 await finishReadOnlyBatch(callbacks,{timeoutMs:100,cleanupTimeoutMs:100,...options});
 return context;
}
test('actual lifecycle drains before snapshot and close, terminal is last',async()=>{
 const {events,errors}=await lifecycle();assert.deepEqual(errors,[]);
 assert.deepEqual(events,['drain','reconcile','persist','drain','close','drain','reconcile',['terminal',0]]);
});
test('real drain timeout retains nonzero terminal and never snapshots but still closes',async()=>{
 const drain=await create(),req=request();drain.started(req);
 const {events,errors}=await lifecycle({drain},{timeoutMs:20,cleanupTimeoutMs:20});
 assert.ok(!events.includes('persist'));assert.ok(events.includes('close'));
 assert.deepEqual(errors,['teardown_drain_timeout','teardown_completion_timeout']);assert.deepEqual(events.at(-1),['terminal',2]);
});
test('close rejection retains diagnostic without raw error and still emits terminal',async()=>{
 const {events,errors}=await lifecycle({close:async()=>{throw Error('PRIVATE RAW BODY');}});
 assert.deepEqual(errors,['teardown_close_failed']);assert.deepEqual(events.at(-1),['terminal',1]);assert.ok(!JSON.stringify({events,errors}).includes('PRIVATE'));
});
test('never-settling close cannot defeat cleanup deadline',async()=>{
 const start=Date.now();const {events,errors}=await lifecycle({close:()=>new Promise(()=>{})},{cleanupTimeoutMs:20});
 assert.ok(Date.now()-start<500);assert.ok(errors.includes('teardown_close_timeout'));assert.deepEqual(events.at(-1),['terminal',errors.length]);
});
test('body promise appearing during close is awaited before terminal',async()=>{
 let released=false;
 const drain=await create();
 const {events,errors}=await lifecycle(({pendingResponses})=>({drain,close:async()=>{const body=new Promise(resolve=>setTimeout(()=>{released=true;pendingResponses.delete(body);resolve();},15));pendingResponses.add(body);}}),{timeoutMs:500,cleanupTimeoutMs:300});
 assert.equal(released,true);assert.deepEqual(errors,[]);assert.deepEqual(events.at(-1),['terminal',0]);
});
test('never-settling body after close fails boundedly rather than waiting forever',async()=>{
 const drain=await create(),start=Date.now();
 const {events,errors}=await lifecycle(({pendingResponses})=>({drain,close:async()=>{pendingResponses.add(new Promise(()=>{}));}}),{timeoutMs:500,cleanupTimeoutMs:25});
 assert.ok(Date.now()-start<1000);assert.deepEqual(errors,['teardown_completion_timeout']);assert.deepEqual(events.at(-1),['terminal',1]);
});
test('late close error and existing response failures remain in final evidence',async()=>{
 const {events,errors}=await lifecycle(({errors})=>{errors.push('existing_500');return{close:async()=>{errors.push('response_body_incomplete');}};});
 assert.deepEqual(errors,['existing_500','response_body_incomplete']);assert.deepEqual(events.at(-1),['terminal',2]);
});
test('teardown failures remain unexpected errors in authoritative summary',async()=>{
 const {summarize}=await import('../scripts/run-admin-readonly-sweep.mjs');
 for(const classification of ['teardown_drain_timeout','teardown_completion_timeout','teardown_close_failed']){
  const summary=summarize({routes:[]},[{event:'api_read_failure',route_id:'last',classification}]);
  assert.equal(summary.unexpected_errors,1);
 }
});

test('real per-route boundary holds navigation for pre-header heartbeat and body completion', async () => {
 const source=fs.readFileSync(path.join(__dirname,'../e2e-admin-readonly/route-sweep.spec.mjs'),'utf8');
 const boundary=source.match(/await inFlight\.wait\(pendingResponses\);\s+await Promise\.all\(pendingResponses\);\s+reconcileTransportFailures\(\);/g);
 assert.equal(boundary?.length,1,'one bounded request-start drain before per-route reconciliation');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const advance=new AsyncFunction('inFlight','pendingResponses','reconcileTransportFailures','navigate',boundary[0]+' navigate();');
 const drain=await create(),pending=new Set(),req=request(),events=[];
 drain.started(req);
 const waiting=advance(drain,pending,()=>events.push('reconcile'),()=>events.push('next-navigation'));
 await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(events,[]);
 let complete;const body=new Promise(resolve=>{complete=resolve;});pending.add(body);drain.settled(req);
 await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(events,[]);
 pending.delete(body);complete();await waiting;
 assert.deepEqual(events,['reconcile','next-navigation']);
 const blocked=await create();blocked.started(request());const failures=[];
 await assert.rejects(advance({wait:p=>blocked.wait(p,{timeoutMs:20,pollMs:2})},new Set(),()=>failures.push('reconcile'),()=>failures.push('next-navigation')),/drain timed out/);
 assert.deepEqual(failures,[]);
});
