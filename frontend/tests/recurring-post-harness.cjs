const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const ok = body => ({ ok: true, status: 200, json: async () => body });
const fail = (status, detail = 'Synthetic rejection') => ({ ok: false, status, json: async () => ({ detail }) });
const target = { id: 'synthetic-schedule', name: 'Synthetic monthly cost', is_active: true, next_due_date: '2026-10-26', expense_amount: '25.00', expense_currency: 'USD', account_name: 'Synthetic bank', account_currency: 'USD', project_id: null, client_id: null, reference: 'SYN-REF', notes: null };
const payload = { expense_date: '2026-10-26', expense_amount: '25.00', account_amount: null, profitability_amount: null, reference: 'SYN-REF', notes: null };
const receipt = { recurring_expense: { ...target, next_due_date: '2026-11-26' }, expense_id: 'synthetic-expense', expense_number: 'SYN-EXP-1', posted_date: '2026-10-26', next_due_date: '2026-11-26', is_active: true };
function loader(mocks = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
    mod.require = id => {
      if (id in mocks) return mocks[id];
      if (id.startsWith('@/') || id.startsWith('.')) {
        const base = id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : path.resolve(path.dirname(filename), id);
        const file = ['.ts', '.tsx', '.cjs', '/index.ts'].map(ext => base + ext).find(p => fs.existsSync(p));
        if (file) return load(file);
      }
      return require(id);
    };
    let source = fs.readFileSync(filename, 'utf8');
    mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
    return mod.exports;
  }
  return relative => load(path.join(root, relative));
}
function harness({ workspace = false } = {}) {
  let cursor = 0, refCursor = 0, effectCursor = 0, memoCursor = 0, scope = 'synthetic-company/member/role', allowed = true, consent = true, id = 0;
  const states = [], refs = [], effects = [], memos = [], pendingEffects = [], calls = [], guards = [], nav = [], confirms = [];
  let responder = () => ok(receipt);
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useMemo(fn, deps) { const i = memoCursor++, old = memos[i]; if (!old || !deps || deps.some((v,j) => !Object.is(v,old.deps[j]))) memos[i] = { deps, value: fn() }; return memos[i].value; },
    useEffect(fn, deps) { const i = effectCursor++, old = effects[i]; if (!old || !deps || deps.some((v,j) => !Object.is(v,old.deps[j]))) pendingEffects.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const original = { window: global.window, fetch: global.fetch };
  global.window = { location: { assign: href => nav.push(['assign',href]) }, setTimeout, clearTimeout, crypto: { randomUUID: () => `synthetic-operation-key-${++id}` }, confirm: message => { confirms.push(message); return consent; } };
  global.fetch = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  const router = { replace: href => nav.push(['replace',href]) };
  const load = loader({ react: hooks, 'lucide-react': new Proxy({}, { get: (_, key) => String(key) }),
    '@/components/dashboard-session-context': { useDashboardSession: () => ({ tenant: { organization: { id: scope }, permissions: allowed ? ['finance.view','finance.manage'] : ['finance.view'], membership_id: 'member', role_id: 'role' } }) },
    '@/components/ui/app-page': { AppPage: 'AppPage', PageHeader: 'PageHeader', SectionHeader: 'SectionHeader', Surface: 'Surface' },
    '@/components/searchable-select': { SearchableSelect: 'SearchableSelect' }, '@/components/financial-confirmation-dialog': { FinancialConfirmationDialog: 'FinancialConfirmationDialog' },
    '@/components/accounting-money-out/money-out-ui': { MoneyOutConfirmation: 'FinancialConfirmationDialog' },
    'next/navigation': { useRouter: () => router },
    '@/components/finance-controls/control-ui': new Proxy({}, { get: (_, key) => String(key) }),
    './control-ui': new Proxy({}, { get: (_, key) => String(key) }),
    './use-document-navigation-guard': { useDocumentNavigationGuard: (dirty, options) => {
      let clean = false; const guard = { dirty, options, clean: false }; guards.push(guard);
      return { markClean: () => { clean = true; guard.clean = true; },
        navigate: (href, opts = {}) => { if (options.pendingRef.current || options.isBusy || !clean && dirty && !opts.discard && !consent) return false; nav.push(['navigate',href,opts]); return true; } };
    } } });
  const useHook = workspace ? load('src/components/finance-controls/control-manual-post.tsx').ControlManualPost : load('src/hooks/use-recurring-expense-post.ts').useRecurringExpensePost;
  return { calls, guards, nav, confirms, load,
    render() { cursor = refCursor = effectCursor = memoCursor = 0; const vm = workspace ? useHook({ scope, id: target.id, returnTo: "/dashboard/accounting/controls" }) : useHook(scope, allowed); pendingEffects.splice(0).forEach(fn => fn()); return vm; },
    respond: fn => { responder = fn; }, scope: value => { scope = value; }, permission: value => { allowed = value; }, consent: value => { consent = value; },
    unmount() { effects.forEach(e => e?.cleanup?.()); }, cleanup() { effects.forEach(e => e?.cleanup?.()); Object.assign(global, original); } };
}
function review(h, value = payload) { h.render().review(value); return h.render(); }
function ready(h) { h.render().open(target); return h.render(); }
function nodes(tree, type) { const out = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; if (node.type === type) out.push(node); visit(node.props?.children); }; visit(tree); return out; }
function text(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (Array.isArray(tree)) return tree.map(text).join(''); if (typeof tree !== 'object') return String(tree); return text(tree.props?.children); }
module.exports = { root, loader, harness, ok, fail, target, payload, receipt, ready, review, nodes, text, settle };
