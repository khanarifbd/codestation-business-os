const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const spec=read('e2e/qc-owner-financial-ux.spec.mjs'),source=read('e2e/support/reports-readonly-browser.mjs'),review=require('./helpers/reviewed-reports-browser.json');
function restoreApprovedFinancialAdditions(s) {
  for (const fragment of [
    'import { verifyFinancialReviewCancel } from "./support/financial-review-cancel.mjs";\n',
    'import { verifyMoneyOutUnknownAction } from "./support/money-out-safe-action.mjs";\n',
    '  await verifyMoneyOutUnknownAction(page, testInfo, api, account, category, today);\n',
    '  await verifyFinancialReviewCancel(page, testInfo, api, account, today);\n',
  ]) {
    assert.equal(s.split(fragment).length, 2, 'Exactly one reviewed addition must remain');
    s = s.replace(fragment, '');
  }
  return s;
}
function verify(s=spec,h=source){s=restoreApprovedFinancialAdditions(s);const imported="import { verifyReportsReadOnly } from './support/reports-readonly-browser.mjs';\n",call='\n  await verifyReportsReadOnly(page, testInfo, today, project, costClient);';assert.equal(s.split(imported).length,2);assert.equal(s.split(call).length,2);assert.equal(hash(s.replace(imported,'').replace(call,'')),review.baselineHash);assert.equal(hash(h.replace("      if (size === 'mobile' && ['clients', 'performance', 'position', 'projects'].includes(name)) {\n        const disclosure = page.locator('.or-data-details > summary');\n        let opened = false;\n        try {\n          if (name === 'performance') { await disclosure.click(); opened = true; }\n          const target = name === 'position'\n            ? page.getByRole('heading', { name: 'Active account balances', exact: true })\n            : page.getByRole('region', { name: { clients: 'Client performance table', projects: 'Project performance table', performance: 'USD monthly values table' }[name], exact: true }).getByRole('row').nth(1);\n          await target.scrollIntoViewIfNeeded();\n          await expect(target).toBeVisible();\n          await expect(target).toBeInViewport();\n          await page.screenshot({ path: info.outputPath(`neutral-theme-reports-${name}-mobile-results.png`), fullPage: false });\n        } finally { if (opened) await disclosure.click(); }\n      }\n", "")),review.helperHash);}
test('full original financial fixture/assertions/actions/timeouts unchanged except one read-only helper call',()=>{verify();assert.ok(review.originalAssertions>=94);for(const [a,b]of [['USD 169.00','USD 170.00'],['180_000','240_000'],['today, project, costClient','today, project, null']])assert.throws(()=>verify(spec.replace(a,b)));assert.throws(()=>verify(spec,source.replace("toBe(200)","toBe(201)")));});
function fn(name,globals){const tree=ts.createSourceFile('helper.mjs',source,99,true),node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);return vm.runInNewContext('('+node.getText(tree).replace(/^export /,'')+')',{URL,...globals});}
const expect=value=>({toBe:x=>assert.equal(value,x),toEqual:x=>assert.equal(JSON.stringify(value),JSON.stringify(x)),toHaveAttribute:async()=>{}});
function fixture(){let predicate,resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});const events=[];return{events,resolve,reject,predicate:()=>predicate,page:{waitForResponse:fn=>{events.push('observe');predicate=fn;return promise;},locator:()=>({})}};}
function response(url='https://fixture.invalid/api/reports/overview?date_from=2026-10-30&date_to=2026-10-30&currency=USD',method='GET',status=200){return{url:()=>url,request:()=>({method:()=>method}),status:()=>status,json:async()=>({reporting_basis:'operational',date_from:'2026-10-30',date_to:'2026-10-30',financials:[{currency:'USD'}]}),finished:async()=>null};}
test('actual report waiter observes before action and rejects other route/date/currency/mutation',async()=>{const h=fixture(),run=fn('observeReportRead',{expect})(h.page,'2026-10-30',async()=>h.events.push('action'));assert.deepEqual(h.events,['observe','action']);assert.equal(h.predicate()(response()),true);for(const bad of [response('https://fixture.invalid/api/reports/meta'),response(undefined,'POST'),response('https://fixture.invalid/api/reports/overview?date_from=2026-10-29&date_to=2026-10-30&currency=USD'),response('https://fixture.invalid/api/reports/overview?date_from=2026-10-30&date_to=2026-10-30&currency=EUR')])assert.equal(h.predicate()(bad),false);h.resolve(response());await run;});
for(const fail of ['action','waiter','status','body','completion'])test('actual GET observation rejects '+fail+' without retry or unhandled waiter',async()=>{const h=fixture(),run=fn('observeReportRead',{expect})(h.page,'2026-10-30',async()=>{if(fail==='action')throw Error(fail);});if(fail==='action'||fail==='waiter')h.reject(Error('waiter'));else{const r=response(undefined,'GET',fail==='status'?500:200);if(fail==='body')r.json=async()=>{throw Error('body');};if(fail==='completion')r.finished=async()=>Error('completion');h.resolve(r);}await assert.rejects(run);await new Promise(r=>setImmediate(r));assert.equal(h.events.length,1);});
for(const fail of [false,true])test('actual Reports capture restores viewport on failure '+fail,async()=>{const previous={width:1200,height:900},sizes=[];const page={viewportSize:()=>previous,setViewportSize:async v=>sizes.push(v),evaluate:async()=>true,locator:()=>({}),screenshot:async()=>{if(fail)throw Error('screenshot');}};const run=fn('captureReportsPage',{expect})(page,{outputPath:x=>x},'fixture');if(fail)await assert.rejects(run);else await run;assert.equal(sizes.at(-1),previous);});
test('Reports helper has no mutation/auth/interceptor and all eight captures fit unchanged artifact glob',()=>{assert.doesNotMatch(source,/page\.route|route\.(?:fetch|fulfill)|request\.(?:post|patch|put|delete)|auth\/login|waitForTimeout|test\.setTimeout/);assert.ok(source.includes('neutral-theme-reports-${name}-${size}.png'));assert.ok(fs.readFileSync(path.join(root,'../.github/workflows/ci.yml'),'utf8').includes('**/neutral-theme-*.png'));assert.ok(spec.includes('const today = new Date().toISOString().slice(0, 10)'));const view=read('src/components/operational-reports/report-workspace.tsx');for(const label of ['Apply filters','Refresh results','Report sections','Applied report scope'])assert.ok(view.includes(label));});
for(const failure of ['none','capture','readiness'])test('mobile performance table disclosure and viewport cleanup '+failure,async()=>{
 const previous={width:1200,height:900},sizes=[];let opened=false,shots=0,scrolls=0;
 const row={scrollIntoViewIfNeeded:async()=>{scrolls++;if(failure==='readiness')throw Error('readiness');}};
 const page={viewportSize:()=>previous,setViewportSize:async v=>sizes.push(v),evaluate:async()=>true,locator:selector=>selector.includes('summary')?{click:async()=>{opened=!opened;}}:{},getByRole:()=>({getByRole:()=>({nth:()=>row})}),screenshot:async o=>{shots++;if(failure==='capture'&&o.path.includes('mobile-results'))throw Error('capture');}};
 const assertions=value=>({...expect(value),toBeVisible:async()=>{},toBeInViewport:async()=>{}});
 const run=()=>fn('captureReportsPage',{expect:assertions})(page,{outputPath:x=>x},'performance');
 if(failure==='none')await run();else await assert.rejects(run);
 assert.equal(opened,false);assert.equal(sizes.at(-1),previous);assert.equal(scrolls,1);if(failure==='none')assert.equal(shots,3);
});
test('targeted report capture inverse rejects changed readiness and disclosure cleanup',()=>{
 assert.throws(()=>verify(spec,source.replace('await expect(target).toBeInViewport();','')));
 assert.throws(()=>verify(spec,source.replace('if (opened) await disclosure.click();','')));
});

test('approved financial helper coexistence rejects changed, missing or duplicated imports and calls',()=>{
 for(const fragment of [
  'import { verifyFinancialReviewCancel } from "./support/financial-review-cancel.mjs";',
  'import { verifyMoneyOutUnknownAction } from "./support/money-out-safe-action.mjs";',
  'await verifyMoneyOutUnknownAction(page, testInfo, api, account, category, today);',
  'await verifyFinancialReviewCancel(page, testInfo, api, account, today);',
 ]) {
  assert.throws(()=>verify(spec.replace(fragment, '')));
  assert.throws(()=>verify(spec.replace(fragment, fragment+'\n'+fragment)));
  assert.throws(()=>verify(spec.replace(fragment, fragment.replace('verify', 'changed'))));
 }
});
