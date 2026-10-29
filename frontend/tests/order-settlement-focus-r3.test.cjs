/** Actual local confirmation effect with a deterministic DOM; no browser or requests. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function harness(busy){
 const previousGlobals={document:global.document,Node:global.Node,HTMLElement:global.HTMLElement,HTMLButtonElement:global.HTMLButtonElement};
 const events=new Map(),hostEvents=new Map(),effects=[],layouts=[];let cancel=0,confirm=0;
 class Node{}
 class Element extends Node{constructor(name){super();this.name=name;this.isConnected=true;this.disabled=false;this.focusCalls=0;}getClientRects(){return[{}];}focus(){this.focusCalls++;global.document.activeElement=this;events.get('focusin')?.({target:this});}}
 class Button extends Element{}
 const previous=new Button('previous'),outside=new Element('outside'),host=new Element('outer host'),dialog=new Element('dialog'),region=new Element('Confirmation review details'),close=new Button('close'),post=new Button('confirm');
 close.disabled=busy;post.disabled=busy;
 host.contains=target=>[host,dialog,region,close,post].includes(target);
 host.querySelectorAll=()=>[region,close,post].filter(x=>!x.disabled);
 host.addEventListener=(kind,fn)=>hostEvents.set(kind,fn);host.removeEventListener=kind=>hostEvents.delete(kind);
 global.Node=Node;global.HTMLElement=Element;global.HTMLButtonElement=Button;
 global.document={activeElement:previous,addEventListener:(kind,fn)=>events.set(kind,fn),removeEventListener:kind=>events.delete(kind)};
 let refIndex=0;const mod=new Module(path.join(root,'src/components/commercial/order-settlement-workspace.tsx'),module);mod.paths=module.paths;
 mod.require=id=>{if(id==='react')return{useRef:initial=>({current:refIndex++===0?host:initial}),useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>layouts.push(fn)};if(id==='next/navigation')return{};if(id.endsWith('.css'))return{};if(id.endsWith('order-settlement-model'))return{settlementMoney:(value,currency)=>`${currency} ${value}`};if(id.startsWith('@/'))return new Proxy({},{get:(_t,key)=>String(key)});return require(id);};
 mod._compile(ts.transpileModule(fs.readFileSync(mod.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,mod.id);
 const vm={phase:busy?'pending':'idle',review:{token:1,body:{expense_amount:'0.00',settlement_date:null,reference:null,mark_invoice_sent_to_client:false},currency:'USD',orderNumber:'Synthetic order',total:'1.00',accountName:'Synthetic bank',categoryName:null},cancelReview:()=>cancel++,confirm:()=>confirm++};
 const tree=mod.exports.OrderSettlementConfirmation({vm});layouts.forEach(fn=>fn());const cleanup=effects[0]();
 return{host,dialog,region,close,post,previous,outside,tree,events,hostEvents,cancel:()=>cancel,confirm:()=>confirm,key:(key,shiftKey=false)=>{let prevented=false;hostEvents.get('keydown')?.({key,shiftKey,preventDefault:()=>{prevented=true;}});return prevented;},cleanup:()=>{cleanup?.();Object.assign(global,previousGlobals);},effectCleanup:cleanup};
}
function check(name,busy,run){test(name,()=>{const h=harness(busy);try{run(h);}finally{h.cleanup();}});}
for(const busy of [false,true])check(`outer host focus redirects inside actual dialog, pending=${busy}`,busy,h=>{assert.equal(global.document.activeElement,h.region);h.host.focus();assert.equal(global.document.activeElement,h.region);assert.equal(h.cancel(),0);assert.equal(h.confirm(),0);});
check('pending disabled-confirm fallback stays in review region immediately, before next Tab',true,h=>{h.host.focus();assert.equal(global.document.activeElement,h.region);assert.ok(h.region.focusCalls>=2);h.key('Tab');assert.equal(global.document.activeElement,h.region);h.key('Tab',true);assert.equal(global.document.activeElement,h.region);assert.equal(h.key('Escape'),true);assert.equal(h.cancel(),0);});
check('focus outside host is still contained',false,h=>{h.outside.focus();assert.equal(global.document.activeElement,h.region);});
check('ordinary dialog controls keep their focus and idle Tab wraps',false,h=>{h.close.focus();assert.equal(global.document.activeElement,h.close);h.post.focus();assert.equal(global.document.activeElement,h.post);assert.equal(h.key('Tab'),true);assert.equal(global.document.activeElement,h.region);assert.equal(h.key('Tab',true),true);assert.equal(global.document.activeElement,h.post);});
check('idle Escape cancels review exactly once without confirming',false,h=>{assert.equal(h.key('Escape'),true);assert.equal(h.cancel(),1);assert.equal(h.confirm(),0);});
check('closing removes trap and restores the prior connected enabled trigger',false,h=>{h.effectCleanup();assert.equal(h.events.has('focusin'),false);assert.equal(h.hostEvents.has('keydown'),false);assert.equal(global.document.activeElement,h.previous);});
check('disabled prior trigger is not force-focused after closing',true,h=>{h.previous.disabled=true;h.effectCleanup();assert.notEqual(global.document.activeElement,h.previous);});
test('R3 workspace changes only the local outer-host focus predicate',()=>{const f='src/components/commercial/order-settlement-workspace.tsx',before=fs.readFileSync(path.join(root,'evidence/order-settlement-ui/correction-r3/preimages-neutral',f+'.txt'),'utf8'),after=fs.readFileSync(path.join(root,f),'utf8');assert.equal(after,before.replace('event.target instanceof Node && !host.contains(event.target)','event.target instanceof Node && (event.target === host || !host.contains(event.target))'));});
