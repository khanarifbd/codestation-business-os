const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../e2e/qc-owner-hr-project-extended.spec.mjs'),'utf8'),{beforeTalentBrowser}=require('./helpers/reviewed-talent-browser.cjs');
const tree=ts.createSourceFile('browser',source,99,true);
const helper=name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree);
test('only exact reviewed Talent helpers normalize; changed assertion and renamed helper fail',()=>{
 assert.doesNotThrow(()=>beforeTalentBrowser(source));
 assert.throws(()=>beforeTalentBrowser(source.replace('expect(succeeded).toBe(1)','expect(succeeded).toBe(2)')),/reviewed Talent helper/);
 assert.throws(()=>beforeTalentBrowser(source.replace('function verifyTalentReadRecovery','function uncheckedReadRecovery')),/exact Talent helper/);
 const body=source.slice(source.indexOf("test('HR11"),source.indexOf("test('HR07"));
 assert.ok(body.includes('test.setTimeout(150000)'));assert.equal((body.match(/setup\(p,/g)||[]).length,1);
 assert.doesNotMatch(body,/hire\(|\/convert|\/invitations|test\.(?:skip|fixme)|force:/);
 assert.ok(body.includes('verifyTalentReviewRefresh(p,review,async()=>'));
});
for(const fail of [false,true])test('actual read outage always unregisters before retry/failure '+fail,async()=>{
 const calls=[];let count=0;const p={route:async()=>calls.push('route'),unroute:async()=>calls.push('unroute'),goto:async()=>calls.push('goto'),getByRole:()=>({click:async()=>calls.push('retry')}),getByText:()=>({})};
 const expect=()=>({toBeVisible:async()=>{if(fail&&++count===1)throw Error('assertion failed');},toHaveCount:async()=>{}});
 const run=vm.runInNewContext('('+helper('verifyTalentReadRecovery')+')',{expect});
 if(fail)await assert.rejects(()=>run(p),/assertion failed/);else await run(p);
 assert.deepEqual(calls,fail?['route','goto','unroute']:['route','goto','unroute','retry']);
});
for(const fail of [false,true])test('actual Talent captures restore viewport on success/failure '+fail,async()=>{
 const original={width:900,height:700},sizes=[];const p={viewportSize:()=>original,setViewportSize:async v=>sizes.push(v),getByRole:()=>({click:async()=>{}}),getByText:()=>({}),evaluate:async()=>true,screenshot:async()=>{if(fail)throw Error('capture failed');}};
 const expect=v=>({toBeVisible:async()=>{},toBe:x=>assert.equal(v,x)}),run=vm.runInNewContext('('+helper('captureTalentTabs')+')',{expect});
 if(fail)await assert.rejects(()=>run(p,{outputPath:x=>x}),/capture failed/);else await run(p,{outputPath:x=>x});
 assert.equal(sizes.at(-1),original);
});
test('real backend rejection probe restores native validation and never fabricates a write response',()=>{
 const s=helper('verifyTalentReviewRefresh');assert.ok(s.includes('finally{await form.evaluate'));assert.ok(s.includes('node.noValidate=value'));assert.ok(s.includes('finally{p.off'));assert.ok(s.includes('response.status()===422'));assert.ok(s.includes('expect(succeeded).toBe(1)'));assert.doesNotMatch(s,/route\.(?:fulfill|fetch)|force:|waitForTimeout/);
});
for(const scenario of ['success','submit-failure','response-failure','refresh-failure','save-failure'])test('actual backend validation probe restores form and listener after '+scenario,async()=>{
 let listener,waits=0,off=false;const node={noValidate:false,requestSubmit(){if(scenario==='submit-failure')throw Error('submit failed');listener(response(422));}};
 const response=status=>({status:()=>status,ok:()=>status>=200&&status<300,url:()=> 'https://synthetic.invalid/api/hr/performance/review-a',request:()=>({method:()=> 'PATCH'})});
 const retry={click:async()=>{if(scenario==='refresh-failure')throw Error('refresh failed');}},form={evaluate:async(fn,arg)=>fn(node,arg),locator:()=>({getByRole:()=>retry})};
 const p={locator:()=>({filter:()=>form}),getByLabel:()=>({}),on:(event,fn)=>{listener=fn;},off:(event,fn)=>{assert.equal(fn,listener);off=true;},waitForResponse:async()=>{waits++;if(waits===1&&scenario==='response-failure')throw Error('response failed');return response(waits===1?422:200);}};
 const expect=value=>({toBe:expected=>assert.equal(value,expected),toBeEnabled:async()=>{},toHaveCount:async()=>{},toHaveValue:async()=>{}});
 const run=vm.runInNewContext('('+helper('verifyTalentReviewRefresh')+')',{expect,URL});
 const action=()=>run(p,{id:'review-a'},async()=>{if(scenario==='save-failure')throw Error('save failed');listener(response(200));});
 if(scenario==='success')await action();else await assert.rejects(action,/failed/);
 assert.equal(node.noValidate,false);assert.equal(off,true);await new Promise(resolve=>setImmediate(resolve));
});
