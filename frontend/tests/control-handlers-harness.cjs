/* Actual Controls + shared resource/action hooks in a deterministic hook harness.
 * No React DOM, native history, database, scheduler or external-request evidence. */
const { sourceLoader } = require('./reconciliation-harness.cjs');
const { tick, failure, ok, deferred } = require('./reconciliation-fixtures.cjs');
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
function controlHarness({ file, target, args = [] }) {
  const slots = [], effects = new Map(), pendingEffects = new Map(), layouts = new Map(), calls = [], nav = [], guards = [];
  let index = 0, dirty = true, alive = true, vm, allowExit = true, failNavigation = false;
  let query = new URLSearchParams(), pathname = '/dashboard/accounting/controls';
  let tenant = { organization: { id: 'synthetic-company', currency: 'USD', base_currency: 'USD', timezone: 'UTC' }, membership_id: 'synthetic-membership', role_id: 'synthetic-role', permissions: ['finance.view', 'finance.manage'] };
  let response = async () => failure(404);
  const route = (kind, href, options) => { if (failNavigation) throw Error('Synthetic navigation failure'); nav.push({ kind, href, options }); const url = new URL(href, 'https://synthetic.invalid'); pathname = url.pathname; query = url.searchParams; dirty = true; };
  const router = { push: (href, options) => route('push', href, options), replace: (href, options) => route('replace', href, options), refresh: () => nav.push({ kind: 'refresh' }) };
  const hooks = {
    useState(initial) { const i = index++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = index++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = index++; if (!effects.has(i) || !same(effects.get(i).deps, deps)) pendingEffects.set(i, { fn, deps }); },
    useLayoutEffect(fn, deps) { const i = index++; if (!effects.has(i) || !same(effects.get(i).deps, deps)) layouts.set(i, { fn, deps }); },
  };
  const guard = (isDirty, options = {}) => {
    const current = hooks.useRef(null), row = { dirty: isDirty, options }; current.current = row; guards.push(row);
    return {
      markClean() { current.current.dirty = false; row.cleaned = true; },
      navigate(href, opts = {}) { const state = current.current; if (failNavigation || state.options.pendingRef?.current || state.options.isBusy || state.dirty && !opts.discard && !allowExit) return false; nav.push({ kind: 'navigate', href, options: opts }); return true; },
      confirmLeave() { const state = current.current; return !state.options.pendingRef?.current && !state.options.isBusy && (!state.dirty || allowExit); },
    };
  };
  const loader = sourceLoader({
    react: hooks,
    'next/navigation': { useRouter: () => router, useSearchParams: () => query, usePathname: () => pathname, useParams: () => ({}) },
    '@/components/dashboard-session-context': { useDashboardSession: () => ({ loading: false, tenant }) },
    './use-document-navigation-guard': { useDocumentNavigationGuard: guard },
    '@/hooks/use-document-navigation-guard': { useDocumentNavigationGuard: guard },
  });
  const prior = { fetch: global.fetch, window: global.window, document: global.document };
  global.fetch = async (url, init) => { const call = { url, init }; calls.push(call); return response(url, init, call); };
  let keySequence = 0;
  global.window = { setTimeout, clearTimeout, crypto: { randomUUID: () => `synthetic-controls-key-${++keySequence}` }, confirm: () => allowExit, dispatchEvent: () => allowExit, location: { href: 'https://synthetic.invalid' + pathname, assign: href => route('assign', href), replace: href => route('native-replace', href) } };
  global.document = { getElementById: () => null };
  function runEffects(collection) { const items = [...collection.entries()]; collection.clear(); for (const [slot, item] of items) { effects.get(slot)?.cleanup?.(); effects.set(slot, { deps: item.deps, cleanup: item.fn() }); } }
  function render(...nextArgs) { if (nextArgs.length) args = nextArgs; index = 0; dirty = false; vm = loader.load(file)[target](...args); runEffects(layouts); return vm; }
  async function flush() {
    for (let turn = 0; turn < 35; turn++) {
      if (!alive) { await tick(); return vm; }
      if (dirty || !vm) render(); runEffects(pendingEffects); await tick(); await tick();
      if (!dirty && !pendingEffects.size) return vm;
    }
    throw Error('Control harness did not settle; possible hook loop');
  }
  function unmount() { alive = false; for (const row of effects.values()) row.cleanup?.(); effects.clear(); pendingEffects.clear(); layouts.clear(); }
  return {
    calls, nav, guards, render, flush, vm: () => vm, respond: fn => { response = fn; },
    query: value => { query = new URLSearchParams(value); dirty = true; },
    permissions: value => { tenant = { ...tenant, permissions: value }; dirty = true; },
    organization: value => { tenant = { ...tenant, organization: { ...tenant.organization, ...value } }; dirty = true; },
    scope: value => { tenant = { ...tenant, ...value }; dirty = true; },
    exit: value => { allowExit = value; }, failNavigation: value => { failNavigation = value; },
    unmount, cleanup() { if (alive) unmount(); Object.assign(global, prior); },
  };
}
const writes = h => h.calls.filter(call => ['POST', 'PATCH'].includes(call.init?.method));
module.exports = { controlHarness, writes, tick, failure, ok, deferred };
