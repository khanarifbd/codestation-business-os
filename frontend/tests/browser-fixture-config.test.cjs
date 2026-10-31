const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function config(baseURL) {
  const env = { ...process.env };
  delete env.E2E_BASE_URL;
  delete env.CI;
  if (baseURL !== undefined) env.E2E_BASE_URL = baseURL;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import config from './playwright.config.mjs'; console.log(JSON.stringify(config.use));"], { cwd: root, env, encoding: 'utf8' }));
}
test('API fixture requests use exact configured origin including nondefault port', () => {
  const use = config('http://localhost:3199');
  assert.equal(use.baseURL, 'http://localhost:3199');
  assert.deepEqual(use.extraHTTPHeaders, { Origin: 'http://localhost:3199' });
  assert.equal(use.ignoreHTTPSErrors, undefined);
});
test('default origin and HTTPS scheme are preserved without TLS bypass', () => {
  assert.equal(config().extraHTTPHeaders.Origin, 'http://127.0.0.1:3000');
  const use = config('https://localhost:3443');
  assert.equal(use.extraHTTPHeaders.Origin, 'https://localhost:3443');
  assert.equal(use.ignoreHTTPSErrors, undefined);
});
test('separate personal manager context inherits configured URL and Origin, not owner cookies', () => {
  const source = fs.readFileSync(path.join(root, 'e2e/qc-personal-client-portals.spec.mjs'), 'utf8');
  assert.match(source, /newContext\(\{baseURL:info\.project\.use\.baseURL,extraHTTPHeaders:info\.project\.use\.extraHTTPHeaders\}\)/);
  assert.doesNotMatch(source, /localhost:3100|storageState:/);
  assert.match(source, /BROWSER_FIXTURE is required/);
});
test('client project navigation awaits the exact real detail GET before visibility assertions', () => {
  const source = fs.readFileSync(path.join(root, 'e2e/qc-personal-client-portals.spec.mjs'), 'utf8');
  const start = source.indexOf(' const projectDetailURL=');
  const end = source.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start);
  const detail = source.slice(start, end);
  assert.match(detail, /new URL\(`\/api\/client-portal\/projects\/\$\{f\.project_id\}`,page\.url\(\)\)\.href/);
  assert.match(detail, /Promise\.all\(\[\s*page\.waitForResponse\(r=>r\.url\(\)===projectDetailURL&&r\.request\(\)\.method\(\)==='GET'\),\s*page\.getByRole\('link'\)/);
  assert.match(detail, /expect\(projectResponse\.status\(\)\)\.toBe\(200\)/);
  assert.match(detail, /await json\(projectResponse\);expect\(project\.id\)\.toBe\(f\.project_id\)/);
  for (const [title, present] of [['Public update', true], ['Private update', false]]) {
    assert.ok(detail.includes(`expect(project.milestones.some(row=>row.title==='${title}')).toBe(${present})`));
  }
  assert.ok(detail.includes('toHaveURL(url=>url.pathname===`/dashboard/client/projects/${f.project_id}`)'));
  assert.ok(detail.indexOf('await json(projectResponse)') < detail.indexOf("page.getByText('Public update'"));
  assert.ok(detail.includes("page.getByText('Public update',{exact:true})).toBeVisible()"));
  assert.ok(detail.includes("page.getByText('Private update',{exact:true})).toHaveCount(0)"));
  assert.doesNotMatch(detail, /timeout:|waitForTimeout|route\(|fulfill\(/);
});

function readConfig(ci = false) {
  const env = { ...process.env, CI: String(ci) };
  delete env.E2E_BASE_URL;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import config from './playwright.config.mjs'; console.log(JSON.stringify(config));"], { cwd: root, env, encoding: 'utf8' }));
}
function assertSessionOrdering(value, ci = false) {
  assert.equal(value.workers, 1);
  assert.equal(value.fullyParallel, false);
  assert.equal(value.timeout, 45_000);
  assert.deepEqual(value.expect, { timeout: 10_000 });
  assert.equal(value.retries, 0);
  assert.deepEqual(value.projects, [
    { name: 'session-contract', testMatch: '**/session-idle.spec.mjs' },
    { name: 'browser-journeys', testIgnore: '**/session-idle.spec.mjs', dependencies: ['session-contract'] },
  ]);
  assert.deepEqual(value.use.extraHTTPHeaders, { Origin: 'http://127.0.0.1:3000', ...(ci ? { Connection: 'close' } : {}) });
}
test('session contract runs once before shared-IP bulk traffic without changing security or budgets', () => {
  for (const ci of [false, true]) {
  const value = readConfig(ci);
  assertSessionOrdering(value, ci);
  for (const mutate of [
    c => { delete c.projects[1].dependencies; },
    c => { delete c.projects[1].testIgnore; },
    c => { c.projects[0].testMatch = '**/*.spec.mjs'; },
    c => { c.timeout = 90_000; },
    c => { c.projects[1].timeout = 90_000; },
    c => { c.use.extraHTTPHeaders['X-Forwarded-For'] = '8.8.8.8'; },
    c => { c.use.extraHTTPHeaders.Connection = 'keep-alive'; },
    c => { c.use.extraHTTPHeaders.Origin = 'http://other-origin.invalid'; },
    c => { if (ci) delete c.use.extraHTTPHeaders.Connection; else c.use.extraHTTPHeaders.Connection = 'close'; },
  ]) {
    const changed = structuredClone(value); mutate(changed);
    assert.throws(() => assertSessionOrdering(changed, ci));
  }
  }
  const session = fs.readFileSync(path.join(root, 'e2e/session-idle.spec.mjs'), 'utf8');
  assert.match(session, /expect\(heartbeat.status\(\)\).toBe\(200\)/);
  assert.doesNotMatch(session, /test\.(skip|fixme|fail)|fulfill\(|waitForTimeout/);
  assertSessionScriptGate(session);
  const auth = fs.readFileSync(path.join(root, '../backend/app/api/v1/auth.py'), 'utf8');
  assert.ok(auth.includes('enforce_auth_rate_limit(request, action="session_activity", limit=120, window_seconds=600)'));
});

const ts = require('typescript');
function declarations(source) {
  const ast = ts.createSourceFile('browser.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const cases = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'test') {
      cases.push({ name: node.arguments[0].text, body: node.arguments[1].getText(ast) });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); return cases;
}
test('portal split adds three independent cases, retaining each original privacy and financial assertion', () => {
  const source = fs.readFileSync(path.join(root, 'e2e/qc-personal-client-portals.spec.mjs'), 'utf8');
  const cases = declarations(source);
  assert.equal(cases.length, 6); // previously 3: personal, combined client, HR
  const portal = cases.filter(row => row.name.startsWith('Client portal real'));
  assert.equal(portal.length, 4);
  for (const row of portal) {
    assert.match(row.body, /const f=fixture\(\);await login\(page,f.customer_email\)/);
    assert.doesNotMatch(row.body, /test\.(skip|fixme|fail)|waitForTimeout|storageState|route\(|fulfill\(/);
  }
  const decision = portal.find(row => row.name.endsWith('quotation decision')).body;
  for (const expected of ["expect(pendingQuote.status).toBe('sent')", "expect(Number(pendingQuote.total)).toBe(100)", "expect(quotation.status).toBe('accepted')", "expect(billing.financials).toHaveLength(1)", "expect(billing.financials[0].invoice_count).toBe(1)", "expect(Number(billing.financials[0].balance_due)).toBe(100)", "page.getByText('Hidden customer',{exact:true})).toHaveCount(0)", "Decision workspace locked against repeat submission", "Review rejection"]) assert.ok(decision.includes(expected), expected);
  assert.doesNotMatch(decision, /dashboard\/client\/(invoices|orders|projects)/);
  for (const row of portal.filter(row => !row.name.endsWith('quotation decision'))) {
    assert.doesNotMatch(row.body, /Confirm acceptance|Review rejection|request\.(post|put|patch|delete)\(/);
  }
  const invoice = portal.find(row => row.name.includes('invoice suppression')).body;
  assert.ok(invoice.includes("['INV-DRAFT','INV-CANCELLED','INV-OTHER']"));
  assert.ok(invoice.includes("name:'View document'"));
  assert.ok(portal.find(row => row.name.endsWith('order visibility')).body.includes("page.getByText('O-EXP'"));
  const files = fs.readdirSync(path.join(root, 'e2e')).filter(file => file.endsWith('.spec.mjs'));
  // 49 declarations plus the existing two-entry leads/clients parameterization = 50 executions.
  // Before this split there were 46 declarations / 47 executions; none are excluded.
  const existingFiles = files.filter(file => !['neutral-workspace-theme.spec.mjs', 'administration-workspace.spec.mjs', 'dashboard-final-revision.spec.mjs', 'clients-final-revision.spec.mjs', 'orders-final-revision.spec.mjs', 'finance-compatibility.spec.mjs'].includes(file));
  assert.equal(existingFiles.reduce((count, file) => count + declarations(fs.readFileSync(path.join(root, 'e2e', file), 'utf8')).length, 0), 49);
  assert.equal(declarations(fs.readFileSync(path.join(root, 'e2e/neutral-workspace-theme.spec.mjs'), 'utf8')).length, 5);
  assert.equal(declarations(fs.readFileSync(path.join(root, 'e2e/administration-workspace.spec.mjs'), 'utf8')).length, 1);
  assert.equal(declarations(fs.readFileSync(path.join(root, 'e2e/dashboard-final-revision.spec.mjs'), 'utf8')).length, 1);
  assert.equal(declarations(fs.readFileSync(path.join(root, 'e2e/clients-final-revision.spec.mjs'), 'utf8')).length, 1);
  assert.equal(declarations(fs.readFileSync(path.join(root, 'e2e/orders-final-revision.spec.mjs'), 'utf8')).length, 1);
  assert.equal(declarations(fs.readFileSync(path.join(root, 'e2e/finance-compatibility.spec.mjs'), 'utf8')).length, 1);
  // Prior 59 executions plus one Finance compatibility journey; all 50 originals retained (60 executions).
});

function assertDecisionBudget(source) {
  const cases = declarations(source);
  const budgeted = cases.filter(row => row.body.includes('test.setTimeout('));
  assert.equal(budgeted.length, 1);
  assert.equal(budgeted[0].name, 'Client portal real billing visibility and quotation decision');
  assert.equal((source.match(/test\.setTimeout\(/g) || []).length, 1);
  assert.ok(budgeted[0].body.includes('test.setTimeout(90_000);'));
  assert.doesNotMatch(source, /expect\.configure|test\.slow|setDefaultTimeout|setDefaultNavigationTimeout|timeout\s*:/);
}
test('only the evidenced cold billing-decision journey receives a 90s total budget', () => {
  const source = fs.readFileSync(path.join(root, 'e2e/qc-personal-client-portals.spec.mjs'), 'utf8');
  assertDecisionBudget(source);
  for (const altered of [
    source.replace('test.setTimeout(90_000);', ''),
    source.replace('test.setTimeout(90_000);', 'test.setTimeout(180_000);'),
    source.replace('test.setTimeout(90_000);', 'test.setTimeout(90_000); test.setTimeout(90_000);'),
    source.replace("test('Client portal real linked order visibility',async({page})=>{", "test('Client portal real linked order visibility',async({page})=>{ test.setTimeout(90_000);"),
    source.replace('test.setTimeout(90_000);', 'test.setTimeout(90_000); page.setDefaultTimeout(90_000);'),
  ]) assert.throws(() => assertDecisionBudget(altered));
  for (const ci of [false, true]) assertSessionOrdering(readConfig(ci), ci); // global test45s / expect10s / no retry unchanged
});

function assertSessionScriptGate(source) {
 const gate = "  const scriptGate = async route => {\n    if (route.request().resourceType() === \"script\") await released;\n    await route.continue();\n  };";
 assert.equal(source.split(gate).length - 1, 1, 'only exact script-resource hydration gate');
 assert.equal(source.split('await page.route("**/*", scriptGate);').length-1,1);
 assert.equal(source.split('await page.unroute("**/*", scriptGate);').length-1,1);
 const withoutGate=source.replace(gate,'').replace('await page.route("**/*", scriptGate);','').replace('await page.unroute("**/*", scriptGate);','');
 assert.doesNotMatch(withoutGate,/\.route\(|\.unroute\(|\.fulfill\(|\.abort\(/);
 assert.ok(source.includes('finally {\n    releaseScripts();\n  }'));
 assert.ok(source.includes('expect(loginRequests).toBe(1)'));
 assert.ok(source.includes('expect(nativeLoginQueries).toBe(0)'));
 assert.ok(source.includes('javaScriptEnabled: false'));
 assert.ok(source.includes('if (!password) throw'));
}
test('session hydration gate delays scripts only and retains exact authentication proof',()=>{
 const source=fs.readFileSync(path.join(root,'e2e/session-idle.spec.mjs'),'utf8');
 assertSessionScriptGate(source);
 for(const changed of [
  source.replace('resourceType() === "script"','resourceType() !== "script"'),
  source.replace('await route.continue()','await route.abort()'),
  source.replace('expect(loginRequests).toBe(1)','expect(loginRequests).toBe(0)'),
  source+'\npage.route("**/api/**", route => route.abort());',
 ])assert.throws(()=>assertSessionScriptGate(changed));
});
