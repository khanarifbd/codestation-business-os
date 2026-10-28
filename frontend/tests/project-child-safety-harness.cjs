'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const realComponents=new Set(['project-notes-section','project-review-tips','project-client-milestone-sharing','projects/project-income-operation','projects/project-workspace','projects/project-model','projects/project-list-model','accounting-transfers/transfer-model']);
const tenant={organization:{id:'org-synthetic',currency:'USD'},membership_id:'member-synthetic',role_id:'role-synthetic',permissions:['projects.view','projects.manage','finance.view','finance.manage']};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function nodes(tree,predicate=()=>true,out=[]){if(!tree||typeof tree!=='object')return out;if(predicate(tree))out.push(tree);for(const child of [tree.props?.children].flat(Infinity))nodes(child,predicate,out);return out;}
function text(tree){if(tree===null||tree===undefined||typeof tree==='boolean')return'';if(typeof tree!=='object')return String(tree);return[tree.props?.children].flat(Infinity).map(text).join(' ');}
function harness(file,target,props={}){
 const modules=new Map(),controllers={},slots=[],calls=[],pushes=[],assigns=[],prompts=[];
 let cursor=0,needsRender=false,tree,confirm=true,respond=()=>{throw Error('Unexpected synthetic fetch')};
 const layouts=new Map(),passives=new Map(),context={tenant:structuredClone(tenant)};
 const route={pathname:'/dashboard/projects/project-synthetic',query:'',params:{projectId:'project-synthetic'}};
 const depsEqual=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 function effect(kind,fn,deps){const i=cursor++,old=slots[i];if(!old||!depsEqual(old.deps,deps)){slots[i]={...old,deps};kind.set(i,fn);}}
 const hooks={useState(init){const i=cursor++;if(!slots[i])slots[i]={value:typeof init==='function'?init():init};return[slots[i].value,v=>{const next=typeof v==='function'?v(slots[i].value):v;if(!Object.is(next,slots[i].value)){slots[i].value=next;needsRender=true}}]},useRef(value){const i=cursor++;return(slots[i]??={current:value})},useMemo(fn,deps){const i=cursor++;if(!slots[i]||!depsEqual(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value},useCallback(fn,deps){return hooks.useMemo(()=>fn,deps)},useEffect(fn,deps){effect(passives,fn,deps)},useLayoutEffect(fn,deps){effect(layouts,fn,deps)},Suspense:'Suspense'};
 const originals={fetch:global.fetch,window:global.window,Element:global.Element,Node:global.Node,crypto:global.crypto};
 const listeners=new Map();class FakeElement{constructor(href){this.href=href}closest(){return this}getAttribute(n){return n==='href'?this.href:null}hasAttribute(){return false}}
 const win={location:{href:'https://example.invalid'+route.pathname,assign:href=>assigns.push(['assign',href]),replace:href=>assigns.push(['replace',href])},confirm:message=>{prompts.push(message);return confirm},addEventListener(t,f){if(!listeners.has(t))listeners.set(t,new Set());listeners.get(t).add(f)},removeEventListener(t,f){listeners.get(t)?.delete(f)},dispatchEvent(e){for(const f of listeners.get(e.type)||[])f(e);return!e.defaultPrevented},setTimeout};
 let uuid=0;
 global.fetch=(url,init)=>{calls.push({url,init});return Promise.resolve().then(()=>respond(url,init))};global.window=win;global.Element=FakeElement;global.Node=FakeElement;
 Object.defineProperty(global,'crypto',{value:{randomUUID:()=>`synthetic-operation-${++uuid}`},configurable:true});
 function load(filename){if(modules.has(filename))return modules.get(filename).exports;let source=fs.readFileSync(filename,'utf8');const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,filename.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);const functions=ast.statements.filter(ts.isFunctionDeclaration).filter(x=>x.name&&x.body);const edits=[];
  for(const fn of functions){
   const names=fn.body.statements.filter(ts.isFunctionDeclaration).filter(n=>n.name).map(n=>n.name.text);
   edits.push({at:fn.body.getStart(ast)+1,value:`__capture(${JSON.stringify(fn.name.text)},{${names.join(',')}},true);\n`});
   for(const statement of fn.body.statements.filter(ts.isVariableStatement)){
    const vars=statement.declarationList.declarations.flatMap(d=>ts.isIdentifier(d.name)?[d.name.text]:ts.isArrayBindingPattern(d.name)?d.name.elements.filter(ts.isBindingElement).map(e=>e.name.getText(ast)):[]);
    if(vars.length)edits.push({at:statement.end,value:`\n__capture(${JSON.stringify(fn.name.text)},{${vars.join(',')}});\n`});
   }
  }
  for(const e of edits.sort((a,b)=>b.at-a.at))source=source.slice(0,e.at)+e.value+source.slice(e.at);
  source+='\nexport const __test={'+functions.map(f=>f.name.text).join(',')+'};';
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;modules.set(filename,mod);mod.require=id=>{
   if(id==='react')return hooks;if(id==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key}),Fragment:'Fragment'};
   if(id==='next/navigation')return{useRouter:()=>({push:(...x)=>pushes.push(x),replace:(...x)=>pushes.push(x)}),usePathname:()=>route.pathname,useSearchParams:()=>new URLSearchParams(route.query),useParams:()=>route.params};
   if(id==='@/components/dashboard-session-context')return{useDashboardSession:()=>context};
   if(id==='next/link')return{default:'NextLink'};if(id==='lucide-react')return new Proxy({},{get:(_,k)=>String(k)});
   if(id.startsWith('@/components/')&&!realComponents.has(id.slice('@/components/'.length)))return new Proxy({},{get:(_,k)=>String(k)});
   if(id.endsWith('.css'))return{};
   if(id.startsWith('@/')){const base=path.join(root,'src',id.slice(2));const resolved=['.ts','.tsx'].map(x=>base+x).find(fs.existsSync);if(resolved)return load(resolved)}
   if(id.startsWith('.')){const base=path.resolve(path.dirname(filename),id);const resolved=['.ts','.tsx',''].map(x=>base+x).find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());if(resolved)return load(resolved)}
   return require(id);
  };
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  mod._compile('const __capture=global.__projectChildCapture;\n'+js,filename);return mod.exports;
 }
 const priorCapture=global.__projectChildCapture;global.__projectChildCapture=(name,values,reset=false)=>{controllers[name]=reset?values:{...controllers[name],...values}};
 const loaded=load(path.join(root,file));
 function runEffects(map){const batch=[...map];map.clear();for(const[i,fn]of batch){slots[i].cleanup?.();slots[i].cleanup=fn();}}
 const api={calls,pushes,assigns,prompts,context,route,loaded,slots,listeners,
  render(nextProps){if(nextProps!==undefined)props=nextProps;cursor=0;needsRender=false;tree=loaded.__test[target](...(Array.isArray(props)?props:[props]));return tree;},
  layout(){runEffects(layouts)},passive(){runEffects(passives)},
  controller(name=target){return controllers[name]},tree:()=>tree,pendingPassive:()=>[...passives.values()],
  async flush({passive=true}={}){for(let n=0;n<15;n++){if(needsRender)api.render();api.layout();if(passive)api.passive();await Promise.resolve();await Promise.resolve();if(!needsRender&&!layouts.size&&(!passive||!passives.size))return;}throw Error('Synthetic render did not settle')},
  respond(fn){respond=fn},confirm(v){confirm=v},
  unmountLayout(){for(const[i]of layouts)layouts.delete(i);for(const s of slots)if(s?.cleanup&&s.kind==='layout')s.cleanup();},
  cleanupLayout(){for(const s of slots)if(s?.layoutCleanup){s.layoutCleanup();s.layoutCleanup=null}},
  cleanup(){for(const s of slots)s?.cleanup?.();Object.assign(global,{fetch:originals.fetch,window:originals.window,Element:originals.Element,Node:originals.Node});Object.defineProperty(global,'crypto',{value:originals.crypto,configurable:true});global.__projectChildCapture=priorCapture;},
  set(name,value){const c=api.controller();const setter='set'+name[0].toUpperCase()+name.slice(1);assert.equal(typeof c[setter],'function',setter);c[setter](value);},
  clickAnchor(href){const event={type:'click',target:new FakeElement(href),button:0,preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){}};for(const fn of listeners.get('click')||[])fn(event);return event;},
 };
 // Track layout cleanup separately so pre-passive teardown can be exercised explicitly.
 const originalLayout=api.layout;api.layout=()=>{const indices=[...layouts.keys()];originalLayout();for(const i of indices){slots[i].kind='layout';slots[i].layoutCleanup=slots[i].cleanup}};
 api.render();api.layout();return api;
}
module.exports={harness,response,deferred,nodes,text,tenant,root};
