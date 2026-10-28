/* Actual Records page and source hooks under deterministic synthetic scheduling.
 * No React DOM/browser, live API, storage, file upload or database proof. */
const { sourceLoader } = require('./reconciliation-harness.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const failure = (status, detail = 'Synthetic precommit rejection') => ok({ detail }, status);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const access = { can_view: true, can_manage: true, can_self: true, can_view_people: true, can_manage_people: true, can_invite_employees: true, can_manage_structure: true, is_employee: true, role_name: 'Synthetic manager', timezone: 'Asia/Dhaka', currency: 'BDT', landing: 'overview' };
const meta = { employees: [{ id: 'synthetic-employee', employee_code: 'SYN-01', name: 'Synthetic Employee' }] };
const receipt = { id: 'synthetic-document', file_url: '/api/hr-documents/synthetic-document/file' };
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
function harness() {
  const slots = [], effects = new Map(), layouts = new Map(), passives = new Map(), calls = [], nav = [], prompts = [];
  let params = new URLSearchParams();
  let index = 0, dirty = true, alive = true, tree, allowExit = true, caps = { ...access }, sessionLoading = false;
  let identity = { organizationId: 'synthetic-company-A', membershipId: 'synthetic-member-A', roleId: 'synthetic-role-A', permissions: ['hr.view', 'hr.manage'], email: 'synthetic-A@example.invalid' };
  const saved = { fetch: global.fetch, window: global.window, document: global.document, Node: global.Node, Element: global.Element, FormData: global.FormData };
  const syntheticFile = new File(['SYNTHETIC MEMORY ONLY. NOT A USER DOCUMENT.'], 'synthetic-document.pdf', { type: 'application/pdf' });
  const formNode = { fields: { employee_id: 'synthetic-employee', title: 'Synthetic contract', document_type: 'contract', reference_number: 'SYN-REF', issued_on: '2026-01-02', expires_on: '2027-01-02', notes: 'Synthetic note', file: syntheticFile }, reset() { this.resetCount = (this.resetCount ?? 0) + 1; } };
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
  global.window = win; global.document = { getElementById: () => null }; global.Node = Node; global.Element = Element; global.FormData = SyntheticFormData;
  let readResponder = url => url === '/api/hr/access' ? ok(caps) : url === '/api/hr/meta' ? ok(meta) : ['/api/hr/documents', '/api/hr/lifecycle'].includes(url) ? ok([]) : failure(405);
  let writeResponder = () => ok(receipt, 201);
  global.fetch = async (url, init = {}) => {
    const isWrite = (init.method ?? 'GET') !== 'GET';
    const call = { url, init, owner: { ...identity, permissions: [...identity.permissions] }, body: init.body instanceof SyntheticFormData ? Object.fromEntries(init.body) : init.body };
    calls.push(call); return isWrite ? writeResponder(url, init, call) : readResponder(url, init, call);
  };
  const loader = sourceLoader({
    react: hooks,
    'next/navigation': { useRouter: () => router, usePathname: () => '/dashboard/hr/records', useSearchParams: () => params },
    '@/components/dashboard-session-context': { useDashboardSession: () => ({ loading: sessionLoading, tenant: { organization: { id: identity.organizationId }, membership_id: identity.membershipId, role_id: identity.roleId, status: 'active', permissions: identity.permissions }, profile: { email: identity.email } }) },
    '@/components/hr-access-context': { useHRAccess: () => ({ access: caps, loading: false, error: null }) },
    '@/components/searchable-select': { SearchableSelect: () => null },
  });
  const attachedRefs = new Set();
  const fileNode = { name: 'file', get files() { return formNode.fields.file ? [formNode.fields.file] : []; }, get value() { return formNode.fields.file ? 'synthetic-memory-selection' : ''; }, set value(value) { if (value === '') formNode.fields.file = null; } };
  function bindRefs() { for (const ref of attachedRefs) ref.current = null; attachedRefs.clear(); for (const element of elements(tree)) { const ref = element.props.ref; if (ref && typeof ref === 'object' && 'current' in ref) { const node = element.type === 'form' ? formNode : element.type === 'input' && element.props.type === 'file' ? fileNode : null; if (node) { ref.current = node; attachedRefs.add(ref); } } } }
  function render() {
    if (!alive) return tree;
    index = 0; dirty = false; tree = loader.load('src/app/dashboard/hr/records/page.tsx').default(); bindRefs();
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
    throw Error('Records page did not settle');
  }
  const modal = () => elements(tree).find(node => node.props.title === 'Upload employee document');
  const form = () => elements(modal()).find(node => node.type === 'form');
  const button = label => elements(tree).find(node => node.type === 'button' && textOf(node).trim() === label);
  const api = {
    calls, nav, prompts, loader, formNode, render, flush, query(value) { params = new URLSearchParams(value); dirty = true; }, elements: () => elements(tree), tree: () => tree, text: () => textOf(tree), modal, form, button,
    async openUpload() { await flush(); const opener = button('Upload document'); if (!opener) throw Error('Upload opener missing'); opener.props.onClick(); await flush(); },
    submit(captured = form()) { if (!captured) throw Error('Upload form missing'); return captured.props.onSubmit({ preventDefault() {}, currentTarget: formNode, target: formNode }); },
    closeUpload(captured = modal()) { if (!captured) throw Error('Upload modal missing'); return captured.props.onClose(); },
    uploadVisible: () => Boolean(modal()),
    change(name, value) { formNode.fields[name] = value; form()?.props.onChange?.({ target: { name, value }, currentTarget: formNode }); },
    writes: () => calls.filter(call => call.url === '/api/hr-documents/upload' && call.init.method === 'POST'),
    respondWrites(fn) { writeResponder = fn; }, respondReads(fn) { readResponder = fn; },
    identity(next) { identity = { ...identity, ...next }; dirty = true; }, caps(next) { caps = { ...caps, ...next }; dirty = true; }, sessionLoading(value) { sessionLoading = value; dirty = true; }, exit(value) { allowExit = value; },
    anchor(href) { const event = new Event('click', { cancelable: true }); Object.defineProperties(event, { target: { value: new Element(href) }, button: { value: 0 } }); win.dispatchEvent(event); return event; },
    layoutUnmount() { alive = false; for (const item of effects.values()) if (item.layout) item.cleanup?.(); layouts.clear(); passives.clear(); },
    cleanup() { alive = false; for (const item of effects.values()) item.cleanup?.(); effects.clear(); layouts.clear(); passives.clear(); Object.assign(global, saved); },
  };
  return api;
}
module.exports = { harness, ok, failure, deferred, receipt, access, meta, tick, textOf, elements, SyntheticFormData };
