const test=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./reconciliation-harness.cjs');
function flatten(node,out=[]){if(Array.isArray(node))node.forEach(item=>flatten(item,out));else if(node?.props){out.push(node);flatten(node.props.children,out);}return out;}
function render(selected=['Income','Expenses','Projects','Orders','Clients'],state={}){
 const data={date_from:'2024-01-01',date_to:'2024-01-01',effective_date_to:'2024-01-01',bucket:'day',counts:[{period_start:'2024-01-01',period_end:'2024-01-01',projects:1,orders:2,clients:3}],money:['USD','GBP'].map(currency=>({currency,points:[{period_start:'2024-01-01',period_end:'2024-01-01',income:'1.00',expenses:'0.00'}]}))};
 const loader=sourceLoader({react:{useId:()=> 'layout-test',useState:()=>[selected,()=>{}]},'@/hooks/use-dashboard-series':{useDashboardSeries:()=>({data,loading:false,error:null,restricted:false,retry(){},...state})}});
 const {DashboardTrendExplorer:Explorer}=loader.load('src/components/dashboard/dashboard-trend-explorer.tsx');
 return flatten(Explorer({organizationId:'synthetic',dateFrom:data.date_from,dateTo:data.date_to,timezone:'UTC',reportingCurrency:'USD',enabled:true,filters:{type:'button',props:{children:'Synthetic compact date trigger'}}}));
}
test('all real currency/count plots precede one colored selector row and compact date slot',()=>{
 const nodes=render(),plots=nodes.filter(n=>typeof n.type==='function'&&n.type.name==='DashboardSeriesLineChart');
 assert.deepEqual(plots.map(n=>n.props.title),['Income and expenses · USD','Income and expenses · GBP','Records created over time']);
 const controls=nodes.findIndex(n=>n.props.className==='dashboard-series-controls'),slot=nodes.findIndex(n=>n.props.className==='dashboard-series-filter-slot');
 assert.ok(plots.every(n=>nodes.indexOf(n)<controls));assert.ok(slot>controls);assert.equal(nodes.filter(n=>n.props.className==='dashboard-series-options').length,1);
 assert.equal(nodes.filter(n=>n.props.className==='dashboard-series-filter-slot').length,1);assert.ok(plots.every(n=>n.props.description.length>0));
 assert.deepEqual(nodes.filter(n=>n.type==='label').map(n=>n.props['data-series']),['income','expenses','projects','orders','clients']);
});
test('none selected retains lower controls; loading/error never expose prior chart data',()=>{
 for(const nodes of [render([]),render(undefined,{loading:true}),render(undefined,{error:'Synthetic read failure'})]){
  assert.equal(nodes.filter(n=>typeof n.type==='function'&&n.type.name==='DashboardSeriesLineChart').length,0);
  assert.equal(nodes.filter(n=>n.props.className==='dashboard-series-options').length,1);
  assert.equal(nodes.filter(n=>n.props.className==='dashboard-series-filter-slot').length,1);
 }
});
