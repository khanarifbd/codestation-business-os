/** Fully synthetic dashboard/shell handler tests: no network, account or tenant mutation. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const success = value => ({ ok: true, status: 200, json: async () => value });
const failure = (status, detail = 'Synthetic failure') => ({ ok: false, status, json: async () => ({ detail }) });
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const organization = { id: 'synthetic-a', name: 'Synthetic design review', currency: 'BDT' };
const owner = { organization, is_owner: true, primary_relationship: 'owner', relationships: ['owner'], permissions: ['*'] };
const financial = (currency, amount = '100.00') => ({ currency, invoiced_revenue: amount, direct_income: '0', collected_revenue: '70', receivables: '30', expenses: '20', platform_fees: '0', transfer_fees: '0', net_profit: '80' });
const overview = { date_from: '2026-10-01', date_to: '2026-10-24', financials: [financial('USD'), financial('BDT'), financial('EUR')], trend: [], operations: { active_clients: 12, open_orders: 8, active_projects: 6, open_invoices: 4, overdue_tasks: 2, due_followups: 3 }, accounts: [], projects: [], clients: [] };
function all(node, type, result = []) {
  if (Array.isArray(node)) node.forEach(child => all(child, type, result));
  else if (node?.props) {
    if (node.type === type || node.type?.name === type) result.push(node);
    for (const value of Object.values(node.props)) if (Array.isArray(value) || value?.props) all(value, type, result);
  }
  return result;
}
function strings(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(strings).join(' ');
  if (node.props) return Object.values(node.props).filter(value => typeof value !== 'function').map(strings).join(' ');
  return '';
}
function reportingModule(file = 'dashboard-reporting.ts') {
  const filename=path.join(root,'src/lib',file), mod=new Module(filename,module);
  mod.filename=filename; mod.paths=module.paths;
  mod.require=id=>id.startsWith('./')?reportingModule(id.slice(2)+'.ts'):require(id);
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return mod.exports;
}
function harness(file = 'src/app/dashboard/page.tsx', exported = 'default', privateNames = []) {
  const states = [], refs = [], effects = [], requests = [], navigation = [], nativeNavigation = [], prefetches = [];
  let workspaceExitAllowed = true, workspaceExitChecks = 0;
  let cursor = 0, refCursor = 0, tenant = structuredClone(owner), workspaces = null, pathname = '/dashboard', response = () => success({});
  const router = { replace: p => navigation.push(p), push: p => navigation.push(p), refresh: () => navigation.push('refresh'), prefetch: p => prefetches.push(p) };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functionName = exported === 'default' ? 'DashboardPage' : exported;
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === functionName);
  const stateNames = fn?.body.statements.filter(ts.isVariableStatement).flatMap(s => s.declarationList.declarations).filter(d => ts.isArrayBindingPattern(d.name) && d.initializer?.getText(ast).startsWith('useState')).map(d => d.name.elements[0].name.text) ?? [];
  const code = ts.transpileModule(source + (privateNames.length ? '\nexport const __test = {' + privateNames.join(',') + '};' : ''), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = new Module(__filename, module); mod.filename = __filename; mod.paths = module.paths;
  mod.require = id => {
    if (id === 'react') return { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useMemo: fn => fn(), useEffect: fn => effects.push(fn), useRef: initial => { const i = refCursor++; if (!(i in refs)) refs[i] = { current: initial }; return refs[i]; } };
    if (id === 'next/navigation') return { useRouter: () => router, usePathname: () => pathname };
    if (id === 'next/link') return { default: 'a' };
    if (id === '@/components/dashboard-session-context') return { useDashboardSession: () => ({ tenant, profile: { full_name: 'Synthetic Preview', email: 'preview@example.invalid', has_avatar: false }, workspaces: workspaces ?? [tenant], setTenant: next => { tenant = next; } }) };
    if (id === '@/lib/workspace-navigation') return { requestWorkspaceExit: () => { workspaceExitChecks += 1; return workspaceExitAllowed; } };
    if (id === '@/lib/dashboard-reporting') return reportingModule();
    if (id === '@/lib/dashboard-date-range') return reportingModule('dashboard-date-range.ts');
    if (id === '@/hooks/use-administration-read-owner') return {useAdministrationReadOwner:()=>{const key=JSON.stringify(tenant);return {current:()=>Boolean(tenant)&&JSON.stringify(tenant)===key};}};
    if (id === '@/lib/cn') return { cn: (...values) => values.filter(Boolean).join(' ') };
    if (id.endsWith('.css')) return {};
    if (id.startsWith('@/components/')) return new Proxy({}, { get: (_target, name) => String(name) });
    return require(id);
  };
  mod._compile(code, __filename);
  const original = { fetch: global.fetch, Date: global.Date, document: global.document, window: global.window };
  global.window = { location: { assign: href => nativeNavigation.push(['assign', href]), replace: href => nativeNavigation.push(['replace', href]) } };
  global.fetch = async (url, options) => { requests.push({ url, options }); return response(url, options); };
  global.Date = class extends original.Date { constructor(...args) { super(...(args.length ? args : ['2026-10-24T12:00:00Z'])); } static now() { return new original.Date('2026-10-24T12:00:00Z').getTime(); } };
  global.document = { body: { style: { overflow: 'auto' } }, addEventListener() {}, removeEventListener() {} };
  return { states, effects, requests, navigation, nativeNavigation, prefetches, setWorkspaceExitAllowed: value => { workspaceExitAllowed = value; }, workspaceExitChecks: () => workspaceExitChecks, helpers: mod.exports.__test, all, render: props => { cursor = 0; refCursor = 0; effects.length = 0; return (mod.exports[exported] ?? mod.exports.__test[exported])(props ?? {}); }, state: name => states[stateNames.indexOf(name)], setState: (name, value) => { const i = stateNames.indexOf(name); assert.ok(i >= 0, name); states[i] = value; }, setTenant: value => { tenant = value; }, getTenant: () => tenant, setWorkspaces: value => { workspaces = value; }, setPath: value => { pathname = value; }, setResponse: fn => { response = fn; }, cleanup: () => Object.assign(global, original) };
}
function withDashboard(name, check) { test(name, async () => { const h = harness(); try { await check(h); } finally { h.cleanup(); } }); }
function ready(h, data = overview) { h.render(); h.setState('reportResult', { organizationId: 'synthetic-a', value: structuredClone(data) }); h.setState('loading', false); return h.render(); }
const dateFilter = (h, tree) => h.all(tree, 'DashboardDateFilter')[0];
// Invoke the actual shared filter callback; the retired header dropdown is not rendered.
const periodSelect = (h, tree) => { const filter = dateFilter(h,tree); return { props: { value:filter.props.preset, disabled:filter.props.busy, onChange:event=>filter.props.onPreset(event.target.value) } }; };

withDashboard('Initial report request preserves month range, no-store and tenant-keyed result', async h => {
  h.setResponse(() => success(overview)); h.render(); h.effects[0](); await settle();
  assert.equal(h.requests[0].url, '/api/reports/dashboard?date_from=2026-10-01&date_to=2026-10-24');
  assert.deepEqual(h.requests[0].options, { cache: 'no-store' });
  assert.equal(h.state('reportResult').organizationId, 'synthetic-a'); assert.equal(h.state('loading'), false);
});
withDashboard('Cancelled initial report ignores a late response', async h => {
  let finish; h.setResponse(() => new Promise(resolve => { finish = resolve; })); h.render(); const cancel = h.effects[0](); cancel(); finish(success(overview)); await settle();
  assert.equal(h.state('reportResult'), null);
});
withDashboard('Initial report 401 keeps login redirect and 403 keeps restricted workspace', async h => {
  h.setResponse(() => failure(401)); h.render(); h.effects[0](); await settle(); assert.deepEqual(h.navigation, ['/login']);
  h.navigation.length = 0; h.setResponse(() => failure(403)); h.render(); h.effects[0](); await settle();
  const tree = h.render(); assert.match(strings(tree), /financial reporting is restricted/); assert.equal(h.state('error'), null); assert.deepEqual(h.navigation, []);
});
withDashboard('Tenant change immediately hides previous organization metrics', h => {
  ready(h); h.setTenant({ ...owner, organization: { ...organization, id: 'synthetic-b' } }); const tree = h.render();
  assert.match(strings(tree), /Loading dashboard/); assert.equal(h.all(tree, 'MetricCard').length, 0);
});
withDashboard('Financial rows sort reporting currency first without combining currencies', h => {
  const rows = h.all(ready(h), 'FinancialPerformanceCard').map(n => n.props.row);
  assert.deepEqual(rows.map(row => row.currency), ['BDT', 'EUR', 'USD']); assert.equal(rows.length, overview.financials.length);
  assert.equal(rows[0].invoiced_revenue, '100.00');
});
withDashboard('Historical explorer receives exact current tenant/date scope independently of old monthly trend', h => {
  const tree = ready(h);
  const charts = h.all(tree, 'DashboardTrendExplorer');
  assert.equal(charts.length, 1);
  const { filters, ...scope } = charts[0].props;
  assert.equal(filters.type, 'DashboardDateFilter');
  assert.deepEqual(scope, { organizationId:'synthetic-a', dateFrom:overview.date_from, dateTo:overview.date_to, timezone:'UTC', reportingCurrency:'BDT', enabled:true });
  h.setState('reportLoading', true);
  assert.equal(h.all(h.render(), 'DashboardTrendExplorer')[0].props.enabled, false);
});
withDashboard('Four operation cards and two attention rows preserve all six original values and destinations', h => {
  const tree=ready(h), cards=h.all(tree,'MetricCard'), alerts=h.all(tree,'AlertRow');
  assert.equal(cards.length,4); assert.equal(alerts.length,2);
  assert.deepEqual(cards.map(n=>[n.props.label,n.props.value,n.props.href]),[['Active clients',12,'/dashboard/clients'],['Open orders',8,'/dashboard/orders'],['Active projects',6,'/dashboard/projects'],['Open invoices',4,'/dashboard/accounting/invoices']]);
  assert.deepEqual(alerts.map(n=>[n.props.label,n.props.value,n.props.href]),[['Overdue tasks',2,'/dashboard/projects'],['Due CRM follow-ups',3,'/dashboard/crm']]);
});
for (const [preset, from, to] of [['last_month','2026-09-01','2026-09-30'],['quarter','2026-10-01','2026-10-24'],['year','2026-01-01','2026-10-24']]) {
  withDashboard(`${preset} requests the existing date range and updates preset only on success`, async h => {
    const tree = ready(h); h.setResponse(() => success({ ...overview, date_from: from, date_to: to })); periodSelect(h, tree).props.onChange({ target: { value: preset } }); await settle();
    if(from===overview.date_from&&to===overview.date_to)assert.equal(h.requests.length,0);else assert.equal(h.requests[0].url, `/api/reports/dashboard?date_from=${from}&date_to=${to}`); assert.equal(h.state('preset'), preset); assert.equal(h.state('reportLoading'), false);
  });
}
withDashboard('Unchanged period makes no request; failed period preserves previous report and enables control', async h => {
  let tree = ready(h); periodSelect(h, tree).props.onChange({ target: { value: 'month' } }); await settle(); assert.equal(h.requests.length, 0);
  h.setResponse(() => failure(500)); tree = h.render(); periodSelect(h, tree).props.onChange({ target: { value: 'year' } }); await settle();
  assert.equal(h.state('preset'), 'month'); assert.equal(h.state('reportResult').value.date_from, '2026-10-01'); assert.equal(periodSelect(h,h.render()).props.disabled, false); assert.equal(h.state('error'), 'Unable to load dashboard metrics');
});
withDashboard('Pending period update disables select and unauthenticated response keeps login redirect', async h => {
  let finish; const tree = ready(h); h.setResponse(() => new Promise(resolve => { finish = resolve; })); periodSelect(h, tree).props.onChange({ target: { value: 'year' } });
  assert.equal(periodSelect(h,h.render()).props.disabled, true); finish(failure(401)); await settle(); assert.deepEqual(h.navigation, ['/login']); assert.equal(h.state('reportLoading'), false);
});
withDashboard('Details request is date/tenant keyed, abortable and cannot replace another period', async h => {
  ready(h); h.setResponse(() => success({ accounts: [], projects: [], clients: [] })); const cancel = h.effects[2](); await settle();
  assert.equal(h.requests[0].url, '/api/reports/dashboard-details?date_from=2026-10-01&date_to=2026-10-24'); assert.equal(h.requests[0].options.cache, 'no-store'); assert.equal(h.requests[0].options.signal.aborted, false);
  assert.equal(h.state('detailsResult').organizationId, 'synthetic-a'); assert.equal(h.state('detailsResult').from, '2026-10-01'); cancel(); assert.equal(h.requests[0].options.signal.aborted, true);
  h.setState('reportResult', { organizationId:'synthetic-a',value:{...overview,date_from:'2026-01-01'} }); assert.ok(h.all(h.render(),'DetailPlaceholder').length > 0);
});
withDashboard('Aborted details response cannot repopulate the details state', async h => {
  ready(h); let finish; h.setResponse(() => new Promise(resolve => { finish = resolve; })); const cancel = h.effects[2](); cancel(); finish(success({ accounts:[],projects:[],clients:[] })); await settle(); assert.equal(h.state('detailsResult'), null);
});
withDashboard('Pulse response stays tenant keyed and weighted pipeline preserves currency amounts', async h => {
  ready(h); h.setResponse(() => success({ orders:null,projects:null,finance:null,people:null,crm:{open_leads:2,values:[{currency:'USD',amount:'200',weighted_amount:'50'},{currency:'BDT',amount:'1000',weighted_amount:'300'}]} })); h.effects[1](); await settle();
  assert.equal(h.requests[0].url, '/api/dashboard-pulse/overview'); assert.equal(h.state('pulseOrganizationId'), 'synthetic-a');
  const row = h.all(h.render(),'PulseValueRow').find(n => n.props.label === 'Open CRM pipeline'); assert.deepEqual(row.props.secondaryValues,[{currency:'USD',amount:'50'},{currency:'BDT',amount:'300'}]);
  h.setState('pulseOrganizationId','synthetic-other'); assert.equal(h.all(h.render(),'PulseCard').length,0);
});
withDashboard('Supplementary pulse failure does not replace usable financial data', async h => {
  ready(h); h.setResponse(() => { throw new Error('Synthetic unavailable'); }); h.effects[1](); await settle(); assert.equal(h.state('error'),null); assert.equal(h.all(h.render(),'FinancialPerformanceCard').length,3);
});

withDashboard('Empty reports keep financial/trend empty states and operational counts without fabricated values', h => {
  const tree = ready(h, {...overview, financials:[], trend:[]});
  assert.equal(h.all(tree,'FinancialPerformanceCard').length,0);
  assert.equal(h.all(tree,'DashboardTrendExplorer').length,1);
  assert.deepEqual(h.all(tree,'EmptyState').map(node=>node.props.title).sort(),['No financial activity']);
  assert.equal(h.all(tree,'PulseCard').length,0);
});
withDashboard('Details failure leaves financial report usable and renders three unavailable sections', h => {
  ready(h); h.setState('detailsError',true);
  const tree = h.render();
  assert.equal(h.all(tree,'DetailUnavailable').length,3);
  assert.equal(h.all(tree,'FinancialPerformanceCard').length,3);
  assert.equal(h.all(tree,'DetailPlaceholder').length,0);
});
withDashboard('Lower account/project/client sections retain row limits, links and exact financial fields', h => {
  ready(h);
  const accounts = Array.from({length:10},(_,i)=>({account_id:'account-'+i,account_name:'Synthetic account '+i,account_type:'bank',currency:'BDT',balance:'1000.50'}));
  const projects = Array.from({length:8},(_,i)=>({project_id:'project-'+i,project_number:'SYN-'+i,project_name:'Synthetic project '+i,client_name:'Synthetic client',currency:'USD',contract_value:'111.11',invoiced_revenue:'222.22',direct_income:'33.33',collected_revenue:'444.44',direct_expenses:'55.55',estimated_profit:'-66.66',margin_percent:'-12.34'}));
  const clients = Array.from({length:11},(_,i)=>({client_id:'client-'+i,client_name:'Synthetic client '+i,currency:'EUR',invoiced_revenue:'111.11',direct_income:'22.22',collected_revenue:'333.33',direct_expenses:'44.44',estimated_profit:'-55.55',margin_percent:null}));
  h.setState('detailsResult',{organizationId:'synthetic-a',from:overview.date_from,to:overview.date_to,value:{accounts,projects,clients}});
  const tree = h.render(), links = h.all(tree,'a');
  const accountLinks = links.filter(n=>n.props.href.startsWith('/dashboard/accounting/accounts/account-'));
  const projectLinks = links.filter(n=>n.props.href.startsWith('/dashboard/projects/project-'));
  const clientLinks = links.filter(n=>n.props.href.startsWith('/dashboard/clients/client-'));
  assert.equal(accountLinks.length,8); assert.equal(projectLinks.length,6); assert.equal(clientLinks.length,9);
  assert.match(strings(accountLinks[0]),/BDT 1,000.50/);
  for(const amount of ['USD 111.11','USD 222.22','USD 444.44','USD 55.55','USD -66.66','-12.3%']) assert.ok(strings(projectLinks[0]).includes(amount),amount);
  assert.deepEqual(h.all(clientLinks[0],'ClientMetric').map(n=>[n.props.label,n.props.value]),[['Invoiced','EUR 111.11'],['Collected','EUR 333.33'],['Linked cost','EUR 44.44'],['Est. profit','EUR -55.55']]);
  assert.match(strings(clientLinks[0]),/—/);
  assert.ok([...accountLinks,...projectLinks,...clientLinks].every(link=>link.props.prefetch===false));
});
withDashboard('Lower detail empty states retain all existing operational destinations', h => {
  ready(h); h.setState('detailsResult',{organizationId:'synthetic-a',from:overview.date_from,to:overview.date_to,value:{accounts:[],projects:[],clients:[]}});
  const tree = h.render();
  for(const title of ['No financial accounts','No project economics yet','No client economics yet']) assert.ok(h.all(tree,'EmptyState').some(n=>n.props.title===title));
  assert.deepEqual(h.all(tree,'SectionHeading').map(n=>n.props.href),['/dashboard/accounting/accounts','/dashboard/reports','/dashboard/clients']);
});
withDashboard('Chart-first hierarchy puts trends before unchanged operations, ledgers and detail', h => {
  const tree=ready(h,{...overview,trend:[{...financial('USD'),period:'2026-10'}]});
  const children=tree.props.children.props.children.filter(Boolean);
  const railIndex=children.findIndex(node=>h.all(node,'MetricCard').length===4);
  const decisionIndex=children.findIndex(node=>h.all(node,'DashboardTrendExplorer').length===1&&h.all(node,'aside').some(n=>n.props['aria-label']==='Priority work and quick entry'));
  const ledgerIndex=children.findIndex(node=>h.all(node,'FinancialPerformanceCard').length>0);
  const detailsIndex=children.findIndex(node=>h.all(node,'SectionHeading').length>0);
  assert.ok(decisionIndex>=0&&railIndex>decisionIndex&&ledgerIndex>railIndex&&detailsIndex>ledgerIndex);
  const decision=children[decisionIndex], aside=h.all(decision,'aside')[0];
  assert.equal(h.all(decision,'MetricCard').length,0);
  assert.equal(h.all(aside,'AlertRow').length,2);
  assert.deepEqual(h.all(aside,'WorkspaceLink').map(n=>n.props.href),['/dashboard/orders/new','/dashboard/accounting/money-in','/dashboard/accounting/money-out','/dashboard/accounting/transfers']);
  assert.equal(h.all(tree,'WorkspaceLink').length,4);
});
withDashboard('Attention shows current finance-pulse overdue values separately from period financial receivables', h => {
  ready(h);
  const finance={open_invoices:9,overdue_invoices:7,outstanding:[{currency:'USD',amount:'900'},{currency:'BDT',amount:'5000'}],overdue:[{currency:'USD',amount:'120'},{currency:'BDT',amount:'700'}]};
  h.setState('rawFinancePulse',finance);h.setState('pulseOrganizationId','synthetic-a');
  const tree=h.render(), aside=h.all(tree,'aside')[0];
  const alert=h.all(aside,'AlertRow').find(n=>n.props.label==='Overdue invoices');
  assert.equal(alert.props.value,7); assert.equal(alert.props.href,'/dashboard/accounting/receivables');
  const chips=h.all(aside,'CurrencyChips')[0];
  assert.deepEqual(chips.props.values,finance.overdue); assert.equal(chips.props.reportingCurrency,'BDT');
  const pulseRows=h.all(tree,'PulseValueRow');
  assert.deepEqual(pulseRows.find(n=>n.props.label==='Outstanding').props.values,finance.outstanding);
  assert.deepEqual(pulseRows.find(n=>n.props.label==='Overdue').props.values,finance.overdue);
  assert.equal(h.all(tree,'MetricCard').find(n=>n.props.label==='Open invoices').props.value,4);
  h.setState('pulseOrganizationId','synthetic-other');
  const staleTree=h.render(), staleAttention=h.all(staleTree,'aside')[0];
  assert.equal(h.all(staleTree,'AlertRow').some(n=>n.props.label==='Overdue invoices'),false);
  assert.doesNotMatch(strings(staleAttention),/Current overdue balances/);
  assert.equal(h.all(staleAttention,'CurrencyChips').length,0);
});
withDashboard('Null finance pulse suppresses both overdue invoice attention and its currency balances while other pulse data remains usable', h => {
  ready(h);h.setState('pulseOrganizationId','synthetic-a');
  h.setState('rawFinancePulse',null);
  h.setState('rawProjectPulse',{active_projects:6,values:[{currency:'USD',amount:'125.50'}]});
  const tree=h.render(), attention=h.all(tree,'aside')[0];
  assert.deepEqual(h.all(attention,'AlertRow').map(n=>n.props.label),['Overdue tasks','Due CRM follow-ups']);
  assert.equal(h.all(attention,'CurrencyChips').length,0);
  assert.doesNotMatch(strings(attention),/Overdue invoices|Current overdue balances/);
  assert.equal(h.all(tree,'PulseValueRow').some(n=>n.props.label==='Active project value'),true);
  assert.equal(h.all(tree,'PulseCard').some(n=>n.props.title==='Collections'),false);
});
withDashboard('Server-masked finance response for a role without finance.view cannot populate foregrounded attention balances', async h => {
  h.setTenant({...owner,is_owner:false,primary_relationship:'employee',relationships:['employee'],permissions:['projects.view','reports.view']});
  ready(h);
  h.setResponse(()=>success({orders:null,projects:{active_projects:6,values:[{currency:'USD',amount:'125.50'}]},crm:null,finance:null,people:null}));
  h.effects[1]();await settle();
  assert.equal(h.requests[0].url,'/api/dashboard-pulse/overview');
  assert.equal(h.state('rawFinancePulse'),null);
  assert.equal(h.state('pulseOrganizationId'),'synthetic-a');
  const tree=h.render(), attention=h.all(tree,'aside')[0];
  assert.equal(h.all(attention,'AlertRow').some(n=>n.props.label==='Overdue invoices'),false);
  assert.equal(h.all(attention,'CurrencyChips').length,0);
  assert.doesNotMatch(strings(attention),/Current overdue balances/);
  assert.equal(h.all(tree,'PulseCard').some(n=>n.props.title==='Collections'),false);
  assert.equal(h.all(tree,'PulseValueRow').find(n=>n.props.label==='Active project value').props.count,6);
});
withDashboard('Restricted report surface does not render finance attention even if an earlier pulse snapshot remains in memory', h => {
  h.render();h.setState('loading',false);
  h.setState('rawFinancePulse',{open_invoices:3,overdue_invoices:2,outstanding:[{currency:'USD',amount:'100'}],overdue:[{currency:'USD',amount:'50'}]});
  h.setState('pulseOrganizationId','synthetic-a');
  const tree=h.render();
  assert.match(strings(tree),/financial reporting is restricted/);
  assert.equal(h.all(tree,'aside').length,0);
  assert.equal(h.all(tree,'CurrencyChips').length,0);
  assert.equal(h.all(tree,'AlertRow').length,0);
  assert.doesNotMatch(strings(tree),/Overdue invoices|Current overdue balances/);
});
withDashboard('Secondary people pulse retains every workforce count after moving below the primary decision area', h => {
  ready(h);h.setState('pulseOrganizationId','synthetic-a');
  h.setState('rawPeoplePulse',{active_employees:101,present_today:102,late_today:103,on_leave_today:104,pending_leave:105});
  const tree=h.render(), people=h.all(tree,'PulseCard').find(n=>n.props.title==='People today');
  assert.equal(people.props.href,'/dashboard/hr');
  assert.deepEqual(h.all(people,'PeopleStat').map(n=>[n.props.label,n.props.value]),[['Active employees',101],['Present today',102],['On leave',104],['Pending leave',105]]);
  assert.match(strings(people),/Late today/); assert.match(strings(people),/103/);
  assert.equal(h.all(people,'PeopleStat').find(n=>n.props.label==='Pending leave').props.attention,true);
});

const shellHelpers = ['hasAnyPermission','isEmployeeSelfServiceContext','isFinanceArea','isActive','isFinanceItemActive','staffNavigation','employeeNavigation','clientNavigation','financeNavigation','Navigation','MobileBottomNavigation'];
function withShell(name, check) { test(name, async () => { const h = harness('src/components/dashboard-shell.tsx','DashboardShell',shellHelpers); try { await check(h); } finally { h.cleanup(); } }); }
withShell('Permission checks preserve wildcard, any-of and no-requirement semantics', h => {
  const can = h.helpers.hasAnyPermission; assert.equal(can([],undefined),true); assert.equal(can(['*'],['finance.view']),true); assert.equal(can(['projects.work'],['projects.view','projects.work']),true); assert.equal(can(['projects.work'],['finance.view']),false);
});
withShell('Employee self-service is restricted by relationship, owner and expanded permission checks', h => {
  const check=h.helpers.isEmployeeSelfServiceContext; const employee={...owner,is_owner:false,primary_relationship:'employee',relationships:['employee'],permissions:['projects.work','hr.self']};
  assert.equal(check(employee),true); assert.equal(check({...employee,permissions:['finance.view']}),false); assert.equal(check({...employee,is_owner:true}),false); assert.equal(check({...employee,permissions:['*']}),false);
});
withShell('Finance aliases and invoice separation preserve active navigation semantics', h => {
  const {isFinanceArea,isActive,isFinanceItemActive}=h.helpers;
  assert.equal(isFinanceArea('/dashboard/accounting/invoices/preview'),false); assert.equal(isActive('/dashboard/accounting/invoices/preview','/dashboard/accounting/invoices'),true); assert.equal(isActive('/dashboard/accounting/invoices/preview','/dashboard/accounting'),false);
  assert.equal(isFinanceItemActive('/dashboard/finance/transfers','/dashboard/accounting/transfers'),true); assert.equal(isFinanceItemActive('/dashboard/finance/controls','/dashboard/accounting/controls'),true); assert.equal(isActive('/dashboard/client-portal','/dashboard/client'),true); assert.equal(isActive('/dashboard/projects','/dashboard'),false);
});
withShell('Client-only context retains client navigation, redirect and profile exception', h => {
  h.setTenant({...owner,is_owner:false,primary_relationship:'client',relationships:['client'],permissions:[]}); const tree=h.render({children:'Synthetic content'}); h.effects[2](); assert.deepEqual(h.navigation,['/dashboard/client']);
  assert.deepEqual(h.all(tree,'Navigation')[0].props.items.map(n=>n.href),h.helpers.clientNavigation.map(n=>n.href));
  h.navigation.length=0;h.setPath('/dashboard/profile');h.render();h.effects[2]();assert.deepEqual(h.navigation,[]);
});
withShell('Employee landing and permission-filtered mobile links retain original destinations', h => {
  h.setTenant({...owner,is_owner:false,primary_relationship:'employee',relationships:['employee'],permissions:['projects.work']}); const tree=h.render(); h.effects[2](); assert.deepEqual(h.navigation,['/dashboard/employee']);
  const mobile=h.all(tree,'MobileBottomNavigation')[0]; assert.deepEqual(mobile.props.items.map(n=>n.href),['/dashboard/employee','/dashboard/my-work','/dashboard/projects']);
});
withShell('Owner with client relationship keeps portal shortcut and four primary mobile destinations', h => {
  h.setTenant({...owner,relationships:['owner','client']}); const tree=h.render(); assert.equal(h.all(tree,'Navigation')[0].props.items[1].href,'/dashboard/client');
  const mobile=h.all(tree,'MobileBottomNavigation')[0];assert.deepEqual(mobile.props.items.map(n=>n.href),['/dashboard','/dashboard/my-work','/dashboard/clients','/dashboard/accounting']);
});
withShell('Print pages continue to bypass dashboard navigation', h => { h.setPath('/dashboard/accounting/invoices/synthetic/print');const tree=h.render({children:'Synthetic print only'});assert.equal(tree.props.children,'Synthetic print only');assert.equal(h.all(tree,'Navigation').length,0); });
withShell('Mobile drawer open, path-change close and body scroll restoration remain functional', h => {
  let tree=h.render();h.all(tree,'MobileBottomNavigation')[0].props.onOpenDrawer();assert.equal(h.state('mobileOpen'),true);tree=h.render();
  // The approved focus lifecycle now requires the actual mounted dialog ref.
  // Detailed focus/Tab/Escape behavior is exercised in shared-navigation-hardening.
  const previous={HTMLElement:global.HTMLElement,window:global.window};
  class FixtureElement { querySelectorAll(){return [];} focus(){} }
  try {
    global.HTMLElement=FixtureElement;global.window={matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
    h.all(tree,'aside').find(node=>node.props.role==='dialog').props.ref.current=new FixtureElement();
    const restore=h.effects[1]();assert.equal(global.document.body.style.overflow,'hidden');restore();assert.equal(global.document.body.style.overflow,'auto');h.effects[0]();assert.equal(h.state('mobileOpen'),false);
  } finally { Object.assign(global,previous); }
});
withShell('Logout retains its POST endpoint and login refresh without a real session', async h => {
  const tree=h.render(); const button=h.all(tree,'button').find(n=>strings(n).includes('Sign out'));button.props.onClick();await settle();assert.deepEqual(h.requests,[{url:'/api/auth/logout',options:{method:'POST'}}]);assert.deepEqual(h.navigation,['/login','refresh']);
});

function withComponent(file, exported, names, title, check) {
  test(title, async () => { const h = harness(file, exported, names); try { await check(h); } finally { h.cleanup(); } });
}
withComponent('src/app/dashboard/page.tsx','CurrencyChips',['CurrencyChips'],'Currency labels preserve nonzero values, reporting-currency order and negative balances without summation',h=>{
  const values=[{currency:'USD',amount:'21.25'},{currency:'BDT',amount:'-10.5'},{currency:'EUR',amount:'0'},{currency:'GBP',amount:'42'}];
  const tree=h.render({values,reportingCurrency:'BDT'});
  assert.deepEqual(h.all(tree,'span').map(n=>strings(n.props.children)),['BDT -10.50','GBP 42.00','USD 21.25']);
  assert.deepEqual(values.map(n=>n.amount),['21.25','-10.5','0','42']);
});
withComponent('src/components/dashboard-shell.tsx', 'Navigation', shellHelpers, 'Navigation filters every visible staff link by existing permissions', h => {
  const tree = h.render({ pathname: '/dashboard/projects', items: h.helpers.staffNavigation, permissions: ['projects.work'] });
  const links = h.all(tree,'a'); assert.deepEqual(links.map(n=>n.props.href),['/dashboard/my-work','/dashboard/notifications','/dashboard/projects']);
  assert.equal(links.find(n=>n.props.href==='/dashboard/projects').props['aria-current'],'page');
});
withComponent('src/components/dashboard-shell.tsx', 'Navigation', shellHelpers, 'Finance expansion preserves permission-filtered destinations and prefetch behavior', h => {
  const props = { pathname:'/dashboard/accounting/accounts',items:h.helpers.staffNavigation,permissions:['capital.view'] };
  let tree=h.render(props);const child=h.all(tree,'a').find(n=>n.props.href==='/dashboard/capital');assert.ok(child);
  child.props.onMouseEnter();child.props.onFocus();assert.deepEqual(h.prefetches,['/dashboard/capital','/dashboard/capital']);
  assert.equal(h.all(tree,'a').some(n=>n.props.href==='/dashboard/accounting/accounts'),false);
  const disclosure=h.all(tree,'button').find(n=>n.props['aria-expanded']===true);assert.ok(disclosure);disclosure.props.onClick();tree=h.render(props);
  assert.equal(h.all(tree,'a').some(n=>n.props.href==='/dashboard/capital'),false);
});
withComponent('src/components/dashboard-shell.tsx', 'MobileBottomNavigation', shellHelpers, 'Mobile navigation exposes current page and More disclosure without changing route', h => {
  let opened=false;const tree=h.render({pathname:'/dashboard/client/projects',items:h.helpers.clientNavigation.slice(0,4),drawerOpen:false,onOpenDrawer:()=>{opened=true;}});
  assert.equal(h.all(tree,'a').find(n=>n.props.href==='/dashboard/client/projects').props['aria-current'],'page');
  const more=h.all(tree,'button').find(n=>n.props['aria-label']==='Open app drawer');assert.equal(more.props['aria-expanded'],false);more.props.onClick();assert.equal(opened,true);assert.deepEqual(h.navigation,[]);
});
withComponent('src/components/dashboard/financial-insights.tsx','FinancialPerformanceCard',[], 'Financial card retains every monetary field and does not recalculate amounts', h => {
  const row={...financial('BDT'),'platform_fees':'4.00','transfer_fees':'2.00','net_profit':'-12.50'};
  const calls=[];const tree=h.render({row,reportingCurrency:'BDT',formatMoney:(value,currency)=>{calls.push([value,currency]);return currency+' '+value;}});
  for(const key of ['invoiced_revenue','direct_income','collected_revenue','receivables','expenses','net_profit','platform_fees','transfer_fees'])assert.ok(calls.some(([v,c])=>v===row[key]&&c===row.currency),key);
  assert.match(strings(tree),/Operational margin/);assert.match(strings(tree),/BDT -12.50/);assert.match(strings(tree),/Reporting currency/);
});
withComponent('src/components/dashboard/financial-insights.tsx','FinancialPerformanceCard',[], 'Zero fees remain omitted and foreign currency is not labeled reporting currency', h => {
  const tree=h.render({row:financial('USD'),reportingCurrency:'BDT',formatMoney:(v,c)=>c+' '+v});const text=strings(tree);assert.doesNotMatch(text,/Platform fees/);assert.doesNotMatch(text,/Transfer fees/);assert.doesNotMatch(text,/Reporting currency/);
});
withComponent('src/components/dashboard/financial-insights.tsx','FinancialPerformanceCard',[], 'Distinct server monetary fields survive the ledger recomposition without conversion or recalculation', h => {
  const row={currency:'EUR',invoiced_revenue:'101.01',direct_income:'202.02',collected_revenue:'303.03',receivables:'404.04',expenses:'505.05',platform_fees:'6.06',transfer_fees:'7.07',net_profit:'-808.08'};
  const calls=[];
  h.render({row,reportingCurrency:'BDT',formatMoney:(amount,currency)=>{calls.push([amount,currency]);return currency+' '+amount;}});
  assert.deepEqual(calls.map(([amount,currency])=>currency+':'+amount).sort(),Object.entries(row).filter(([key])=>key!=='currency').map(([,amount])=>'EUR:'+amount).sort());
});
withComponent('src/components/dashboard/financial-insights.tsx','CurrencyTrendCard',['positiveAmount'], 'Trend normalization excludes non-finite and negative values without changing server values', h => {
  for(const [value,expected] of [['-9',0],['not-a-number',0],['Infinity',0],['0',0],['25.50',25.5]]) assert.equal(h.helpers.positiveAmount(value),expected);
  const rows=[{...financial('USD'),period:'2026-10',collected_revenue:'0',net_profit:'-19.25'}];
  const tree=h.render({currency:'USD',reportingCurrency:'USD',rows,formatMoney:(v,c)=>c+' '+v,formatPeriod:p=>p});
  assert.match(strings(tree),/USD -19.25/);
  assert.equal(rows[0].collected_revenue,'0');
  assert.equal(rows[0].net_profit,'-19.25');
});
withComponent('src/components/dashboard/financial-insights.tsx','CurrencyTrendCard',[], 'Trend bars preserve positive-only within-currency scaling and exact-value table', h => {
  const rows=[{...financial('USD'),period:'2026-09',collected_revenue:'50'},{...financial('USD'),period:'2026-10',collected_revenue:'100'},{...financial('USD'),period:'2026-11',collected_revenue:'-20'}];
  const tree=h.render({currency:'USD',reportingCurrency:'BDT',rows,formatMoney:(v,c)=>c+' '+v,formatPeriod:p=>p});
  const bars=h.all(tree,'div').filter(n=>n.props.style?.height);assert.deepEqual(bars.map(n=>n.props.style.height),['50%','100%','0%']);
  assert.equal(h.all(tree,'tbody')[0].props.children.length,3);assert.match(strings(tree),/USD -20/);assert.match(strings(tree),/within\s+USD\s+only/);
});
withComponent('src/components/dashboard/financial-insights.tsx','CurrencyTrendCard',[], 'Exact trend data remains available in a native disclosure with a keyboard-focusable scroll region', h => {
  const row={...financial('USD'),period:'2026-10',invoiced_revenue:'111.11',collected_revenue:'222.22',net_profit:'-33.33'};
  const tree=h.render({currency:'USD',reportingCurrency:'BDT',rows:[row],formatMoney:(v,c)=>c+' '+v,formatPeriod:p=>p});
  const disclosure=h.all(tree,'details')[0]; assert.ok(disclosure);
  assert.equal(disclosure.props.open,undefined);
  assert.equal(h.all(disclosure,'summary').length,1);
  assert.equal(h.all(disclosure,'table').length,1);
  const region=h.all(disclosure,'div').find(n=>n.props.role==='region');
  assert.equal(region.props.tabIndex,0); assert.match(region.props['aria-label'],/USD/);
  assert.equal(h.all(disclosure,'caption').length,1);
  assert.deepEqual(h.all(disclosure,'th').map(n=>n.props.scope),['col','col','col','col','row']);
  assert.deepEqual(h.all(disclosure,'td').map(n=>strings(n.props.children)),['USD 111.11','USD 222.22','USD -33.33']);
});
withComponent('src/components/dashboard/financial-insights.tsx','CurrencyTrendCard',[], 'Latest-period headline uses the final existing currency row rather than a sum and disappears for empty data', h => {
  const rows=[{...financial('USD'),period:'2026-09',collected_revenue:'900.25'},{...financial('USD'),period:'2026-10',collected_revenue:'-10.50'}];
  const props={currency:'USD',reportingCurrency:'BDT',rows,formatMoney:(v,c)=>c+' '+v,formatPeriod:p=>p};
  const tree=h.render(props);
  assert.deepEqual(h.all(tree,'strong').map(n=>strings(n.props.children)),['USD -10.50']);
  assert.match(strings(tree),/Latest period/);
  const empty=h.render({...props,rows:[]});
  assert.equal(h.all(empty,'strong').length,0);
  assert.doesNotMatch(strings(empty),/Latest period/);
});
function withSwitcher(title,check){withComponent('src/components/workspace-switcher.tsx','WorkspaceSwitcher',[],title,check);}
withSwitcher('Selecting current workspace closes picker without a mutation',h=>{
  h.render();h.setState('open',true);const tree=h.render();const button=h.all(tree,'button').find(n=>strings(n).includes(organization.name)&&n.props['aria-expanded']===undefined);button.props.onClick();assert.equal(h.state('open'),false);assert.deepEqual(h.requests,[]);
});
withSwitcher('Mocked workspace switch preserves organization payload, context and client redirect',async h=>{
  const client={...owner,organization:{...organization,id:'synthetic-b',name:'Other synthetic company'},primary_relationship:'client',relationships:['client'],is_owner:false};h.setWorkspaces([owner,client]);h.render();h.setState('open',true);h.setResponse(()=>success(client));const button=h.all(h.render(),'button').find(n=>strings(n).includes('Other synthetic company'));button.props.onClick();await settle();
  assert.equal(h.requests[0].url,'/api/tenant');assert.equal(h.requests[0].options.method,'POST');assert.deepEqual(JSON.parse(h.requests[0].options.body),{organization_id:'synthetic-b'});assert.equal(h.getTenant().organization.id,'synthetic-b');assert.deepEqual(h.navigation,['/dashboard/client-portal','refresh']);assert.equal(h.state('switchingId'),null);
});
withSwitcher('Failed mocked workspace switch preserves current tenant and displays server error',async h=>{
  const other={...owner,organization:{...organization,id:'synthetic-b',name:'Other synthetic company'}};h.setWorkspaces([owner,other]);h.render();h.setState('open',true);h.setResponse(()=>failure(403,'Synthetic workspace denied'));h.all(h.render(),'button').find(n=>strings(n).includes('Other synthetic company')).props.onClick();await settle();
  assert.equal(h.getTenant().organization.id,'synthetic-a');assert.equal(h.state('error'),'Synthetic workspace denied');assert.equal(h.state('switchingId'),null);assert.deepEqual(h.navigation,[]);
});
withShell('Canceled imperative exit blocks logout before POST or login redirect',async h=>{h.setWorkspaceExitAllowed(false);const tree=h.render();h.all(tree,'button').find(n=>strings(n).includes('Sign out')).props.onClick();await settle();assert.equal(h.workspaceExitChecks(),1);assert.deepEqual(h.requests,[]);assert.deepEqual(h.navigation,[]);});
withSwitcher('Canceled imperative exit blocks tenant POST before picker or tenant state changes',async h=>{const other={...owner,organization:{...organization,id:'synthetic-b',name:'Other synthetic company'}};h.setWorkspaces([owner,other]);h.setWorkspaceExitAllowed(false);h.render();h.setState('open',true);h.all(h.render(),'button').find(n=>strings(n).includes('Other synthetic company')).props.onClick();await settle();assert.equal(h.workspaceExitChecks(),1);assert.equal(h.state('open'),true);assert.equal(h.state('switchingId'),null);assert.equal(h.getTenant().organization.id,'synthetic-a');assert.deepEqual(h.requests,[]);assert.deepEqual(h.navigation,[]);});
withSwitcher('Selecting the already-active tenant is not an exit and never prompts',h=>{h.setWorkspaceExitAllowed(false);h.render();h.setState('open',true);h.all(h.render(),'button').find(n=>strings(n).includes(organization.name)&&n.props['aria-expanded']===undefined).props.onClick();assert.equal(h.workspaceExitChecks(),0);assert.equal(h.state('open'),false);assert.deepEqual(h.requests,[]);});
withSwitcher('Canceled Create company workspace keeps picker open and never navigates',h=>{h.setWorkspaceExitAllowed(false);h.render();h.setState('open',true);h.all(h.render(),'button').find(n=>strings(n).includes('Create company workspace')).props.onClick();assert.equal(h.workspaceExitChecks(),1);assert.equal(h.state('open'),true);assert.deepEqual(h.navigation,[]);assert.deepEqual(h.nativeNavigation,[]);assert.deepEqual(h.requests,[]);});
withSwitcher('Accepted Create company workspace retains its onboarding route without a mutation',h=>{h.render();h.setState('open',true);h.all(h.render(),'button').find(n=>strings(n).includes('Create company workspace')).props.onClick();assert.equal(h.workspaceExitChecks(),1);assert.equal(h.state('open'),false);assert.deepEqual(h.navigation,[]);assert.deepEqual(h.nativeNavigation,[['assign','/onboarding?new=1']]);assert.deepEqual(h.requests,[]);});

withDashboard('Initial network/server errors show recoverable dashboard error, never a false permission message', async h => {
  for (const response of [() => failure(500), () => { throw new Error('Synthetic offline'); }]) {
    h.setResponse(response); h.render(); h.effects[0](); await settle();
    const tree=h.render(); assert.match(strings(tree),/Dashboard unavailable/);
    assert.doesNotMatch(strings(tree),/financial reporting is restricted/);
    const retry=h.all(tree,'button').find(n=>strings(n).includes('Retry dashboard'));
    assert.ok(retry); retry.props.onClick(); assert.ok(h.state('reportRetry') > 0);
    h.setResponse(()=>success(overview)); h.render(); h.effects[0](); await settle();
    assert.equal(h.all(h.render(),'MetricCard').length,4); assert.equal(h.state('error'),null);
  }
});
withDashboard('Tenant reload clears the prior report and period, including a new restricted tenant', async h => {
  ready(h); h.setState('preset','last_month');
  h.setTenant({...owner,organization:{...organization,id:'synthetic-b'}});
  h.setResponse(()=>failure(403)); h.render(); h.effects[0](); await settle();
  assert.equal(h.state('reportResult'),null); assert.equal(h.state('preset'),'month');
  const tree=h.render(); assert.equal(h.all(tree,'MetricCard').length,0);
  assert.match(strings(tree),/financial reporting is restricted/); assert.doesNotMatch(strings(tree),/Loading dashboard/);
});
withDashboard('Late old-tenant preset response cannot replace a new tenant or its period', async h => {
  let finishOld; const oldTree=ready(h);
  h.setResponse(()=>new Promise(resolve=>{finishOld=resolve;}));
  periodSelect(h,oldTree).props.onChange({target:{value:'year'}});
  h.setTenant({...owner,organization:{...organization,id:'synthetic-b'}});
  assert.equal(h.all(h.render(),'MetricCard').length,0);
  const newReport={...overview,operations:{...overview.operations,active_clients:99}};
  h.setResponse(()=>success(newReport)); h.effects[0](); await settle();
  finishOld(success({...overview,date_from:'2026-01-01'})); await settle();
  assert.equal(h.state('reportResult').organizationId,'synthetic-b');
  assert.equal(h.state('reportResult').value.operations.active_clients,99);
  assert.equal(h.state('preset'),'month'); assert.equal(h.state('reportLoading'),false);
});
withDashboard('Unmount invalidates pending preset success and stale unauthenticated redirects', async h => {
  for(const result of [success({...overview,date_from:'2026-01-01'}),failure(401)]) {
    h.setResponse(()=>success(overview)); h.render(); const cleanup=h.effects[0](); await settle();
    let finish; const tree=h.render(); h.setResponse(()=>new Promise(resolve=>{finish=resolve;}));
    periodSelect(h,tree).props.onChange({target:{value:'year'}}); cleanup(); finish(result); await settle();
    assert.equal(h.state('reportResult').value.date_from,'2026-10-01');
    assert.equal(h.state('preset'),'month'); assert.deepEqual(h.navigation,[]);
  }
});
withDashboard('Shared range admission blocks duplicate pending requests and permits a new range after completion', async h => {
  const finish=[]; const tree=ready(h); h.setResponse(()=>new Promise(resolve=>finish.push(resolve)));
  periodSelect(h,tree).props.onChange({target:{value:'year'}});
  periodSelect(h,tree).props.onChange({target:{value:'last_month'}});
  assert.equal(h.requests.length,1); assert.equal(finish.length,1);
  finish[0](failure(500)); await settle(); assert.equal(h.state('reportLoading'),false);
  periodSelect(h,h.render()).props.onChange({target:{value:'last_month'}});
  assert.equal(h.requests.length,2);
  finish[1](success({...overview,date_from:'2026-09-01',date_to:'2026-09-30'})); await settle();
  assert.equal(h.state('preset'),'last_month'); assert.equal(h.state('reportResult').value.date_from,'2026-09-01');
  assert.equal(h.state('reportLoading'),false);
});
withDashboard('Details retry remains read-only and preserves primary dashboard metrics', async h => {
  ready(h); h.setState('detailsError',true); const panels=h.all(h.render(),'DetailUnavailable');
  assert.equal(panels.length,3); panels[0].props.onRetry(); assert.equal(h.state('detailsRetry'),1);
  h.setResponse(()=>success({accounts:[],projects:[],clients:[]})); h.render(); h.effects[2](); await settle();
  assert.equal(h.state('detailsError'),false); assert.equal(h.all(h.render(),'MetricCard').length,4);
  assert.match(h.requests[0].url,/^\/api\/reports\/dashboard-details\?/); assert.equal(h.requests[0].options.method,undefined);
});

withDashboard('A current preset 403 removes previously visible report data instead of presenting stale metrics', async h => {
  const tree=ready(h); h.setResponse(()=>failure(403));
  periodSelect(h,tree).props.onChange({target:{value:'year'}}); await settle();
  assert.equal(h.state('reportResult'),null); assert.equal(h.state('error'),null);
  assert.equal(h.all(h.render(),'MetricCard').length,0);
  assert.match(strings(h.render()),/financial reporting is restricted/);
});

withDashboard('Current details 403 clears reporting data and invalidates an in-flight period response', async h => {
  const tree=ready(h); let finish;
  h.setResponse(()=>new Promise(resolve=>{finish=resolve;}));
  periodSelect(h,tree).props.onChange({target:{value:'year'}});
  h.setResponse(()=>failure(403)); h.effects[2](); await settle();
  finish(success({...overview,date_from:'2026-01-01'})); await settle();
  assert.equal(h.state('reportResult'),null); assert.equal(h.state('error'),null);
  assert.equal(h.state('reportLoading'),false); assert.equal(h.all(h.render(),'MetricCard').length,0);
  assert.match(strings(h.render()),/financial reporting is restricted/);
});
withDashboard('Aborted old details 403 cannot clear a different active tenant report', async h => {
  ready(h); let finish; h.setResponse(()=>new Promise(resolve=>{finish=resolve;}));
  const cancel=h.effects[2](); cancel();
  h.setTenant({...owner,organization:{...organization,id:'synthetic-b'}});
  h.setState('reportResult',{organizationId:'synthetic-b',value:{...overview,operations:{...overview.operations,active_clients:99}}});
  finish(failure(403)); await settle();
  assert.equal(h.state('reportResult').organizationId,'synthetic-b');
  assert.equal(h.state('reportResult').value.operations.active_clients,99);
  assert.equal(h.all(h.render(),'MetricCard').length,4);
});

withDashboard('Custom inclusive dates drive report, details and chart from one committed range', async h => {
  const tree=ready(h);h.setResponse(()=>success({...overview,date_from:'2026-09-28',date_to:'2026-10-04'}));
  dateFilter(h,tree).props.onRange({from:'2026-09-28',to:'2026-10-04'});await settle();
  assert.equal(h.requests[0].url,'/api/reports/dashboard?date_from=2026-09-28&date_to=2026-10-04');
  assert.equal(h.state('preset'),'custom');const next=h.render();const chart=h.all(next,'DashboardTrendExplorer')[0];
  assert.equal(chart.props.dateFrom,'2026-09-28');assert.equal(chart.props.dateTo,'2026-10-04');
  assert.equal(dateFilter(h,next).props.from,chart.props.dateFrom);assert.equal(dateFilter(h,next).props.to,chart.props.dateTo);
  h.setResponse(()=>success({accounts:[],projects:[],clients:[]}));h.effects[2]();await settle();
  assert.equal(h.requests.at(-1).url,'/api/reports/dashboard-details?date_from=2026-09-28&date_to=2026-10-04');
  assert.equal(h.all(next,'select').some(n=>n.props['aria-label']==='Reporting period'),false);
});
for(const range of [{from:'',to:'2026-10-24'},{from:'2026-02-30',to:'2026-10-24'},{from:'2026-10-25',to:'2026-10-24'},{from:'2026-10-01',to:'2026-10-25'},{from:'2025-01-01',to:'2026-10-24'}])withDashboard(`Invalid custom range never reaches network ${JSON.stringify(range)}`,async h=>{
  dateFilter(h,ready(h)).props.onRange(range);await settle();assert.equal(h.requests.length,0);assert.ok(h.state('error'));assert.equal(h.state('reportResult').value.date_from,overview.date_from);
});
withDashboard('Wrong returned date identity cannot relabel or replace a report',async h=>{
  const tree=ready(h);h.setResponse(()=>success(overview));dateFilter(h,tree).props.onRange({from:'2026-10-23',to:'2026-10-24'});await settle();
  assert.equal(h.state('preset'),'month');assert.equal(h.state('reportResult').value.date_from,overview.date_from);assert.match(h.state('error'),/did not match/);assert.equal(h.state('reportLoading'),false);
});
for(const [preset,from,to]of[['today','2026-10-24','2026-10-24'],['week','2026-10-19','2026-10-24']])withDashboard(`${preset} shortcut applies org-local inclusive dates`,async h=>{
  const tree=ready(h);h.setResponse(()=>success({...overview,date_from:from,date_to:to}));dateFilter(h,tree).props.onPreset(preset);await settle();assert.equal(h.requests[0].url,`/api/reports/dashboard?date_from=${from}&date_to=${to}`);assert.equal(h.state('preset'),preset);
});

withDashboard('Selecting the already applied range clears an abandoned failed-range error without refetch',async h=>{
 ready(h);h.setState('error','Unable to load dashboard metrics');const tree=h.render();dateFilter(h,tree).props.onPreset('month');await settle();assert.equal(h.requests.length,0);assert.equal(h.state('error'),null);assert.equal(h.state('preset'),'month');
});

withDashboard('Initial default month response must match requested inclusive dates',async h=>{
 h.setResponse(()=>success({...overview,date_from:'2026-01-01'}));h.render();h.effects[0]();await settle();assert.equal(h.state('reportResult'),null);assert.match(h.state('error'),/did not match/);
});
for(const stage of ['initial','range','details'])for(const outcome of [401,403,500])withDashboard(`${stage} old-owner ${outcome} before passive cleanup cannot redirect or alter current state`,async h=>{
 let finish;const tree=ready(h);h.setResponse(()=>new Promise(resolve=>{finish=resolve;}));
 if(stage==='initial')h.effects[0]();else if(stage==='range')dateFilter(h,tree).props.onPreset('year');else h.effects[2]();
 h.setTenant({...owner,permissions:['dashboard.view']});h.render();const priorError=h.state('error'),priorReport=h.state('reportResult');finish(failure(outcome));await settle();assert.deepEqual(h.navigation,[]);assert.equal(h.state('error'),priorError);assert.equal(h.state('reportResult'),priorReport);
});
