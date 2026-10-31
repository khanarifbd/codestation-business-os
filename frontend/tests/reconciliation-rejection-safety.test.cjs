const test=require('node:test'),assert=require('node:assert/strict');
const {hookHarness}=require('./reconciliation-harness.cjs');
const f=require('./reconciliation-fixtures.cjs');
const {validation,malformed,rejected}=require('./accounting-rejection-fixtures.cjs');
const back='/dashboard/accounting/reconciliation';
const writes=h=>h.calls.filter(c=>['POST','DELETE'].includes(c.init?.method));
async function setup(kind){
 const creation=kind==='create';const row=kind==='unmatch'||kind==='finalize'?{...f.detail,cleared_book_balance:'125.00',difference:'0.00',matched_transactions:2,transactions:[{...f.transaction,selected:true}],unmatched_count:0}:f.detail;
 const h=hookHarness({file:creation?'src/hooks/use-reconciliation-create.ts':'src/hooks/use-reconciliation-document.ts',target:creation?'useReconciliationCreate':'useReconciliationDocument',args:creation?[back]:[f.session.id,true,back]});
 h.respond(async()=>f.ok(creation?{accounts:[f.account]}:row));await h.flush();
 if(creation){for(const[k,v]of Object.entries(f.values))h.vm().change(k,v);await h.flush();}
 h.readValue=creation?{accounts:[f.account]}:row;
 h.respondFailure=(status,body)=>h.respond(async(url,init)=>init?.method?rejected(status,body):f.ok(h.readValue));
 h.perform=async()=>{if(creation){h.vm().review();await h.flush();await h.vm().create();}else if(kind==='match'||kind==='unmatch')await h.vm().toggle(f.transaction.id);else{h.vm().reviewAction(kind);await h.flush();await h.vm().confirmAction();}await h.flush();};
 return h;
}
for(const kind of ['create','match','unmatch','finalize','discard']) {
 for(const[label,body]of malformed)test(`reconciliation ${kind} malformed 422 ${label} retains action`,async()=>{const h=await setup(kind);try{h.respondFailure(422,body);await h.perform();assert.equal(h.vm().phase,'uncertain');await h.perform();assert.equal(writes(h).length,1);if(kind==='create'){h.vm().change('notes','unsafe replacement');assert.equal(h.vm().values.notes,f.values.notes);}else assert.equal(h.vm().editable,false);}finally{h.cleanup();}});
 for(const status of [408,429])test(`reconciliation ${kind} ${status} remains uncertain with valid body`,async()=>{const h=await setup(kind);try{h.respondFailure(status,validation);await h.perform();assert.equal(h.vm().phase,'uncertain');await h.perform();assert.equal(writes(h).length,1);}finally{h.cleanup();}});
 for(const body of [{detail:'Synthetic precommit rejection'},validation])test(`reconciliation ${kind} valid 422 ${typeof body.detail} preserves correction`,async()=>{const h=await setup(kind);try{h.respondFailure(422,body);await h.perform();assert.equal(h.vm().phase,'idle');assert.equal(writes(h).length,1);await h.perform();assert.equal(writes(h).length,2);}finally{h.cleanup();}});
 test(`reconciliation ${kind} malformed JSON survives unchanged reads and cannot replay`,async()=>{const h=await setup(kind);try{h.respond(async(url,init)=>init?.method?{ok:false,status:422,json:async()=>{throw Error('Invalid JSON');}}:f.ok(h.readValue));await h.perform();const original=writes(h)[0];if(kind==='create')await h.vm().refreshMeta();else await h.vm().recheck();await h.flush();assert.equal(h.vm().phase,'uncertain');h.respondFailure(422,validation);await h.perform();assert.equal(writes(h).length,1);assert.equal(writes(h)[0].init.body,original.init.body);h.exit(false);assert.equal(h.vm().back(),false);}finally{h.cleanup();}});
 test(`reconciliation ${kind} stale owner cannot classify delayed 401 or replay`,async()=>{const h=await setup(kind);try{const pending=f.deferred();h.respond(()=>pending.promise);const request=h.perform();await f.tick();await h.flush();assert.equal(writes(h).length,1);const old=h.vm();h.unmount();pending.resolve(rejected(401,validation));await request;if(kind==='create')await old.create();else await old.toggle(f.transaction.id);assert.equal(writes(h).length,1);assert.equal(h.nav.length,0);}finally{h.cleanup();}});
}
