// Independent synthetic behavior regressions. No live fetch, database, provider, or credential use.
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,review,responder,fail,ok,harness,invoice,payment,advance,income,account}=require('./accounting-money-in-independent-helper.cjs');
for(const [purpose,at] of [['order','create'],['project','create'],['order','issue'],['project','issue']])test(`${purpose} ${at} uncertainty cannot be replayed by a retained confirmation callback`,async()=>{
 const h=await setup(purpose,(u,i)=>i?.method&&(at==='create'?u.includes('/from-'):u.endsWith('/status'))?fail(503):responder(u,i));
 try{const retained=review(h);await retained.postMoneyIn();const count=h.calls.filter(c=>c.init?.method).length;assert.equal(h.render().stage.status,`${at}-uncertain`);await retained.postMoneyIn();assert.equal(h.calls.filter(c=>c.init?.method).length,count,'a stale callback must not repeat a non-idempotent create or issue');}finally{h.cleanup();}
});
const {settle}=require('./accounting-money-in-harness.cjs');
const purposes=['invoice','project','order','advance','other'];
const writes=h=>h.calls.filter(c=>c.init?.method);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
for(const purpose of purposes)test(`${purpose}: canceled confirmation rejects its retained confirm callback`,async()=>{
 const h=await setup(purpose);try{const retained=review(h);retained.cancelReview();assert.equal(h.render().confirmOpen,false);await retained.postMoneyIn();assert.equal(writes(h).length,0);assert.equal(h.render().values.amount,'25.00');assert.equal(h.render().dirty,true);}finally{h.cleanup();}
});
for(const purpose of purposes)test(`${purpose}: changing the reviewed amount invalidates the old confirmation`,async()=>{
 const h=await setup(purpose);try{const retained=review(h);retained.change('amount','26.00');await retained.postMoneyIn();assert.equal(writes(h).length,0,'stale confirmation must not post an amount no longer shown');assert.equal(h.render().values.amount,'26.00');}finally{h.cleanup();}
});
for(const purpose of purposes)test(`${purpose}: confirmed receipt locks writes even while response JSON is pending`,async()=>{
 const body=deferred();const h=await setup(purpose,(u,i)=>i?.method&&!u.includes('/from-')&&!u.endsWith('/status')?{ok:true,status:201,json:()=>body.promise}:responder(u,i));
 try{const retained=review(h),pending=retained.postMoneyIn();await settle();assert.equal(h.render().stage.status,'confirmed');const count=writes(h).length;await retained.postMoneyIn();assert.equal(writes(h).length,count);body.resolve(null);await pending;assert.equal(h.render().receipt,null);assert.equal(h.render().dirty,false);assert.match(h.render().writeError,/confirmed/);}finally{body.resolve(null);h.cleanup();}
});
for(const purpose of purposes)test(`${purpose}: exact payment instructions remain sticky across network, 500, 400, 403, then success`,async()=>{
 let n=0;const h=await setup(purpose,(u,i)=>{if(i?.method&&!u.includes('/from-')&&!u.endsWith('/status')){n++;if(n===1)throw Error('Synthetic lost acknowledgement');if(n<=4)return fail([0,0,500,400,403][n]);}return responder(u,i);});
 try{await review(h).postMoneyIn();const first=writes(h).at(-1),snapshot=structuredClone(h.render().values);for(let attempt=2;attempt<=5;attempt++){let v=h.render();assert.equal(v.stage.status,'payment-uncertain');for(const [key,value]of [['amount','99.00'],['account_id','foreign'],['source_id','foreign'],['reference','revised']])v.change(key,value);assert.deepEqual(h.render().values,snapshot);v.review();await h.render().postMoneyIn();const latest=writes(h).at(-1);assert.equal(latest.url,first.url);assert.equal(latest.init.body,first.init.body);assert.equal(latest.init.headers['Idempotency-Key'],first.init.headers['Idempotency-Key']);}assert.equal(h.render().stage.status,'confirmed');assert.equal(writes(h).filter(c=>c.url.includes('/from-')).length,['project','order'].includes(purpose)?1:0);assert.equal(writes(h).filter(c=>c.url.endsWith('/status')).length,['project','order'].includes(purpose)?1:0);}finally{h.cleanup();}
});
for(const purpose of purposes)test(`${purpose}: exact outbound contract uses the approved existing JSON-number fields only`,async()=>{
 const h=await setup(purpose);try{let v=h.render();v.change('reference','SYN-REF');v.change('notes','Synthetic internal note');await review(h).postMoneyIn();const expected=purpose==='advance'?{client_id:'synthetic-client',financial_account_id:account.id,advance_date:'2026-10-26',amount:25,reference:'SYN-REF',notes:'Synthetic internal note'}:purpose==='other'?{kind:'income',entry_date:'2026-10-26',financial_account_id:account.id,category_ledger_account_id:'category',amount:25,description:'Synthetic receipt',reference:'SYN-REF',notes:'Synthetic internal note',source_type:null,source_id:null}:{invoice_id:invoice.id,account_id:account.id,payment_date:'2026-10-26',invoice_amount:25,method:'bank_transfer',reference:'SYN-REF',notes:'Synthetic internal note'};assert.deepEqual(JSON.parse(writes(h).at(-1).init.body),expected);assert.deepEqual(Object.keys(writes(h).at(-1).init.headers).sort(),['Content-Type','Idempotency-Key']);for(const call of writes(h).filter(c=>c.url.endsWith('/status')))assert.deepEqual(JSON.parse(call.init.body),{action:'send'});}finally{h.cleanup();}
});
for(const purpose of ['advance','other'])for(const status of [400,403,422])test(`${purpose}: first authoritative ${status} rejection retains fields but permits a corrected new operation`,async()=>{
 let n=0;const h=await setup(purpose,(u,i)=>i?.method&&++n===1?fail(status):responder(u,i));try{const original=structuredClone(h.render().values);await review(h).postMoneyIn();assert.deepEqual(h.render().values,original);assert.equal(h.render().stage.status,'idle');h.render().change('reference','Corrected reference');await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.notEqual(writes(h)[0].init.headers['Idempotency-Key'],writes(h)[1].init.headers['Idempotency-Key']);assert.equal(JSON.parse(writes(h)[1].init.body).reference,'Corrected reference');}finally{h.cleanup();}
});
for(const purpose of ['order','project'])for(const status of [409,500])for(const at of ['create','issue'])test(`${purpose} ${at} HTTP ${status} recovery never auto-writes`,async()=>{
 let recovering=false;const h=await setup(purpose,(u,i)=>{if(i?.method&&(at==='create'?u.includes('/from-'):u.endsWith('/status')))return fail(status);if(recovering&&!i?.method&&u.includes('/settlement'))return ok({order_id:'synthetic-order',invoice_id:invoice.id});return responder(u,i);});
 try{await review(h).postMoneyIn();assert.equal(h.render().stage.status,`${at}-uncertain`);const count=writes(h).length;recovering=true;await h.render().recoverSource();assert.equal(h.render().stage.status,'issued');assert.equal(writes(h).length,count);assert.equal(h.render().confirmOpen,false);await h.render().postMoneyIn();assert.equal(writes(h).length,count,'a new explicit confirmation is required after read recovery');await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.equal(writes(h).length,count+1);assert.equal(writes(h).at(-1).url,'/api/finance/payments');}finally{h.cleanup();}
});
for(const purpose of ['order','project'])for(const at of ['create','issue'])test(`${purpose} ${at} read recovery failure retains stage and every input`,async()=>{
 let recovering=false;const h=await setup(purpose,(u,i)=>recovering&&!i?.method?fail(403):i?.method&&(at==='create'?u.includes('/from-'):u.endsWith('/status'))?fail(503):responder(u,i));
 try{await review(h).postMoneyIn();const before=structuredClone(h.render().values),stage=structuredClone(h.render().stage),count=writes(h).length;recovering=true;await h.render().recoverSource();assert.deepEqual(h.render().values,before);assert.deepEqual(h.render().stage,stage);assert.match(h.render().writeError,/Synthetic/);assert.equal(writes(h).length,count);assert.equal(h.render().dirty,true);}finally{h.cleanup();}
});
for(const status of ['paid','cancelled'])test(`recovered ${status} source never becomes permission for another receipt`,async()=>{
 let recovering=false;const h=await setup('order',(u,i)=>{if(recovering&&!i?.method&&u.includes('/invoices/'))return ok({...invoice,status,balance_due:status==='paid'?'0.00':'100.00'});if(i?.method&&u.endsWith('/status'))throw Error('Synthetic interruption');return responder(u,i);});
 try{await review(h).postMoneyIn();const count=writes(h).length;recovering=true;await h.render().recoverSource();assert.equal(h.render().stage.status,'issue-uncertain');assert.match(h.render().writeError,/paid or cancelled/);h.render().review();await h.render().postMoneyIn();assert.equal(writes(h).length,count);}finally{h.cleanup();}
});
for(const [name,patch] of [['wrong client',{client_id:'foreign'}],['wrong order',{order_id:'foreign'}],['wrong project',{project_id:'foreign'}],['wrong currency',{currency:'USD'}]])test(`created project invoice with ${name} remains committed creation but never issues/pays`,async()=>{
 const h=await setup('project',(u,i)=>i?.method&&u.includes('/from-')?ok({...invoice,status:'draft',...patch}):responder(u,i));try{await review(h).postMoneyIn();assert.equal(h.render().stage.status,'create-confirmed');assert.equal(writes(h).length,1);assert.equal(h.render().receipt,null);assert.match(h.render().writeError,/identity/);}finally{h.cleanup();}
});
for(const purpose of purposes)test(`${purpose}: a newer review invalidates the previous review token`,async()=>{
 const h=await setup(purpose);try{const stale=review(h);h.render().review();const fresh=h.render();await stale.postMoneyIn();assert.equal(writes(h).length,0);await fresh.postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.equal(writes(h).length,['order','project'].includes(purpose)?3:1);}finally{h.cleanup();}
});
for(const purpose of purposes)test(`${purpose}: unmounted review cannot submit in a newer document`,async()=>{
 const h=await setup(purpose);try{const retained=review(h),unmount=h.runEffect(/mounted.current = true/);unmount();await retained.postMoneyIn();assert.equal(writes(h).length,0);}finally{h.cleanup();}
});
for(const purpose of ['order','project'])for(const at of ['create','issue'])test(`${purpose}: late ${at} success after unmount cannot start the next financial stage`,async()=>{
 const deferredWrite=deferred();const h=await setup(purpose,(u,i)=>i?.method&&(at==='create'?u.includes('/from-'):u.endsWith('/status'))?deferredWrite.promise:responder(u,i));
 try{const retained=review(h),unmount=h.runEffect(/mounted.current = true/),pending=retained.postMoneyIn();await settle();const count=writes(h).length;unmount();deferredWrite.resolve(ok({...invoice,status:at==='create'?'draft':'sent'}));await pending;assert.equal(writes(h).length,count);assert.equal(h.render().receipt,null);}finally{deferredWrite.resolve(ok(null));h.cleanup();}
});
for(const purpose of ['order','project'])test(`${purpose}: known source creation with a new server ID uses only that saved ID`,async()=>{
 const serverId='synthetic-created-new-id';const h=await setup(purpose,(u,i)=>i?.method&&u.includes('/from-')?ok({...invoice,id:serverId,status:'draft'}):i?.method&&u.endsWith('/status')?ok({...invoice,id:serverId,status:'sent'}):i?.method?ok({...payment,invoice_id:serverId}):responder(u,i));
 try{await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.equal(writes(h).length,3);assert.equal(writes(h)[1].url,`/api/finance/invoices/${serverId}/status`);assert.equal(JSON.parse(writes(h)[2].init.body).invoice_id,serverId);}finally{h.cleanup();}
});
for(const purpose of ['order','project'])test(`${purpose}: existing issued source skips both source creation and issue`,async()=>{
 const h=await setup(purpose,(u,i)=>!i?.method&&u.includes('/settlement')?ok({order_id:'synthetic-order',invoice_id:invoice.id,eligible:false,reason:'Order must be completed'}):responder(u,i));
 try{await review(h).postMoneyIn();assert.equal(writes(h).length,1);assert.equal(writes(h)[0].url,'/api/finance/payments');assert.equal(h.render().stage.status,'confirmed');}finally{h.cleanup();}
});
for(const purpose of ['order','project'])test(`${purpose}: existing draft source is issued once, never recreated`,async()=>{
 const h=await setup(purpose,(u,i)=>!i?.method&&u.includes('/settlement')?ok({order_id:'synthetic-order',invoice_id:invoice.id,eligible:false}):!i?.method&&u.includes('/invoices/')?ok({...invoice,status:'draft'}):responder(u,i));
 try{await review(h).postMoneyIn();assert.equal(writes(h).length,2);assert.equal(writes(h)[0].init.method,'PATCH');assert.equal(writes(h)[1].url,'/api/finance/payments');}finally{h.cleanup();}
});
for(const status of [401,403,404,500])test(`direct invoice ${status} read fails closed without replacing source or posting`,async()=>{
 const h=await setup('invoice',(u,i)=>!i?.method&&u.includes('/invoices/')?fail(status):responder(u,i));try{assert.equal(h.render().invoice,null);assert.equal(h.render().canContinue,false);h.render().review();await h.render().postMoneyIn();assert.equal(writes(h).length,0);assert.match(h.render().sourceError,/Synthetic/);}finally{h.cleanup();}
});
for(const [name,permission,canView,canManage]of [['none',[],false,false],['manage only',['finance.manage'],false,true],['view only',['finance.view'],true,false],['both',['finance.view','finance.manage'],true,true],['wildcard',['*'],true,true]])test(`capability matrix ${name}: exact reads and writes`,async()=>{
 const h=harness();h.mode('create');h.query('purpose=advance');h.permissions(permission);h.respond(responder);try{let v=h.render();assert.equal(v.canView,canView);assert.equal(v.canManage,canManage);await v.loadMeta();v=h.render();assert.equal(h.calls.length,canView?1:0);v.change('source_id','synthetic-client');v.change('account_id',account.id);v.change('amount','25');v.change('date','2026-10-26');v=h.render();v.review();await h.render().postMoneyIn();assert.equal(writes(h).length,canView&&canManage?1:0);}finally{h.cleanup();}
});
test('legacy invoice link beyond100 is verified directly and prefills its authoritative balance',async()=>{
 const id='synthetic-invoice-101',h=harness();h.mode('create');h.query('purpose=invoice&invoice_id='+id);h.respond((u,i)=>u.includes('invoice-page')?ok({items:[],next_cursor:null}):u.endsWith('/'+id)?ok({...invoice,id,balance_due:'67.89'}):responder(u,i));try{await h.render().loadMeta();await h.render().loadInvoices();await h.render().loadSource();const v=h.render();assert.equal(v.invoice.id,id);assert.equal(v.values.source_id,id);assert.equal(v.values.amount,'67.89');assert.equal(v.invoicePage.items.length,0);assert.ok(h.calls.some(c=>c.url==='/api/finance/invoices/'+id));assert.equal(h.calls.some(c=>c.url.includes('limit=100')),false);}finally{h.cleanup();}
});
test('late selected invoice response does not overwrite a newer source read failure',async()=>{
 const delayed=deferred(),h=await setup('invoice');try{h.respond(u=>u.endsWith('/slow')?delayed.promise:fail(403));h.render().change('source_id','slow');const pending=h.render().loadSource();h.render().change('source_id','denied');await h.render().loadSource();delayed.resolve(ok({...invoice,id:'slow'}));await pending;assert.equal(h.render().invoice,null);assert.equal(h.render().values.source_id,'denied');assert.match(h.render().sourceError,/Synthetic/);assert.equal(h.render().canContinue,false);}finally{delayed.resolve(ok(null));h.cleanup();}
});
test('concurrent source recoveries are a single read transaction, never a write',async()=>{
 let recovering=false;const delayed=deferred(),h=await setup('order',(u,i)=>recovering&&!i?.method&&u.includes('/settlement')?delayed.promise:i?.method?fail(503):responder(u,i));try{await review(h).postMoneyIn();recovering=true;const before=h.calls.length,v=h.render(),a=v.recoverSource(),b=v.recoverSource();assert.equal(h.calls.length,before+1);delayed.resolve(ok({order_id:'synthetic-order',invoice_id:invoice.id}));await Promise.all([a,b]);assert.equal(h.render().stage.status,'issued');assert.equal(writes(h).length,1);}finally{delayed.resolve(ok(null));h.cleanup();}
});
for(const change of ['tenant','membership','role','permissions','purpose','invoice'])test(`workspace identity changes remount ${change} boundary`,()=>{
 const h=harness();try{h.mode('create');h.query('purpose=invoice&invoice_id=A');const file='src/components/accounting-money-in/money-in-workspace.tsx';const first=h.component(file,'MoneyInWorkspace',{}).key;if(change==='permissions')h.permissions(['finance.view']);else if(change==='purpose')h.query('purpose=advance&invoice_id=A');else if(change==='invoice')h.query('purpose=invoice&invoice_id=B');else h[change]('synthetic-new-'+change);const second=h.component(file,'MoneyInWorkspace',{}).key;assert.notEqual(second,first);}finally{h.cleanup();}
});
test('source read refresh invalidates the previously displayed confirmation before any new write',async()=>{
 const h=await setup('invoice');try{const retained=review(h);await h.render().loadSource();await retained.postMoneyIn();assert.equal(writes(h).length,0);await review(h).postMoneyIn();assert.equal(writes(h).length,1);}finally{h.cleanup();}
});
for(const next of [undefined,17,{},[]])test(`payment cursor metadata ${JSON.stringify(next)} cannot masquerade as an authoritative last page`,async()=>{
 const h=harness();h.respond(()=>ok({items:[payment],...(next===undefined?{}:{next_cursor:next})}));try{await h.render().loadPage();assert.equal(h.render().rows,null);assert.ok(h.render().pageError,'malformed next cursor must be an unavailable read, not an invented end');assert.equal(writes(h).length,0);}finally{h.cleanup();}
});
for(const [purpose,patch]of [['invoice',{invoice_currency:'USD'}],['invoice',{account_currency:'USD'}],['advance',{currency:'USD'}],['other',{currency:'USD'}]])test(`${purpose}: a saved receipt in the wrong immutable currency stays committed but unverified ${JSON.stringify(patch)}`,async()=>{
 const h=await setup(purpose,(u,i)=>i?.method?ok({...({invoice:payment,advance,income,other:income}[purpose]),...patch}):responder(u,i));try{await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.equal(h.render().receipt,null,'wrong currency receipt must not be accepted as verification of the reviewed operation');assert.match(h.render().writeError,/identity/);h.render().review();await h.render().postMoneyIn();assert.equal(writes(h).length,1);}finally{h.cleanup();}
});
test('payment register page50 can continue to51 without a fixed record/page ceiling',async()=>{
 const h=harness();h.query('cursor=synthetic-page50&page=50&filter_invoice=synthetic-filter');h.respond(()=>ok({items:[payment],next_cursor:'synthetic-page51'}));try{await h.render().loadPage();await h.render().nextPage();const url=new URL(h.nav.at(-1)[1],'https://synthetic.invalid');assert.equal(url.searchParams.get('page'),'51');assert.equal(url.searchParams.get('cursor'),'synthetic-page51');assert.equal(url.searchParams.get('filter_invoice'),'synthetic-filter');assert.equal(h.calls[0].url,'/api/finance/payment-page?limit=20&cursor=synthetic-page50&invoice_id=synthetic-filter');}finally{h.cleanup();}
});
test('payment cursor previous history is isolated from company and invoice filter',async()=>{
 const h=harness();h.respond(()=>ok({items:[payment],next_cursor:'opaque-synthetic-next'}));try{await h.render().loadPage();await h.render().nextPage();h.query('cursor=opaque-synthetic-next&page=2');h.render();h.runEffect(/readPreviousAccountCursor/);await settle();assert.equal(h.render().hasPrevious,true);h.query('cursor=opaque-synthetic-next&page=2&filter_invoice=different');h.render();h.runEffect(/readPreviousAccountCursor/);await settle();assert.equal(h.render().hasPrevious,false);h.query('cursor=opaque-synthetic-next&page=2');h.tenant('synthetic-tenant-two');h.render();h.runEffect(/readPreviousAccountCursor/);await settle();assert.equal(h.render().hasPrevious,false);}finally{h.cleanup();}
});
test('invoice search resets cursor history and discards an older in-flight selector read',async()=>{
 const h=await setup('invoice');const delayed=deferred();try{h.respond(u=>u.includes('search=old')?delayed.promise:ok({items:[{...invoice,id:'new-result'}],next_cursor:'new-next'}));h.render().setInvoiceSearch('old');const first=h.render().loadInvoices();h.render().setInvoiceSearch('new');await h.render().loadInvoices();delayed.resolve(ok({items:[{...invoice,id:'old-result'}],next_cursor:'old-next'}));await first;assert.equal(h.render().invoicePage.items[0].id,'new-result');assert.equal(h.render().hasPreviousInvoices,false);assert.equal(h.render().values.source_id,invoice.id,'selector searching must not silently replace the chosen invoice');assert.equal(h.render().invoice.id,invoice.id);}finally{delayed.resolve(ok(null));h.cleanup();}
});
for(const purpose of purposes)test(`${purpose}: dirty Back cancellation preserves the draft and accepted Back performs no financial write`,async()=>{
 const h=await setup(purpose);try{const before=structuredClone(h.render().values);h.confirm(false);assert.equal(h.render().back(),false);assert.equal(h.nav.length,0);assert.deepEqual(h.render().values,before);h.confirm(true);assert.equal(h.render().back(),true);assert.equal(h.nav.length,1);assert.equal(writes(h).length,0);}finally{h.cleanup();}
});
test('same-currency verified receipt must match the receiving account amount, not only the invoice amount',async()=>{
 const h=await setup('invoice',(u,i)=>i?.method?ok({...payment,account_amount:'1.00'}):responder(u,i));try{await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.equal(h.render().receipt,null);assert.match(h.render().writeError,/identity/);h.render().review();await h.render().postMoneyIn();assert.equal(writes(h).length,1);}finally{h.cleanup();}
});
test('matching receipt may truthfully expose a later reversed status without reopening posting',async()=>{
 const h=await setup('invoice',(u,i)=>i?.method?ok({...payment,status:'reversed'}):responder(u,i));try{await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.equal(h.render().receipt.record.status,'reversed');h.render().review();await h.render().postMoneyIn();assert.equal(writes(h).length,1);}finally{h.cleanup();}
});
for(const purpose of purposes)test(`${purpose}: success never couples a financial POST to fallible GET readback`,async()=>{
 let started=false;const h=await setup(purpose,(u,i)=>{if(i?.method)started=true;if(started&&!i?.method)throw Error('Readback must not be called');return responder(u,i);});try{const before=h.calls.length;await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.ok(h.render().receipt);assert.ok(h.calls.slice(before).every(c=>c.init?.method));assert.equal(h.render().dirty,false);}finally{h.cleanup();}
});
for(const [name,patch]of [['client',{client_id:'foreign'}],['order',{order_id:'foreign'}],['project',{project_id:'foreign'}],['currency',{currency:'USD'}]])test(`read-only source recovery with mismatched ${name} cannot resume writes`,async()=>{
 let recover=false;const h=await setup('project',(u,i)=>recover&&!i?.method&&u.includes('/invoices/')?ok({...invoice,...patch}):i?.method&&u.endsWith('/status')?fail(503):responder(u,i));try{await review(h).postMoneyIn();const count=writes(h).length;recover=true;await h.render().recoverSource();assert.equal(h.render().stage.status,'issue-uncertain');assert.match(h.render().writeError,/does not match/);h.render().review();await h.render().postMoneyIn();assert.equal(writes(h).length,count);}finally{h.cleanup();}
});
for(const rate of ['2.00000000','0.99999999',null,undefined])test(`same-currency receipt with unverified exchange rate ${String(rate)} remains committed but unverified`,async()=>{
 const h=await setup('invoice',(u,i)=>i?.method?ok({...payment,exchange_rate:rate}):responder(u,i));try{await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.equal(h.render().receipt,null);assert.match(h.render().writeError,/identity/);}finally{h.cleanup();}
});
for(const rate of [1,'1','1.00000000'])test(`same-currency receipt accepts the actual server unit exchange rate ${JSON.stringify(rate)}`,async()=>{
 const h=await setup('invoice',(u,i)=>i?.method?ok({...payment,exchange_rate:rate}):responder(u,i));try{await review(h).postMoneyIn();assert.equal(h.render().stage.status,'confirmed');assert.equal(h.render().receipt.record.id,payment.id);}finally{h.cleanup();}
});

test('native query transition invalidates a delayed register Next completion',async()=>{
 const h=harness();h.query('cursor=synthetic-page2&page=2');h.respond(()=>ok({items:[payment],next_cursor:'synthetic-page3'}));
 try{await h.render().loadPage();let release;window.crypto={randomUUID:require('node:crypto').randomUUID,subtle:{digest:()=>new Promise(resolve=>release=resolve)}};
  const pending=h.render().nextPage();h.query('filter_invoice=browser-selected-invoice');h.render();h.runEffect(/navBusy.current = false/);release(new Uint8Array(32).buffer);await pending;
  assert.equal(h.nav.length,0,'A delayed Next must not override the browser-selected register query.');
 }finally{h.cleanup();}
});

test('browser Back to an earlier pending register URL does not restore disabled paging',async()=>{
 const h=harness();h.query('cursor=synthetic-page2&page=2');h.respond(()=>ok({items:[payment],next_cursor:'synthetic-page3'}));
 try{await h.render().loadPage();let release;window.crypto={randomUUID:require('node:crypto').randomUUID,subtle:{digest:()=>new Promise(resolve=>release=resolve)}};
  const pending=h.render().nextPage();h.query('filter_invoice=other');h.render();h.render();h.runEffect(/navBusy.current = false/);h.query('cursor=synthetic-page2&page=2');h.render();h.render();h.runEffect(/navBusy.current = false/);
  assert.equal(h.render().paging,false);release(new Uint8Array(32).buffer);await pending;assert.equal(h.nav.length,0);
 }finally{h.cleanup();}
});
test('same-API native query change invalidates navigation and its pending presentation',async()=>{
 const h=harness();h.query('cursor=synthetic-page2&page=2&focus=old-focus');h.respond(()=>ok({items:[payment],next_cursor:'synthetic-page3'}));
 try{await h.render().loadPage();let release;window.crypto={randomUUID:require('node:crypto').randomUUID,subtle:{digest:()=>new Promise(resolve=>release=resolve)}};
  const pending=h.render().nextPage(),source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/hooks/use-money-in-workspace.ts'),'utf8');
  assert.match(source,/useEffect\([\s\S]*?navBusy\.current = false;[\s\S]*?\[pageUrl, rawQuery\]/,'Native query identity must participate even if its API URL is unchanged.');
  h.query('cursor=synthetic-page2&page=2&focus=browser-selected');h.render();h.render();h.runEffect(/navBusy.current = false/);assert.equal(h.render().paging,false);release(new Uint8Array(32).buffer);await pending;assert.equal(h.nav.length,0);
 }finally{h.cleanup();}
});
