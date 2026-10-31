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
function harness(){const states=[],calls=[];let index=0;const loader=sourceLoader({react:{useId:()=> 'synthetic-date',useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];}}});const {DashboardDateFilter:Component}=loader.load('src/components/dashboard/dashboard-date-filter.tsx');const props={from:'2024-01-01',to:'2024-01-31',timezone:'UTC',preset:'month',busy:false,onRange:value=>calls.push(['range',value]),onPreset:value=>calls.push(['preset',value])};return{calls,props,render:()=>{index=0;return Component(props);}};}
test('actual form labels dateinputs and dispatches valid explicit range once',()=>{const h=harness();let tree=h.render();assert.equal(tree.type,'form');assert.equal(tree.props['aria-label'],'Dashboard date range');const inputs=all(tree,'input');assert.deepEqual(inputs.map(n=>[n.props.type,n.props.value]),[['date','2024-01-01'],['date','2024-01-31']]);inputs[0].props.onChange({target:{value:'2024-02-01'}});inputs[1].props.onChange({target:{value:'2024-02-29'}});tree=h.render();tree.props.onSubmit({preventDefault(){}});assert.deepEqual(h.calls,[['range',{from:'2024-02-01',to:'2024-02-29'}]]);});
test('inverted drafts report inline error without callback or auto-fetch',()=>{const h=harness();let tree=h.render();all(tree,'input')[0].props.onChange({target:{value:'2024-02-01'}});tree=h.render();assert.equal(h.calls.length,0);tree.props.onSubmit({preventDefault(){}});tree=h.render();assert.equal(h.calls.length,0);assert.equal(all(tree,'p').find(n=>n.props.role==='alert').props.children,'From must be on or before To.');assert.ok(all(tree,'input').every(n=>n.props['aria-invalid']));});
test('busy fieldset blocks browser controls and submit handler independently refuses dispatch',()=>{const h=harness();h.props.busy=true;const tree=h.render();assert.equal(all(tree,'fieldset')[0].props.disabled,true);tree.props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,0);});
test('shortcut discards invalid drafts, clears error and dispatches selected preset',()=>{const h=harness();let tree=h.render();all(tree,'input')[0].props.onChange({target:{value:'2099-01-01'}});tree=h.render();tree.props.onSubmit({preventDefault(){}});tree=h.render();assert.ok(all(tree,'p').some(n=>n.props.role==='alert'));all(tree,'button').find(n=>n.props.children==='Today').props.onClick();tree=h.render();assert.deepEqual(h.calls,[['preset','today']]);const inputs=all(tree,'input');assert.equal(inputs[0].props.value,inputs[1].props.value);assert.ok(!all(tree,'p').some(n=>n.props.role==='alert'));});
