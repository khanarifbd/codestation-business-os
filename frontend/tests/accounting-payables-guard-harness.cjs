// Author-run shared guard event harness; reused from the prior verified Receivables harness without registering any other test suite.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function guardHarness(dirty=true,busy=false,documentLabel){
 const filename=path.join(root,'src/hooks/use-quotation-navigation-guard.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 const refs=[],listeners=new Map(),calls=[],prompts=[];let cursor=0,effects=[],cleanups=[],answer=true,guard,throwNavigation=false,message; const pendingRef={current:false};
 const original={window:global.window,Element:global.Element,Node:global.Node};
 class FakeNode{constructor(parentElement=null){this.parentElement=parentElement;}}
 class FakeElement extends FakeNode{constructor(href,attrs={}){super();this.attrs={href,...attrs};}closest(){return this;}getAttribute(name){return this.attrs[name]??null;}hasAttribute(name){return name in this.attrs;}}
 const current='https://example.invalid/dashboard/accounting/payables/synthetic/pay';
 const key=(type,capture)=>`${type}:${Boolean(capture)}`;
 global.Node=FakeNode;global.Element=FakeElement;global.window={location:{href:current,assign:href=>{if(throwNavigation)throw Error('Synthetic blocked navigation');calls.push(['assign',href]);},replace:href=>{if(throwNavigation)throw Error('Synthetic blocked navigation');calls.push(['replace',href]);}},confirm:message=>{prompts.push(message);return answer;},addEventListener:(type,fn,capture)=>{const k=key(type,capture);if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener:(type,fn,capture)=>listeners.get(key(type,capture))?.delete(fn)};
 const utilityFilename=path.join(root,'src/lib/workspace-navigation.ts'),utility=new Module(utilityFilename,module);utility.filename=utilityFilename;utility.paths=module.paths;utility._compile(ts.transpileModule(fs.readFileSync(utilityFilename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,utilityFilename);
 global.window.dispatchEvent=event=>{for(const capture of [true,false])for(const fn of listeners.get(key(event.type,capture))||[])fn(event);return !event.defaultPrevented;};
 mod.require=id=>id==='react'?{useRef:value=>refs[cursor++]??={current:value},useCallback:fn=>fn,useEffect:fn=>effects.push(fn)}:id==='@/lib/workspace-navigation'?utility.exports:require(id);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
 const render=(nextDirty=dirty,nextBusy=busy,nextMessage=message)=>{cleanups.forEach(fn=>fn?.());cursor=0;effects=[];message=nextMessage;guard=mod.exports.useQuotationNavigationGuard(nextDirty,{isBusy:nextBusy,pendingRef,discardMessage:message,...(documentLabel?{documentLabel}:{})});cleanups=effects.map(fn=>fn());return guard;};render();
 const event=(type,attrs={})=>{const e={defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...attrs};for(const capture of [true,false])for(const fn of listeners.get(key(type,capture))||[])fn(e);return e;};
 return{pendingRef,guard:()=>guard,render,calls,prompts,current,requestExit:utility.exports.requestWorkspaceExit,exitEvent:utility.exports.WORKSPACE_EXIT_EVENT,detach:()=>{cleanups.forEach(fn=>fn?.());cleanups=[];},classify:mod.exports.quotationAnchorDestination,answer:value=>{answer=value;},throwNavigation:value=>{throwNavigation=value;},event,anchor:(href,attrs)=>new FakeElement(href,attrs),textNode:anchor=>new FakeNode(anchor),count:type=>[...(listeners.get(key(type,true))||[]),...(listeners.get(key(type,false))||[])].length,cleanup:()=>{cleanups.forEach(fn=>fn?.());Object.assign(global,original);}};
}
module.exports={guardHarness};
