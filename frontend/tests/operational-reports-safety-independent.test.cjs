/* Independent actual-source lifecycle checks. React scheduling/fetch/router are deterministic fakes;
 * this is not React DOM, a browser, an API integration test or PostgreSQL evidence. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { sourceLoader, hookHarness, root } = require('./reconciliation-harness.cjs');
const f = require('./operational-reports-fixtures.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const valid = value => Boolean(value && typeof value.tag === 'string');
const initial = 'date_from=2026-10-01&date_to=2026-10-26';
const next = 'date_from=2026-09-01&date_to=2026-10-26';

// Separate layout and passive cleanup lets a response settle after commit/unmount,
// before passive cleanup. No application callback, validator or resource is mocked.
function resourceHarness() {
  const slots = [], effects = new Map(), queuedLayout = new Map(), queuedPassive = new Map();
  let index = 0, dirty = true, mounted = true, vm;
  let args = ['/api/reports/overview?scope=A', true, valid];
  let tenant = { organization: { id: 'synthetic-A' }, membership_id: 'membership-A', role_id: 'role-A', permissions: ['reports.view'] };
  let respond = async () => f.ok({ tag: 'A' });
  const calls = [], nav = [];
  const router = { replace: href => nav.push(href) };
  const hooks = {
    useState(initialValue) {
      const i = index++;
      if (!slots[i]) slots[i] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [slots[i].value, value => {
        const nextValue = typeof value === 'function' ? value(slots[i].value) : value;
        if (!Object.is(nextValue, slots[i].value)) { slots[i].value = nextValue; dirty = true; }
      }];
    },
    useRef(value) { const i = index++; return slots[i] ||= { current: value }; },
    useMemo(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useLayoutEffect(fn, deps) { const i = index++; if (!effects.has(i) || !same(effects.get(i).deps, deps)) queuedLayout.set(i, { kind: 'layout', fn, deps }); },
    useEffect(fn, deps) { const i = index++; if (!effects.has(i) || !same(effects.get(i).deps, deps)) queuedPassive.set(i, { kind: 'passive', fn, deps }); },
  };
  const loader = sourceLoader({ react: hooks, 'next/navigation': { useRouter: () => router }, '@/components/dashboard-session-context': { useDashboardSession: () => ({ tenant, loading: false }) } });
  const resource = loader.load('src/hooks/use-operational-report-resource.ts').useOperationalReportResource;
  assert.equal(typeof resource, 'function');
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  const commit = queue => {
    const pending = [...queue.entries()]; queue.clear();
    for (const [i, effect] of pending) { effects.get(i)?.cleanup?.(); effects.set(i, { ...effect, cleanup: effect.fn() }); }
  };
  const render = () => { index = 0; dirty = false; vm = resource(...args); commit(queuedLayout); return vm; };
  async function flush() {
    for (let turn = 0; turn < 30; turn++) {
      if (!mounted) { await tick(); return vm; }
      if (dirty || !vm) render();
      commit(queuedPassive); await tick(); await tick();
      if (!dirty && !queuedPassive.size && !queuedLayout.size) return vm;
    }
    throw new Error('Independent harness failed to settle');
  }
  return {
    calls, nav, render, flush, vm: () => vm, respond: fn => { respond = fn; },
    args: patch => { args = args.map((v, i) => Object.hasOwn(patch, i) ? patch[i] : v); dirty = true; },
    tenant: patch => { tenant = { ...tenant, ...patch }; dirty = true; },
    // Only layout cleanup runs here; delayed passive cleanup cannot mask the regression.
    unmountLayout() { mounted = false; for (const effect of effects.values()) if (effect.kind === 'layout') { effect.cleanup?.(); effect.cleanup = undefined; } },
    startPassive() { commit(queuedPassive); },
    replayEffects() { for (const effect of effects.values()) effect.cleanup?.(); for (const kind of ['layout', 'passive']) for (const effect of effects.values()) if (effect.kind === kind) effect.cleanup = effect.fn(); },
    cleanup() { mounted = false; for (const effect of effects.values()) effect.cleanup?.(); effects.clear(); queuedLayout.clear(); queuedPassive.clear(); global.fetch = originalFetch; },
  };
}

const direct = (name, body) => test(name, async () => { const h = resourceHarness(); try { await body(h); } finally { h.cleanup(); } });
const reports = (name, body) => test(name, async () => {
  const h = hookHarness({ file: 'src/hooks/use-operational-reports.ts', target: 'useOperationalReports' });
  try { h.permissions(['reports.view']); h.query(initial); await body(h); } finally { h.cleanup(); }
});
function reportResponse(url) {
  const u = new URL(url, 'https://synthetic.invalid');
  return u.pathname.endsWith('/meta') ? f.ok(f.meta) : f.ok({ ...f.overview, date_from: u.searchParams.get('date_from'), date_to: u.searchParams.get('date_to') });
}

reports('reachable query commit invalidates old401 before passive cleanup', async h => {
  const pending = f.deferred(); h.respond(url => url.includes('/meta') ? f.ok(f.meta) : pending.promise);
  await h.flush(); h.query(next); h.render();
  assert.equal(h.vm().browse.date_from, '2026-09-01'); assert.equal(h.vm().report.value, null);
  pending.resolve(f.failure(401)); await tick(); await tick(); assert.deepEqual(h.nav, []);
  h.respond(reportResponse); await h.flush(); assert.equal(h.vm().report.value.date_from, '2026-09-01');
});
reports('retained prior-query refresh refuses a GET and cannot blank newer report', async h => {
  h.respond(reportResponse); await h.flush(); const old = h.vm().report.refresh;
  h.query(next); await h.flush(); const before = h.calls.length;
  const result = await old(); await h.flush();
  assert.equal(result.current, false); assert.equal(h.calls.length, before);
  assert.equal(h.vm().report.value.date_from, '2026-09-01'); assert.equal(h.vm().report.loading, false);
});
reports('returning A after B does not revive an old A callback', async h => {
  h.respond(reportResponse); await h.flush(); const old = h.vm().report.refresh;
  h.query(next); await h.flush(); h.query(initial); await h.flush(); const before = h.calls.length;
  assert.equal((await old()).current, false); assert.equal(h.calls.length, before);
  assert.equal(h.vm().report.value.date_from, '2026-10-01');
});
reports('genuine current overview401 still redirects; it is not swallowed as stale', async h => {
  h.respond(url => url.includes('/meta') ? f.ok(f.meta) : f.failure(401)); await h.flush();
  assert.ok(h.nav.some(item => item.href === '/login')); assert.equal(h.vm().report.value, null);
});
reports('genuine current metadata401 still redirects', async h => {
  h.respond(url => url.includes('/meta') ? f.failure(401) : reportResponse(url)); await h.flush();
  assert.ok(h.nav.some(item => item.href === '/login'));
});
reports('actual controller retries a failed current scope without old figures', async h => {
  h.respond(reportResponse); await h.flush(); h.respond(url => url.includes('/meta') ? f.ok(f.meta) : f.failure(503));
  h.vm().refresh(); await h.flush(); assert.equal(h.vm().report.value, null); assert.equal(h.vm().report.status, 503);
  h.respond(reportResponse); h.vm().refresh(); await h.flush();
  assert.equal(h.vm().report.value.date_from, '2026-10-01'); assert.equal(h.vm().report.error, null);
  assert.ok(h.calls.every(call => !call.init?.method && call.init?.cache === 'no-store'));
});

const changes = {
  url: h => h.args({ 0: '/api/reports/overview?scope=B' }),
  company: h => h.tenant({ organization: { id: 'synthetic-B' } }),
  membership: h => h.tenant({ membership_id: 'membership-B' }),
  role: h => h.tenant({ role_id: 'role-B' }),
  permissions: h => h.tenant({ permissions: ['reports.view', 'synthetic.extra'] }),
  disabled: h => h.args({ 1: false }),
  validator: h => h.args({ 2: value => Boolean(value && value.tag === 'B') }),
};
for (const [name, change] of Object.entries(changes)) {
  direct(`${name} layout commit rejects prior request401 before passive cleanup`, async h => {
    const pending = f.deferred(); h.respond(() => pending.promise); await h.flush();
    change(h); h.render(); pending.resolve(f.failure(401)); await tick(); await tick();
    assert.deepEqual(h.nav, []); assert.equal(h.vm().value, null);
  });
  direct(`${name} layout commit rejects retained refresh before request and state effects`, async h => {
    await h.flush(); const old = h.vm().refresh; change(h); h.render(); const before = h.calls.length;
    assert.equal((await old()).current, false); assert.equal(h.calls.length, before); assert.deepEqual(h.nav, []);
  });
}
direct('layout-only unmount invalidates pending401 without relying on passive cleanup', async h => {
  const pending = f.deferred(); h.respond(() => pending.promise); await h.flush();
  h.unmountLayout(); pending.resolve(f.failure(401)); await tick(); await tick(); assert.deepEqual(h.nav, []);
});
direct('retained callback after layout-only unmount does not fetch', async h => {
  await h.flush(); const old = h.vm().refresh, before = h.calls.length; h.unmountLayout();
  assert.equal((await old()).current, false); assert.equal(h.calls.length, before);
});
direct('queued initial request is canceled by layout-only unmount', async h => {
  h.render(); h.startPassive(); h.unmountLayout(); await tick(); assert.equal(h.calls.length, 0);
});
direct('StrictMode-style setup cleanup setup only runs current queued GET', async h => {
  h.render(); h.startPassive(); h.replayEffects(); await h.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.vm().value.tag, 'A');
});
direct('stale payload parsing completion cannot redirect after current scope commit', async h => {
  const body = f.deferred(); h.respond(() => ({ ok: false, status: 401, json: () => body.promise })); await h.flush();
  h.args({ 0: '/api/reports/overview?scope=B' }); h.render(); body.resolve({ detail: 'Old response' });
  await tick(); await tick(); assert.deepEqual(h.nav, []);
});
direct('superseded same-scope request401 cannot redirect over later successful read', async h => {
  await h.flush(); const a = f.deferred(), b = f.deferred(); let n = 0; h.respond(() => ++n === 1 ? a.promise : b.promise);
  const first = h.vm().refresh(), second = h.vm().refresh(); b.resolve(f.ok({ tag: 'B' })); await second; await h.flush();
  a.resolve(f.failure(401)); assert.equal((await first).current, false); await h.flush();
  assert.equal(h.vm().value.tag, 'B'); assert.deepEqual(h.nav, []);
});
direct('late network rejection cannot replace newer state', async h => {
  const old = f.deferred(); h.respond(() => old.promise); await h.flush(); h.args({ 0: '/api/reports/overview?scope=B' });
  h.respond(() => f.ok({ tag: 'B' })); await h.flush(); old.reject(new Error('Old request failed')); await tick(); await h.flush();
  assert.equal(h.vm().value.tag, 'B'); assert.equal(h.vm().error, null);
});
for (const [name, bad] of [
  ['network failure', () => Promise.reject(new Error('Synthetic network error'))],
  ['503', () => f.failure(503)],
  ['invalid schema', () => f.ok({ unrelated: true })],
  ['invalid JSON', () => ({ ok: true, status: 200, json: async () => { throw new Error('Synthetic JSON error'); } })],
]) direct(`current ${name} is explicit, does not redirect, and retry recovers`, async h => {
  await h.flush(); h.respond(bad); await h.vm().refresh(); await h.flush();
  assert.equal(h.vm().value, null); assert.ok(h.vm().error); assert.equal(h.vm().loading, false); assert.deepEqual(h.nav, []);
  h.respond(() => f.ok({ tag: 'recovered' })); const outcome = await h.vm().refresh(); await h.flush();
  assert.equal(outcome.current, true); assert.equal(h.vm().value.tag, 'recovered'); assert.equal(h.vm().error, null);
});
direct('current401 still redirects even if body parsing fails', async h => {
  h.respond(() => ({ ok: false, status: 401, json: async () => { throw new Error('Synthetic JSON failure'); } }));
  await h.flush(); assert.deepEqual(h.nav, ['/login']); assert.equal(h.vm().status, 401);
});
direct('permission disable followed by enable never revives old enabled callback', async h => {
  await h.flush(); const old = h.vm().refresh; h.args({ 1: false }); await h.flush(); h.args({ 1: true }); await h.flush();
  const before = h.calls.length; assert.equal((await old()).current, false); assert.equal(h.calls.length, before); assert.equal(h.vm().value.tag, 'A');
});

test('Reports historical shared-reader proof is preserved by the exact later safety layer', () => {
  const proof = path.join(root, 'review/accounting-loans/provenance/shared-read-safety');
  const read = relative => fs.readFileSync(path.join(proof, relative));
  const beforeReader = read('preimages/src/hooks/use-advanced-resource.ts.txt');
  const beforeTest = read('preimages/tests/operational-reports-safety-independent.test.cjs.txt');
  const candidateManifest = read('candidate-final-manifest.json');
  assert.equal(sha(beforeReader), '534293022ccaca1a01a1c7c74ffaa19cb9371710eb6c698e74ece6c24835f7ed');
  assert.equal(sha(beforeTest), 'ca8c5c402b47fa1acca6659355f018cbab4ffc5cc64042e764f1e53c384b7589');
  assert.equal(sha(candidateManifest), 'cb6e5411488483c524e57cc08f8998ef63f9553b415d00a3076e72e57a80aaff');
  assert.equal(sha(read('candidate-source.patch')), 'c3cddf81d8487459097837563e2b5e9cf923e760cf19281824e1c31047ecc6aa');
  const transition = JSON.parse(candidateManifest.toString('utf8')).owned.find(row => row.path === 'src/hooks/use-advanced-resource.ts');
  assert.deepEqual(transition, {
    path: 'src/hooks/use-advanced-resource.ts',
    before_sha256: '534293022ccaca1a01a1c7c74ffaa19cb9371710eb6c698e74ece6c24835f7ed',
    after_sha256: '8ca43e0aa82f4c7a13c811f2f6531bfb496036c8c24c8fd34d74d442c01a6603',
  });
  assert.equal(sha(fs.readFileSync(path.join(root, transition.path))), transition.after_sha256);
  // Restore only this approved assertion block; all other Reports checks stay exact.
  const previous = beforeTest.toString('utf8'), current = fs.readFileSync(__filename, 'utf8');
  const start = "test('Reports historical shared-reader proof is preserved by the exact later safety layer',";
  const priorStart = "test('Reports correction leaves the shared advanced resource byte-identical',";
  const end = "\ntest('Reports controller change is exactly the scoped resource import and two calls',";
  const currentStart = current.indexOf(start), currentEnd = current.indexOf(end, currentStart);
  const previousStart = previous.indexOf(priorStart), previousEnd = previous.indexOf(end, previousStart);
  assert.ok(currentStart >= 0 && currentEnd > currentStart && previousStart >= 0 && previousEnd > previousStart);
  const restored = current.slice(0, currentStart) + previous.slice(previousStart, previousEnd) + current.slice(currentEnd);
  assert.equal(sha(restored), 'ca8c5c402b47fa1acca6659355f018cbab4ffc5cc64042e764f1e53c384b7589');
});
test('Reports controller change is exactly the scoped resource import and two calls', () => {
  const source = fs.readFileSync(path.join(root, 'src/hooks/use-operational-reports.ts'), 'utf8');
  assert.equal((source.match(/useOperationalReportResource\(/g) || []).length, 2);
  const restored = source.replaceAll('useOperationalReportResource', 'useAdvancedResource').replaceAll('@/hooks/use-operational-report-resource', '@/hooks/use-advanced-resource');
  assert.equal(sha(restored), 'c8da0e539f2eb36f4168017d1a2515a196b94946eab01d6af996ef320f2067bb');
});
