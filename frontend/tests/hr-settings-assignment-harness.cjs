/* Actual HR Settings hooks and navigation guard under deterministic synthetic scheduling.
 * No React DOM/browser, live API, storage, file upload or database proof. */
const { sourceLoader } = require('./reconciliation-harness.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const failure = (status, detail = 'Synthetic precommit rejection') => ok({ detail }, status);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const access = { can_view: true, can_manage: true, can_self: true, can_view_people: true, can_manage_people: true, can_invite_employees: true, can_manage_structure: true, is_employee: true, role_name: 'Synthetic manager', timezone: 'Asia/Dhaka', currency: 'BDT', landing: 'overview' };
const meta = { employees: [{ id: 'synthetic-employee', employee_code: 'SYN-01', name: 'Synthetic Employee' }],shifts:[{id:'synthetic-shift',name:'Synthetic day shift',start_time:'09:00:00',end_time:'17:00:00'}] };
const receipt = { id: 'synthetic-assignment' };
const shift = { id:'synthetic-shift',name:'Synthetic day shift',start_time:'09:00:00',end_time:'17:00:00',is_active:true,break_minutes:60,grace_minutes:10,weekly_off_days:[5,6] };
const leave = {id:'synthetic-leave',name:'Annual',code:'AL',annual_allowance_days:'12.50',is_paid:true,is_active:true,requires_approval:true};
const holiday={id:'synthetic-holiday',name:'Synthetic holiday',holiday_date:'2026-12-01',is_paid:true,notes:null};
const assignment={id:'synthetic-assignment',employee_id:'synthetic-employee',employee_code:'SYN-01',employee_name:'Synthetic Employee',shift_id:'synthetic-shift',shift_name:'Synthetic day shift',effective_from:'2026-10-27',effective_to:null};
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const elements = root => {
  const found = [];
  function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; if (node.type && node.props) { found.push(node); visit(node.props.children); } }
  visit(root); return found;
};
const textOf = root => {
  if (Array.isArray(root)) return root.map(textOf).join(' ');
  if (root === null || root === undefined || typeof root === 'boolean') return '';
  if (typeof root === 'string' || typeof root === 'number') return String(root);
  return root?.props ? textOf(root.props.children) : '';
};
class SyntheticFormData {
  constructor(form) { this.data = form instanceof SyntheticFormData ? new Map(form.data) : new Map(Object.entries(form?.fields ?? {})); }
  get(name) { return this.data.get(name) ?? null; }
  getAll(name) { return this.data.has(name) ? [this.data.get(name)] : []; }
  has(name) { return this.data.has(name); }
  set(name, value) { this.data.set(name, value); }
  append(name, value) { this.data.set(name, value); }
  delete(name) { this.data.delete(name); }
  entries() { return this.data.entries(); }
  keys() { return this.data.keys(); }
  values() { return this.data.values(); }
  forEach(fn) { this.data.forEach((v, k) => fn(v, k, this)); }
  [Symbol.iterator]() { return this.entries(); }
}
function harness({mode='create'}={}) {
  const slots = [], effects = new Map(), layouts = new Map(), passives = new Map(), calls = [], nav = [], prompts = [];
  let pathname = mode==='create' ? '/dashboard/hr/settings/assignments/new' : '/dashboard/hr/settings', params = new URLSearchParams();
  let index = 0, dirty = true, alive = true, tree, allowExit = true, caps = { ...access }, sessionLoading = false;
  let identity = { organizationId: 'synthetic-company-A', membershipId: 'synthetic-member-A', roleId: 'synthetic-role-A', permissions: ['hr.view', 'hr.manage'], email: 'synthetic-A@example.invalid' };
  const saved = { fetch: global.fetch, window: global.window, document: global.document, Node: global.Node, Element: global.Element, FormData: global.FormData };
  const formNode = { fields: { employee_id:'synthetic-employee',shift_id:'synthetic-shift',effective_from:'2026-10-27' } };
  const hooks = {
    useState(initial) { const i = index++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = index++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useLayoutEffect(fn, deps) { const i = index++; if (!effects.has(i) || !same(effects.get(i).deps, deps)) layouts.set(i, { fn, deps }); },
    useEffect(fn, deps) { const i = index++; if (!effects.has(i) || !same(effects.get(i).deps, deps)) passives.set(i, { fn, deps }); },
  };
  const router = { push: href => nav.push({ kind: 'push', href }), replace: href => nav.push({ kind: 'replace', href }), refresh: () => nav.push({ kind: 'refresh' }) };
  class Node {}
  class Element extends Node { constructor(href) { super(); this.href = href; } closest() { return this; } getAttribute(name) { return name === 'href' ? this.href : null; } hasAttribute() { return false; } }
  const win = new EventTarget(); win.location = { href: 'https://synthetic.invalid/dashboard/hr/settings', assign: href => nav.push({ kind: 'native', href }), replace: href => nav.push({ kind: 'native-replace', href }) }; win.confirm = message => { prompts.push(message); return allowExit; }; win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  global.window = win; global.document = { getElementById: () => null }; global.Node = Node; global.Element = Element; global.FormData = SyntheticFormData;
  const defaultRead = url => url === '/api/hr/access' ? ok(caps) : url === '/api/hr/meta' ? ok(meta) : url==='/api/hr/shift-assignments' ? ok([assignment]) : url==='/api/hr/shifts' ? ok([shift]) : url==='/api/hr/leave-types' ? ok([leave]) : url==='/api/hr/holidays' ? ok([holiday]) : failure(405);
  let readResponder=defaultRead;
  let writeResponder = () => ok(receipt, 201);
  global.fetch = async (url, init = {}) => {
    const isWrite = (init.method ?? 'GET') !== 'GET';
    const call = { url, init, owner: { ...identity, permissions: [...identity.permissions] }, body: init.body instanceof SyntheticFormData ? Object.fromEntries(init.body) : init.body };
    calls.push(call); return isWrite ? writeResponder(url, init, call) : readResponder(url, init, call);
  };
  const loader = sourceLoader({
    react: hooks,
    'next/navigation': { useRouter: () => router, usePathname: () => pathname, useSearchParams: () => params },
    '@/components/dashboard-session-context': { useDashboardSession: () => ({ loading: sessionLoading, tenant: { organization: { id: identity.organizationId }, membership_id: identity.membershipId, role_id: identity.roleId, status: 'active', permissions: identity.permissions }, profile: { email: identity.email } }) },
    '@/components/hr-access-context': { useHRAccess: () => ({ access: caps, loading: false, error: null }) },
    '@/components/searchable-select': { SearchableSelect: () => null },
  });
  function render() {
    if (!alive) return tree;
    index = 0; dirty = false; tree = mode==='create' ? loader.load('src/hooks/use-hr-settings-assignment-create.ts').useHRSettingsAssignmentCreate() : loader.load('src/hooks/use-hr-settings-browse.ts').useHRSettingsBrowse();
    const queued = [...layouts]; layouts.clear(); for (const [i, item] of queued) { effects.get(i)?.cleanup?.(); effects.set(i, { ...item, layout: true, cleanup: item.fn() }); }
    return tree;
  }
  async function flush() {
    for (let n = 0; n < 50; n++) {
      if (!alive) { await tick(); return tree; }
      if (dirty || !tree) render();
      const queued = [...passives]; passives.clear(); for (const [i, item] of queued) { effects.get(i)?.cleanup?.(); effects.set(i, { ...item, layout: false, cleanup: item.fn() }); }
      await tick(); await tick(); if (!dirty && !passives.size) return tree;
    }
    throw Error('Settings hook did not settle');
  }
  const api = {
    calls, nav, prompts, loader, formNode, render, flush, defaultRead, vm: () => tree,
    query(value) { params = new URLSearchParams(value); dirty = true; },
    path(value) { pathname = value; dirty = true; },
    review() { return tree.review(formNode); },
    submit() { return tree.submit(); },
    change(name, value) { formNode.fields[name] = value; tree.changed(); },
    writes: () => calls.filter(call => call.url === '/api/hr/shift-assignments' && call.init.method === 'POST'),
    respondWrites(fn) { writeResponder = fn; }, respondReads(fn) { readResponder = fn; },
    identity(next) { identity = { ...identity, ...next }; dirty = true; }, caps(next) { caps = { ...caps, ...next }; dirty = true; }, sessionLoading(value) { sessionLoading = value; dirty = true; }, exit(value) { allowExit = value; },
    anchor(href) { const event = new Event('click', { cancelable: true }); Object.defineProperties(event, { target: { value: new Element(href) }, button: { value: 0 } }); win.dispatchEvent(event); return event; },
    layoutUnmount() { alive = false; for (const item of effects.values()) if (item.layout) item.cleanup?.(); layouts.clear(); passives.clear(); },
    cleanup() { alive = false; for (const item of effects.values()) item.cleanup?.(); effects.clear(); layouts.clear(); passives.clear(); Object.assign(global, saved); },
  };
  return api;
}
module.exports = { harness, ok, failure, deferred, receipt, access, meta, shift,leave,holiday,assignment,tick, textOf, elements, SyntheticFormData };
