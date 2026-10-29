/* v24 presentation integration migrated under explicit approval; core keyed suites unchanged. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { harness, ok, fail, target, payload, receipt, nodes, text, settle, root } = require('./recurring-post-harness.cjs');
const fixtures = require('./control-fixtures.cjs');
const meta = fixtures.meta(), row = fixtures.recurring({...target});
function button(tree, label) { return nodes(tree,'button').find(node => text(node) === label); }
function response(url, fallback) { return url.endsWith('expense-meta') ? ok(meta) : url.endsWith('/accounts') ? ok([fixtures.account()]) : fallback(); }
async function initialized(responder) { const h = harness({workspace:true}); h.respond(responder); for(let i=0;i<4;i++){h.render();await settle();}return h; }
function openReview(h) {
 const form = nodes(h.render(),'form').find(n=>n.props.onChange);assert.ok(form,'dedicated posting form exists without register selection');const original=global.FormData;
 try{global.FormData=class{constructor(value){this.value=value;}get(k){return this.value[k]??'';}};form.props.onSubmit({preventDefault(){},currentTarget:payload});}finally{global.FormData=original;}
 return nodes(h.render(),'FinancialConfirmationDialog')[0];
}
test('Controls dedicated integration: POST200 then failed current-schedule GET retains ACK and disables repost',async()=>{
 let reads=0;const h=await initialized((url,init)=>init?.method?ok(receipt):response(url,()=>++reads===1?ok([row]):fail(503,'Synthetic readback unavailable')));
 try{const dialog=openReview(h);assert.equal(dialog.props.open,true);await dialog.props.onConfirm();const tree=h.render();assert.match(text(tree),/Expense posting acknowledged/);assert.match(text(tree),/Posting was acknowledged, but the schedule refresh is unavailable/);assert.equal(button(tree,'Review expense posting').props.disabled,true);assert.equal(nodes(tree,'FinancialConfirmationDialog')[0].props.open,false);await dialog.props.onConfirm();assert.equal(h.calls.filter(c=>c.init?.method==='POST').length,1);}finally{h.cleanup();}
});
test('Controls dedicated integration: unknown retains fields/key, Cancel cannot discard, explicit retry uses exact body/key',async()=>{
 let writes=0;const h=await initialized((url,init)=>init?.method?++writes===1?Promise.reject(Error('Synthetic unknown')):ok(receipt):response(url,()=>ok([row])));
 try{await openReview(h).props.onConfirm();let tree=h.render();assert.match(text(tree),/Posting outcome needs verification/);const inspect=nodes(tree,'a').find(n=>n.props.href==='/dashboard/expenses');assert.equal(inspect.props.target,'_blank');assert.equal(inspect.props.rel,'noopener noreferrer');nodes(tree,'button').find(n=>n.props['aria-label']==='Close').props.onClick();assert.equal(h.nav.length,0);tree=h.render();button(tree,'Review same-operation retry').props.onClick();const retry=nodes(h.render(),'FinancialConfirmationDialog')[0];assert.equal(retry.props.confirmLabel,'Retry same operation');await retry.props.onConfirm();const calls=h.calls.filter(c=>c.init?.method==='POST');assert.equal(calls.length,2);assert.equal(calls[0].init.body,calls[1].init.body);assert.equal(calls[0].init.headers['Idempotency-Key'],calls[1].init.headers['Idempotency-Key']);assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)),Object.keys(payload));assert.match(text(h.render()),/Expense posting acknowledged/);}finally{h.cleanup();}
});
test('Controls dedicated integration: fields and Cancel stay disabled while POST pending',async()=>{
 let resolve;const h=await initialized((url,init)=>init?.method?new Promise(r=>resolve=r):response(url,()=>ok([row])));
 try{const dialog=openReview(h),pending=dialog.props.onConfirm(),tree=h.render();assert.ok(nodes(tree,'fieldset').some(n=>n.props.disabled));assert.equal(nodes(tree,'button').find(n=>n.props['aria-label']==='Close').props.disabled,true);resolve(ok(receipt));await pending;assert.equal(h.calls.filter(c=>c.init?.method==='POST').length,1);}finally{h.cleanup();}
});
test('Controls dispatcher remounts by company membership role permissions and native document path',()=>{
 const source=fs.readFileSync(path.join(root,'src/components/finance-controls/control-workspace.tsx'),'utf8');assert.match(source,/JSON.stringify\(\[tenant\?\.organization.id,\s*tenant\?\.membership_id,\s*tenant\?\.role_id,\s*tenant\?\.permissions\]\)/);assert.match(source,/key=\{`\$\{scope\}:\$\{pathname\}`\}/);assert.match(source,/<ControlManualPost id=\{id\} returnTo=\{back\} scope=\{scope\}/);
});
test('Controls acknowledged workspace cannot begin another occurrence; native return requires a fresh mounted read',async()=>{
 let reads=0;const h=await initialized((url,init)=>init?.method?ok(receipt):response(url,()=>++reads===1?ok([row]):fail(503)));
 try{await openReview(h).props.onConfirm();let tree=h.render();assert.equal(button(tree,'Review expense posting').props.disabled,true);nodes(tree,'button').find(n=>n.props['aria-label']==='Close').props.onClick();assert.deepEqual(h.nav.at(-1),['assign','/dashboard/accounting/controls']);tree=h.render();assert.equal(nodes(tree,'form').length,0);assert.equal(h.calls.filter(c=>c.init?.method==='POST').length,1);}finally{h.cleanup();}
 const fresh=await initialized((url)=>response(url,()=>ok([{...row,next_due_date:'2026-11-26'}])));try{assert.equal(nodes(fresh.render(),'input').find(n=>n.props.name==='expense_date').props.defaultValue,'2026-11-26');assert.equal(fresh.calls.filter(c=>c.init?.method==='POST').length,0);}finally{fresh.cleanup();}
});
test('Controls manual confirmation retains focus-managed MoneyOutConfirmation wrapper',()=>{const source=fs.readFileSync(path.join(root,'src/components/finance-controls/control-manual-post.tsx'),'utf8');assert.match(source,/import \{ MoneyOutConfirmation as FinancialConfirmationDialog \} from "@\/components\/accounting-money-out\/money-out-ui"/);});
test('Controls old first-post callback and failed readback cannot unlock acknowledged workspace',async()=>{
 let reads=0;const h=await initialized((url,init)=>init?.method?ok(receipt):response(url,()=>++reads===1?ok([row]):fail(503,'Current readback unavailable')));
 try{const old=openReview(h).props.onConfirm;await old();h.render();await old();const tree=h.render();assert.equal(button(tree,'Review expense posting').props.disabled,true);assert.match(text(tree),/cannot begin another occurrence/);assert.equal(h.calls.filter(c=>c.init?.method==='POST').length,1);}finally{h.cleanup();}
});
test('Controls register has no inline editor or nested scrolling table and actions enter native workspaces',()=>{
 const source=fs.readFileSync(path.join(root,'src/components/finance-controls/control-register.tsx'),'utf8'),css=fs.readFileSync(path.join(root,'src/components/finance-controls/controls.css'),'utf8');assert.doesNotMatch(source,/ControlManualPost|ControlCreate|<form|overflow-y/);assert.match(source,/href=\{vm.viewHref\(row.id\)\}/);assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/\.ct-form-grid\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);assert.match(css,/\.ct-tabs button\s*\{\s*font-size:.69rem/);
});
