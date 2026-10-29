/* Real decision hook, deterministic synthetic fetches. Not browser or live acceptance evidence. */
const test=require('node:test'),assert=require('node:assert/strict');
const {hookHarness}=require('./reconciliation-harness.cjs'),f=require('./client-portal-fixtures.cjs');
const file='src/hooks/use-client-quotation-decision.ts';
function setup(patch={},selected='accepted'){
 let current=true,reads=0,readResult={current:true,value:f.quotationDetail,status:200};
 const record={value:f.clone(f.quotationDetail),loading:false,error:null,status:200,version:1,isCurrent:()=>current,refresh:async()=>{reads++;return readResult;},...patch};
 const h=hookHarness({file,target:'useClientQuotationDecision',args:[record,selected,'/dashboard/client/quotations/'+f.quotation.id]});
 return {h,record,setCurrent:v=>current=v,reads:()=>reads,setRead:v=>readResult=v};
}
function run(name,fn,patch={},selected='accepted'){test(name,async()=>{const x=setup(patch,selected);try{x.h.render();await fn(x);}finally{x.h.cleanup();}});}
const accepted=()=>f.ok({...f.quotationDetail,status:'accepted'});
run('confirmation freezes exact identity, client, money and target before write',async({h})=>{assert.equal(h.vm().arm(),true);await h.flush();assert.equal(h.vm().review.id,f.quotation.id);assert.equal(h.vm().review.clientId,f.clientA.id);assert.equal(h.vm().review.target,'accepted');assert.equal(h.calls.length,0);});
run('exact existing status-only contract and no order/payment side effects',async({h})=>{h.respond(accepted);h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,`/api/client-portal/quotations/${f.quotation.id}/decision`);assert.equal(h.calls[0].init.method,'POST');assert.deepEqual(JSON.parse(h.calls[0].init.body),{status:'accepted'});assert.equal(h.vm().phase,'acknowledged');assert.match(h.vm().notice,/does not itself create an order/);});
run('rejection preserves status-only payload',async({h})=>{h.respond(()=>f.ok({...f.quotationDetail,status:'rejected'}));h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();assert.deepEqual(JSON.parse(h.calls[0].init.body),{status:'rejected'});assert.equal(h.vm().phase,'acknowledged');},{},'rejected');
run('synchronous double confirm produces one POST',async({h})=>{const d=f.deferred();h.respond(()=>d.promise);h.vm().arm();await h.flush();const confirm=h.vm().confirm;const a=confirm(),b=confirm();assert.equal(h.calls.length,1);d.resolve(accepted());await Promise.all([a,b]);await h.flush();assert.equal(h.vm().phase,'acknowledged');});
run('delayed successful JSON decode remains pending and cannot duplicate',async({h})=>{const d=f.deferred();h.respond(()=>({ok:true,status:200,json:()=>d.promise}));h.vm().arm();await h.flush();const pending=h.vm().confirm();await h.flush();assert.equal(h.vm().busy,true);await h.vm().confirm();assert.equal(h.calls.length,1);d.resolve({...f.quotationDetail,status:'accepted'});await pending;await h.flush();assert.equal(h.vm().phase,'acknowledged');});
for(const status of ['accepted','rejected','draft','cancelled'])run(`${status} quotation cannot arm`,async({h})=>{assert.equal(h.vm().arm(),false);assert.equal(h.calls.length,0);},{value:{...f.quotationDetail,status}});
for(const patch of [{loading:true},{error:'Unavailable'},{value:null}])run(`unready quotation ${JSON.stringify(patch)} cannot arm`,async({h})=>{assert.equal(h.vm().arm(),false);assert.equal(h.calls.length,0);},patch);
run('missing decision does not arm',async({h})=>{assert.equal(h.vm().arm(),false);},{},null);
run('same-event read invalidation prevents captured arm and confirm',async({h,setCurrent})=>{const arm=h.vm().arm;setCurrent(false);assert.equal(arm(),false);setCurrent(true);h.vm().arm();await h.flush();const confirm=h.vm().confirm;setCurrent(false);await confirm();assert.equal(h.calls.length,0);});
run('new read version invalidates armed snapshot even for same document',async({h,record})=>{h.vm().arm();await h.flush();h.render({...record,version:2},'accepted','/back');await h.vm().confirm();assert.equal(h.calls.length,0);});
run('route decision change cannot confirm stale opposite decision',async({h,record})=>{h.vm().arm();await h.flush();h.render(record,'rejected','/back');await h.vm().confirm();assert.equal(h.calls.length,0);});
run('A to B identity cannot confirm A snapshot',async({h,record})=>{h.vm().arm();await h.flush();h.render({...record,value:f.quotationDetailB},'accepted','/back');await h.vm().confirm();assert.equal(h.calls.length,0);});
run('company change cannot confirm stale snapshot',async({h})=>{h.vm().arm();await h.flush();h.tenant('synthetic-company-b');h.render();await h.vm().confirm();assert.equal(h.calls.length,0);});
for(const status of [400,401,403,404,409,422])run(`explicit server${status} rejection unlocks only after fresh read readiness`,async({h,reads})=>{h.respond(()=>f.failure(status));h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();assert.equal(h.vm().phase,'idle');assert.equal(reads(),1);assert.equal(h.calls.length,1);assert.equal(h.vm().review,null);if(status===401)assert.ok(h.nav.some(n=>n.href==='/login'));});
for(const status of [408,429,500,502,503])run(`HTTP${status} is unknown, never an automatic retry`,async({h})=>{h.respond(()=>f.failure(status));h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();assert.equal(h.vm().phase,'unknown');assert.equal(h.vm().arm(),false);await h.vm().confirm();assert.equal(h.calls.length,1);});
run('transport interruption locks unknown outcome, no opposite decision',async({h,record})=>{h.respond(()=>{throw Error('synthetic interruption');});h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();assert.equal(h.vm().phase,'unknown');h.render(record,'rejected','/back');assert.equal(h.vm().arm(),false);assert.equal(h.calls.length,1);});
for(const payload of [{}, {...f.quotationDetail,status:'accepted',id:'wrong'}, {...f.quotationDetail,status:'accepted',client_id:f.clientB.id}, {...f.quotationDetail,status:'sent'}])run('unverified successful reply stays locked: '+JSON.stringify(payload).slice(0,100),async({h})=>{h.respond(()=>f.ok(payload));h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();assert.equal(h.vm().phase,'unknown');assert.equal(h.vm().arm(),false);});
run('acknowledged success stays locked against same or opposite repeat',async({h,record})=>{h.respond(accepted);h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();assert.equal(h.vm().arm(),false);h.render(record,'rejected','/back');assert.equal(h.vm().arm(),false);assert.equal(h.calls.length,1);});
for(const status of ['accepted','rejected'])run(`explicit safe read verifies saved ${status} but not request authorship`,async({h,setRead,reads})=>{h.respond(()=>f.failure(503));h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();setRead({current:true,value:{...f.quotationDetail,status},status:200});await h.vm().verify();await h.flush();assert.equal(h.vm().phase,'verified');assert.match(h.vm().notice,/not which request/);assert.equal(reads(),1);assert.equal(h.calls.length,1);assert.equal(h.vm().arm(),false);});
run('sent saved read does not unlock unknown request',async({h,setRead})=>{h.respond(()=>f.failure(503));h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();setRead({current:true,value:f.quotationDetail,status:200});await h.vm().verify();await h.flush();assert.equal(h.vm().phase,'unknown');assert.match(h.vm().notice,/cannot still complete/);assert.equal(h.vm().arm(),false);});
for(const status of [403,404,500])run(`verify${status} cannot claim original failure or unlock`,async({h,setRead})=>{h.respond(()=>f.failure(503));h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();setRead({current:true,value:null,status});await h.vm().verify();await h.flush();assert.equal(h.vm().phase,'unknown');assert.match(h.vm().notice,/not evidence/);assert.equal(h.vm().arm(),false);});
run('cancel confirmation and stay guard retains unsubmitted review',async({h})=>{h.vm().arm();await h.flush();h.exit(false);assert.equal(h.vm().cancel(),false);assert.ok(h.vm().review);h.vm().close();await h.flush();assert.equal(h.vm().review,null);assert.equal(h.calls.length,0);});
run('pending cancel is blocked before and after render',async({h})=>{const d=f.deferred();h.respond(()=>d.promise);h.vm().arm();await h.flush();const cancel=h.vm().cancel,pending=h.vm().confirm();assert.equal(cancel(),false);await h.flush();assert.equal(h.vm().cancel(),false);h.vm().close();await h.flush();assert.ok(h.vm().review);d.resolve(accepted());await pending;await h.flush();});
run('unknown cancel asks before losing memory-only operation context',async({h})=>{h.respond(()=>f.failure(503));h.vm().arm();await h.flush();await h.vm().confirm();await h.flush();h.exit(false);assert.equal(h.vm().cancel(),false);assert.match(h.guards.at(-1).options.discardMessage,/may already be recorded/);h.exit(true);assert.equal(h.vm().cancel(),true);});
run('late401 on old company cannot redirect current company',async({h})=>{const d=f.deferred();h.respond(()=>d.promise);h.vm().arm();await h.flush();const pending=h.vm().confirm();h.tenant('synthetic-company-b');h.render();d.resolve(f.failure(401));await pending;await h.flush();assert.equal(h.nav.length,0);assert.equal(h.vm().result,null);});
run('unmount ignores late success and redirect',async({h})=>{const d=f.deferred();h.respond(()=>d.promise);h.vm().arm();await h.flush();const pending=h.vm().confirm();h.unmount();d.resolve(f.failure(401));await pending;assert.equal(h.nav.length,0);});

// A confirmation callback authorizes only its rendered receipt, not a later armed ref.
for (const nextTarget of ['accepted', 'rejected']) {
  run(`retained confirm cannot consume a replacement ${nextTarget} review`, async ({ h, record }) => {
    h.respond(() => f.ok({ ...f.quotationDetail, status: nextTarget }));
    h.vm().arm(); await h.flush();
    const old = h.vm(), first = old.review;
    old.close(); await h.flush();
    h.render(record, nextTarget, '/back');
    h.vm().arm(); await h.flush();
    const replacement = h.vm().review;
    assert.notEqual(replacement, first);
    await old.confirm(); await h.flush();
    assert.equal(h.calls.length, 0);
    assert.equal(h.vm().phase, 'idle');
    assert.equal(h.vm().review, replacement);
    await h.vm().confirm(); await h.flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, `/api/client-portal/quotations/${f.quotation.id}/decision`);
    assert.equal(h.calls[0].init.method, 'POST');
    assert.deepEqual(h.calls[0].init.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(h.calls[0].init.body), { status: nextTarget });
    assert.equal(h.vm().phase, 'acknowledged');
    assert.equal(h.vm().result.status, nextTarget);
  });
  run(`retained close cannot dismiss a replacement ${nextTarget} review`, async ({ h, record }) => {
    h.vm().arm(); await h.flush();
    const old = h.vm(); old.close(); await h.flush();
    h.render(record, nextTarget, '/back');
    h.vm().arm(); await h.flush();
    const replacement = h.vm().review;
    old.close(); await h.flush();
    assert.equal(h.vm().review, replacement);
    assert.equal(h.vm().review.target, nextTarget);
    assert.equal(h.calls.length, 0);
    h.vm().close(); await h.flush();
    assert.equal(h.vm().review, null);
  });
}
run('pre-arm callbacks have no authority over a later rendered confirmation', async ({ h }) => {
  const unarmed = h.vm();
  h.vm().arm(); await h.flush();
  const reviewed = h.vm().review;
  await unarmed.confirm(); unarmed.close(); await h.flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.vm().review, reviewed);
  assert.equal(h.vm().phase, 'idle');
});
run('a closed confirmation cannot be reused without a newly rendered receipt', async ({ h }) => {
  h.vm().arm(); await h.flush();
  const old = h.vm(); old.close(); await h.flush();
  await old.confirm(); await h.flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.vm().review, null);
  assert.equal(h.vm().phase, 'idle');
});
