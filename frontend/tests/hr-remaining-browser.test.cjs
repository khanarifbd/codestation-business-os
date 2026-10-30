const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../e2e/qc-owner-hr-project-extended.spec.mjs'),'utf8'),{beforeHRRemainingBrowser}=require('./helpers/reviewed-hr-remaining-browser.cjs'),tree=ts.createSourceFile('browser',source,99,true);
const helper=name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree);
test('exact reviewed remaining-HR helpers reject changed assertions and names',()=>{assert.doesNotThrow(()=>beforeHRRemainingBrowser(source));assert.throws(()=>beforeHRRemainingBrowser(source.replace('expect(requests).toBe(0)','expect(requests).toBe(1)')),/reviewed HR remaining/);assert.throws(()=>beforeHRRemainingBrowser(source.replace('function verifyDocumentWidths','function uncheckedWidths')),/exact HR remaining/);});
for(const fail of [false,true])test('actual responsive helper restores original viewport '+fail,async()=>{
 const original={width:1200,height:900},sizes=[];const p={viewportSize:()=>original,setViewportSize:async v=>sizes.push(v),evaluate:async()=>true,screenshot:async()=>{if(fail)throw Error('capture failed');}};
 const expect=value=>({toBeVisible:async()=>{},toBe:expected=>assert.equal(value,expected)}),run=vm.runInNewContext('('+helper('captureHRResponsive')+')',{expect});
 if(fail)await assert.rejects(()=>run(p,{outputPath:x=>x},'fixture',{}),/capture failed/);else await run(p,{outputPath:x=>x},'fixture',{});assert.equal(sizes.at(-1),original);
});
for(const fail of [false,true])test('actual width probe restores fixture inputs and removes request counter '+fail,async()=>{
 const fields={},events=[];let handler;
 const p={on:(type,fn)=>{events.push('on');handler=fn;},off:(type,fn)=>{assert.equal(fn,handler);events.push('off');},getByLabel:label=>({fill:async value=>{fields[label]=value;}}),getByRole:()=>({click:async()=>{if(fail)throw Error('click failed');}}),getByText:()=>({})};
 const expect=value=>({toBeVisible:async()=>{},toBe:expected=>assert.equal(value,expected)}),run=vm.runInNewContext('('+helper('verifyDocumentWidths')+')',{expect,URL});
 if(fail)await assert.rejects(()=>run(p),/click failed/);else await run(p);assert.deepEqual(events,['on','off']);assert.equal(fields['Document title'],'Synthetic expiring document');assert.equal(fields['Reference number'],'SYNTHETIC-EXPIRY');
});
for(const scenario of ['success','confirm-failure','waiter-failure','read-failure','capture-failure'])test('actual Attendance malformed boundary owns cleanup '+scenario,async()=>{
 let routeHandler,registered=false,unregistered=false;const office={id:'office-a',name:'Original'},response={status:()=>422};
 const locator={fill:async()=>{},filter(){return this;},evaluate:async()=>{},click:async()=>{}};
 const p={goto:async()=>{},getByText:()=>locator,getByLabel:()=>locator,locator:()=>locator,getByRole:(role,{name})=>({...locator,click:async()=>{if(name==='Confirm and save once'){if(scenario==='confirm-failure')throw Error('confirm failed');await routeHandler({request:()=>({method:()=> 'PATCH'}),fulfill:async()=>{},fallback:async()=>{}});}}}),route:async(pattern,h)=>{routeHandler=h;registered=true;},unroute:async(pattern,h)=>{assert.equal(h,routeHandler);unregistered=true;},waitForResponse:async()=>{if(scenario==='waiter-failure')throw Error('waiter failed');return response;}};
 const expect=value=>({toBeVisible:async()=>{},toBeDisabled:async()=>{},toHaveCount:async()=>{},toBe:expected=>assert.equal(value,expected)});
 const run=vm.runInNewContext('('+helper('verifyAttendanceSetupEvidence')+')',{expect,URL,get:async()=>{if(scenario==='read-failure')throw Error('read failed');return [office];},captureHRResponsive:async()=>{if(registered&&scenario==='capture-failure')throw Error('capture failed');}});
 if(scenario==='success')await run(p,{}, {id:'employee-a'},office);else await assert.rejects(()=>run(p,{}, {id:'employee-a'},office),/failed/);assert.equal(unregistered,true);await new Promise(resolve=>setImmediate(resolve));
});
test('malformed probes never forward or fabricate success and leave native security alone',()=>{for(const name of ['verifyAttendanceSetupEvidence','verifyRecordsSetupEvidence']){const s=helper(name);assert.ok(s.includes("status:422"));assert.ok(s.includes('"detail":[]'));assert.ok(s.includes('finally{await p.unroute(pattern,malformed);}'));assert.doesNotMatch(s,/route\.(fetch|continue)\(|status:20[0-9]|geolocation|getCurrentPosition|force:|waitForTimeout/);}assert.ok(source.includes("const doc=await submit(p,'Upload securely','/hr-documents/upload')"));});
