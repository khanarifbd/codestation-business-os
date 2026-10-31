const { beforeDashboardDesignA } = require('./helpers/reviewed-dashboard-design-a.cjs');
const { withReviewedCanvas } = require('./helpers/reviewed-canvas.cjs');
/* Actual return component under controlled React lifecycle/fetch scheduling.
 * No browser/provider/session/network/accounting integration is exercised. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { sourceLoader } = require('./reconciliation-harness.cjs');
const root = path.resolve(__dirname, '..');
const statusFile = process.env.RETURN_STATUS_SOURCE || 'src/components/stripe-checkout-return-status.tsx';
const evidence = path.join(root, 'evidence/portal-ui/payment-return-r1');
const props = (sessionId = 'cs_live_SYNTHETIC0001', mode = 'live', result = 'success') => ({ sessionId, mode, result });
const reply = (status, payload) => ({ status, ok: status >= 200 && status < 300, json: async () => payload });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
function fixture() {
  const instances = new Map(), allInstances = new Set(), requests = [], timers = new Map(); let current, index, tree, parameters, key, serial = 0, writesAfterLayoutUnmount = 0;
  let responder = async () => reply(503, {});
  const before = { fetch: global.fetch, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const instance = id => { if (!instances.has(id) || !instances.get(id).mounted) { const owner = { slots: [], effects: new Map(), layouts: new Map(), passive: new Map(), mounted: true }; instances.set(id, owner); allInstances.add(owner); } return instances.get(id); };
  const hooks = { ...React,
    useState(initial) { const owner = current, i = index++; if (!owner.slots[i]) owner.slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [owner.slots[i].value, value => { if (!owner.mounted) writesAfterLayoutUnmount++; owner.slots[i].value = typeof value === 'function' ? value(owner.slots[i].value) : value; }]; },
    useRef(initial) { return current.slots[index++] ||= { current: initial }; },
    useLayoutEffect(fn, deps) { const i = index++; if (!same(current.effects.get(i)?.deps, deps)) current.layouts.set(i, { fn, deps }); },
    useEffect(fn, deps) { const i = index++; if (!same(current.effects.get(i)?.deps, deps)) current.passive.set(i, { fn, deps }); },
  };
  function commit(owner, which) { for (const [i, effect] of owner[which]) { owner.effects.get(i)?.cleanup?.(); owner.effects.set(i, { ...effect, which, cleanup: effect.fn() }); } owner[which].clear(); }
  function unmountLayout(owner) { owner.mounted = false; for (const value of owner.effects.values()) if (value.which === 'layouts') value.cleanup?.(); }
  global.fetch = async (url, init) => { requests.push({ url, init }); return responder(url, init); };
  global.setTimeout = (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; };
  global.clearTimeout = id => timers.delete(id);
  const C = sourceLoader({ react: hooks }).load(statusFile).StripeCheckoutReturnStatus;
  function render(next = parameters) {
    parameters = next; current = instance('root'); index = 0; const out = C(parameters); commit(current, 'layouts');
    if (typeof out.type === 'function' && out.type.name === 'CheckoutReturnSession') {
      const nextKey = out.key;
      if (key !== undefined && key !== nextKey) unmountLayout(instances.get(key));
      key = nextKey; current = instance(key); current.mounted = true; index = 0; tree = out.type(out.props); commit(current, 'layouts');
    } else { key = 'root'; tree = out; }
    return renderToStaticMarkup(tree);
  }
  return {
    render, calls: requests, timers,
    respond: fn => { responder = fn; },
    async effects() { for (const owner of instances.values()) if (owner.mounted) commit(owner, 'passive'); await tick(); await tick(); },
    async settle() { await tick(); await tick(); },
    layoutUnmount() { for (const owner of instances.values()) unmountLayout(owner); },
    replay() { const owner = instances.get(key); unmountLayout(owner); owner.mounted = true; for (const item of owner.effects.values()) if (item.which === 'layouts') item.cleanup = item.fn(); for (const item of owner.effects.values()) if (item.which === 'passive') { item.cleanup?.(); item.cleanup = item.fn(); } },
    writesAfterUnmount: () => writesAfterLayoutUnmount,
    async timer() { const entry = timers.entries().next().value; assert.ok(entry); timers.delete(entry[0]); assert.equal(entry[1].ms, 4000); entry[1].fn(); await tick(); await tick(); },
    close() { for (const owner of allInstances) { unmountLayout(owner); for (const effect of owner.effects.values()) effect.cleanup?.(); } Object.assign(global, before); },
  };
}
function run(name, fn) { test(name, async () => { const h = fixture(); try { await fn(h); } finally { h.close(); } }); }
run('new session cannot display previous posted state before passive effects', async h => {
  h.respond(() => reply(200, { status: 'posted' })); h.render(props()); await h.effects(); assert.match(h.render(), /Payment verified and posted/);
  const d = deferred(); h.respond(() => d.promise); const html = h.render(props('cs_live_SYNTHETIC0002'));
  assert.doesNotMatch(html, /Payment verified and posted/); assert.match(html, /Awaiting verified payment posting/);
  await h.effects(); assert.equal(h.calls.length, 2); d.resolve(reply(200, { status: 'pending' })); await h.settle();
});
for (const next of [props('cs_test_SYNTHETIC0001', 'test'), props('cs_live_SYNTHETIC0001', 'live', 'cancelled')]) run(`mode/result identity resets previous state: ${next.mode}/${next.result}`, async h => {
  h.respond(() => reply(200, { status: 'posted' })); h.render(props()); await h.effects(); assert.match(h.render(), /Payment verified and posted/);
  assert.doesNotMatch(h.render(next), /Payment verified and posted/);
});
run('A to B to A creates a new session state rather than reviving previous posted status', async h => {
  h.respond(() => reply(200, { status: 'posted' })); h.render(props()); await h.effects(); assert.match(h.render(), /Payment verified and posted/);
  h.render(props('cs_live_SYNTHETIC0002')); assert.doesNotMatch(h.render(props()), /Payment verified and posted/);
});
run('late response after layout cleanup cannot write or schedule another poll', async h => {
  const d = deferred(); h.respond(() => d.promise); h.render(props()); await h.effects(); h.layoutUnmount();
  let decoded = 0; d.resolve({ ok: true, status: 200, json: async () => { decoded++; return { status: 'posted' }; } }); await h.settle();
  assert.equal(decoded, 0); assert.equal(h.writesAfterUnmount(), 0); assert.equal(h.timers.size, 0);
});
run('late parsed body after layout cleanup cannot write or poll', async h => {
  const d = deferred(); h.respond(() => ({ ok: true, status: 200, json: () => d.promise })); h.render(props()); await h.effects(); h.layoutUnmount(); d.resolve({ status: 'posted' }); await h.settle();
  assert.equal(h.writesAfterUnmount(), 0); assert.equal(h.timers.size, 0);
});
run('late old-session result cannot replace new-session pending display', async h => {
  const a = deferred(), b = deferred(); h.respond(url => url.endsWith('0001') ? a.promise : b.promise);
  h.render(props()); await h.effects(); h.render(props('cs_live_SYNTHETIC0002')); await h.effects();
  a.resolve(reply(200, { status: 'posted' })); await h.settle(); assert.doesNotMatch(h.render(), /Payment verified and posted/); assert.equal(h.writesAfterUnmount(), 0);
  b.resolve(reply(200, { status: 'processing' })); await h.settle(); assert.match(h.render(), /Awaiting verified payment posting/);
});
run('StrictMode-style cleanup and replay rejects the first lifetime response', async h => {
  const first = deferred(); let calls = 0; h.respond(() => ++calls === 1 ? first.promise : reply(200, { status: 'pending' }));
  h.render(props()); await h.effects(); h.replay(); await h.settle(); first.resolve(reply(200, { status: 'posted' })); await h.settle();
  assert.equal(h.calls.length, 2); assert.doesNotMatch(h.render(), /Payment verified and posted/);
});
for (const [status, wording] of [['posted', 'Payment verified and posted'], ['reversed', 'This Stripe payment was reversed'], ['review_required', 'Payment needs reconciliation']]) run(`genuine current ${status} remains authoritative and terminal`, async h => {
  h.respond(() => reply(200, { status })); h.render(props()); await h.effects(); assert.match(h.render(), new RegExp(wording)); assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls, [{ url: '/api/stripe-checkout/return-status/cs_live_SYNTHETIC0001', init: { cache: 'no-store' } }]);
});
run('sandbox receipt never claims live accounting posting', async h => {
  h.respond(() => reply(200, { status: 'sandbox_paid' })); h.render(props('cs_test_SYNTHETIC0001', 'test')); await h.effects();
  assert.match(h.render(), /test session has been recorded/); assert.match(h.render(), /never change real Invoice/); assert.doesNotMatch(h.render(), /Payment verified and posted/); assert.equal(h.timers.size, 0);
});
for (const status of ['processing', 'pending']) run(`${status} preserves bounded twelve-read polling, not payment mutation`, async h => {
  h.respond(() => reply(200, { status })); h.render(props()); await h.effects();
  for (let i = 1; i < 12; i++) { assert.equal(h.timers.size, 1); await h.timer(); }
  assert.equal(h.calls.length, 12); assert.equal(h.timers.size, 0); assert.doesNotMatch(h.render(), /Payment verified and posted/);
  for (const call of h.calls) assert.deepEqual(call.init, { cache: 'no-store' });
});
for (const [label, respond] of [['503', () => reply(503, {})], ['malformed', () => reply(200, { status: 'paid' })], ['JSON failure', () => ({ ok: true, status: 200, json: async () => { throw Error('synthetic'); } })], ['transport', () => { throw Error('synthetic'); }]]) run(`${label} cannot claim payment success; safe retry remains bounded`, async h => {
  h.respond(respond); h.render(props()); await h.effects(); assert.match(h.render(), /cannot currently retrieve/); assert.doesNotMatch(h.render(), /Payment verified and posted/); assert.equal(h.timers.size, 1);
});
for (const value of [props(null), props('cs_live_SYNTHETIC0001', 'unknown')]) run('missing/unknown return identity makes no status request', async h => {
  h.render(value); await h.effects(); assert.equal(h.calls.length, 0); assert.match(h.render(), /No valid Stripe Checkout session/);
});
test('all original accounting-state messages and presentation remain byte-exact', () => {
  const original = fs.readFileSync(path.join(evidence, 'preimages/src/components/stripe-checkout-return-status.tsx.txt'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'src/components/stripe-checkout-return-status.tsx'), 'utf8');
  const marker = '  if (!sessionId || mode === "unknown") {';
  assert.equal(source.slice(source.indexOf(marker)), original.slice(original.indexOf(marker)));
});
test('public route retains parsing, metadata and status props; only reviewed destination/copy/canvas change', () => {
  const before = fs.readFileSync(path.join(evidence, 'preimages/src/app/payments/stripe/return/page.tsx.txt'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'src/app/payments/stripe/return/page.tsx'), 'utf8');
  assert.equal(source.replace('href="/dashboard"', 'href="/dashboard/accounting/invoices"').replace('Return to your workspace', 'Return to Invoices'), withReviewedCanvas('src/app/payments/stripe/return/page.tsx', before));
});
test('neutral destination delegates actual client/employee/staff routing to unchanged shell', () => {
  const file = path.join(root, 'src/components/dashboard-shell.tsx'), source = fs.readFileSync(file, 'utf8');
  assert.equal(crypto.createHash('sha256').update(beforeDashboardDesignA('src/components/dashboard-shell.tsx', source)).digest('hex'), JSON.parse(fs.readFileSync(path.join(evidence, 'dependency-pins.json'))).files['src/components/dashboard-shell.tsx']);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let effect;
  const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('router.replace(clientLanding)')) effect = node.arguments[0]; ts.forEachChild(node, visit); }; visit(ast); assert.ok(effect);
  const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, effect, ast);
  const compiled = ts.transpileModule(`const effect = ${printed}; export default effect;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const [clientOnly, employeeSelfService, expected] of [[true, false, '/dashboard/client'], [false, true, '/dashboard/employee'], [false, false, null]]) {
    const mod = { exports: {} }, calls = [];
    require('node:vm').runInNewContext(compiled, { module: mod, exports: mod.exports, clientOnly, employeeSelfService, clientArea: false, pathname: '/dashboard', clientLanding: '/dashboard/client', employeeLanding: '/dashboard/employee', router: { replace: x => calls.push(x) } });
    mod.exports.default(); assert.deepEqual(calls, expected ? [expected] : []);
  }
  assert.ok(source.includes('workspaceContext?.primary_relationship === "client"'));
  assert.ok(source.includes('isEmployeeSelfServiceContext(workspaceContext)'));
});
// Identity's native document entry changes only this one bootstrap call. Keep
// the original dependency pins: the exact inverse must restore every old byte.
function normalizeNativeBootstrapEntry(source) {
  const native = 'window.location.replace("/onboarding")';
  assert.equal(source.split(native).length - 1, 1, 'exactly one reviewed native onboarding call');
  assert.ok(!source.includes('router.replace("/onboarding")'), 'SPA onboarding entry must not remain');
  return source.replace(native, 'router.replace("/onboarding")');
}
function assertOriginalReturnDependency(file, source, pins) {
  const normalized = file === 'src/components/dashboard-session-context.tsx' ? normalizeNativeBootstrapEntry(source) : beforeDashboardDesignA(file, source);
  assert.equal(crypto.createHash('sha256').update(normalized).digest('hex'), pins[file], file);
}
test('public status proxy and auth bootstrap retain original bytes except exact native onboarding entry; no provider or signed-pay GET is added', () => {
  const pins = JSON.parse(fs.readFileSync(path.join(evidence, 'dependency-pins.json'))).files;
  for (const file of Object.keys(pins)) assertOriginalReturnDependency(file, fs.readFileSync(path.join(root, file), 'utf8'), pins);
  const source = fs.readFileSync(path.join(root, 'src/components/stripe-checkout-return-status.tsx'), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|\/pay\/|stripe\.com|method:\s*["'](?:POST|PATCH|PUT|DELETE)/);
});
test('bootstrap inverse rejects wrong target, SPA, assign, missing and duplicate native calls', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/dashboard-session-context.tsx'), 'utf8');
  const native = 'window.location.replace("/onboarding")';
  for (const replacement of ['window.location.replace("/onboarding?new=1")', 'router.replace("/onboarding")', 'window.location.assign("/onboarding")', 'void 0', native + '; ' + native]) {
    assert.throws(() => normalizeNativeBootstrapEntry(source.replace(native, replacement)), replacement);
  }
});
test('bootstrap inverse cannot hide collateral auth, tenant, endpoint, provider or storage changes', () => {
  const file = 'src/components/dashboard-session-context.tsx', source = fs.readFileSync(path.join(root, file), 'utf8');
  const pins = JSON.parse(fs.readFileSync(path.join(evidence, 'dependency-pins.json'))).files;
  for (const [from, to] of [['response.status === 401', 'response.status === 403'], ['setTenant(bootstrap.tenant ?? null)', 'setTenant(null)'], ['/api/dashboard-bootstrap', '/api/other-bootstrap']]) {
    assert.ok(source.includes(from), from);
    assert.throws(() => assertOriginalReturnDependency(file, source.replace(from, to), pins), from);
  }
  for (const added of ['\nfetch("https://stripe.com/provider");', '\nfetch("/pay/signed-token");', '\nlocalStorage.setItem("session", "synthetic");']) {
    assert.throws(() => assertOriginalReturnDependency(file, source + added, pins));
  }
});
test('native bootstrap exception never relaxes the original public proxy or dashboard-shell pins', () => {
  const pins = JSON.parse(fs.readFileSync(path.join(evidence, 'dependency-pins.json'))).files;
  for (const file of ['src/components/dashboard-shell.tsx', 'src/app/api/stripe-checkout/return-status/[sessionId]/route.ts']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assertOriginalReturnDependency(file, source, pins);
    assert.throws(() => assertOriginalReturnDependency(file, source + '\n// unapproved change', pins));
  }
});
