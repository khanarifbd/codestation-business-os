const {test}=require('node:test'),assert=require('node:assert/strict');
const {loader,harness,ready,review}=require('./recurring-post-harness.cjs');
// Execute the reused wrapper's effects against a minimal DOM double, not a browser claim.
function focusHarness(){
  let effectIndex=0,refIndex=0,buttons=[],cancelled=0;const effects=[],refs=[],listeners=new Map();
  const original={document:global.document,HTMLElement:global.HTMLElement};
  class Element{constructor(name){this.name=name;this.isConnected=true;this.focuses=0;}focus(){doc.activeElement=this;this.focuses++;}}
  const prior=new Element('review-button'),first=new Element('close-confirmation'),last=new Element('post');buttons=[first,last];
  const container={querySelectorAll:()=>buttons,contains:item=>buttons.includes(item)};
  const doc={activeElement:prior,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
  global.document=doc;global.HTMLElement=Element;
  const hooks={useRef:initial=>refs[refIndex++]??={current:refIndex===1?container:initial},useEffect:(fn,deps)=>{const i=effectIndex++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();effects[i]={deps,cleanup:fn()};}}};
  const Component=loader({react:hooks,'next/link':{default:'Link'},'lucide-react':{},'@/components/accounting-accounts/account-ui':{},'@/components/financial-confirmation-dialog':{FinancialConfirmationDialog:'FinancialConfirmationDialog'}})('src/components/accounting-money-out/money-out-ui.tsx').MoneyOutConfirmation;
  function render(extra={}){effectIndex=refIndex=0;return Component({open:true,loading:false,details:[],title:'Retry same operation',description:'Synthetic',warning:'Retained key',confirmLabel:'Retry same operation',onCancel:()=>cancelled++,onConfirm:()=>{},...extra});}
  function key(key,shiftKey=false){const e={key,shiftKey,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};listeners.get('keydown')?.(e);return e;}
  return{render,key,doc,first,last,prior,buttons:value=>buttons=value,cancelled:()=>cancelled,listeners,cleanup(){effects.forEach(e=>e.cleanup?.());Object.assign(global,original);}};
}
function check(name,fn){test('Recurring reused confirmation: '+name,()=>{const h=focusHarness();try{h.render();fn(h);}finally{h.cleanup();}});}
check('initial focus stays within confirmation',h=>assert.equal(h.doc.activeElement,h.first));
check('Tab and Shift+Tab wrap in top confirmation',h=>{h.doc.activeElement=h.last;assert.equal(h.key('Tab').prevented,true);assert.equal(h.doc.activeElement,h.first);assert.equal(h.key('Tab',true).prevented,true);assert.equal(h.doc.activeElement,h.last);});
check('outside focus returns to top confirmation and no enabled controls blocks Tab',h=>{h.doc.activeElement=h.prior;h.key('Tab');assert.equal(h.doc.activeElement,h.first);h.buttons([]);assert.equal(h.key('Tab').prevented,true);});
check('Escape calls only confirmation cancellation, busy Escape cannot cancel',h=>{assert.equal(h.key('Escape').stopped,true);assert.equal(h.cancelled(),1);h.render({loading:true});h.key('Escape');assert.equal(h.cancelled(),1);});
check('close returns focus and removes listener',h=>{h.render({open:false});assert.equal(h.doc.activeElement,h.prior);assert.equal(h.listeners.has('keydown'),false);});
test('Recurring confirmation Escape retains form and invalidates old confirmed callback',async()=>{const state=harness(),focus=focusHarness();try{ready(state);const vm=review(state);focus.render({onCancel:vm.cancelReview});focus.key('Escape');assert.equal(state.render().confirmOpen,false);assert.equal(state.render().target.id,'synthetic-schedule');assert.equal(state.render().dirty,true);await vm.post();assert.equal(state.calls.length,0);}finally{focus.cleanup();state.cleanup();}});
