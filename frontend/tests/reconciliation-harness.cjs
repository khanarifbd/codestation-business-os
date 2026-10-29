/* Deterministic execution of real TypeScript models/hooks. Not React DOM, browser history or database evidence. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { tick, failure } = require('./reconciliation-fixtures.cjs');
const root = path.resolve(__dirname, '..');
function sourceLoader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    const filename = path.isAbsolute(file) ? file : path.join(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
    mod.require = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith('.css')) return {};
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
        const found = ['', '.ts', '.tsx', '.js', '.cjs', '/index.ts', '/index.tsx'].map(ext => base + ext).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
        if (found) return load(found);
      }
      return require(name);
    };
    const source = fs.readFileSync(filename, 'utf8');
    mod._compile(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
    return mod.exports;
  }
  return { load, cache };
}
const sameDependencies = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
function hookHarness({ file, target, args = [] }) {
  const slots = [], effects = new Map(), queued = new Map(), layouts = new Map(), calls = [], nav = [], guards = [];
  let index = 0, dirty = true, alive = true, vm, allowExit = true, failNavigation = false, pathname = '/dashboard/accounting/reconciliation', query = new URLSearchParams();
  let permissions = ['finance.view', 'finance.manage'];
  let tenantId = 'synthetic-company';
  let respond = async () => failure(404);
  const route = (kind, href, options) => { if (failNavigation) throw new Error('Synthetic navigation failure'); nav.push({ kind, href, options }); const url = new URL(href, 'https://synthetic.invalid'); pathname = url.pathname; query = url.searchParams; dirty = true; };
  const router = { push: (href, options) => route('push', href, options), replace: (href, options) => route('replace', href, options), refresh: () => nav.push({ kind: 'refresh' }) };
  const hooks = {
    useState(initial) { const i = index++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = index++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = index++; if (!slots[i] || !sameDependencies(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useLayoutEffect(fn, deps) { const i = index++; if (!effects.has(i) || !sameDependencies(effects.get(i).deps, deps)) layouts.set(i, { fn, deps }); },
    useEffect(fn, deps) { const i = index++; if (!effects.has(i) || !sameDependencies(effects.get(i).deps, deps)) queued.set(i, { fn, deps }); },
  };
  const guard = (isDirty, options = {}) => {
    const state = hooks.useRef({ dirty: isDirty, options }); state.current = { dirty: isDirty, options };
    const row = { dirty: isDirty, options }; guards.push(row);
    return {
      markClean() { state.current.dirty = false; row.cleaned = true; },
      navigate(href, opts = {}) { const current = state.current; if (failNavigation || current.options.pendingRef?.current || current.options.isBusy || current.dirty && !opts.discard && !allowExit) return false; nav.push({ kind: 'navigate', href, options: opts }); return true; },
      confirmLeave() { return !options.pendingRef?.current && !options.isBusy && (!state.current.dirty || allowExit); },
    };
  };
  const tenant = () => ({ organization: { id: tenantId, currency: 'USD' }, membership_id: 'synthetic-membership', role_id: 'synthetic-role', permissions });
  const loader = sourceLoader({
    react: hooks,
    'next/navigation': { useRouter: () => router, useSearchParams: () => query, usePathname: () => pathname, useParams: () => ({}) },
    '@/components/dashboard-session-context': { useDashboardSession: () => ({ loading: false, tenant: tenant() }) },
    './use-document-navigation-guard': { useDocumentNavigationGuard: guard },
    '@/hooks/use-document-navigation-guard': { useDocumentNavigationGuard: guard },
  });
  const before = { fetch: global.fetch, window: global.window, document: global.document };
  global.fetch = async (url, init) => { const call = { url, init }; calls.push(call); return respond(url, init, call); };
  global.window = { confirm: () => allowExit, dispatchEvent: () => allowExit, setTimeout, clearTimeout, location: { href: 'https://synthetic.invalid' + pathname, assign: href => route('assign', href), replace: href => route('native-replace', href) } };
  global.document = { getElementById: () => null };
  function render(...nextArgs) { if (nextArgs.length) args = nextArgs; index = 0; dirty = false; vm = loader.load(file)[target](...args);
    // Commit layout effects before exposing the rendered event handlers; passive effects run in flush().
    const pending = [...layouts.entries()]; layouts.clear();
    for (const [slot, item] of pending) { effects.get(slot)?.cleanup?.(); effects.set(slot, { deps: item.deps, cleanup: item.fn() }); }
    return vm; }
  async function flush() {
    for (let turn = 0; turn < 30; turn++) {
      if (!alive) { await tick(); return vm; }
      if (dirty || !vm) render();
      const pending = [...queued.entries()]; queued.clear();
      for (const [slot, item] of pending) { effects.get(slot)?.cleanup?.(); effects.set(slot, { deps: item.deps, cleanup: item.fn() }); }
      await tick(); await tick();
      if (!dirty && !queued.size) return vm;
    }
    throw new Error('Harness did not settle in 30 renders (possible effect loop)');
  }
  function unmount() { alive = false; for (const item of effects.values()) item.cleanup?.(); effects.clear(); queued.clear(); layouts.clear(); }
  return { calls, nav, guards, render, flush, vm: () => vm, respond: fn => { respond = fn; }, query: value => { query = new URLSearchParams(value); dirty = true; }, permissions: value => { permissions = value; dirty = true; }, tenant: value => { tenantId = value; dirty = true; }, exit: value => { allowExit = value; }, failNavigation: value => { failNavigation = value; }, unmount, cleanup() { if (alive) unmount(); Object.assign(global, before); }, load: loader.load };
}
module.exports = { root, sourceLoader, hookHarness };
