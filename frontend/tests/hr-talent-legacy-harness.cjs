/* Actual catalog-create hook and navigation guard under deterministic synthetic scheduling.
 * No React DOM/browser, live API, storage, file upload or database proof. */
const { sourceLoader } = require('./reconciliation-harness.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const failure = (status, detail = 'Synthetic precommit rejection') => ok({ detail }, status);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const access = { can_view: true, can_manage: true, can_self: true, can_view_people: true, can_manage_people: true, can_invite_employees: true, can_manage_structure: true, is_employee: true, role_name: 'Synthetic manager', timezone: 'Asia/Dhaka', currency: 'BDT', landing: 'overview' };
const meta = { employees: [{ id: 'synthetic-employee', employee_code: 'SYN-01', name: 'Synthetic Employee' }] };
const receipt = { id: 'synthetic-event' };
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
  getAll(name) { const v=this.data.get(name);return Array.isArray(v)?v:v===undefined?[]:[v]; }
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
function harness() {
  const slots = [], effects = new Map(), layouts = new Map(), passives = new Map(), calls = [], nav = [], prompts = [], copies=[];
  let pathname = '/dashboard/hr/talent', params = new URLSearchParams();
  let index = 0, dirty = true, alive = true, tree, allowExit = true, caps = { ...access }, sessionLoading = false;
  let identity = { organizationId: 'synthetic-company-A', membershipId: 'synthetic-member-A', roleId: 'synthetic-role-A', permissions: ['hr.view', 'hr.manage', 'employees.invite'], email: 'synthetic-A@example.invalid' };
  const saved = { navigatorDescriptor:Object.getOwnPropertyDescriptor(global,'navigator'), fetch: global.fetch, window: global.window, document: global.document, Node: global.Node, Element: global.Element, FormData: global.FormData };
  const formNode = {fields:{employee_id:'employee-a',reviewer_employee_id:'',period_start:'2026-01-01',period_end:'2026-02-01',title:'Synthetic',body:'Synthetic update',job_opening_id:'job-a',full_name:'Synthetic Candidate',email:'synthetic@example.invalid',openings:'1'}};
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
  const win = new EventTarget(); win.location = { href: 'https://synthetic.invalid/dashboard/hr/records', assign: href => nav.push({ kind: 'native', href }), replace: href => nav.push({ kind: 'native-replace', href }) }; win.confirm = message => { prompts.push(message); return allowExit; }; win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{copies.push('copied');}}}});win.location.origin='https://synthetic.invalid';global.window = win; global.document = { getElementById: () => null }; global.Node = Node; global.Element = Element; global.FormData = SyntheticFormData;
  const job={id:'job-a',title:'Synthetic job',department_id:null,employment_type:'full_time',location:null,openings:1,status:'open',description:null};
  const candidate={id:'candidate-a',job_opening_id:'job-a',job_title:'Synthetic job',full_name:'Synthetic Candidate',email:'synthetic@example.invalid',phone:null,stage:'offer',rating:null,resume_url:null,notes:null};
  const review={id:'review-a',employee_id:'employee-a',employee_name:'Synthetic',reviewer_employee_id:null,period_start:'2026-01-01',period_end:'2026-02-01',status:'completed',goals:[],manager_review:null,rating:null};
  const dataset={'/api/hr/jobs':[job],'/api/hr/candidates':[candidate],'/api/hr/performance':[review],'/api/hr/announcements':[], '/api/hr/meta':{employees:[{id:'employee-a',name:'Synthetic',employee_code:'E1'}],departments:[]}};
  let readResponder=url=>ok(dataset[url]);
  let writeResponder=()=>ok({id:'created-a'},201);
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
    index = 0; dirty = false; tree = loader.load('src/hooks/use-hr-talent.ts').useHRTalent();
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
    throw Error('Catalog page did not settle');
  }
  const api = {
    calls, nav, prompts, copies, dataset, loader, formNode, render, flush, vm: () => tree,
    query(value) { params = new URLSearchParams(value); dirty = true; },
    path(value) { pathname = value; dirty = true; },
    event(){return {preventDefault(){},currentTarget:formNode};},
    async open(kind){tree.setModal(kind);await api.flush();},
    accessNull(){caps=null;dirty=true;},
    change(name, value) { formNode.fields[name] = value; tree.markDirty(); },
    writes: () => calls.filter(call => ['POST','PATCH'].includes(call.init.method)),
    respondWrites(fn) { writeResponder = fn; }, respondReads(fn) { readResponder = fn; },
    identity(next) { identity = { ...identity, ...next }; dirty = true; }, caps(next) { caps = { ...caps, ...next }; dirty = true; }, sessionLoading(value) { sessionLoading = value; dirty = true; }, exit(value) { allowExit = value; },
    anchor(href) { const event = new Event('click', { cancelable: true }); Object.defineProperties(event, { target: { value: new Element(href) }, button: { value: 0 } }); win.dispatchEvent(event); return event; },
    layoutUnmount() { alive = false; for (const item of effects.values()) if (item.layout) item.cleanup?.(); layouts.clear(); passives.clear(); },
    cleanup() { alive = false; for (const item of effects.values()) item.cleanup?.(); effects.clear(); layouts.clear(); passives.clear(); const {navigatorDescriptor,...rest}=saved;Object.assign(global,rest);if(navigatorDescriptor)Object.defineProperty(global,'navigator',navigatorDescriptor);else delete global.navigator; },
  };
  return api;
}
module.exports = { harness, ok, failure, deferred, receipt, access, meta, tick, textOf, elements, SyntheticFormData };
