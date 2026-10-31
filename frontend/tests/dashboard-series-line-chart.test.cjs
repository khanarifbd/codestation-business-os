const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../src');
function load(relative) {
 const filename=path.join(root,relative), mod=new Module(filename,module); mod.filename=filename;mod.paths=module.paths;
 mod.require=name=>name.endsWith('.css')?{}:name.startsWith('@/')?load(`${name.slice(2)}.ts`):require(name);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);return mod.exports;
}
const {dashboardSeriesGeometry:geometry,nearestChartPeriod,keyboardChartPeriod,exactChartCount}=load('lib/dashboard-series-geometry.ts');
const {dashboardSeriesStyle}=load('lib/dashboard-series-palette.ts');
const {DashboardSeriesLineChart:Chart}=load('components/dashboard/dashboard-series-line-chart.tsx');
const periods=['2026-10-01','2026-10-02','2026-10-03'].map(key=>({key,label:key,axisLabel:key.slice(5)}));
const rows=values=>[{key:'income',label:'Income received',values}];
const money={kind:'money',currency:'USD'},count={kind:'count'};
const render=props=>renderToStaticMarkup(React.createElement(Chart,{title:'Income history',periods,series:rows(['1.00','3.00','2.00']),unit:money,...props}));
test('actual straight points preserve rises/falls without invented intermediate data',()=>{
 const g=geometry(periods,rows(['1.00','3.00','2.00']),money);assert.equal(g.points[0].length,3);
 assert.ok(g.points[0][1].y<g.points[0][0].y);assert.ok(g.points[0][2].y>g.points[0][1].y);
 assert.deepEqual(g.points[0].map(p=>p.x),[12,320,628]);assert.equal(g.max,'3.00');assert.equal(g.min,'0.00');
});
test('huge exact cents retained while only bounded ratios become finite coordinates',()=>{
 const value='999999999999999999999999999999999999999999999999999999999999.99';
 const g=geometry(periods,rows(['0.01',value,'-0.01']),money);assert.equal(g.max,value);assert.equal(g.min,'-0.01');
 for(const p of g.points.flat()){assert.ok(Number.isFinite(p.y));assert.ok(p.y>=18&&p.y<=190);}
 const html=render({series:rows(['0.01',value,'-0.01'])});assert.ok(html.includes('999,999,999,999,999,999,999,999,999,999,999,999,999,999,999,999,999,999,999,999.99'));assert.ok(html.includes('USD -0.01'));
});
test('zero and one-period history never manufacture trends',()=>{
 const g=geometry(periods,rows(['0.00','0.00','0.00']),money);assert.equal(g.allZero,true);assert.equal(g.max,'1.00');assert.equal(g.points[0][0].y,190);
 const html=render({periods:periods.slice(0,1),series:rows(['0.00'])});assert.ok(!html.includes('<polyline'));assert.ok(html.includes('One recorded period'));assert.ok(html.includes('All selected values are zero'));
 assert.equal(geometry(periods.slice(0,1),rows(['2.00']),money).points[0][0].x,320);
});
test('count rendering preserves integers beyond safe Number range',()=>{
 assert.equal(exactChartCount('9007199254740993'),'9,007,199,254,740,993');
 const html=render({unit:count,series:rows(['0','9007199254740993','1'])});assert.ok(html.includes('Records created'));assert.ok(html.includes('Counts are not monetary values'));assert.ok(html.includes('9,007,199,254,740,993'));assert.ok(!html.includes('USD'));
});
test('invalid, nonexact, mismatched and ambiguous data fail closed',()=>{
 for(const bad of [1,NaN,Infinity,'NaN','1e3','01','1.001',' 1.00 ','','.1','1.'])assert.throws(()=>geometry(periods,rows([bad,'1.00','2.00']),money));
 for(const bad of ['-1','1.1',1])assert.throws(()=>geometry(periods,rows([bad,'1','2']),count));
 assert.throws(()=>geometry(periods,rows(['1']),money));assert.throws(()=>geometry([periods[0],periods[0]],rows(['1','2']),money));
 assert.throws(()=>geometry(periods,[...rows(['1','2','3']),...rows(['1','2','3'])],money));
 assert.throws(()=>geometry(periods,rows(['1','2','3']),{kind:'money',currency:'usd'}));
 assert.throws(()=>geometry(Array.from({length:367},(_,i)=>({key:String(i),label:String(i)})),[],money));
 assert.ok(render({series:rows(['0.001','1','2'])}).includes('role="alert"'));
});
test('empty selection/periods explicit instead of stale values',()=>{assert.ok(render({series:[]}).includes('Select a series'));assert.ok(render({periods:[],series:rows([])}).includes('No periods are available'));});
test('multi-series has identifiable strokes, exact date/value table and keyboard/touch point inspection',()=>{
 const html=render({series:[...rows(['1.00','3.00','2.00']),{key:'expenses',label:'Expenses recorded',values:['0.00','2.00','1.00']}]});
 assert.equal((html.match(/<polyline/g)||[]).length,2);assert.ok(html.includes('stroke-dasharray="7 4"'));
 for(const token of ['aria-keyshortcuts="ArrowLeft ArrowRight Home End"','tabindex="0"','<details','<table','aria-live="polite"','2026-10-03 · Income received: USD 2.00','Only USD amounts share this scale','scope="row"','Point inspection does not change the date range'])assert.ok(html.includes(token),token);
});
test('pointer clamps to real periods; invalid geometry rejected',()=>{
 assert.equal(nearestChartPeriod(0,0,640,3),0);assert.equal(nearestChartPeriod(320,0,640,3),1);assert.equal(nearestChartPeriod(1000,0,640,3),2);assert.equal(nearestChartPeriod(400,0,640,1),0);
 assert.equal(nearestChartPeriod(1,0,0,3),null);assert.equal(nearestChartPeriod(NaN,0,640,3),null);assert.equal(nearestChartPeriod(1,0,640,0),null);
});

test('single-day dropdown removed; chart describes keyboard and shared date filters',()=>{
 const html=render({});assert.ok(!html.includes('<select'));assert.ok(!html.includes('Explore period'));
 for(const token of ['use Left/Right','Home/End','date-range popup below','aria-describedby','dashboard-series-current-period'])assert.ok(html.includes(token),token);
});
test('palette stays attached to metric identity, with contrast and non-color redundancy',()=>{
 const keys=['income','expenses','projects','orders','clients'];
 assert.equal(new Set(keys.map(key=>dashboardSeriesStyle(key).color)).size,5);
 function luminance(hex){const channels=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;}
 for(const key of keys){const style=dashboardSeriesStyle(key);assert.ok(1.05/(luminance(style.color)+0.05)>=4.5);assert.ok(style.marker);}
 assert.equal(new Set(keys.map(key=>dashboardSeriesStyle(key).dash)).size,5);
 const expense={key:'expenses',label:'Expenses recorded',values:['1.00','2.00','3.00']};
 for(const series of [[expense],[...rows(['1.00','2.00','3.00']),expense]]){
  const html=render({series});assert.ok(html.includes('data-series="expenses" style="color:#b91c1c"'));assert.ok(html.includes('stroke-dasharray="7 4"'));assert.ok(html.includes('<rect'));
 }
});
test('keyboard inspection clamps ends, handles single point, and ignores unrelated/invalid input',()=>{
 assert.equal(keyboardChartPeriod('Home',2,3),0);assert.equal(keyboardChartPeriod('End',0,3),2);
 assert.equal(keyboardChartPeriod('ArrowLeft',0,3),0);assert.equal(keyboardChartPeriod('ArrowRight',2,3),2);
 assert.equal(keyboardChartPeriod('ArrowLeft',2,3),1);assert.equal(keyboardChartPeriod('ArrowRight',0,3),1);
 for(const key of ['Home','End','ArrowLeft','ArrowRight'])assert.equal(keyboardChartPeriod(key,0,1),0);
 assert.equal(keyboardChartPeriod('Enter',0,3),null);assert.equal(keyboardChartPeriod('ArrowLeft',0,0),null);assert.equal(keyboardChartPeriod('End',3,3),null);
});
