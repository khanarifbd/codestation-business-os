// These tests use synthetic data and mocked fetch/confirm/router hooks only.
// They do not prove browser login, session preservation, authorization or persistence.
const assert = require('node:assert/strict');
const test = require('node:test');
const { componentFixture, response } = require('./helpers/component-fixture.cjs');

const peoplePath = 'components/people/people-workspace.tsx';
const accessPath = 'components/client-access-section.tsx';

function person(id, overrides = {}) {
  return { id, full_name: `Synthetic person ${id}`, employee_code: `EMP-${id}`, login_email: `${id}@example.test`, work_email: null, role_name: 'User', membership_status: 'active', employment_status: 'active', employment_type: 'full_time', ...overrides };
}
function directoryBundle(overrides = {}) {
  return { people: [person('owner', { role_name: 'Owner' }), person('employee')], departments: [{ id: 'department', name: 'Engineering' }], designations: [], invite_roles: [{ id: 'role', name: 'User' }], invitations: [{ id: 'invite', full_name: 'Invited person', email: 'invite@example.test', employee_code: 'EMP-3', role_name: 'User', expires_at: '2026-11-01T00:00:00Z' }], capabilities: { can_manage_people: true, can_invite_employees: true, can_manage_structure: true }, ...overrides };
}
// HR06 now renders the actual extracted controller and register components. The
// old monolithic page state order is intentionally not treated as an API contract.
function peopleFixture(bundle, search = '') {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const ts = require('typescript'), React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const values = ['idle', bundle, false, null, null, {}, {}, false, false, null, null, null];
  const refs = [], memos = [], layouts = [], modules = new Map(); let cursor = 0, refCursor = 0, memoCursor = 0, layoutCursor = 0, company = 'synthetic-company';
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks = { ...React, useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; }, useRef(initial) { return refs[refCursor++] ??= { current: initial }; }, useEffect() {}, useLayoutEffect(fn,deps) {const i=layoutCursor++,old=layouts[i];layouts[i]={fn,deps,cleanup:old?.cleanup,changed:!old||!same(old.deps,deps)};}, useMemo(fn,deps) {const i=memoCursor++;if(!memos[i]||!same(memos[i].deps,deps))memos[i]={deps,value:fn()};return memos[i].value;}, useCallback(fn,deps) {return hooks.useMemo(()=>fn,deps);} };
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const compiled = { exports: {} }; modules.set(filename, compiled.exports);
    let source = fs.readFileSync(filename, 'utf8');
    if (filename.endsWith('/people-workspace.tsx')) source += '\nexport const TestPeopleContent = PeopleContent;';
    source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { module: compiled, exports: compiled.exports, URLSearchParams, Error,
      fetch: () => { throw new Error('Unexpected HR06 fixture request'); },
      require(name) {
        if (name === 'react') return hooks;
        if (name === 'next/navigation') return { useParams: () => ({}), usePathname: () => '/dashboard/hr/people', useSearchParams: () => new URLSearchParams({ search }), useRouter: () => ({push(){throw Error('Unexpected stale navigation');}}) };
        if (name.includes('document-navigation-guard')) return { useDocumentNavigationGuard: () => ({ confirmLeave: () => true, navigate: () => false, markClean() {} }) };
        if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
        if (name.endsWith('.css')) return {};
        if (name === '@/components/searchable-select') return { SearchableSelect: () => null };
        if (name === '@/components/dashboard-session-context') return { useDashboardSession: () => ({ tenant: {organization:{id:company},membership_id:'synthetic-member',role_id:'synthetic-role',status:'active',permissions:['*']}, loading: false }) };
        if (name === '@/components/relationships/relationship-ui') return { RelationshipPage: ({ children }) => React.createElement('main', null, children), RelationshipNotice: ({ children }) => React.createElement('aside', null, children) };
        if (name.startsWith('@/') || name.startsWith('.')) { const base = name.startsWith('@/') ? path.resolve(__dirname, '../src', name.slice(2)) : path.resolve(path.dirname(filename), name); const found = ['.tsx', '.ts'].map(ext => base + ext).find(fs.existsSync); if (found) return load(found); }
        return require(name);
      },
    }, { filename });
    return compiled.exports;
  }
  const Component = load(path.resolve(__dirname, '../src', peoplePath)).TestPeopleContent;
  function begin(){cursor=0;refCursor=0;memoCursor=0;layoutCursor=0;}
  function commit(){for(const slot of layouts)if(slot.changed){slot.changed=false;slot.cleanup?.();slot.cleanup=slot.fn();}}
  return { setBundle(next){values[1]=next;}, controller(){begin();const result=load(path.resolve(__dirname,'../src/hooks/use-people-workspace.ts')).usePeopleWorkspace();commit();return result;}, company(value){company=value;}, unmount(){for(const slot of layouts)slot.cleanup?.();}, render() { begin();const tree=Component();commit();return renderToStaticMarkup(tree); } };
}
function metric(html, label, value) {
  const matches = [...html.matchAll(new RegExp(`<dt>${label}</dt><dd>([^<]*)</dd>`, 'g'))].map(match => match[1]);
  // Desktop and collapsed mobile disclosure must contain the same exact counts.
  assert.deepEqual(matches, [String(value), String(value)]);
}

test('HR06 faithful layout lifetime blocks retained controller after unmount and company replacement',async()=>{for(const boundary of ['unmount','company']){const fixture=peopleFixture(directoryBundle());const old=fixture.controller();if(boundary==='unmount')fixture.unmount();else{fixture.company('replacement');fixture.controller();}old.openPerson('employee');old.changeBrowse({search:'stale'});await old.load();assert.equal(old.values.full_name,undefined);fixture.unmount();}});

test('HR06 directory renders all supplied people and active/pending counts before acceptance', () => {
  const fixture = peopleFixture(directoryBundle());
  const html = fixture.render();
  metric(html, 'People', 2); metric(html, 'Active', 2); metric(html, 'Invites pending', 1);
  assert.match(html, /Synthetic person owner/); assert.match(html, /Synthetic person employee/);
  assert.equal((html.match(/aria-label="Edit Synthetic person /g) || []).length, 2);
  for (const id of ['owner', 'employee']) assert.match(html, new RegExp(`/dashboard/hr/people/${id}/edit\\?`));
});
test('HR06 post-acceptance bundle renders the new employee and no pending invitation', () => {
  const fixture = peopleFixture(directoryBundle());
  fixture.render();
  fixture.setBundle(directoryBundle({ people: [person('owner', { role_name: 'Owner' }), person('employee'), person('invited')], invitations: [] }));
  const html = fixture.render();
  metric(html, 'People', 3); metric(html, 'Active', 3); metric(html, 'Invites pending', 0);
  assert.match(html, /Synthetic person invited/); assert.match(html, /EMP-invited/);
});
test('HR06 active count excludes inactive employment and suspended membership', () => {
  const fixture = peopleFixture(directoryBundle({ people: [person('owner'), person('suspended', { membership_status: 'suspended' }), person('terminated', { employment_status: 'terminated' })] }));
  const html = fixture.render();
  metric(html, 'People', 3); metric(html, 'Active', 1);
  assert.match(html, /Access: suspended/); assert.match(html, /terminated/);
});
test('HR06 case-insensitive trimmed search filters rows without changing global counts', () => {
  const fixture = peopleFixture(directoryBundle(), ' EMP-OWNER ');
  const html = fixture.render();
  metric(html, 'People', 2); metric(html, 'Active', 2);
  assert.match(html, /Synthetic person owner/); assert.doesNotMatch(html, /Synthetic person employee/);
});
test('HR06 advertised role search returns employees whose names do not contain their role', () => {
  const fixture = peopleFixture(directoryBundle({ people: [person('alex', { role_name: 'Finance Manager' }), person('jo')] }), ' finance manager ');
  const html = fixture.render();
  assert.match(html, /Synthetic person alex/); assert.doesNotMatch(html, /Synthetic person jo/);
});
test('HR06 read-only directory does not expose owner mutation controls', () => {
  const fixture = peopleFixture(directoryBundle({ capabilities: { can_manage_people: false, can_invite_employees: false, can_manage_structure: false } }));
  const html = fixture.render();
  assert.doesNotMatch(html, /Invite person|>Edit<\/(?:button|a)>|aria-label="Edit Synthetic person |Invites pending|>Invitations<\/button>/);
  assert.equal((html.match(/View only/g) || []).length, 2);
});

// CP05 now exercises the actual dedicated decision hook and presentation. The
// legacy inline buttons/state positions are not the business contract. The old
// slash-containing fake ID was not a valid server UUID; use a valid synthetic ID
// and retain an explicit AST assertion that the endpoint encodes frozen.id.
function quotationFixture(overrides = {}) {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { hookHarness, sourceLoader } = require('./reconciliation-harness.cjs');
  const f = require('./client-portal-fixtures.cjs');
  const row = { ...f.clone(f.quotationDetail), ...overrides };
  const record = { value: row, loading: false, error: null, status: 200, version: 1, isCurrent: () => true, refresh: async () => ({ current: true, value: row, status: 200 }) };
  const h = hookHarness({ file: 'src/hooks/use-client-quotation-decision.ts', target: 'useClientQuotationDecision', args: [record, 'rejected', '/dashboard/client/quotations/' + row.id] });
  const read = value => ({ value, loading: false, error: null, isCurrent: () => true });
  const loader = sourceLoader({
    '@/hooks/use-client-portal-document': { usePortalDocument: () => ({ scope: { loading: false, ready: true }, context: read(f.context), record, validId: true, backHref: '/dashboard/client/quotations', detailHref: '/dashboard/client/quotations/' + row.id }) },
    '@/hooks/use-client-quotation-decision': { useClientQuotationDecision: () => h.vm() },
    'next/navigation': { useSearchParams: () => new URLSearchParams('decision=rejected') },
  });
  const Component = loader.load('src/components/client-portal/portal-decision.tsx').PortalQuotationDecision;
  h.render();
  return { h, row, record, tree: () => Component({ id: row.id }), html: () => renderToStaticMarkup(React.createElement(Component, { id: row.id })) };
}
test('CP05 cancelling rejection performs no request and keeps the sent quotation', async () => {
  const fixture = quotationFixture(), { h } = fixture;
  try {
    assert.equal(h.vm().arm(), true); await h.flush();
    assert.equal(h.vm().review.target, 'rejected'); assert.equal(h.vm().review.number, fixture.row.quotation_number);
    const tree = fixture.tree();
    const confirmation = tree.props.children.props.children.find(node => node?.props?.confirmLabel === 'Confirm rejection');
    assert.ok(confirmation); assert.equal(confirmation.props.onCancel, h.vm().close);
    confirmation.props.onCancel(); await h.flush();
    assert.equal(h.calls.length, 0); assert.equal(h.vm().review, null); assert.equal(fixture.row.status, 'sent');
    assert.match(fixture.html(), /Review final confirmation/);
  } finally { h.cleanup(); }
});
test('CP05 confirmed rejection uses the exact encoded endpoint and removes decision controls', async () => {
  const fixture = quotationFixture(), { h } = fixture;
  try {
    h.respond(() => response(200, { ...fixture.row, status: 'rejected', rejected_at: '2026-10-23T05:00:00Z' }));
    h.vm().arm(); await h.flush(); await h.vm().confirm(); await h.flush();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, `/api/client-portal/quotations/${encodeURIComponent(fixture.row.id)}/decision`);
    assert.equal(h.calls[0].init.method, 'POST'); assert.deepEqual(JSON.parse(h.calls[0].init.body), { status: 'rejected' });
    const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
    const source = fs.readFileSync(path.join(__dirname, '../src/hooks/use-client-quotation-decision.ts'), 'utf8');
    const ast = ts.createSourceFile('decision.ts', source, ts.ScriptTarget.Latest, true); const urls = [];
    const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'fetch') urls.push(node.arguments[0].getText(ast)); ts.forEachChild(node, visit); }; visit(ast);
    assert.deepEqual(urls, ['`/api/client-portal/quotations/${encodeURIComponent(frozen.id)}/decision`']);
    assert.equal(h.vm().phase, 'acknowledged'); assert.equal(h.vm().result.status, 'rejected'); assert.equal(h.vm().busy, false);
    assert.match(fixture.html(), /is rejected/); assert.doesNotMatch(fixture.html(), /Review final confirmation|Confirm rejection|Confirm acceptance/);
  } finally { h.cleanup(); }
});
test('CP05 pending rejection locks confirmation and prevents repeat or opposite decisions', async () => {
  const fixture = quotationFixture(), { h } = fixture;
  try {
    let complete; h.respond(() => new Promise(resolve => { complete = resolve; }));
    h.vm().arm(); await h.flush(); const confirm = h.vm().confirm, pending = confirm();
    await confirm(); assert.equal(h.calls.length, 1); await h.flush();
    assert.equal(h.vm().busy, true); assert.equal(h.vm().locked, true); assert.equal(h.vm().arm(), false);
    function find(node) { if (!node || typeof node !== 'object') return null; if (Array.isArray(node)) return node.map(find).find(Boolean); if (node.props?.confirmLabel === 'Confirm rejection') return node; return find(node.props?.children); }
    const confirmation = find(fixture.tree()); assert.ok(confirmation); assert.equal(confirmation.props.loading, true);
    assert.equal(h.vm().cancel(), false); h.vm().close(); await h.flush(); assert.ok(h.vm().review);
    assert.doesNotMatch(fixture.html(), /Review final confirmation|Confirm acceptance/);
    complete(response(200, { ...fixture.row, status: 'rejected' })); await pending; await h.flush();
  } finally { h.cleanup(); }
});
test('CP05 rejected mutation returns its error without false success or losing the quotation', async () => {
  const fixture = quotationFixture(), { h } = fixture; let reads = 0;
  fixture.record.refresh = async () => { reads++; return { current: true, value: fixture.row, status: 200 }; };
  try {
    h.respond(() => response(409, { detail: 'Quotation has already been decided' }));
    h.vm().arm(); await h.flush(); await h.vm().confirm(); await h.flush();
    assert.match(fixture.html(), /Quotation has already been decided/); assert.match(fixture.html(), /Review final confirmation/);
    assert.equal(h.vm().result, null); assert.equal(h.vm().notice, null); assert.equal(h.vm().phase, 'idle'); assert.equal(h.vm().busy, false);
    assert.equal(fixture.row.status, 'sent'); assert.equal(reads, 1); assert.equal(h.calls.length, 1);
  } finally { h.cleanup(); }
});
test('CP05 unauthenticated decision redirects to login and does not claim rejection', async () => {
  const { h } = quotationFixture();
  try {
    h.respond(() => response(401, {})); h.vm().arm(); await h.flush(); await h.vm().confirm(); await h.flush();
    assert.deepEqual(h.nav.map(row => row.href), ['/login']); assert.equal(h.vm().notice, null); assert.equal(h.vm().result, null); assert.equal(h.vm().busy, false);
  } finally { h.cleanup(); }
});
test('CP05 loaded rejected quotations render read-only decision state', async () => {
  const fixture = quotationFixture({ status: 'rejected', rejected_at: '2026-10-23T05:00:00Z' }), { h } = fixture;
  try {
    assert.match(fixture.html(), /Rejected/); assert.match(fixture.html(), /new decision cannot be submitted/);
    assert.doesNotMatch(fixture.html(), /Review final confirmation|Confirm acceptance|Confirm rejection/);
    assert.equal(h.vm().arm(), false); await h.vm().confirm(); assert.equal(h.calls.length, 0);
  } finally { h.cleanup(); }
});

function accessOverview(overrides = {}) {
  return { client_id: 'client/id', display_name: 'Synthetic client', suggested_email: 'client@example.test', suggested_full_name: 'Synthetic Client', account_exists_for_suggested_email: true, enabled: true, pending: false, can_manage: true, users: [{ access_id: 'access/id', full_name: 'Synthetic Portal User', email: 'portal@example.test', is_primary_contact: true }], invitations: [], ...overrides };
}
function accessFixture(options = {}) {
  return componentFixture(accessPath, { exportName: 'ClientAccessSection', props: { clientId: 'client/id' }, states: [accessOverview(), false, null, null, null, false], ...options });
}
test('CP06 successful revoke refreshes access state to Disabled with no stale user', async () => {
  const calls = [];
  const fixture = accessFixture({ fetch: async (...args) => { calls.push(args); return calls.length === 1 ? response(204, null) : response(200, accessOverview({ enabled: false, users: [] })); } });
  fixture.render(); fixture.button('Revoke access').props.onClick(); await fixture.settle();
  assert.equal(calls.length, 2); assert.equal(calls[0][0], '/api/client-access?access_id=access%2Fid'); assert.equal(calls[0][1].method, 'DELETE');
  assert.equal(calls[1][0], '/api/client-access/manage/client/client%2Fid/overview');
  const html = fixture.render();
  assert.match(html, /Client portal access revoked/); assert.match(html, />Disabled</); assert.match(html, /No portal user has access yet/);
  assert.doesNotMatch(html, /Synthetic Portal User|Revoke access/); assert.equal(fixture.states[2], null);
});
test('CP06 revoking one of several users preserves remaining access reported by the server', async () => {
  let requests = 0;
  const fixture = accessFixture({ fetch: async () => ++requests === 1 ? response(204, null) : response(200, accessOverview({ users: [{ access_id: 'other', full_name: 'Remaining Portal User', email: 'remaining@example.test' }] })) });
  fixture.render(); fixture.button('Revoke access').props.onClick(); await fixture.settle();
  const html = fixture.render();
  assert.match(html, />Enabled</); assert.match(html, /Remaining Portal User/); assert.doesNotMatch(html, /Synthetic Portal User/);
});
test('CP06 failed revocation leaves the access state intact and shows the server error', async () => {
  let requests = 0;
  const fixture = accessFixture({ fetch: async () => { requests++; return response(403, { detail: 'Client access management is not allowed' }); } });
  fixture.render(); fixture.button('Revoke access').props.onClick(); await fixture.settle();
  const html = fixture.render();
  assert.equal(requests, 1); assert.match(html, /Client access management is not allowed/);
  assert.match(html, />Enabled</); assert.match(html, /Synthetic Portal User/); assert.doesNotMatch(html, /access revoked/);
  assert.equal(fixture.states[2], null);
});
test('CP06 read-only users cannot see revocation controls', () => {
  const fixture = accessFixture({ states: [accessOverview({ can_manage: false }), false, null, null, null, false] });
  const html = fixture.render(); assert.match(html, /Synthetic Portal User/); assert.doesNotMatch(html, /Revoke access/);
});
test('CP06 refresh network failure after revoke clears loading and avoids stale enabled access', async () => {
  let requests = 0;
  const fixture = accessFixture({ fetch: async () => { if (++requests === 1) return response(204, null); throw new Error('Synthetic offline refresh'); } });
  fixture.render(); fixture.button('Revoke access').props.onClick(); await fixture.settle();
  const html = fixture.render();
  assert.equal(fixture.states[1], false, 'refresh failure must clear loading');
  assert.match(html, /Synthetic offline refresh/); assert.match(html, /Client portal access revoked/);
  assert.doesNotMatch(html, />Enabled<|Synthetic Portal User|Revoke access/);
});
test('CP06 forbidden refresh after revoke does not render stale privileged access controls', async () => {
  let requests = 0;
  const fixture = accessFixture({ fetch: async () => ++requests === 1 ? response(204, null) : response(403, { detail: 'Access to this client was removed' }) });
  fixture.render(); fixture.button('Revoke access').props.onClick(); await fixture.settle();
  const html = fixture.render();
  assert.match(html, /Access to this client was removed/); assert.match(html, /Client portal access revoked/);
  assert.doesNotMatch(html, />Enabled<|Synthetic Portal User|Revoke access/);
  assert.equal(fixture.states[1], false);
});
test('CP06 network failure during revoke does not falsely remove access or claim success', async () => {
  const fixture = accessFixture({ fetch: async () => { throw new Error('Synthetic offline revoke'); } });
  fixture.render(); fixture.button('Revoke access').props.onClick(); await fixture.settle();
  const html = fixture.render();
  assert.match(html, /Synthetic offline revoke/); assert.match(html, />Enabled</); assert.match(html, /Synthetic Portal User/);
  assert.doesNotMatch(html, /Client portal access revoked/); assert.equal(fixture.states[2], null);
});
test('CP06 a pending invitation remains visible after the final active user is revoked', async () => {
  let requests = 0;
  const invite = { id: 'invite', full_name: 'Synthetic Invitee', email: 'invite@example.test', expires_at: '2026-11-01T00:00:00Z', last_sent_at: '2026-10-23T00:00:00Z' };
  const fixture = accessFixture({ fetch: async () => ++requests === 1 ? response(204, null) : response(200, accessOverview({ enabled: false, pending: true, users: [], invitations: [invite] })) });
  fixture.render(); fixture.button('Revoke access').props.onClick(); await fixture.settle();
  const html = fixture.render();
  assert.match(html, /Invitation pending/); assert.match(html, /Synthetic Invitee/);
  assert.doesNotMatch(html, />Disabled<|Synthetic Portal User|Revoke access|No portal user has access yet/);
});
test('CP06 revocation control disables while the request is pending', async () => {
  let complete; let requests = 0;
  const fixture = accessFixture({ fetch: () => ++requests === 1 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve(response(200, accessOverview({ enabled: false, users: [] }))) });
  fixture.render(); fixture.button('Revoke access').props.onClick(); fixture.render();
  assert.equal(fixture.button('Revoking…').props.disabled, true);
  complete(response(204, null)); await fixture.settle();
  assert.equal(requests, 2); assert.equal(fixture.states[2], null);
});
test('CP06 initial overview load renders the returned active access state', async () => {
  const calls = [];
  const fixture = accessFixture({ states: [null, true, null, null, null, false], fetch: async (...args) => { calls.push(args); return response(200, accessOverview()); } });
  fixture.render(); fixture.effects()[0](); await fixture.settle();
  const html = fixture.render();
  assert.equal(calls.length, 1); assert.equal(calls[0][0], '/api/client-access/manage/client/client%2Fid/overview');
  assert.equal(fixture.states[1], false); assert.match(html, />Enabled</); assert.match(html, /Synthetic Portal User/);
});
test('CP06 initial overview network failure settles loading and renders a useful error', async () => {
  const fixture = accessFixture({ states: [null, true, null, null, null, false], fetch: async () => { throw new Error('Synthetic initial offline'); } });
  fixture.render(); fixture.effects()[0](); await fixture.settle();
  const html = fixture.render();
  assert.equal(fixture.states[1], false); assert.match(html, /Synthetic initial offline/);
  assert.doesNotMatch(html, />Enabled<|Synthetic Portal User|Revoke access|access revoked/);
});
test('CP06 initial overview permission denial has no enabled badge or mutation controls', async () => {
  const fixture = accessFixture({ states: [null, true, null, null, null, false], fetch: async () => response(403, { detail: 'No permission to manage this client' }) });
  fixture.render(); fixture.effects()[0](); await fixture.settle();
  const html = fixture.render();
  assert.equal(fixture.states[1], false); assert.match(html, /No permission to manage this client/);
  assert.doesNotMatch(html, />Enabled<|Synthetic Portal User|Revoke access|access revoked/);
});
