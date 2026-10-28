'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const helpers='src/components/projects/project-dialog.tsx';
function nodes(tree,predicate=()=>true,out=[]){if(!tree||typeof tree!=='object')return out;if(predicate(tree))out.push(tree);for(const child of[tree.props?.children].flat(Infinity))nodes(child,predicate,out);return out;}
function fixture(){
 const originals={document:global.document,HTMLElement:global.HTMLElement,Node:global.Node,getComputedStyle:global.getComputedStyle};
 const listeners=new Map();
 const doc={activeElement:null,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},removeEventListener(name,fn){listeners.get(name)?.delete(fn)}};
 class Element{
  constructor(tag='div',attrs={}){this.tag=tag;this.attrs={...attrs};this.children=[];this.parent=null;this.isConnected=true;this.disabled=false;this.hidden=false;this.inert=false;this.visibility='visible';this.rects=1;this.focusCalls=0;this.focusOptions=[];}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}return this;}
  get tabIndex(){if('tabindex'in this.attrs)return Number(this.attrs.tabindex);return['button','input','select','textarea'].includes(this.tag)||this.tag==='a'&&'href'in this.attrs?0:-1;}
  set tabIndex(v){this.attrs.tabindex=String(v)}
  getAttribute(name){return name in this.attrs?String(this.attrs[name]):null}hasAttribute(name){return name in this.attrs}setAttribute(name,value){this.attrs[name]=String(value)}removeAttribute(name){delete this.attrs[name]}
  getClientRects(){return this.rects?[{}]:[]}
  closest(selector){if(selector==='[hidden], [inert]'&&(this.hidden||this.inert||this.hasAttribute('hidden')||this.hasAttribute('inert')))return this;return this.parent?.closest(selector)||null}
  matches(selector){assert.equal(selector,':disabled, [aria-disabled="true"]');if(this.disabled||this.attrs['aria-disabled']==='true')return true;for(let p=this.parent;p;p=p.parent)if(p.tag==='fieldset'&&p.disabled)return true;return false}
  all(){return this.children.flatMap(child=>[child,...child.all()])}
  querySelectorAll(selector){assert.equal(selector,'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]');return this.all().filter(e=>e.tag==='button'||e.tag==='a'&&e.hasAttribute('href')||e.tag==='input'&&e.attrs.type!=='hidden'||['select','textarea'].includes(e.tag)||e.hasAttribute('tabindex'))}
  querySelector(selector){return this.all().find(e=>selector==='[role="dialog"]'?e.attrs.role==='dialog':selector==='[data-project-dialog-initial]'?e.hasAttribute('data-project-dialog-initial'):selector==='[aria-expanded="true"][aria-haspopup="listbox"]'?e.attrs['aria-expanded']==='true'&&e.attrs['aria-haspopup']==='listbox':false)||null}
  contains(element){return element===this||this.all().includes(element)}
  focus(options){if(!this.isConnected||this.matches(':disabled, [aria-disabled="true"]'))return;this.focusCalls++;this.focusOptions.push(options);doc.activeElement=this;for(const fn of listeners.get('focusin')||[])fn({target:this});}
 }
 global.document=doc;global.HTMLElement=Element;global.Node=Element;global.getComputedStyle=e=>({visibility:e.visibility});
 const opener=new Element('button');doc.activeElement=opener;
 function host(){
  const slots=[],pendingLayouts=new Map(),pendingPassive=new Map();let cursor=0;
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  function effect(queue,fn,deps){const index=cursor++,old=slots[index];if(!old||!equal(old.deps,deps)){slots[index]={...old,deps};queue.set(index,fn)}}
  const hooks={useRef(initial){const i=cursor++;return(slots[i]??={current:initial})},useLayoutEffect(fn,deps){effect(pendingLayouts,fn,deps)},useEffect(fn,deps){effect(pendingPassive,fn,deps)}};
  const modules=new Map();function load(relative){const filename=path.join(root,relative);if(modules.has(filename))return modules.get(filename).exports;const mod=new Module(filename,module);mod.paths=module.paths;modules.set(filename,mod);mod.require=id=>id==='react'?hooks:id==='react/jsx-runtime'?{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})}:id==='lucide-react'?new Proxy({},{get:(_,name)=>name}):require(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);return mod.exports;}
  function commit(queue){const batch=[...queue];queue.clear();for(const[i,fn]of batch){slots[i].cleanup?.();slots[i].cleanup=fn();}}
  return{load,render(fn,props,element){cursor=0;const tree=fn(props);if(element&&tree?.props?.ref)tree.props.ref.current=element;return tree},layout(){commit(pendingLayouts)},passive(){commit(pendingPassive)},unmount(){pendingLayouts.clear();pendingPassive.clear();for(const slot of slots)slot?.cleanup?.();}};
 }
 function setup({existing=false,restoreFocus=true,preferred=false,busy=false,onClose=()=>{},fallback=null}={}){
  const h=host(),api=h.load(helpers),dialog=new Element('div',{role:'dialog',tabindex:'-1'}),first=new Element('button'),input=new Element('input',preferred?{'data-project-dialog-initial':''}:{}),last=new Element('button');dialog.append(first,input,last);const container=existing?new Element().append(dialog):dialog;
  let props={busy,onClose,restoreFocus,returnFocusRef:fallback?{current:fallback}:undefined,label:'Synthetic project dialog',className:'bounded',children:null};const component=existing?api.ProjectDialogFocus:api.ProjectDialog;
  let tree=h.render(component,props,container);return{h,api,dialog,container,first,input,last,get tree(){return tree},get returnFocusRef(){return props.returnFocusRef},mount(){h.layout()},render(patch={}){props={...props,...patch};tree=h.render(component,props,container);h.layout();return tree},unmount(){h.unmount()}};
 }
 return{doc,Element,opener,host,setup,listeners,cleanup(){Object.assign(global,originals)}};
}
const event=(key,extra={})=>({key,shiftKey:false,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},...extra});
function withFixture(fn){return()=>{const f=fixture();try{return fn(f)}finally{f.cleanup()}}}

test('Projects panel has one labelled modal role and bubble-only keyboard handler',withFixture(f=>{const x=f.setup();assert.equal(x.tree.props.role,'dialog');assert.equal(x.tree.props['aria-modal'],'true');assert.equal(x.tree.props['aria-label'],'Synthetic project dialog');assert.equal(x.tree.props.tabIndex,-1);assert.equal(typeof x.tree.props.onKeyDown,'function');assert.equal(x.tree.props.onKeyDownCapture,undefined);x.mount();x.unmount()}));
test('Opening focuses the actual preferred Note field and returns to its connected opener',withFixture(f=>{const x=f.setup({preferred:true});assert.equal(f.doc.activeElement,f.opener);x.mount();assert.equal(f.doc.activeElement,x.input);x.unmount();assert.equal(f.doc.activeElement,f.opener)}));
test('Opening without preferred field focuses first available inner control',withFixture(f=>{const x=f.setup();x.mount();assert.equal(f.doc.activeElement,x.first);x.unmount()}));
test('Focusable list excludes disabled, fieldset-disabled, aria-disabled, hidden, inert, invisible, negative-tabindex and hidden input',withFixture(f=>{const x=f.setup();x.first.disabled=true;x.input.attrs['aria-disabled']='true';const hidden=new f.Element().append(new f.Element('button'));hidden.hidden=true;const inert=new f.Element().append(new f.Element('button'));inert.inert=true;const fieldset=new f.Element('fieldset').append(new f.Element('input'));fieldset.disabled=true;const invisible=new f.Element('button');invisible.visibility='hidden';const rectless=new f.Element('button');rectless.rects=0;x.dialog.append(hidden,inert,fieldset,invisible,rectless,new f.Element('input',{type:'hidden'}),new f.Element('button',{tabindex:'-1'}));assert.deepEqual(x.api.projectDialogFocusable(x.dialog),[x.last]);}));
test('Pending all-disabled actions focus the panel fallback and keep Tab inside',withFixture(f=>{const x=f.setup();x.mount();for(const c of[x.first,x.input,x.last])c.disabled=true;x.render({busy:true});assert.equal(f.doc.activeElement,x.dialog);const e=event('Tab');x.api.projectDialogKeyDown(e,x.dialog,true,()=>assert.fail('busy close'));assert.equal(e.defaultPrevented,true);assert.equal(f.doc.activeElement,x.dialog);x.unmount()}));
test('Pending repairs a now-disabled input to an enabled inner review target',withFixture(f=>{const x=f.setup({preferred:true});x.mount();x.input.disabled=true;x.first.disabled=true;x.render({busy:true});assert.equal(f.doc.activeElement,x.last);x.unmount()}));
test('Normal renders never steal focus from an enabled selected input',withFixture(f=>{const x=f.setup();x.mount();x.input.focus();const count=x.input.focusCalls;x.render();x.render({busy:true});assert.equal(f.doc.activeElement,x.input);assert.equal(x.input.focusCalls,count);x.unmount()}));
test('Focus entering outside while mounted is contained and listener removed on cleanup',withFixture(f=>{const x=f.setup();x.mount();const outside=new f.Element('button');outside.focus();assert.equal(f.doc.activeElement,x.first);x.unmount();outside.focus();assert.equal(f.doc.activeElement,outside);assert.equal(f.listeners.get('focusin').size,0)}));
for(const shift of[false,true])test(`Tab boundary wraps ${shift?'backward':'forward'} inside actual dialog`,withFixture(f=>{const x=f.setup();x.mount();(shift?x.first:x.last).focus();const e=event('Tab',{shiftKey:shift});x.api.projectDialogKeyDown(e,x.dialog,false,()=>{});assert.equal(e.defaultPrevented,true);assert.equal(f.doc.activeElement,shift?x.last:x.first);assert.equal((shift?x.last:x.first).focusOptions.at(-1),undefined,'Keyboard wrapping must permit browser scrolling to the off-screen action');x.unmount()}));
test('Tab from fallback panel enters first or last inner control',withFixture(f=>{const x=f.setup();x.mount();for(const shift of[false,true]){x.dialog.focus();const e=event('Tab',{shiftKey:shift});x.api.projectDialogKeyDown(e,x.dialog,false,()=>{});assert.equal(f.doc.activeElement,shift?x.last:x.first)}x.unmount()}));
test('A prevented inner key is never handled by the outer dialog',withFixture(f=>{const x=f.setup();let closed=0;for(const key of['Tab','Escape']){const e=event(key,{defaultPrevented:true});x.api.projectDialogKeyDown(e,x.dialog,false,()=>closed++);}assert.equal(closed,0)}));
test('Expanded inner listbox owns the first Escape, then dialog owns later Escape',withFixture(f=>{const x=f.setup();let closed=0;x.input.attrs['aria-expanded']='true';x.input.attrs['aria-haspopup']='listbox';const first=event('Escape');x.api.projectDialogKeyDown(first,x.dialog,false,()=>closed++);assert.equal(first.defaultPrevented,false);assert.equal(closed,0);x.input.attrs['aria-expanded']='false';const second=event('Escape');x.api.projectDialogKeyDown(second,x.dialog,false,()=>closed++);assert.equal(second.defaultPrevented,true);assert.equal(closed,1)}));
test('Busy Escape blocks close; idle Escape delegates to existing dirty-confirmation callback',withFixture(f=>{let asked=0;const x=f.setup({onClose:()=>asked++});x.mount();x.api.projectDialogKeyDown(event('Escape'),x.dialog,true,()=>asked++);assert.equal(asked,0);x.api.projectDialogKeyDown(event('Escape'),x.dialog,false,()=>asked++);assert.equal(asked,1);assert.equal(f.doc.activeElement,x.first,'callback denial does not unmount or move focus');x.unmount()}));
test('Unrelated keyboard commands are not consumed',withFixture(f=>{const x=f.setup();for(const key of['Enter','ArrowDown','a']){const e=event(key);x.api.projectDialogKeyDown(e,x.dialog,false,()=>assert.fail('unexpected close'));assert.equal(e.defaultPrevented,false)}}));
for(const unusable of['disabled','disconnected'])test(`Local close uses owned section fallback when opener is ${unusable}`,withFixture(f=>{const fallback=new f.Element('section',{tabindex:'-1'});const x=f.setup({fallback});x.mount();if(unusable==='disabled')f.opener.disabled=true;else f.opener.isConnected=false;x.unmount();assert.equal(f.doc.activeElement,fallback)}));
test('Cleanup never follows a replaced fallback ref into a later owner',withFixture(f=>{const original=new f.Element('section',{tabindex:'-1'}),later=new f.Element('section',{tabindex:'-1'});const x=f.setup({fallback:original});x.mount();f.opener.disabled=true;x.returnFocusRef.current=later;x.unmount();assert.equal(f.doc.activeElement,original);assert.equal(later.focusCalls,0)}));
test('Native sharing exit deliberately does not claim same-document opener restoration',withFixture(f=>{const x=f.setup({restoreFocus:false});x.mount();const calls=f.opener.focusCalls;x.unmount();assert.equal(f.opener.focusCalls,calls)}));
test('A delayed ready-panel mount focuses when actual DOM exists, not during access loading',withFixture(f=>{const previous=f.doc.activeElement;assert.equal(previous,f.opener);const x=f.setup();assert.equal(f.doc.activeElement,previous);x.mount();assert.equal(f.doc.activeElement,x.first);x.unmount()}));
test('StrictMode cleanup/setup retains one focus listener and valid restoration',withFixture(f=>{let x=f.setup();x.mount();x.unmount();x=f.setup();x.mount();assert.equal(f.listeners.get('focusin').size,1);x.unmount();assert.equal(f.doc.activeElement,f.opener);assert.equal(f.listeners.get('focusin').size,0)}));
test('Financial focus controller adds no second dialog role around actual shared component',withFixture(f=>{const h=f.host(),shared=h.load('src/components/financial-confirmation-dialog.tsx');const financial=h.render(shared.FinancialConfirmationDialog,{open:true,title:'Synthetic review',description:'No real operation',details:[],confirmLabel:'Review only',onCancel(){},onConfirm(){}});const x=f.setup({existing:true});const wrapper=x.render({children:financial});assert.equal(wrapper.props.role,undefined);assert.equal(nodes(wrapper,n=>n.props?.role==='dialog').length,1);assert.equal(wrapper.props.onKeyDownCapture,undefined);x.unmount()}));
test('Shared queued review-region focus and pending fallback remain compatible',async()=>{const f=fixture();let x;try{const h=f.host(),shared=h.load('src/components/financial-confirmation-dialog.tsx');x=f.setup({existing:true});const region=new f.Element('div',{tabindex:'0'});x.dialog.children=[];x.dialog.append(region,x.first,x.last);x.mount();assert.equal(f.doc.activeElement,region);x.first.disabled=true;x.last.disabled=true;const sharedTree=h.render(shared.FinancialConfirmationDialog,{open:true,loading:true,title:'Synthetic review',description:'No real operation',details:[],confirmLabel:'Review only',onCancel(){},onConfirm(){}});nodes(sharedTree,n=>n.props?.['data-financial-confirmation-content']!==undefined)[0].props.ref.current=region;x.render({busy:true});h.passive();await Promise.resolve();assert.equal(f.doc.activeElement,region);const count=region.focusCalls;x.render({busy:true});assert.equal(region.focusCalls,count,'no repeated focus steal on unchanged busy render');h.unmount();x.unmount();}finally{f.cleanup()}});

// Exact R2 preimages are evidence inputs, not permissive hashes for changing business handlers.
const preimages=process.env.PROJECT_DIALOG_R2_PREIMAGES?path.resolve(process.env.PROJECT_DIALOG_R2_PREIMAGES):path.join(root,'evidence/project-child-safety/dialog-accessibility-r5/preimages');
const pins={
 'src/components/project-notes-section.tsx':'3e9fd3387534d0276b9bf1897b48806c71d7d96f831494eddfe256275741478c',
 'src/components/project-client-milestone-sharing.tsx':'ae9caa0b4254a65246133f42aa7a239cd0c9d8f110d8c249d7ddaa380aaba590',
 'src/components/project-review-tips.tsx':'7baaca695d7f51da973f45731ccd823697a3a924836b32c4d7c582d5dd70b3ab',
};
function declaration(source,name){const ast=ts.createSourceFile('source.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;const visit=n=>{if((ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.getText(ast)===name){assert.equal(found,undefined,'Unique '+name);found=n;}ts.forEachChild(n,visit)};visit(ast);assert.ok(found,name);return ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,found,ast)}
for(const[file,names]of[
 ['src/components/project-notes-section.tsx',['closeNote','load','openCreate','openEdit','save','remove','discardLocalAttempt','copy']],
 ['src/components/project-client-milestone-sharing.tsx',['loadWorkspace','openSharing','closeSharing','acceptCurrentVisibility','toggleVisibility','projectIdFromPath']],
 ['src/components/project-review-tips.tsx',['changeTip','changeReview','cancelReview','loadFeedback','startReviewEdit','saveReview','discardLocalReview','reviewTip','postTip']],
])for(const name of names)test(`R2 ${path.basename(file)} ${name} business handler remains exact`,()=>{const prior=fs.readFileSync(path.join(preimages,file+'.txt'),'utf8');assert.equal(sha(prior),pins[file],'Correct immutable R2 input');assert.equal(declaration(fs.readFileSync(path.join(root,file),'utf8'),name),declaration(prior,name));});
for(const[file,pin]of[
 ['src/components/financial-confirmation-dialog.tsx','e1975c9281905775de9520e34955a06b876e8c63c8b496b40fc8e8bc2dad9cd0'],
 ['src/components/searchable-select.tsx','4e5b0e7e5caacbc687d250e84eceb1855df1ebdb8c54f43b106458138f836434'],
 ['src/lib/project-navigation.ts','366492c98990a017b410e3466eff5aa666df9f933c065d07b660c34d1d4a52fc'],
])test(`${file} shared/global/native-query source remains byte-identical`,()=>assert.equal(sha(fs.readFileSync(path.join(root,file))),pin));
test('Notes scroll body and nonshrinking wrapped footer are constrained within viewport',()=>{const s=fs.readFileSync(path.join(root,'src/components/project-notes-section.tsx'),'utf8');assert.match(s,/max-h-\[calc\(100dvh-2rem\)\]/);assert.match(s,/min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain/);assert.match(s,/flex shrink-0 flex-wrap justify-end/);assert.match(s,/returnFocusRef=\{dialogReturnRef\}/);assert.match(s,/Title<input data-project-dialog-initial/);});
test('Sharing mounts dialog after access early return and does not change native close semantics',()=>{const s=fs.readFileSync(path.join(root,'src/components/project-client-milestone-sharing.tsx'),'utf8');assert.ok(s.indexOf('if (loadingProject || !project) return')<s.indexOf('<ProjectDialog label='));assert.match(s,/restoreFocus=\{false\}/);const body=layoutNodes(s).find(n=>n.tag==='div'&&n.classes.includes('overscroll-contain'));assert.ok(body);for(const token of['min-h-0','flex-1','overflow-y-auto','overscroll-contain'])assert.ok(body.classes.includes(token),token);assert.match(s,/max-h-\[calc\(100dvh-2rem\)\]/)});
test('Tip controller mounts only with actual open confirmation and delegates existing token cancellation',()=>{const s=fs.readFileSync(path.join(root,'src/components/project-review-tips.tsx'),'utf8');assert.match(s,/\{tipConfirmOpen \? <ProjectDialogFocus busy=\{tipSaving\} onClose=\{\(\) => tipOperation\.cancel\(tipOperation\.token\)\}/);assert.match(s,/returnFocusRef=\{dialogReturnRef\}/);assert.equal((s.match(/<FinancialConfirmationDialog/g)||[]).length,1);});


// R6 is a presentation-only layer over exact R5 bytes. ClassName removal is
// permitted only with a separate unchanged dynamic-expression contract.
const r6Preimages=process.env.PROJECT_LAYOUT_R5_PREIMAGES?path.resolve(process.env.PROJECT_LAYOUT_R5_PREIMAGES):path.join(root,'evidence/project-child-safety/layout-correction-r6/preimages');
const r6Pins={
 'src/components/project-review-tips.tsx':'826fd19a6c012fb4a744ee5a4e85a4e85c6d738dfd1c26e35ea80808e973b53a',
 'src/components/project-client-milestone-sharing.tsx':'016aa677e6594de62d83ddf83574e50f6b8527e492d16812d5b73650c889c628',
};
const r6Source=file=>fs.readFileSync(path.join(root,file),'utf8');
function r6Prior(file){const source=fs.readFileSync(path.join(r6Preimages,file+'.txt'),'utf8');assert.equal(sha(source),r6Pins[file],'Exact immutable R5 preimage');return source;}
function layoutAst(source){const ast=ts.createSourceFile('source.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.equal(ast.parseDiagnostics.length,0);return ast;}
function withoutJsxClasses(source){
 const ast=layoutAst(source),transformed=ts.transform(ast,[context=>{
  const visit=node=>ts.isJsxAttribute(node)&&node.name.getText(ast)==='className'?undefined:ts.visitEachChild(node,visit,context);
  return node=>ts.visitNode(node,visit);
 }]);
 try{return ts.createPrinter({removeComments:false}).printFile(transformed.transformed[0]);}finally{transformed.dispose();}
}
function dynamicClassContracts(source){
 const ast=layoutAst(source),print=ts.createPrinter({removeComments:false}),expressions=[];let classCount=0;
 const visit=node=>{if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='className'){
  const index=classCount++,initializer=node.initializer;
  if(initializer&&ts.isJsxExpression(initializer)&&initializer.expression){
   const expression=initializer.expression;
   if(ts.isTemplateExpression(expression))expressions.push({index,kind:'template',interpolations:expression.templateSpans.map(span=>print.printNode(ts.EmitHint.Expression,span.expression,ast))});
   else if(!ts.isStringLiteral(expression)&&!ts.isNoSubstitutionTemplateLiteral(expression))expressions.push({index,kind:'expression',expression:print.printNode(ts.EmitHint.Expression,expression,ast)});
  }
 }ts.forEachChild(node,visit);};visit(ast);return{classCount,expressions};
}
function assertR5ClassOnly(file,current=r6Source(file)){
 if(file==='src/components/project-review-tips.tsx')current=verifiedR7Projection(current);
 const before=r6Prior(file);
 assert.equal(withoutJsxClasses(current),withoutJsxClasses(before),'Whole source excluding only JSX className attrs');
 assert.deepEqual(dynamicClassContracts(current),dynamicClassContracts(before),'Every nonliteral class expression and template interpolation remains exact');
}
function layoutNodes(source){
 const ast=layoutAst(source),found=[];
 const visit=node=>{if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
  const attr=name=>node.attributes.properties.find(x=>ts.isJsxAttribute(x)&&x.name.getText(ast)===name);
  const initializer=attr('className')?.initializer;let value='';
  if(initializer&&ts.isStringLiteral(initializer))value=initializer.text;
  else if(initializer&&ts.isJsxExpression(initializer)&&initializer.expression){const x=initializer.expression;if(ts.isTemplateExpression(x))value=x.head.text;else if(ts.isStringLiteral(x)||ts.isNoSubstitutionTemplateLiteral(x))value=x.text;}
  found.push({tag:node.tagName.getText(ast),classes:value.trim().split(/\s+/).filter(Boolean),attribute:name=>attr(name)?.initializer?.getText(ast)||null,source:node.parent.getText(ast)});
 }ts.forEachChild(node,visit);};visit(ast);return found;
}
const classTokens=(node,tokens)=>{assert.ok(node,'Expected real JSX node');for(const token of tokens)assert.ok(node.classes.includes(token),'Required class '+token);};
for(const file of Object.keys(r6Pins))test('R6 exact intermediate class-only preservation (declared R7 layer reversed first): '+file,()=>assertR5ClassOnly(file));
for(const[file,from,to,label]of[
 ['src/components/project-review-tips.tsx','onSubmit={saveReview}','onSubmit={postTip}','handler prop'],
 ['src/components/project-review-tips.tsx','gross_amount: grossAmount','gross_amount: grossAmount + 1','money body expression'],
 ['src/components/project-review-tips.tsx','Review income & fee','Send money now','visible copy'],
 ['src/components/project-review-tips.tsx','maxLength={180}','maxLength={181}','nonclass validation prop'],
 ['src/components/project-review-tips.tsx','reviewForm.rating >= rating','reviewForm.rating > rating','rating highlight condition'],
 ['src/components/project-client-milestone-sharing.tsx','milestone.client_visible ? "border-emerald','!milestone.client_visible ? "border-emerald','sharing status class condition'],
])test('R6 preservation rejects changed '+label,()=>{const current=r6Source(file);assert.ok(current.includes(from),'Nonvacuous mutation target');assertR5ClassOnly(file,current);assert.throws(()=>assertR5ClassOnly(file,current.replace(from,to)));});
test('R6 dynamic class proof detects interpolation changes even when class stripping would hide them',()=>{const file='src/components/project-review-tips.tsx',current=r6Source(file),changed=current.replace('reviewForm.rating >= rating ?','reviewForm.rating > rating ?');assert.notEqual(changed,current);assert.equal(withoutJsxClasses(changed),withoutJsxClasses(current));assert.notDeepEqual(dynamicClassContracts(changed),dynamicClassContracts(current));});
test('R6 Review/Tips outer container is shrinkable and wraps unbroken content',()=>{const n=layoutNodes(r6Source('src/components/project-review-tips.tsx')).find(n=>n.attribute('ref')==='{dialogReturnRef}');classTokens(n,['min-w-0','[overflow-wrap:anywhere]']);});
test('R6 all three responsive form/summary grids use explicit zero-minimum single-column tracks',()=>{const nodes=layoutNodes(r6Source('src/components/project-review-tips.tsx')),grids=nodes.filter(n=>n.classes.includes('grid'));assert.equal(grids.length,3,'Actual existing review,tip,summary grids');for(const n of grids)classTokens(n,['grid-cols-1']);assert.ok(grids.some(n=>n.classes.includes('sm:grid-cols-2')));assert.ok(grids.some(n=>n.classes.includes('md:grid-cols-2')&&n.classes.includes('xl:grid-cols-3')));assert.ok(grids.some(n=>n.classes.includes('sm:grid-cols-3')));});
test('R6 review and tip labels cannot impose an automatic min-content column width',()=>{const labels=layoutNodes(r6Source('src/components/project-review-tips.tsx')).filter(n=>n.tag==='label');assert.ok(labels.length>=10);for(const n of labels)classTokens(n,['min-w-0']);});
test('R6 date,amount,reference and select controls retain44px height and zero minimum width',()=>{const controls=layoutNodes(r6Source('src/components/project-review-tips.tsx')).filter(n=>['input','select'].includes(n.tag));assert.ok(controls.length>=8);for(const n of controls)classTokens(n,['h-11','w-full','min-w-0']);});
test('R6 rating row wraps; each star is44px and cannot shrink',()=>{const nodes=layoutNodes(r6Source('src/components/project-review-tips.tsx')),star=nodes.find(n=>n.tag==='button'&&n.attribute('aria-label')?.includes('star rating'));classTokens(star,['size-11','shrink-0']);const row=nodes.find(n=>n.tag==='div'&&n.classes.includes('gap-0.5')&&n.source.includes('star rating'));classTokens(row,['flex','flex-wrap']);});
test('R6 Clear,Cancel and both financial/review submit controls have44px minimum height',()=>{const nodes=layoutNodes(r6Source('src/components/project-review-tips.tsx'));const clear=nodes.find(n=>n.tag==='button'&&n.source.includes('>Clear</button>'));classTokens(clear,['min-h-11']);const cancel=nodes.find(n=>n.tag==='button'&&n.attribute('onClick')==='{cancelReview}');classTokens(cancel,['min-h-11']);const submits=nodes.filter(n=>n.tag==='button'&&n.attribute('type')==='"submit"');assert.equal(submits.length,2);for(const n of submits)classTokens(n,['min-h-11','max-w-full','whitespace-normal','text-center']);});
test('R6 review footer permits wrapping without changing Cancel or Save semantics',()=>{const footer=layoutNodes(r6Source('src/components/project-review-tips.tsx')).find(n=>n.tag==='div'&&n.classes.includes('border-t')&&n.source.includes('onClick={cancelReview}'));classTokens(footer,['flex','flex-wrap','justify-end']);});
test('R6 sharing scroll body and cards shrink and allow unbroken title wrapping',()=>{const nodes=layoutNodes(r6Source('src/components/project-client-milestone-sharing.tsx')),body=nodes.find(n=>n.tag==='div'&&n.classes.includes('overscroll-contain'));classTokens(body,['min-w-0','min-h-0','overflow-y-auto','overscroll-contain','[overflow-wrap:anywhere]']);for(const article of nodes.filter(n=>n.tag==='article'))classTokens(article,['min-w-0']);});
test('R6 full milestone title remains original text with no clipping class',()=>{const title=layoutNodes(r6Source('src/components/project-client-milestone-sharing.tsx')).find(n=>n.tag==='p'&&n.source.includes('{milestone.title}'));classTokens(title,['min-w-0','max-w-full','break-words','[overflow-wrap:anywhere]']);for(const token of['truncate','whitespace-nowrap','overflow-hidden'])assert.equal(title.classes.includes(token),false);assert.ok(!title.classes.some(x=>x.startsWith('line-clamp-')));});

// Execute the actual ProjectReviewTips + income-operation hooks. The DOM fixture
// supplies commit-time refs/focus only; it does not implement the correction.
const {harness:childHarness,response:childResponse,deferred:childDeferred,text:childText}=require('./project-child-safety-harness.cjs');
async function actualTipFocus(){
 const f=fixture(),props={projectId:'project-synthetic',projectNumber:'SYN-1',projectCurrency:'USD',projectStatus:'completed'};
 const h=childHarness('src/components/project-review-tips.tsx','ProjectReviewTips',props);
 const feedback={project_status:'completed',project_currency:'USD',review:null,tips:[],tip_totals:[],can_manage_review:true,can_record_tip:true,can_view_tips:true};
 let post=()=>{throw Error('Unexpected synthetic POST')};
 h.respond((url,init)=>{
  if(init?.method==='POST')return post(url,init);
  if(url.endsWith('/feedback'))return childResponse(feedback);
  if(url==='/api/finance/meta')return childResponse({accounts:[{id:'account-synthetic',name:'Synthetic bank',account_type:'bank',currency:'USD',current_balance:'100',is_active:true}]});
  if(url==='/api/finance/expense-meta')return childResponse({categories:[],vendors:[]});
  if(url==='/api/accounting/chart-of-accounts')return childResponse([{id:'income-synthetic',code:'4000',name:'Synthetic income',category:'income',is_active:true}]);
  throw Error('Unexpected synthetic read '+url);
 });
 const trigger=new f.Element('button'),fallback=new f.Element('div',{tabindex:'-1'});
 function bind(){const button=nodes(h.tree(),n=>n.type==='button'&&childText(n).includes('Review income & fee'))[0];assert.ok(button,'Actual review trigger is mounted');h.controller().dialogReturnRef.current=fallback;if(button.props.ref)button.props.ref.current=trigger;const fieldset=nodes(h.tree(),n=>n.type==='fieldset'&&nodes(n,x=>x===button).length)[0];trigger.disabled=Boolean(button.props.disabled||fieldset?.props.disabled);return button;}
 function commit({fallbackFocus=false,passive=true}={}){h.render();bind();if(fallbackFocus)fallback.focus();h.layout();if(passive)h.passive();}
 try{await h.flush();await new Promise(setImmediate);await h.flush();await new Promise(setImmediate);await h.flush();h.set('tipForm',{...h.controller().tipForm,amount:'75',financial_account_id:'account-synthetic',category_ledger_account_id:'income-synthetic'});commit();await h.flush();bind();}catch(error){h.cleanup();f.cleanup();throw error;}
 return{f,h,trigger,fallback,props,bind,commit,setPost(fn){post=fn},posts:()=>h.calls.filter(x=>x.init?.method==='POST'),open(){trigger.focus();h.controller().reviewTip({preventDefault(){}});commit();assert.equal(h.controller().tipOperation.phase,'review');assert.equal(trigger.disabled,true);},cancel(kind='button',{passive=true}={}){const node=nodes(h.tree(),n=>n.type===(kind==='escape'?'ProjectDialogFocus':'FinancialConfirmationDialog'))[0];assert.ok(node);node.props[kind==='escape'?'onClose':'onCancel']();commit({fallbackFocus:true,passive});},cleanup(){h.cleanup();f.cleanup()}};
}
for(const kind of['button','escape'])test('R7 actual pre-POST '+kind+' Cancel restores the re-enabled review trigger and retains75',async()=>{const x=await actualTipFocus();try{x.open();x.cancel(kind);assert.equal(x.h.controller().tipOperation.phase,'idle');assert.equal(x.h.controller().tipForm.amount,'75');assert.equal(x.posts().length,0);assert.equal(x.trigger.disabled,false);assert.equal(x.f.doc.activeElement,x.trigger);}finally{x.cleanup()}});


const r7ReviewFile='src/components/project-review-tips.tsx';
const r7Preimage=process.env.PROJECT_FOCUS_R6_PREIMAGE?path.resolve(process.env.PROJECT_FOCUS_R6_PREIMAGE):path.join(root,'evidence/project-child-safety/focus-correction-r7/preimages',r7ReviewFile+'.txt');
const r7PreviousSha='0b86c350d1000eaecea38d03b913c3bd0c08eaee3e53497cf95482acd62c6996';
const r7DeclaredRefs=[
 'const tipReviewButtonRef = useRef<HTMLButtonElement>(null);',
 'const previousTipConfirmRef = useRef({ open: false, owner: isCurrent });',
];
const r7DeclaredEffect=`useEffect(() => {
    const previous = previousTipConfirmRef.current;
    previousTipConfirmRef.current = { open: tipConfirmOpen, owner: isCurrent };
    if (!previous.open || previous.owner !== isCurrent || tipConfirmOpen || tipOperation.phase !== "idle" || !isCurrent()) return;
    const fallback = dialogReturnRef.current;
    const trigger = tipReviewButtonRef.current;
    if (!fallback?.isConnected || document.activeElement !== fallback || !trigger?.isConnected) return;
    if (trigger.matches(':disabled, [aria-disabled="true"]') || trigger.closest("[hidden], [inert]") || trigger.getClientRects().length === 0 || getComputedStyle(trigger).visibility !== "visible") return;
    trigger.focus();
  }, [tipConfirmOpen, tipOperation.phase, isCurrent]);`;
function verifiedR7Projection(source){
 const ast=layoutAst(source),printer=ts.createPrinter({removeComments:false}),print=n=>printer.printNode(ts.EmitHint.Unspecified,n,ast),component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ProjectReviewTips');assert.ok(component?.body);
 const removed=new Set();
 for(const declarationText of r7DeclaredRefs){const expected=layoutAst(declarationText),name=expected.statements[0].declarationList.declarations[0].name.text;const rows=component.body.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text===name));assert.equal(rows.length,1,'Exact single declared ref '+name);assert.equal(print(rows[0]),printer.printNode(ts.EmitHint.Unspecified,expected.statements[0],expected));removed.add(rows[0]);}
 const effects=component.body.statements.filter(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==='useEffect'&&n.getText(ast).includes('previousTipConfirmRef.current'));assert.equal(effects.length,1,'Only declared local committed focus effect');const expected=layoutAst(r7DeclaredEffect);assert.equal(print(effects[0]),printer.printNode(ts.EmitHint.Unspecified,expected.statements[0],expected));removed.add(effects[0]);
 let triggerRefs=0;const visitRef=node=>{if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='ref'&&node.initializer?.getText(ast)==='{tipReviewButtonRef}'){triggerRefs++;const opening=node.parent.parent;assert.equal(opening.tagName.getText(ast),'button');assert.ok(opening.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='type'&&a.initializer?.getText(ast)==='"submit"'));removed.add(node);}ts.forEachChild(node,visitRef);};visitRef(component);assert.equal(triggerRefs,1,'Exactly the current Review trigger is wired');
 const transformed=ts.transform(ast,[context=>{const visit=node=>removed.has(node)?undefined:ts.visitEachChild(node,visit,context);return node=>ts.visitNode(node,visit);}]);
 let projected;try{projected=printer.printFile(transformed.transformed[0]);}finally{transformed.dispose();}
 const previous=fs.readFileSync(r7Preimage,'utf8');assert.equal(sha(previous),r7PreviousSha,'Exact neutral R6 source');assert.equal(projected,printer.printFile(layoutAst(previous)),'All other R6 source, classes,handlers,props and copy remain exact');return previous;
}
test('R7 exact declared refs/effect/trigger wiring reverses to the entire immutable R6 source',()=>assert.doesNotThrow(()=>verifiedR7Projection(r6Source(r7ReviewFile))));
for(const[from,to,label]of[
 ['previous.owner !== isCurrent || ','','owner identity guard'],
 ['tipOperation.phase !== "idle" || ','','idle Cancel phase guard'],
 [' || !isCurrent()) return;',' ) return;','current lifetime guard'],
 ['document.activeElement !== fallback || ','','existing user focus guard'],
 ['trigger.getClientRects().length === 0','false','visible rect guard'],
 ['trigger.focus();','trigger.focus({ preventScroll: true });','focus action contract'],
 ['ref={tipReviewButtonRef} type="submit"','type="submit"','review trigger ref'],
])test('R7 exact layer rejects a changed '+label,()=>{const current=r6Source(r7ReviewFile);assert.ok(current.includes(from),'Nonvacuous mutation');verifiedR7Projection(current);assert.throws(()=>verifiedR7Projection(current.replace(from,to)));});

test('R7 actual initial idle mount and ordinary rerender never redirect focus',async()=>{const x=await actualTipFocus();try{x.fallback.focus();x.commit();assert.equal(x.f.doc.activeElement,x.fallback);assert.equal(x.trigger.focusCalls,0);assert.equal(x.posts().length,0);}finally{x.cleanup()}});
test('R7 actual Cancel does not steal focus moved elsewhere before passive effects',async()=>{const x=await actualTipFocus();try{x.open();x.cancel('button',{passive:false});const elsewhere=new x.f.Element('button');elsewhere.focus();x.h.passive();assert.equal(x.f.doc.activeElement,elsewhere);assert.equal(x.h.controller().tipOperation.phase,'idle');assert.equal(x.posts().length,0);}finally{x.cleanup()}});
test('R7 actual settled Cancel focuses once and later unrelated renders leave user focus alone',async()=>{const x=await actualTipFocus();try{x.open();x.cancel();assert.equal(x.f.doc.activeElement,x.trigger);const calls=x.trigger.focusCalls,elsewhere=new x.f.Element('input');elsewhere.focus();x.commit();assert.equal(x.f.doc.activeElement,elsewhere);assert.equal(x.trigger.focusCalls,calls);}finally{x.cleanup()}});
for(const kind of['disconnected','disabled','aria-disabled','hidden','inert','rectless','invisible'])test('R7 actual Cancel never focuses a '+kind+' review trigger',async()=>{const x=await actualTipFocus();try{x.open();x.cancel('button',{passive:false});if(kind==='disconnected')x.trigger.isConnected=false;else if(kind==='disabled')x.trigger.disabled=true;else if(kind==='aria-disabled')x.trigger.attrs['aria-disabled']='true';else if(kind==='hidden')x.trigger.hidden=true;else if(kind==='inert')x.trigger.inert=true;else if(kind==='rectless')x.trigger.rects=0;else x.trigger.visibility='hidden';x.h.passive();assert.equal(x.f.doc.activeElement,x.fallback);assert.equal(x.posts().length,0);}finally{x.cleanup()}});
test('R7 actual layout teardown before the queued Cancel effect forbids focus restoration',async()=>{const x=await actualTipFocus();try{x.open();x.cancel('button',{passive:false});x.h.cleanupLayout();x.h.passive();assert.equal(x.f.doc.activeElement,x.fallback);assert.equal(x.posts().length,0);}finally{x.cleanup()}});
for(const owner of['tenant','membership','project','tenant-A-B-A'])test('R7 actual '+owner+' replacement cannot consume an old Cancel focus transition',async()=>{const x=await actualTipFocus();try{x.open();x.cancel('button',{passive:false});const original=structuredClone(x.h.context.tenant);if(owner==='project')x.h.render({...x.props,projectId:'other-project'});else{x.h.context.tenant=owner==='membership'?{...original,membership_id:'other-member'}:{...original,organization:{...original.organization,id:'other-org'}};x.h.render();}x.bind();x.h.layout();if(owner==='tenant-A-B-A'){x.h.context.tenant=original;x.h.render();x.bind();x.h.layout();}x.h.passive();assert.equal(x.f.doc.activeElement,x.fallback);assert.equal(x.posts().length,0);}finally{x.cleanup()}});
for(const outcome of['rejected','unknown','acknowledged'])test('R7 actual '+outcome+' write outcome cannot masquerade as idle Cancel focus restoration',async()=>{const x=await actualTipFocus();try{x.open();x.setPost(()=>{if(outcome==='unknown')throw Error('Synthetic lost response');return childResponse(outcome==='rejected'?{detail:'Synthetic validation error'}:null,outcome==='rejected'?422:201);});await x.h.controller().postTip();x.commit({fallbackFocus:true});assert.equal(x.h.controller().tipOperation.phase,outcome);assert.equal(x.f.doc.activeElement,x.fallback);assert.equal(x.posts().length,1);assert.equal(x.h.controller().tipForm.amount,'75');}finally{x.cleanup()}});
test('R7 actual pending Cancel stays pending and never focuses disabled trigger or sends twice',async()=>{const x=await actualTipFocus(),d=childDeferred();try{x.open();x.setPost(()=>d.promise);const write=x.h.controller().postTip();x.commit();assert.equal(x.h.controller().tipOperation.phase,'pending');x.cancel();assert.equal(x.h.controller().tipOperation.phase,'pending');assert.equal(x.f.doc.activeElement,x.fallback);await Promise.resolve();assert.equal(x.posts().length,1);d.resolve(childResponse({detail:'Synthetic reject'},422));await write;x.commit({fallbackFocus:true});assert.equal(x.f.doc.activeElement,x.fallback);assert.equal(x.posts().length,1);}finally{x.cleanup()}});

test('R7 verified projection returns the exact neutral R6 bytes, avoiding a second printer-format layer',()=>assert.equal(sha(verifiedR7Projection(r6Source(r7ReviewFile))),r7PreviousSha));
