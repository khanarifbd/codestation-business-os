const { withReviewedCanvas } = require('./helpers/reviewed-canvas.cjs');
/** Presentation-only dashboard guardrails against the verified QA baseline. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const baseline = process.env.BASELINE_FRONTEND
  ? path.resolve(process.env.BASELINE_FRONTEND)
  : path.join(__dirname, '../../test-fixtures/frontend-original');
const dashboard = 'src/app/dashboard/page.tsx';
const shell = 'src/components/dashboard-shell.tsx';
const insights = 'src/components/dashboard/financial-insights.tsx';
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
function source(dir, file) { return ts.createSourceFile(file, read(dir, file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function namedFunction(dir, file, name) {
  const ast = source(dir, file); let result;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(result, `${name} exists`); return { ast, node: result };
}
function hasJsx(node) { let yes = false; const visit = n => { if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) yes = true; ts.forEachChild(n, visit); }; visit(node); return yes; }
function logic(dir, file, name) {
  const { ast, node } = namedFunction(dir, file, name);
  const firstRender = node.body.statements.find(hasJsx);
  return ast.text.slice(node.body.getStart(ast) + 1, firstRender ? firstRender.getStart(ast) : node.body.end - 1);
}
// Intentional quotation dirty-exit hardening: strip exactly its one early-return
// gate for the two affected handlers, retaining every other baseline byte.
function withoutWorkspaceExitGate(value, required) {
  if (!required) return value;
  const gate = '    if (!requestWorkspaceExit()) return;\n';
  assert.equal(value.split(gate).length - 1, 1, 'exactly one added preflight gate');
  return value.replace(gate, '');
}
// Approved shared-navigation hardening replaces only the modal lifecycle and adds
// its element ref. All other pre-render business/permission/routing bytes stay exact.
function withoutDrawerFocusLifecycle(value) {
  const ref = '  const drawerRef = useRef<HTMLElement>(null);\n';
  assert.equal(value.split(ref).length - 1, 1);
  value = value.replace(ref, '');
  const start = value.indexOf('  useEffect(() => {\n    if (!mobileOpen || !drawerRef.current) return;');
  assert.ok(start >= 0);
  const end = value.indexOf('  }, [mobileOpen]);', start) + '  }, [mobileOpen]);'.length;
  assert.ok(end > start);
  const original = logic(baseline, shell, 'DashboardShell');
  const oldStart = original.indexOf('  useEffect(() => {\n    if (!mobileOpen) return;');
  const oldEnd = original.indexOf('  }, [mobileOpen]);', oldStart) + '  }, [mobileOpen]);'.length;
  assert.ok(oldStart >= 0 && oldEnd > oldStart);
  return value.slice(0, start) + original.slice(oldStart, oldEnd) + value.slice(end);
}
// Controls v29 deliberately maps the retained Auto Post alias to Controls.
// Remove only that exact reviewed addition before comparing the complete helper.
function withoutControlsAutoPostAlias(value, required) {
  if (!required) return value;
  const alias = ' || pathname.startsWith("/dashboard/finance/auto-post")';
  assert.equal(value.split(alias).length - 1, 1, 'exactly one approved Auto Post alias');
  return value.replace(alias, '');
}
for (const [file, name] of [[dashboard, 'DashboardPage'], [shell, 'DashboardShell'], [shell, 'Navigation'], ['src/components/workspace-switcher.tsx', 'WorkspaceSwitcher'], [insights, 'FinancialPerformanceCard'], [insights, 'CurrencyTrendCard']]) {
  test(`${name}: pre-render hooks, state, requests and derived data remain byte-identical`, () => assert.equal(withoutWorkspaceExitGate(name === 'DashboardShell' ? withoutDrawerFocusLifecycle(logic(root, file, name)) : logic(root, file, name), ['DashboardShell','WorkspaceSwitcher'].includes(name)), logic(baseline, file, name)));
}
for (const [file, names] of [[dashboard, ['iso', 'presetRange', 'money', 'percent', 'periodLabel', 'changePreset']], [shell, ['hasAnyPermission', 'isEmployeeSelfServiceContext', 'isFinanceArea', 'isActive', 'isFinanceItemActive', 'profileInitials', 'logout']], [insights, ['positiveAmount']], ['src/components/workspace-switcher.tsx', ['relationshipLabel', 'switchWorkspace']]]) {
  for (const name of names) test(`${name}: original calculation, routing or mutation contract unchanged`, () => {
    const a = namedFunction(root, file, name), b = namedFunction(baseline, file, name);
    assert.equal(withoutControlsAutoPostAlias(withoutWorkspaceExitGate(a.node.getText(a.ast), ['logout','switchWorkspace'].includes(name)), name === 'isFinanceItemActive'), b.node.getText(b.ast));
  });
}
for (const name of ['staffNavigation', 'employeeNavigation', 'clientNavigation', 'financeNavigation', 'clientPortalItem', 'employeeExpandedWorkspacePermissions']) {
  test(`${name}: destinations and required permissions unchanged`, () => {
    function declaration(dir) { const ast = source(dir, shell); let value; const visit = n => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) value = n.initializer.getText(ast); ts.forEachChild(n, visit); }; visit(ast); assert.ok(value); return value; }
    assert.equal(declaration(root), declaration(baseline));
  });
}
test('Dashboard loading, missing workspace and restricted-report guards retain their conditions', () => {
  function guards(dir) { const { ast, node } = namedFunction(dir, dashboard, 'DashboardPage'); return node.body.statements.filter(ts.isIfStatement).map(n => n.expression.getText(ast)); }
  assert.deepEqual(guards(root), guards(baseline));
});
test('Four rail metrics retain baseline values/routes and two operational alerts move into the attention queue', () => {
  function metrics(dir,tag) { const ast = source(dir, dashboard), result = []; const visit = n => { if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === tag) { const attrs = Object.fromEntries(n.attributes.properties.filter(ts.isJsxAttribute).filter(a => ['label','value','href','attention'].includes(a.name.text)).map(a => [a.name.text, a.initializer?.getText(ast) ?? true])); result.push(attrs); } ts.forEachChild(n, visit); }; visit(ast); return result; }
  const original=metrics(baseline,'MetricCard'), rail=metrics(root,'MetricCard'), queue=metrics(root,'AlertRow');
  assert.equal(rail.length,4); assert.deepEqual(rail,original.slice(0,4));
  for(const metric of original.slice(4)) {
    const moved=queue.filter(item=>item.value===metric.value);
    assert.equal(moved.length,1); assert.equal(moved[0].href,metric.href);
  }
  assert.equal(queue.find(item=>item.value==='{data.operations.overdue_tasks}').label,'"Overdue tasks"');
  assert.equal(queue.find(item=>item.value==='{data.operations.due_followups}').label,'"Due CRM follow-ups"');
});
test('Reporting select retains all four presets, disabled pending state and same handler', () => {
  const code = read(root, dashboard);
  for (const fragment of ['aria-label="Reporting period"', 'value={preset}', 'disabled={reportLoading}', 'changePreset(event.target.value as Preset)', 'value="month"', 'value="last_month"', 'value="quarter"', 'value="year"']) assert.ok(code.includes(fragment), fragment);
});
test('Currency values remain grouped, sorted and passed to existing financial components', () => {
  const code = read(root, dashboard);
  for (const fragment of ['row={row}', 'currency={group.currency}', 'rows={group.rows}', 'reportingCurrency={company.currency}', 'formatMoney={money}', 'formatPeriod={periodLabel}', 'currency: row.currency, amount: row.weighted_amount']) assert.ok(code.includes(fragment), fragment);
  assert.equal(logic(root, dashboard, 'CurrencyChips'), logic(baseline, dashboard, 'CurrencyChips'));
});
function normalizeNativeBootstrapEntry(value) {
 const native='window.location.replace("/onboarding")';
 assert.equal(value.split(native).length-1,1,'exactly one approved native bootstrap onboarding entry');
 assert.ok(!value.includes('router.replace("/onboarding")'),'old SPA onboarding entry must not remain');
 return value.replace(native,'router.replace("/onboarding")');
}
test('Operational reporting and session/tenant enforcement retain exact bytes except native onboarding entry and reviewed guard canvas', () => {
  for (const file of ['src/components/dashboard/operational-reporting-note.tsx', 'src/components/dashboard-session-context.tsx', 'src/components/tenant-area-guard.tsx', 'src/app/dashboard/layout.tsx']) assert.equal(file==='src/components/dashboard-session-context.tsx'?normalizeNativeBootstrapEntry(read(root,file)):read(root,file), withReviewedCanvas(file, read(baseline, file)), file);
});
test('Bootstrap native-entry adapter rejects SPA, duplicate and wrong target and does not hide other enforcement changes',()=>{
 const actual=read(root,'src/components/dashboard-session-context.tsx');
 for(const bad of [actual.replace('window.location.replace("/onboarding")','router.replace("/onboarding")'),actual.replace('window.location.replace("/onboarding")','window.location.assign("/onboarding")'),actual.replace('window.location.replace("/onboarding")','window.location.replace("/onboarding?new=1")'),actual.replace('window.location.replace("/onboarding")','window.location.replace("/onboarding"); window.location.replace("/onboarding")')])assert.throws(()=>normalizeNativeBootstrapEntry(bad));
 assert.notEqual(normalizeNativeBootstrapEntry(actual.replace('response.status === 401','response.status === 403')),read(baseline,'src/components/dashboard-session-context.tsx'));
});
test('Dashboard report, pulse and bootstrap API implementations are unchanged', () => {
  for (const file of ['src/app/api/reports/[[...path]]/route.ts', 'src/app/api/dashboard-pulse/[...path]/route.ts', 'src/app/api/dashboard-bootstrap/route.ts', 'src/app/api/tenant/route.ts']) {
    assert.equal(read(root, file), read(baseline, file), file);
  }
});

test('Operational calculation caveat remains visible and its exact explanation remains available once per section', () => {
  const code = read(root, dashboard);
  assert.ok(code.includes('Operational margin is not accrual net profit.'));
  assert.ok(code.includes('How these figures are calculated'));
  assert.equal((code.match(/<OperationalReportingNote \/>/g) ?? []).length, 1);
  assert.ok(code.includes('<details'));
});
test('Mobile composition explicitly promotes priority work and keeps every section in the responsive flow', () => {
  const code=read(root,'src/components/dashboard/dashboard-composition.css');
  const marker=/@media\s*\(max-width:\s*639px\)\s*\{/.exec(code);
  assert.ok(marker,'dedicated narrow-screen composition');
  let depth=1,end=marker.index+marker[0].length;
  for(;end<code.length&&depth;end++){if(code[end]==='{')depth++;else if(code[end]==='}')depth--;}
  const mobile=code.slice(marker.index+marker[0].length,end-1);
  for(const [section,order] of [['priority-work',1],['trend-focus',2],['financials',3],['operations-rail',4],['context-actions',5],['secondary-pulse',6],['economics-grid',7],['client-economics',8]]) {
    assert.match(mobile,new RegExp('\\.dashboard-'+section+'\\s*\\{[^}]*order:\\s*'+order+'\\s*;'),section);
  }
  assert.match(mobile,/\.dashboard-decision-grid\s*,\s*\.dashboard-attention-column\s*\{\s*display:\s*contents/);
  assert.ok(read(root,dashboard).includes('import "@/components/dashboard/dashboard-composition.css";'));
});
test('Imperative logout and tenant switch check permission to leave before any mutation or pending state',()=>{
 for(const[file,name,index]of [[shell,'logout',0],['src/components/workspace-switcher.tsx','switchWorkspace',1]]){
  const {ast,node}=namedFunction(root,file,name);assert.equal(node.body.statements[index].getText(ast),'if (!requestWorkspaceExit()) return;');
 }
});
function createCompanyHandler(dir) {
 const ast=source(dir,'src/components/workspace-switcher.tsx');let result;const visit=n=>{if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='onClick'&&n.getText(ast).includes('/onboarding?new=1'))result=n.getText(ast);ts.forEachChild(n,visit);};visit(ast);assert.ok(result);return result;
}
function normalizeNativeCompanyEntry(value) {
 const native='window.location.assign("/onboarding?new=1")';
 assert.equal(value.split(native).length-1,1,'exactly one approved native onboarding entry');
 assert.ok(!value.includes('router.push("/onboarding?new=1")'),'SPA onboarding entry must not remain');
 return value.replace(native,'router.push("/onboarding?new=1")');
}
test('Create company workspace preserves its entire callback after explicit exit gate and native-entry substitution',()=>{
 const gate='if (!requestWorkspaceExit()) return; ';const actual=createCompanyHandler(root);assert.equal(actual.split(gate).length-1,1);assert.equal(normalizeNativeCompanyEntry(actual.replace(gate,'')),createCompanyHandler(baseline));assert.ok(actual.indexOf(gate)<actual.indexOf('setOpen(false)'));
});
test('Native company-entry compatibility rejects old SPA, duplicate, wrong-target and collateral callback changes',()=>{
 const gate='if (!requestWorkspaceExit()) return; ';const actual=createCompanyHandler(root).replace(gate,'');
 for(const bad of [actual.replace('window.location.assign','router.push'),actual.replace('window.location.assign','window.location.replace'),actual.replace('?new=1','?new=2'),actual.replace('window.location.assign("/onboarding?new=1")','window.location.assign("/onboarding?new=1"); window.location.assign("/onboarding?new=1")')])assert.throws(()=>normalizeNativeCompanyEntry(bad));
 assert.notEqual(normalizeNativeCompanyEntry(actual.replace('setOpen(false)','setOpen(true)')),createCompanyHandler(baseline));
});


test('Controls retains Auto Post alias activation without activating other finance items', () => {
  const { ast, node } = namedFunction(root, shell, 'isFinanceItemActive');
  const code = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const active = require('node:vm').runInNewContext(code + '; isFinanceItemActive');
  for (const route of ['/dashboard/finance/auto-post', '/dashboard/finance/controls', '/dashboard/accounting/controls', '/dashboard/accounting/controls/automation/synthetic-recurring-1']) {
    assert.equal(active(route, '/dashboard/accounting/controls'), true, route);
    assert.equal(active(route, '/dashboard/accounting/transfers'), false, route);
    assert.equal(active(route, '/dashboard/accounting'), false, route);
  }
  assert.equal(active('/dashboard/finance/transfers', '/dashboard/accounting/controls'), false);
  assert.equal(active('/dashboard/accounting/reports', '/dashboard/accounting/controls'), false);
});
