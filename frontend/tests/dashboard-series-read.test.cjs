/** Real hook/decoder execution with synthetic fetch and React scheduling; not browser or database evidence. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader, hookHarness } = require('./reconciliation-harness.cjs');
const { deferred } = require('./reconciliation-fixtures.cjs');
const { decodeDashboardSeries: decode } = sourceLoader().load('src/lib/dashboard-series-contract.ts');
const scope = { organizationId: 'synthetic-company', dateFrom: '2026-10-01', dateTo: '2026-10-02', timezone: 'Europe/London' };
const props = { ...scope, enabled: true };
const fixture = (overrides = {}) => ({ organization_id: scope.organizationId, date_from: scope.dateFrom, date_to: scope.dateTo, effective_date_to: scope.dateTo, timezone: scope.timezone, bucket: 'day', income_basis: 'received', expense_basis: 'recorded', counts: ['2026-10-01','2026-10-02'].map(day => ({ period_start: day, period_end: day, projects: 1, orders: 2, clients: 3 })), money: [{currency:'GBP', points:['2026-10-01','2026-10-02'].map(day => ({period_start:day,period_end:day,income:'9007199254740993.01',expenses:'0.02'}))}], ...overrides });
const ok = body => ({ok:true,status:200,json:async()=>body});
const bad = status => ({ok:false,status,json:async()=>({detail:'Synthetic failure'})});
async function setup(response = () => ok(fixture()), args = props) {
 const h=hookHarness({file:'src/hooks/use-dashboard-series.ts',target:'useDashboardSeries',args:[args]});
 h.permissions(['reports.view']);h.respond(response);await h.flush();return h;
}
test('decoder retains exact values, separate currencies, org/date/timezone and basis',()=>{
 const value=fixture();value.money.push({...value.money[0],currency:'USD'});
 assert.deepEqual(decode(value,scope),value);assert.equal(decode(value,scope).money[0].points[0].income,'9007199254740993.01');
});
for(const [name,change] of [
 ['wrong company',v=>v.organization_id='other'],['wrong from',v=>v.date_from='2026-09-01'],['wrong end',v=>v.date_to='2026-10-03'],['wrong timezone',v=>v.timezone='UTC'],['wrong basis',v=>v.expense_basis='cash'],['wrong bucket',v=>v.bucket='month'],['future tail',v=>v.effective_date_to='2026-10-03'],['missing period',v=>v.counts.pop()],['duplicate period',v=>v.counts[1]={...v.counts[0]}],['invalid date',v=>v.counts[0].period_start='2026-02-30'],['unsafe count',v=>v.counts[0].clients=9007199254740992],['fraction count',v=>v.counts[0].orders=0.5],['negative count',v=>v.counts[0].projects=-1],['numeric money',v=>v.money[0].points[0].income=1],['precision loss',v=>v.money[0].points[0].income='1.001'],['exponent money',v=>v.money[0].points[0].income='1e2'],['missing money point',v=>v.money[0].points.pop()],['money period mismatch',v=>v.money[0].points[0].period_end='2026-10-02'],['duplicate currency',v=>v.money.push(v.money[0])],
]) test(`decoder rejects ${name} rather than inventing zero history`,()=>{const value=fixture();change(value);assert.throws(()=>decode(value,scope),/verified/);});
test('decoder accepts one actual period and wholly future no-period response',()=>{
 const value=fixture({date_to:'2026-10-01',effective_date_to:'2026-10-01'});value.counts.pop();value.money[0].points.pop();
 assert.equal(decode(value,{...scope,dateTo:'2026-10-01'}).counts.length,1);
 assert.equal(decode(fixture({effective_date_to:null,counts:[],money:[]}),scope).effective_date_to,null);
});
test('decoder monthly range clips first/last, respects leap days and rejects gaps',()=>{
 const s={...scope,dateFrom:'2024-01-17',dateTo:'2024-04-03'};
 const value=fixture({date_from:s.dateFrom,date_to:s.dateTo,effective_date_to:'2024-04-02',bucket:'month',money:[],counts:[['2024-01-17','2024-01-31'],['2024-02-01','2024-02-29'],['2024-03-01','2024-03-31'],['2024-04-01','2024-04-02']].map(([period_start,period_end])=>({period_start,period_end,projects:0,orders:0,clients:0}))});
 assert.equal(decode(value,s).counts.length,4);value.counts[1].period_end='2024-02-28';assert.throws(()=>decode(value,s));
});
test('hook uses exact readonly query, no-store and abortable request',async()=>{const h=await setup();try{assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/reports/dashboard-series?date_from=2026-10-01&date_to=2026-10-02');assert.equal(h.calls[0].init.cache,'no-store');assert.ok(h.calls[0].init.signal instanceof AbortSignal);assert.equal(h.vm().data.money[0].points[0].income,'9007199254740993.01');assert.equal(h.vm().loading,false);}finally{h.cleanup();}});
for(const status of [401,403,500])test(`current ${status} is distinct from empty history`,async()=>{const h=await setup(()=>bad(status));try{assert.equal(h.vm().data,null);assert.equal(h.vm().loading,false);assert.ok(h.vm().error);assert.equal(h.vm().restricted,status===403);assert.equal(h.nav.length,status===401?1:0);if(status===401)assert.equal(h.nav[0].href,'/login');}finally{h.cleanup();}});
for(const response of [()=>{throw Error('Synthetic offline');},()=>ok({}),()=>({ok:true,status:200,json:async()=>{throw Error('Synthetic parse failure');}})])test('failed read supports explicit recovery without false empty result',async()=>{const h=await setup(response);try{assert.equal(h.vm().data,null);assert.ok(h.vm().error);h.respond(()=>ok(fixture()));await h.vm().retry();await h.flush();assert.equal(h.vm().error,null);assert.equal(h.vm().data.organization_id,scope.organizationId);}finally{h.cleanup();}});
for(const boundary of ['date','tenant','permission','disabled','unmount'])for(const outcome of ['success','401','network'])test(`${boundary} immediately hides old history and ignores stale ${outcome}`,async()=>{
 const h=await setup();try{
  const d=deferred();h.respond(()=>d.promise);const old=h.vm(), pending=old.retry();const calls=h.calls.length;
  if(boundary==='unmount')h.unmount();
  else if(boundary==='date')h.render({...props,dateFrom:'2026-09-01',dateTo:'2026-09-02'});
  else if(boundary==='tenant'){h.tenant('other');h.render({...props,organizationId:'other'});}
  else if(boundary==='permission'){h.permissions([]);h.render();}
  else h.render({...props,enabled:false});
  if(boundary!=='unmount')assert.equal(h.vm().data,null);
  assert.equal(h.calls.at(-1).init.signal.aborted,true);
  if(outcome==='network')d.reject(Error('Stale offline'));else d.resolve(outcome==='401'?bad(401):ok(fixture()));
  await pending;await old.retry();assert.equal(h.calls.length,calls);assert.equal(h.nav.length,0);
 }finally{h.cleanup();}
});
test('double retry admits one pending read',async()=>{const h=await setup();try{const d=deferred();h.respond(()=>d.promise);const first=h.vm().retry(),second=h.vm().retry();assert.equal(h.calls.length,2);d.resolve(ok(fixture()));await Promise.all([first,second]);await h.flush();assert.equal(h.vm().error,null);}finally{h.cleanup();}});
for(const args of [{...props,enabled:false},{...props,organizationId:'wrong-cookie-scope'}])test('disabled or wrong current tenant never dispatches',async()=>{const h=await setup(undefined,args);try{assert.equal(h.calls.length,0);assert.equal(h.vm().data,null);}finally{h.cleanup();}});
for(const boundary of ['date','tenant','permission','disabled'])test(`verified data is synchronously hidden on ${boundary} before passive effects`,async()=>{const h=await setup();try{assert.ok(h.vm().data);if(boundary==='date')h.render({...props,dateFrom:'2026-09-01',dateTo:'2026-09-02'});else if(boundary==='tenant'){h.tenant('other');h.render({...props,organizationId:'other'});}else if(boundary==='permission'){h.permissions([]);h.render();}else h.render({...props,enabled:false});assert.equal(h.vm().data,null);}finally{h.cleanup();}});
test('newer scoped result survives late old JSON body and cannot redirect or replace values',async()=>{const h=await setup();try{
 const oldJson=deferred();h.respond(()=>({ok:true,status:200,json:()=>oldJson.promise}));const old=h.vm().retry();await new Promise(resolve=>setImmediate(resolve));
 const nextProps={...props,dateFrom:'2026-09-01',dateTo:'2026-09-01'};
 const current=fixture({date_from:'2026-09-01',date_to:'2026-09-01',effective_date_to:'2026-09-01',money:[],counts:[{period_start:'2026-09-01',period_end:'2026-09-01',projects:77,orders:0,clients:0}]});
 h.respond(()=>ok(current));h.render(nextProps);await h.flush();assert.equal(h.vm().data.counts[0].projects,77);
 oldJson.resolve(fixture());await old;await h.flush();assert.equal(h.vm().data.counts[0].projects,77);assert.equal(h.nav.length,0);
}finally{h.cleanup();}});
test('future range cannot invent currency series without periods',()=>{assert.throws(()=>decode(fixture({effective_date_to:null,counts:[],money:[{currency:'USD',points:[]}]}),scope));});
test('browser date boundaries assert native option value attributes, never input-only value matchers',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../e2e/dashboard-final-revision.spec.mjs'),'utf8');
 const verify=code=>{
  for(const [edge,value] of [['first','rangeFrom'],['last','rangeTo']])assert.ok(code.includes(`expect(historyPeriod.locator('option').${edge}()).toHaveAttribute('value', ${value})`),`exact ${edge} date attribute`);
  assert.doesNotMatch(code,/expect\([^;\n]*locator\(['"]option['"]\)[^;\n]*\)\.toHaveValue\(/,'Playwright toHaveValue is for input/select/textarea, not option');
 };
 verify(source);
 for(const value of ['rangeFrom','rangeTo'])assert.throws(()=>verify(source.replace(`toHaveAttribute('value', ${value})`,`toHaveValue(${value})`)));
 assert.throws(()=>verify(source+"\nawait expect(historyPeriod.locator('option').first()).toHaveValue('2026-01-01');\n"));
});
