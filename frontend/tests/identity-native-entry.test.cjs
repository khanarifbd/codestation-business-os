/** Actual onboarding callers; router/native boundaries are distinct. No provider/network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const ok = body => ({ ok: true, status: 200, json: async () => body });
const failure = status => ({ ok: false, status, json: async () => ({ detail: 'Synthetic error' }) });
const profile = { id: 'synthetic-user', system_role: 'user', full_name: 'Synthetic user' };
const organization = { id: 'synthetic-company', name: 'Synthetic company' };
const tenant = { organization, primary_relationship: 'owner', relationships: ['owner'] };
function all(node, type, found = []) {
  if (Array.isArray(node)) node.forEach(n => all(n, type, found));
  else if (node?.props) { if (node.type === type) found.push(node); for (const n of Object.values(node.props)) if (Array.isArray(n) || n?.props) all(n, type, found); }
  return found;
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (['string', 'number'].includes(typeof node)) return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return node.props ? Object.values(node.props).filter(v => typeof v !== 'function').map(text).join(' ') : '';
}
function harness(file, exported) {
  const original = { window: global.window, document: global.document, fetch: global.fetch };
  const states = [], routerCalls = [], native = [], requests = [], effects = [], confirmations = [], cache = new Map();
  let cursor = 0, response = () => ok([]), confirmResult = true;
  const window = new EventTarget();
  window.location = { href: 'https://synthetic.invalid/dashboard', assign: href => native.push(['assign', href]), replace: href => native.push(['replace', href]) };
  window.confirm = value => { confirmations.push(value); return confirmResult; };
  global.window = window; global.document = new EventTarget();
  global.fetch = async (url, options = {}) => { requests.push({ url, options }); return response(url, options); };
  const router = { replace: href => routerCalls.push(['replace', href]), push: href => routerCalls.push(['push', href]), refresh: () => routerCalls.push(['refresh']) };
  const react = { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useRef: initial => ({ current: initial }), useEffect: fn => effects.push(fn), useCallback: fn => fn, useMemo: fn => fn(), createContext: () => ({ Provider: 'Provider' }), useContext: () => null };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const named = exported === 'default' ? 'SignupPage' : exported;
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === named);
  const stateNames = fn.body.statements.filter(ts.isVariableStatement).flatMap(n => n.declarationList.declarations).filter(n => ts.isArrayBindingPattern(n.name) && n.initializer?.getText(ast).startsWith('useState')).map(n => n.name.elements[0].name.text);
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const src = fs.readFileSync(path.join(root, relative), 'utf8');
    const mod = new Module(__filename, module); mod.filename = __filename; mod.paths = module.paths; cache.set(relative, mod);
    mod.require = id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'next/navigation') return { useRouter: () => router };
      if (id === 'next/link') return { default: 'a' };
      if (id === '@/lib/workspace-navigation') return load('src/lib/workspace-navigation.ts');
      if (id === '@/components/dashboard-session-context') return { useDashboardSession: () => ({ tenant, workspaces: [tenant], setTenant() {} }) };
      if (id.startsWith('@/components/') || id === 'lucide-react') return new Proxy({}, { get: (_value, name) => String(name) });
      throw new Error('Unexpected dependency: ' + id);
    };
    mod._compile(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, __filename);
    return mod.exports;
  }
  const component = load(file)[exported];
  const cleanups = [];
  return { native, routerCalls, requests, confirmations, render: () => { cursor = 0; effects.length = 0; return component({ children: null }); }, state: name => states[stateNames.indexOf(name)], setState: (name, value) => { const i = stateNames.indexOf(name); assert.ok(i >= 0, name); states[i] = value; }, respond: fn => { response = fn; }, guard: ({ dirty = true, busy = false, pending = false, confirm = true } = {}) => { confirmResult = confirm; effects.length = 0; load('src/hooks/use-quotation-navigation-guard.ts').useQuotationNavigationGuard(dirty, { isBusy: busy, pendingRef: { current: pending } }); for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } }, cleanup: () => { for (const fn of cleanups) fn(); Object.assign(global, original); } };
}
function caller(file, exported, name, check) { test(name, async () => { const h = harness(file, exported); try { await check(h); } finally { h.cleanup(); } }); }
const signup = (name, check) => caller('src/app/signup/page.tsx', 'default', name, check);
const session = (name, check) => caller('src/components/dashboard-session-context.tsx', 'DashboardSessionProvider', name, check);
const switcher = (name, check) => caller('src/components/workspace-switcher.tsx', 'WorkspaceSwitcher', name, check);
const google = h => all(h.render(), 'GoogleAuthSection')[0].props.onAuthenticated;
const context = h => all(h.render(), 'Provider')[0].props.value;
const create = h => { h.render(); h.setState('open', true); return all(h.render(), 'button').find(n => text(n).includes('Create company workspace')).props.onClick; };
const noWrites = h => assert.equal(h.requests.filter(r => !['GET', 'HEAD'].includes(r.options.method ?? 'GET')).length, 0);

signup('Google signup with empty discovery enters onboarding by native replace only', async h => { h.respond(() => ok([])); await google(h)(profile); assert.deepEqual(h.native, [['replace', '/onboarding']]); assert.deepEqual(h.routerCalls, []); assert.deepEqual(h.requests, [{ url: '/api/organizations', options: { cache: 'no-store' } }]); noWrites(h); });
signup('Google signup discovery rejection retains onboarding fallback but makes it native', async h => { h.respond(() => failure(503)); await google(h)(profile); assert.deepEqual(h.native, [['replace', '/onboarding']]); assert.deepEqual(h.routerCalls, []); noWrites(h); });
signup('Google signup nonempty discovery retains dashboard router replace and refresh', async h => { h.respond(() => ok([tenant])); await google(h)(profile); assert.deepEqual(h.native, []); assert.deepEqual(h.routerCalls, [['replace', '/dashboard'], ['refresh']]); noWrites(h); });
signup('Google signup super-admin keeps existing redirect without discovery or native entry', async h => { await google(h)({ ...profile, system_role: 'super_admin' }); assert.deepEqual(h.routerCalls, [['replace', '/super-admin'], ['refresh']]); assert.deepEqual(h.native, []); assert.deepEqual(h.requests, []); });
for (const kind of ['transport', 'json']) signup('Google signup preserves ' + kind + ' rejection without speculative navigation', async h => { h.respond(() => kind === 'transport' ? Promise.reject(new Error('Synthetic rejection')) : { ...ok([]), json: async () => { throw new Error('Synthetic rejection'); } }); await assert.rejects(google(h)(profile), /Synthetic rejection/); assert.deepEqual(h.routerCalls, []); assert.deepEqual(h.native, []); noWrites(h); });

session('Empty dashboard bootstrap enters onboarding by native replace only', async h => { h.respond(() => ok({ profile, workspaces: [], tenant: null })); await context(h).reload(); assert.deepEqual(h.native, [['replace', '/onboarding']]); assert.deepEqual(h.routerCalls, []); assert.equal(h.state('loading'), false); assert.deepEqual(h.requests, [{ url: '/api/dashboard-bootstrap', options: { cache: 'no-store' } }]); noWrites(h); });
session('Nonempty dashboard bootstrap retains state with no redirect or write', async h => { h.respond(() => ok({ profile, workspaces: [tenant], tenant })); await context(h).reload(); assert.deepEqual(h.native, []); assert.deepEqual(h.routerCalls, []); assert.equal(h.state('tenant'), tenant); assert.equal(h.state('error'), null); noWrites(h); });
session('Workspace without active tenant retains existing actionable error and no onboarding guess', async h => { h.respond(() => ok({ profile, workspaces: [tenant], tenant: null })); await context(h).reload(); assert.match(h.state('error'), /No active company workspace/); assert.deepEqual(h.native, []); assert.deepEqual(h.routerCalls, []); noWrites(h); });
for (const status of [401, 503]) session('Dashboard bootstrap ' + status + ' retains existing error/login semantics', async h => { h.respond(() => failure(status)); await context(h).reload(); assert.deepEqual(h.native, []); assert.deepEqual(h.routerCalls, status === 401 ? [['replace', '/login']] : []); if (status === 503) assert.match(h.state('error'), /Unable to load dashboard session/); noWrites(h); });
session('Dashboard bootstrap super-admin retains router replace and refresh', async h => { h.respond(() => ok({ profile: { ...profile, system_role: 'super_admin' }, workspaces: [], tenant: null })); await context(h).reload(); assert.deepEqual(h.routerCalls, [['replace', '/super-admin'], ['refresh']]); assert.deepEqual(h.native, []); noWrites(h); });
session('Malformed bootstrap retains account verification error rather than native entry', async h => { h.respond(() => ok({})); await context(h).reload(); assert.match(h.state('error'), /Unable to verify your account access/); assert.deepEqual(h.native, []); assert.deepEqual(h.routerCalls, []); noWrites(h); });

switcher('Create company workspace uses native assign after accepted actual editor preflight', h => { const action = create(h); h.guard({ confirm: true }); action(); assert.deepEqual(h.native, [['assign', '/onboarding?new=1']]); assert.deepEqual(h.routerCalls, []); assert.equal(h.state('open'), false); assert.equal(h.confirmations.length, 1); assert.deepEqual(h.requests, []); });
for (const mode of ['cancel', 'busy', 'pending']) switcher('Create company workspace stays put under actual ' + mode + ' preflight', h => { const action = create(h); h.guard({ confirm: mode !== 'cancel', busy: mode === 'busy', pending: mode === 'pending' }); action(); assert.deepEqual(h.native, []); assert.deepEqual(h.routerCalls, []); assert.equal(h.state('open'), true); assert.equal(h.confirmations.length, mode === 'cancel' ? 1 : 0); assert.deepEqual(h.requests, []); });

test('Every literal onboarding entry uses an explicit full-document boundary; protected-path metadata is not an entry', () => {
  const found = [];
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(tsx?|jsx?)$/.test(entry.name)) { const rel = path.relative(root, file).split(path.sep).join('/'); const ast = ts.createSourceFile(rel, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS); function visit(n) { if (ts.isStringLiteral(n) && n.text.startsWith('/onboarding')) { if (rel === 'src/components/session-activity-tracker.tsx' && ts.isArrayLiteralExpression(n.parent)) found.push([rel, 'protected-path-metadata', n.text]); else { assert.ok(ts.isCallExpression(n.parent), 'Unknown onboarding entry: ' + rel); found.push([rel, n.parent.expression.getText(ast), n.text]); } } ts.forEachChild(n, visit); } visit(ast); } } }
  walk(path.join(root, 'src'));
  assert.deepEqual(found.sort((a,b) => a[0].localeCompare(b[0])), [
    ['src/app/signup/page.tsx', 'window.location.replace', '/onboarding'],
    ['src/components/dashboard-session-context.tsx', 'window.location.replace', '/onboarding'],
    ['src/components/session-activity-tracker.tsx', 'protected-path-metadata', '/onboarding'],
    ['src/components/workspace-switcher.tsx', 'window.location.assign', '/onboarding?new=1'],
    ['src/hooks/use-company-onboarding.ts', 'navigation.navigate', '/onboarding?new=1'],
  ]);
});
