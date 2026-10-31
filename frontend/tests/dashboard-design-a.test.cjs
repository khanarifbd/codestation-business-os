const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const shell = read('src/components/dashboard-shell.tsx');
const page = read('src/app/dashboard/page.tsx');
const css = read('src/components/dashboard/dashboard-design-a.css');

function markerExpression(source) {
  const ast = ts.createSourceFile('shell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'className' && node.initializer && ts.isJsxExpression(node.initializer)
      && node.initializer.expression?.getText(ast).includes('"dashboard-design-a"')) matches.push(node.initializer.expression.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(matches.length, 1, 'exactly one shell marker expression');
  return matches[0];
}
function marker(source, pathname, clientOnly, employeeSelfService) {
  return vm.runInNewContext(markerExpression(source), {
    pathname, clientOnly, employeeSelfService, cn: (...values) => values.filter(Boolean).join(' '),
  }).split(/\s+/).includes('dashboard-design-a');
}
function verifyMarker(source) {
  assert.equal(marker(source, '/dashboard', false, false), true);
  for (const pathname of ['/dashboard/clients', '/dashboard/company', '/dashboard/client', '/dashboard/employee', '/dashboard/reports', '/dashboard/projects/fixture', '/dashboard/profile', '/dashboard-extra', '/dashboard/']) {
    assert.equal(marker(source, pathname, false, false), false, pathname);
  }
  for (const [clientOnly, employeeSelfService] of [[true, false], [false, true], [true, true]]) {
    assert.equal(marker(source, '/dashboard', clientOnly, employeeSelfService), false);
  }
}
test('Design A applies only at the exact tenant Dashboard, never portal or nested routes', () => verifyMarker(shell));
test('route isolation rejects prefix matching and either missing portal guard', () => {
  for (const changed of [shell.replace('pathname === "/dashboard" && !clientOnly', 'pathname.startsWith("/dashboard") && !clientOnly'), shell.replace('&& !clientOnly && !employeeSelfService && "dashboard-design-a"', '&& !employeeSelfService && "dashboard-design-a"'), shell.replace('&& !employeeSelfService && "dashboard-design-a"', '&& "dashboard-design-a"')]) assert.throws(() => verifyMarker(changed));
});

// Parse balanced rule blocks and comma-separated selectors without splitting :is().
// No dependencies, and deliberately reject unrecognized at-rules/nesting rather than
// allowing a global selector to escape review through a permissive regex.
function selectors(header) {
  const result = []; let depth = 0; let start = 0;
  for (let i = 0; i < header.length; i += 1) {
    if ('(['.includes(header[i])) depth += 1;
    if (')]'.includes(header[i])) depth -= 1;
    if (header[i] === ',' && depth === 0) { result.push(header.slice(start, i).trim()); start = i + 1; }
  }
  assert.equal(depth, 0); result.push(header.slice(start).trim()); return result;
}
function rules(source, media = '') {
  source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const result = []; let at = 0;
  while (source.slice(at).trim()) {
    const open = source.indexOf('{', at); assert.ok(open >= 0, 'expected rule block');
    const header = source.slice(at, open).trim(); let depth = 1; let end = open + 1;
    for (; end < source.length && depth; end += 1) { if (source[end] === '{') depth += 1; if (source[end] === '}') depth -= 1; }
    assert.equal(depth, 0, 'balanced CSS'); const body = source.slice(open + 1, end - 1);
    if (header.startsWith('@')) { assert.match(header, /^@media\s*\(/); result.push(...rules(body, header)); }
    else { assert.ok(!body.includes('{'), 'no nested selector escaping scope'); for (const selector of selectors(header)) result.push({ selector, body, media }); }
    at = end;
  }
  return result;
}
function verifyScope(source) {
  const parsed = rules(source); assert.ok(parsed.length > 30);
  for (const { selector, body } of parsed) {
    assert.ok(selector === ':root:not(.dark) .workspace-shell.dashboard-design-a:not(.dark):not(.dark *)' || /^\.dashboard-design-a(?:$|[\s.:>#[])/.test(selector), selector);
    assert.ok(selector.includes('.dashboard-design-a'), selector);
    assert.doesNotMatch(selector, /:has\(/, 'scope must be an actual ancestor, not global :has');
    assert.doesNotMatch(body, /!important|@import|url\(/, 'no forced global cascade or external assets');
  }
  return parsed;
}
test('every Design A selector including responsive overrides stays under the removable route marker', () => verifyScope(css));
test('scope checker rejects global selector branches, media leakage and unreviewed at-rules', () => {
  for (const changed of [css + '\nbody { color:red; }', css + '\n.dashboard-design-a .card, .ws-sidebar { width:1px; }', css + '\n@media(max-width:700px) { .ws-sidebar { width:1px; } }', css + '\n@font-face { font-family:Other; }']) assert.throws(() => verifyScope(changed));
});
function declaration(selector, property, media = '') {
  const matches = rules(css).filter(rule => rule.selector === selector && rule.media === media);
  const values = matches.flatMap(rule => [...rule.body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))].map(match => match[1].trim()));
  assert.ok(values.length, `${selector} ${property} ${media}`); return values.at(-1);
}
test('A retains individual thin-border metric cards and restrained typography', () => {
  assert.equal(declaration('.dashboard-design-a .ws-sidebar', 'width'), '224px');
  assert.equal(declaration('.dashboard-design-a .ws-context-bar', 'min-height'), '72px');
  assert.equal(declaration('.dashboard-design-a .dashboard-heading h1', 'font-size'), '27px');
  assert.equal(declaration('.dashboard-design-a .dashboard-operation-link', 'border'), '1px solid #e5e5e5');
  assert.equal(declaration('.dashboard-design-a .dashboard-operation-link', 'border-radius'), '7px');
  assert.equal(declaration('.dashboard-design-a .dashboard-operations-rail', 'gap'), '15px');
  assert.equal(declaration('.dashboard-design-a .dashboard-heading a', 'background'), '#171717');
  assert.equal(declaration('.dashboard-design-a .dashboard-heading select:focus-visible', 'outline'), 'none');
  assert.equal(declaration('.dashboard-design-a .dashboard-heading select:focus-visible', 'border-color'), '#737373');
});
test('narrow A layout restores real nested sections and two metric columns without removing navigation', () => {
  const media = '@media(max-width:700px)';
  assert.equal(declaration('.dashboard-design-a .dashboard-operations-rail', 'grid-template-columns', media), 'repeat(2,minmax(0,1fr))');
  assert.equal(declaration('.dashboard-design-a .dashboard-decision-grid', 'display', media), 'flex');
  assert.equal(declaration('.dashboard-design-a .dashboard-attention-column', 'display', media), 'flex');
  assert.equal(declaration('.dashboard-design-a .dashboard-trend-multiples', 'grid-template-columns', media), 'minmax(0,1fr)');
  assert.doesNotMatch(css, /(?:\.ws-bottom-nav|\.ws-mobile-header|\.ws-drawer)[^{]*\{[^}]*display:\s*none/);
});
test('A is an additional page-only style import; actual Dashboard data and actions remain', () => {
  const addition = 'import "@/components/dashboard/dashboard-design-a.css";';
  assert.equal(page.split(addition).length - 1, 1);
  assert.ok(page.indexOf('import "@/components/dashboard/dashboard-composition.css";') < page.indexOf(addition));
  assert.ok(!shell.includes('import "@/components/dashboard/dashboard-design-a.css"'));
  for (const fragment of ['data.operations.active_clients', 'data.operations.open_orders', 'data.operations.active_projects', 'data.operations.open_invoices', 'formatMoney={money}', 'formatPeriod={periodLabel}', 'reportingCurrency={company.currency}', 'Company timezone ·', 'aria-label="Reporting period"', 'title="Collections over time"', 'title="Recent project economics"', '<OperationalReportingNote />', 'href="/dashboard/reports"']) assert.ok(page.includes(fragment), fragment);
  assert.doesNotMatch(css, /\.dashboard-(?:financials|secondary-pulse|economics-grid|client-economics)[^{]*\{[^}]*display:\s*none/);
});

const { beforeDashboardDesignA, original, reviewed } = require('./helpers/reviewed-dashboard-design-a.cjs');
const { createHash } = require('node:crypto');
const shellFile = 'src/components/dashboard-shell.tsx';
const digest = value => createHash('sha256').update(value).digest('hex');
test('reviewed inverse restores the original existing security hash without repinning', () => {
  const pins = JSON.parse(read('evidence/portal-ui/payment-return-r1/dependency-pins.json')).files;
  assert.equal(digest(beforeDashboardDesignA(shellFile, shell)), pins[shellFile]);
  assert.equal(beforeDashboardDesignA('src/app/dashboard/page.tsx', page), page);
});
test('reviewed inverse rejects missing, duplicate, broadened-path and missing-role markers', () => {
  for (const changed of [shell.replace(reviewed, original), shell + reviewed, shell + original,
    shell.replace(reviewed, reviewed.replace('pathname === "/dashboard"', 'pathname.startsWith("/dashboard")')),
    shell.replace(reviewed, reviewed.replace(' && !clientOnly', '')),
    shell.replace(reviewed, reviewed.replace(' && !employeeSelfService', ''))]) assert.throws(() => beforeDashboardDesignA(shellFile, changed));
});
test('reviewed inverse cannot hide collateral access, navigation, logout or mobile lifecycle changes', () => {
  const pins = JSON.parse(read('evidence/portal-ui/payment-return-r1/dependency-pins.json')).files;
  for (const [before, after] of [
    ['workspaceContext?.primary_relationship === "client"', 'workspaceContext?.primary_relationship === "owner"'],
    ['router.replace(clientLanding)', 'router.replace("/dashboard")'],
    ['if (!requestWorkspaceExit()) return;', 'if (false) return;'],
    ['if (!mobileOpen || !drawerRef.current) return;', 'if (!mobileOpen) return;'],
    ['permissions: ["dashboard.view"]', 'permissions: []'],
  ]) {
    assert.ok(shell.includes(before), before);
    assert.notEqual(digest(beforeDashboardDesignA(shellFile, shell.replace(before, after))), pins[shellFile], before);
  }
});
