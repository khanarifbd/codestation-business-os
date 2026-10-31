const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(require('node:path').join(__dirname,'../e2e/qc-owner-hr-project-extended.spec.mjs'),'utf8');
const tree=ts.createSourceFile('e2e',source,99,true);
const helper=name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree);
test('supplemental Talent and modal assertions cannot be stripped after tampering',()=>{
 const {beforeTalentBrowser}=require('./helpers/reviewed-talent-browser.cjs'),{beforeHRRemainingBrowser}=require('./helpers/reviewed-hr-remaining-browser.cjs');
 assert.doesNotThrow(()=>beforeTalentBrowser(source));assert.doesNotThrow(()=>beforeHRRemainingBrowser(source));
 assert.throws(()=>beforeTalentBrowser(source.replace('await expect(target).toBeInViewport({ratio:1});','await expect(target).toBeVisible();')),/reviewed Talent helper/);
 assert.throws(()=>beforeHRRemainingBrowser(source.replace('node.scrollTop=0','node.scrollTop=100')),/reviewed HR remaining helper/);
});
for(const fail of [false,true])test('actual upload capture resets nested scroll and restores viewport '+fail,async()=>{
 const original={width:1200,height:900},sizes=[],shots=[],node={scrollTop:350};
 const dialog={evaluate:async fn=>fn(node)},close={};
 const p={viewportSize:()=>original,setViewportSize:async size=>sizes.push(size),evaluate:async()=>true,getByRole:role=>role==='dialog'?dialog:close,screenshot:async options=>{shots.push(options.path);if(fail&&options.path.endsWith('dialog-top.png'))throw Error('capture failed');}};
 let viewportAssertions=0;const expect=value=>({toBe:expected=>assert.equal(value,expected),toBeVisible:async()=>{},toBeInViewport:async()=>{viewportAssertions++;}});
 const run=vm.runInNewContext('('+helper('captureHRResponsive')+')',{expect});
 if(fail)await assert.rejects(()=>run(p,{outputPath:x=>x},'hr-upload-unknown',{}),/capture failed/);else await run(p,{outputPath:x=>x},'hr-upload-unknown',{});
 assert.equal(node.scrollTop,0);assert.equal(sizes.at(-1),original);assert.ok(viewportAssertions>=2);assert.ok(shots.some(p=>p.endsWith('dialog-top.png')));
});
