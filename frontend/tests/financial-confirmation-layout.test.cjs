const{test}=require('node:test'),assert=require('node:assert/strict');
const{loader,nodes,text}=require('./recurring-post-harness.cjs');
const{FinancialConfirmationDialog:Dialog}=loader({react:{useRef:()=>({current:null}),useEffect(){}},'lucide-react':{AlertTriangle:'AlertTriangle',Loader2:'Loader2',X:'X'}})('src/components/financial-confirmation-dialog.tsx');
const long='Synthetic long financial review context '.repeat(18),base={open:true,title:long,description:long,warning:long,details:Array.from({length:12},(_,i)=>({label:`Synthetic detail ${i}`,value:long,emphasis:i===0})),confirmLabel:'Attempt due occurrence with a deliberately long confirmation label',onCancel(){},onConfirm(){}};
function parts(tree){const all=nodes(tree,'div');return{panel:all.find(n=>'data-financial-confirmation-panel'in n.props),content:all.find(n=>'data-financial-confirmation-content'in n.props),actions:all.find(n=>'data-financial-confirmation-actions'in n.props)};}
test('Long shared review has viewport-capped flex panel and scrollable min-height0 content',()=>{const{panel,content}=parts(Dialog(base));assert.equal(panel.props.style.maxHeight,'calc(100dvh - 2rem)');assert.equal(panel.props.style.display,'flex');assert.equal(panel.props.style.flexDirection,'column');assert.equal(panel.props.style.overflow,'hidden');assert.equal(content.props.style.minHeight,0);assert.equal(content.props.style.overflowY,'auto');assert.equal(content.props.style.overscrollBehavior,'contain');assert.equal(content.props.style.overflowWrap,'anywhere');});
test('Shared actions are a non-shrinking sibling outside the scrollable body',()=>{const{panel,content,actions}=parts(Dialog(base));assert.ok(panel.props.children.includes(content));assert.ok(panel.props.children.includes(actions));assert.equal(nodes(content,'button').length,1);assert.equal(nodes(actions,'button').length,2);assert.equal(actions.props.style.flexShrink,0);assert.equal(actions.props.style.flexWrap,'wrap');});
test('Scrollable review remains keyboard reachable and labelled',()=>{const{content}=parts(Dialog(base));assert.equal(content.props.role,'region');assert.equal(content.props.tabIndex,0);assert.equal(content.props['aria-label'],'Confirmation review details');});
for(const loading of [false,true])test(`All shared confirmation controls retain handlers,44px targets and pending state ${loading}`,()=>{let cancel=0,confirm=0;const tree=Dialog({...base,loading,onCancel:()=>cancel++,onConfirm:()=>confirm++}),buttons=nodes(tree,'button');assert.equal(buttons.length,3);for(const b of buttons){assert.equal(b.props.disabled,loading);assert.equal(b.props.style.minHeight,44);}const close=buttons.find(b=>b.props['aria-label']==='Close confirmation');assert.equal(close.props.style.minWidth,44);if(!loading){close.props.onClick();buttons[1].props.onClick();buttons[2].props.onClick();assert.equal(cancel,2);assert.equal(confirm,1);}assert.equal(buttons[2].props.style.maxWidth,'100%');assert.equal(buttons[2].props.style.minWidth,0);assert.equal(buttons[2].props.style.overflowWrap,'anywhere');});
test('Shared confirmation retains all long review text and exact details without truncation',()=>{const tree=Dialog(base);assert.ok(text(tree).includes(long));assert.equal(nodes(tree,'span').filter(n=>n.props.children===long).length,12);assert.equal(nodes(tree,'div').find(n=>n.props.role==='dialog').props['aria-modal'],'true');});
test('Closed shared confirmation renders no controls',()=>assert.equal(Dialog({...base,open:false}),null));

// Actual dialog loading effect + existing wrapper trap. Candidate order is derived
// from the real rendered dialog; browser geometry remains a separate parent gate.
function regionFocusHarness(){
 let effectIndex=0,refIndex=0,loading=false,cancelled=0,dialogEffectIndex=0;
 const effects=[],refs=[],listeners=new Map(),elements=new Map(),dialogEffects=[];
 const original={document:global.document,HTMLElement:global.HTMLElement};
 class Element{constructor(name){this.name=name;this.isConnected=true;this.focuses=0;}focus(){doc.activeElement=this;this.focuses++;}}
 const prior=new Element('original-review-button'),body=new Element('BODY'),region=new Element('review-region');elements.set('review-region',region);
 const doc={activeElement:prior,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
 function candidates(){const result=[];function visit(node){if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;const props=node.props||{};if(props.tabIndex===0||node.type==='button'&&!props.disabled){const name=props.tabIndex===0?'review-region':props['aria-label']||text(node);if(!elements.has(name))elements.set(name,new Element(name));result.push(elements.get(name));}visit(props.children);}visit(Dialog({...base,loading}));return result;}
 const container={querySelectorAll(selector){assert.match(selector,/\[tabindex="0"\]/);return candidates();},contains:item=>candidates().includes(item)};
 global.document=doc;global.HTMLElement=Element;
 const hooks={useRef:initial=>refs[refIndex++]??={current:refIndex===1?container:initial},useEffect:(fn,deps)=>{const i=effectIndex++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();effects[i]={deps,cleanup:fn()};}}};
 const dialogHooks={useRef:()=>({current:region}),useEffect:(fn,deps)=>{const i=dialogEffectIndex++,old=dialogEffects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();dialogEffects[i]={deps,cleanup:fn()};}}};
 const EffectDialog=loader({react:dialogHooks,'lucide-react':{AlertTriangle:'AlertTriangle',Loader2:'Loader2',X:'X'}})('src/components/financial-confirmation-dialog.tsx').FinancialConfirmationDialog;
 const Wrapper=loader({react:hooks,'next/link':{default:'Link'},'lucide-react':{},'@/components/accounting-accounts/account-ui':{},'@/components/financial-confirmation-dialog':{FinancialConfirmationDialog:'Dialog'}})('src/components/accounting-money-out/money-out-ui.tsx').MoneyOutConfirmation;
 function render(extra={}){loading=extra.loading??false;refIndex=effectIndex=dialogEffectIndex=0;const props={...base,loading,onCancel:()=>cancelled++,...extra};const tree=Wrapper(props);EffectDialog(props);return tree;}
 function key(key,shiftKey=false){const event={key,shiftKey,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};listeners.get('keydown')?.(event);return event;}
 return{render,key,doc,candidates,prior,body,region,cancelled:()=>cancelled,async flush(){await Promise.resolve();await Promise.resolve();},cleanup(){effects.forEach(e=>e.cleanup?.());dialogEffects.forEach(e=>e.cleanup?.());Object.assign(global,original);}};
}
for(const mode of ['initial','wrap','outside','pending','pending-transition','restore','cancel-late-effect','initial-pending-restore'])test(`Actual shared focus trap and loading effect: ${mode}`,async()=>{
 const h=regionFocusHarness();try{
  h.render();await h.flush();const list=h.candidates();assert.equal(list.length,4);assert.deepEqual(list.map(x=>x.name),['review-region','Close confirmation','Go back',base.confirmLabel]);
  if(mode==='initial')assert.equal(h.doc.activeElement,list[0]);
  if(mode==='wrap'){h.doc.activeElement=list[0];assert.equal(h.key('Tab',true).prevented,true);assert.equal(h.doc.activeElement,list[3]);assert.equal(h.key('Tab').prevented,true);assert.equal(h.doc.activeElement,list[0]);h.doc.activeElement=list[1];assert.equal(h.key('Tab').prevented,undefined);}
  if(mode==='outside'){h.doc.activeElement=h.prior;h.key('Tab');assert.equal(h.doc.activeElement,list[0]);}
  if(mode==='pending'||mode==='pending-transition'){
   h.doc.activeElement=list[3];h.render({loading:true});h.doc.activeElement=h.body;await h.flush();assert.equal(h.candidates().length,1);assert.equal(h.doc.activeElement,h.region);assert.equal(h.key('Tab').prevented,true);assert.equal(h.key('Tab',true).prevented,true);assert.equal(h.doc.activeElement,h.region);h.key('Escape');assert.equal(h.cancelled(),0);h.render();await h.flush();h.doc.activeElement=list[3];assert.equal(h.key('Tab').prevented,true);assert.equal(h.doc.activeElement,list[0]);assert.equal(h.key('Escape').stopped,true);assert.equal(h.cancelled(),1);
  }
  if(mode==='restore'){h.render({open:false});await h.flush();assert.equal(h.doc.activeElement,h.prior);}
  if(mode==='cancel-late-effect'){h.render({loading:true});h.render({open:false,loading:true});h.doc.activeElement=h.prior;const count=h.region.focuses;await h.flush();assert.equal(h.region.focuses,count);assert.equal(h.doc.activeElement,h.prior);}
  if(mode==='initial-pending-restore'){h.render({open:false});h.doc.activeElement=h.prior;h.render({loading:true});await h.flush();assert.equal(h.doc.activeElement,h.region);h.render({open:false});await h.flush();assert.equal(h.doc.activeElement,h.prior);}
 }finally{h.cleanup();}
});
