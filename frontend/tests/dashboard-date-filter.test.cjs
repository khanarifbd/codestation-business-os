/** Deterministic actual component handlers and calendar helpers; browser range proof is in existing Dashboard journey. */
const test=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./reconciliation-harness.cjs');
const {dashboardDateShortcut:shortcut,validateDashboardDateRange:validate}=sourceLoader().load('src/lib/dashboard-date-range.ts');
const now=new Date('2024-04-01T00:30:00Z');
test('default month/today/week follow company local date, Monday boundary and DST',()=>{
 assert.deepEqual(shortcut('today','America/New_York',now),{from:'2024-03-31',to:'2024-03-31',label:'Today'});
 assert.deepEqual(shortcut('week','America/New_York',now),{from:'2024-03-25',to:'2024-03-31',label:'This week'});
 assert.deepEqual(shortcut('week','Europe/London',now),{from:'2024-04-01',to:'2024-04-01',label:'This week'});
 assert.equal(shortcut('month','America/New_York',now).from,'2024-03-01');
 assert.equal(shortcut('month','Europe/London',now).from,'2024-04-01');
 assert.deepEqual(shortcut('week','UTC',new Date('2025-01-01T12:00:00Z')),{from:'2024-12-30',to:'2025-01-01',label:'This week'});
});
test('inclusive leapday/366-day bounds accepted; invalid/inverted/future ranges rejected',()=>{
 const clock=new Date('2025-01-01T12:00:00Z');
 for(const range of [{from:'2024-02-29',to:'2024-02-29'},{from:'2024-01-01',to:'2024-12-31'}])assert.equal(validate(range,'UTC',clock),null);
 for(const range of [{from:'2024-01-01',to:'2025-01-01'},{from:'2024-03-02',to:'2024-03-01'},{from:'2023-02-29',to:'2024-01-01'},{from:'',to:'2024-01-01'},{from:'2025-01-01',to:'2025-01-02'},{from:'0000-01-01',to:'0000-01-01'}])assert.ok(validate(range,'UTC',clock));
 assert.ok(validate({from:'2024-04-01',to:'2024-04-01'},'America/New_York',now));
 assert.equal(validate({from:'2024-04-01',to:'2024-04-01'},'Europe/London',now),null);
});
function all(node,type,result=[]){if(Array.isArray(node))node.forEach(n=>all(n,type,result));else if(node?.props){if(node.type===type)result.push(node);all(node.props.children,type,result);}return result;}
function harness(){
 const states=[],refs=[],calls=[],focus=[];let index=0,ri=0;
 const loader=sourceLoader({react:{useId:()=> 'synthetic-date',useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useRef:initial=>{const i=ri++;return refs[i]??(refs[i]={current:initial});}}});
 const {DashboardDateFilter:Component}=loader.load('src/components/dashboard/dashboard-date-filter.tsx');
 const props={from:'2024-01-01',to:'2024-01-31',timezone:'UTC',preset:'month',busy:false,onRange:value=>calls.push(['range',value]),onPreset:(value,range)=>calls.push(['preset',value,range])};
 const popup={open:false,showModal(){this.open=true;},close(){this.open=false;}};
 function render(){index=0;ri=0;const tree=Component(props);refs[0].current={focus:()=>focus.push('trigger')};refs[1].current=popup;refs[2].current={focus:()=>focus.push('from')};return tree;}
 function open(){const tree=render();all(tree,'button').find(n=>n.props['aria-haspopup']==='dialog').props.onClick();return render();}
 return{calls,props,focus,popup,render,open};
}
const form=tree=>all(tree,'form')[0];
const submit=tree=>form(tree).props.onSubmit({preventDefault(){}});
const button=(tree,label)=>all(tree,'button').find(n=>n.props.children===label);
test('closed compact trigger opens modal and focuses From; valid draft commits once and closes',()=>{
 const h=harness();let tree=h.render();assert.equal(all(tree,'button')[0].props['aria-expanded'],false);assert.equal(h.popup.open,false);
 tree=h.open();assert.equal(h.popup.open,true);assert.equal(h.focus.at(-1),'from');assert.equal(all(tree,'dialog')[0].props['aria-modal'],'true');assert.equal(form(tree).props['aria-label'],'Dashboard date range');
 const inputs=all(tree,'input');inputs[0].props.onChange({target:{value:'2024-02-01'}});inputs[1].props.onChange({target:{value:'2024-02-29'}});tree=h.render();assert.equal(h.calls.length,0);submit(tree);submit(tree);
 assert.deepEqual(h.calls,[['range',{from:'2024-02-01',to:'2024-02-29'}]]);assert.equal(h.popup.open,false);assert.equal(h.focus.at(-1),'trigger');
});
test('inverted drafts report inline error without callback or closing',()=>{const h=harness();let tree=h.open();all(tree,'input')[0].props.onChange({target:{value:'2024-02-01'}});tree=h.render();submit(tree);tree=h.render();assert.equal(h.calls.length,0);assert.equal(h.popup.open,true);assert.equal(all(tree,'p').find(n=>n.props.role==='alert').props.children,'From must be on or before To.');assert.ok(all(tree,'input').every(n=>n.props['aria-invalid']));});
test('busy blocks trigger, fieldset and submission admission',()=>{const h=harness();h.props.busy=true;h.open();assert.equal(h.popup.open,false);h.props.busy=false;h.open();h.props.busy=true;const tree=h.render();assert.equal(all(tree,'fieldset')[0].props.disabled,true);submit(tree);assert.equal(h.calls.length,0);});
test('preset edits draft only and requires Apply; valid selection clears old draft error',()=>{const h=harness();let tree=h.open();all(tree,'input')[0].props.onChange({target:{value:'2099-01-01'}});tree=h.render();submit(tree);tree=h.render();assert.ok(all(tree,'p').some(n=>n.props.role==='alert'));button(tree,'Today').props.onClick();tree=h.render();assert.deepEqual(h.calls,[]);assert.equal(all(tree,'input')[0].props.value,all(tree,'input')[1].props.value);assert.ok(!all(tree,'p').some(n=>n.props.role==='alert'));const chosen=all(tree,'input').map(n=>n.props.value);submit(tree);assert.deepEqual(h.calls,[['preset','today',{from:chosen[0],to:chosen[1]}]]);assert.equal(h.popup.open,false);});
for(const dismissal of ['Cancel','Escape','outside'])test(`${dismissal} discards edits without reads and restores focus/applied dates on reopen`,()=>{
 const h=harness();let tree=h.open();all(tree,'input')[0].props.onChange({target:{value:'2024-02-01'}});tree=h.render();
 if(dismissal==='Cancel')button(tree,'Cancel').props.onClick();
 else if(dismissal==='Escape')all(tree,'dialog')[0].props.onCancel({preventDefault(){}});
 else {const target={getBoundingClientRect:()=>({left:20,right:500,top:20,bottom:400})};all(tree,'dialog')[0].props.onClick({target,currentTarget:target,clientX:10,clientY:10});}
 assert.equal(h.popup.open,false);assert.deepEqual(h.calls,[]);assert.equal(h.focus.at(-1),'trigger');tree=h.open();assert.deepEqual(all(tree,'input').map(n=>n.props.value),['2024-01-01','2024-01-31']);
});
test('clicking popup padding does not discard draft; changed committed props reset next open',()=>{const h=harness();let tree=h.open();const target={getBoundingClientRect:()=>({left:20,right:500,top:20,bottom:400})};all(tree,'dialog')[0].props.onClick({target,currentTarget:target,clientX:30,clientY:30});assert.equal(h.popup.open,true);button(tree,'Cancel').props.onClick();h.props.from='2024-03-01';h.props.to='2024-03-31';tree=h.open();assert.deepEqual(all(tree,'input').map(n=>n.props.value),['2024-03-01','2024-03-31']);});

test('preset Apply carries exact shown dates even when company day changes while popup is open',()=>{
 const OriginalDate=global.Date;let clock='2024-03-31T23:59:00Z';
 global.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return new OriginalDate(clock).getTime();}};
 try {const h=harness();let tree=h.open();button(tree,'This month').props.onClick();tree=h.render();assert.deepEqual(all(tree,'input').map(n=>n.props.value),['2024-03-01','2024-03-31']);clock='2024-04-01T00:01:00Z';tree=h.render();submit(tree);assert.deepEqual(h.calls,[['preset','month',{from:'2024-03-01',to:'2024-03-31'}]]);}finally{global.Date=OriginalDate;}
});
