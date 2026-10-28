const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, ok, deferred, receipt } = require('./hr-records-upload-harness.cjs');

test('Records upload: transport interruption locks the old handler against a second request', async () => {
  const h = harness();
  try { await h.openUpload(); const form = h.form(); h.respondWrites(async () => { throw Error('Synthetic transport interruption after unknown effect'); }); await h.submit(form); await h.flush(); await h.submit(form); await h.flush(); assert.equal(h.writes().length, 1, 'An unknown upload outcome must never make its old handler reusable'); }
  finally { h.cleanup(); }
});

test('Records upload: malformed acknowledged success never claims secure upload success', async () => {
  const h = harness();
  try { await h.openUpload(); h.respondWrites(() => ok(null, 201)); await h.submit(); await h.flush(); assert.doesNotMatch(h.text(), /Employee document uploaded securely/, 'Malformed 2xx is acknowledged, not a verified uploaded-document receipt'); }
  finally { h.cleanup(); }
});

test('Records upload: malformed acknowledged response locks a retained submit callback', async () => {
  const h = harness();
  try { await h.openUpload(); const form = h.form(); h.respondWrites(() => ok(null, 201)); await h.submit(form); await h.flush(); await h.submit(form); await h.flush(); assert.equal(h.writes().length, 1, 'Acknowledged malformed result must not be resent through a stale callback'); }
  finally { h.cleanup(); }
});

test('Records upload: same-event duplicate submit sends one request before busy render', async () => {
  const h = harness(), flight = deferred(); let first, second;
  try { await h.openUpload(); const form = h.form(); h.respondWrites(() => flight.promise); first = h.submit(form); second = h.submit(form); assert.equal(h.writes().length, 1, 'Synchronous upload latch must block the duplicate before React renders busy'); }
  finally { flight.resolve(ok(receipt, 201)); await Promise.all([first, second]); await h.flush(); h.cleanup(); }
});

test('Records upload: pending Close keeps the active upload boundary mounted', async () => {
  const h = harness(), flight = deferred(); let pending;
  try { await h.openUpload(); const modal = h.modal(); h.respondWrites(() => flight.promise); pending = h.submit(); await h.flush(); h.closeUpload(modal); await h.flush(); assert.equal(h.uploadVisible(), true, 'Pending upload cannot dismiss its boundary through retained Close'); }
  finally { flight.resolve(ok(receipt, 201)); await pending; await h.flush(); h.cleanup(); }
});

test('Records upload: positive valid receipt still sends one exact FormData request', async () => {
  const h = harness();
  try { await h.openUpload(); await h.submit(); await h.flush(); assert.equal(h.writes().length, 1); assert.deepEqual(Object.keys(h.writes()[0].body).sort(), ['document_type', 'employee_id', 'expires_on', 'file', 'issued_on', 'notes', 'reference_number', 'title']); assert.equal(h.writes()[0].body.employee_id, 'synthetic-employee'); assert.match(h.text(), /uploaded|confirmed/i); }
  finally { h.cleanup(); }
});

const { failure, tick } = require('./hr-records-upload-harness.cjs');

for (const status of [400, 403, 404, 413, 422]) {
  test(`Records upload: structured precommit ${status} permits a deliberate corrected retry`, async () => {
    const h = harness();
    try { await h.openUpload(); h.respondWrites(() => failure(status)); await h.submit(); await h.flush(); h.respondWrites(() => ok(receipt, 201)); await h.submit(); await h.flush(); assert.equal(h.writes().length, 2); assert.match(h.text(), /uploaded|confirmed/i); }
    finally { h.cleanup(); }
  });
}

for (const value of [
  { id: 'synthetic-document', file_url: '/api/hr-documents/another-document/file' },
  { id: 'synthetic-document', file_url: 'https://synthetic.invalid/api/hr-documents/synthetic-document/file' },
  { id: 'synthetic-document', file_url: '/api/hr-documents/synthetic-document/file?download=1' },
  { id: 'synthetic-document', file_url: '/api/hr-documents/synthetic-document/file#download' },
  { id: '../synthetic-document', file_url: '/api/hr-documents/../synthetic-document/file' },
  { id: 'synthetic-document' },
  { file_url: '/api/hr-documents/synthetic-document/file' },
]) {
  test(`Records upload: mismatched or unsafe receipt stays locked (${JSON.stringify(value)})`, async () => {
    const h = harness();
    try { await h.openUpload(); const form = h.form(); h.respondWrites(() => ok(value, 201)); await h.submit(form); await h.flush(); assert.doesNotMatch(h.text(), /Employee document uploaded securely/); await h.submit(form); await h.flush(); assert.equal(h.writes().length, 1); }
    finally { h.cleanup(); }
  });
}

for (const applied of [false, true]) {
  test(`Records upload: transport ${applied ? 'applied-response-lost' : 'no-effect'} remains unknown and never resends`, async () => {
    const h = harness(); let effects = 0;
    try { await h.openUpload(); const form = h.form(); h.respondWrites(async () => { if (applied) effects++; throw Error('Synthetic response lost'); }); await h.submit(form); await h.flush(); assert.match(h.text(), /unknown|uncertain|may already/i); await h.submit(form); await h.flush(); assert.equal(h.writes().length, 1); assert.equal(effects, applied ? 1 : 0); }
    finally { h.cleanup(); }
  });
}

for (const status of [500, 503]) {
  test(`Records upload: ${status} is not a proven precommit rejection`, async () => {
    const h = harness();
    try { await h.openUpload(); const form = h.form(); h.respondWrites(() => failure(status)); await h.submit(form); await h.flush(); assert.match(h.text(), /unknown|uncertain|may already/i); await h.submit(form); await h.flush(); assert.equal(h.writes().length, 1); }
    finally { h.cleanup(); }
  });
}

test('Records upload: malformed rejection is not an authoritative retry permission', async () => {
  const h = harness();
  try { await h.openUpload(); const form = h.form(); h.respondWrites(() => ok(null, 400)); await h.submit(form); await h.flush(); await h.submit(form); await h.flush(); assert.equal(h.writes().length, 1); assert.match(h.text(), /unknown|uncertain|unverified/i); }
  finally { h.cleanup(); }
});

test('Records upload: delayed success JSON is acknowledged before parsing and remains pending', async () => {
  const h = harness(), body = deferred(); let pending;
  try { await h.openUpload(); const form = h.form(), modal = h.modal(); h.respondWrites(() => ({ ok: true, status: 201, json: () => body.promise })); pending = h.submit(form); await h.flush(); assert.match(h.text(), /acknowledged|verif/i); await h.submit(form); h.closeUpload(modal); await h.flush(); assert.equal(h.writes().length, 1); assert.equal(h.uploadVisible(), true); }
  finally { body.resolve(receipt); await pending; await h.flush(); h.cleanup(); }
});

test('Records upload: throwing success JSON is acknowledged but not confirmed or retryable', async () => {
  const h = harness();
  try { await h.openUpload(); const form = h.form(); h.respondWrites(() => ({ ok: true, status: 201, json: async () => { throw Error('Synthetic unreadable JSON'); } })); await h.submit(form); await h.flush(); assert.match(h.text(), /acknowledged|unverified/i); assert.doesNotMatch(h.text(), /Employee document uploaded securely/); await h.submit(form); assert.equal(h.writes().length, 1); }
  finally { h.cleanup(); }
});

test('Records upload: pending real shared navigation guard refuses native anchor exit', async () => {
  const h = harness(), flight = deferred(); let pending;
  try { await h.openUpload(); h.respondWrites(() => flight.promise); pending = h.submit(); await h.flush(); const event = h.anchor('/dashboard/hr'); assert.equal(event.defaultPrevented, true); assert.deepEqual(h.nav, []); }
  finally { flight.resolve(ok(receipt, 201)); await pending; await h.flush(); h.cleanup(); }
});

test('Records upload: unknown outcome dismissal warns and reopening does not reset the page latch', async () => {
  const h = harness();
  try { await h.openUpload(); const form = h.form(); h.respondWrites(async () => { throw Error('Synthetic response lost'); }); await h.submit(); await h.flush(); h.exit(false); h.closeUpload(); await h.flush(); assert.equal(h.uploadVisible(), true); assert.ok(h.prompts.length > 0); h.exit(true); h.closeUpload(); await h.flush(); await h.openUpload(); await h.submit(form); await h.flush(); assert.equal(h.writes().length, 1); assert.match(h.text(), /memory.only|reload|closing/i); }
  finally { h.cleanup(); }
});

for (const [kind, change] of [
  ['organization', { organizationId: 'synthetic-company-B' }],
  ['membership', { membershipId: 'synthetic-member-B' }],
  ['role', { roleId: 'synthetic-role-B' }],
  ['permissions', { permissions: ['hr.view'] }],
  ['account', { email: 'synthetic-B@example.invalid' }],
]) {
  test(`Records upload: ${kind} ownership change invalidates a retained submit callback at layout commit`, async () => {
    const h = harness();
    try { await h.openUpload(); const form = h.form(); h.identity(change); h.render(); await h.submit(form); assert.equal(h.writes().length, 0); }
    finally { h.cleanup(); }
  });
}

test('Records upload: revoked manage capability invalidates its previously captured submit handler', async () => {
  const h = harness();
  try { await h.openUpload(); const form = h.form(); h.caps({ can_manage: false }); h.render(); await h.submit(form); assert.equal(h.writes().length, 0); }
  finally { h.cleanup(); }
});

test('Records upload: stale 401 after an account layout switch cannot redirect current account', async () => {
  const h = harness(), flight = deferred(); let pending;
  try { await h.openUpload(); h.respondWrites(() => flight.promise); pending = h.submit(); await h.flush(); h.identity({ email: 'synthetic-B@example.invalid' }); h.render(); flight.resolve(failure(401)); await pending; await h.flush(); assert.deepEqual(h.nav, []); assert.doesNotMatch(h.text(), /uploaded securely/i); }
  finally { flight.resolve(failure(401)); await pending; h.cleanup(); }
});

test('Records upload: stale successful reply after layout unmount cannot claim a current success', async () => {
  const h = harness(), flight = deferred(); let pending;
  try { await h.openUpload(); h.respondWrites(() => flight.promise); pending = h.submit(); await h.flush(); const before = h.text(); h.layoutUnmount(); flight.resolve(ok(receipt, 201)); await pending; await tick(); assert.equal(h.text(), before); assert.deepEqual(h.nav, []); }
  finally { flight.resolve(ok(receipt, 201)); await pending; h.cleanup(); }
});

test('Records upload: current 401 retains the fixture-only authentication redirect', async () => {
  const h = harness();
  try { await h.openUpload(); h.respondWrites(() => failure(401)); await h.submit(); await h.flush(); assert.deepEqual(h.nav, [{ kind: 'replace', href: '/login' }]); }
  finally { h.cleanup(); }
});

test('Records upload: request snapshots selected FormData values once before late UI changes', async () => {
  const h = harness(), flight = deferred(); let pending;
  try { await h.openUpload(); h.respondWrites(() => flight.promise); pending = h.submit(); h.change('title', 'Later synthetic title'); h.change('employee_id', 'later-employee'); assert.equal(h.writes()[0].body.title, 'Synthetic contract'); assert.equal(h.writes()[0].body.employee_id, 'synthetic-employee'); assert.equal(h.writes().length, 1); }
  finally { flight.resolve(ok(receipt, 201)); await pending; await h.flush(); h.cleanup(); }
});


test('Records upload: settled upload success notice cannot survive into a different account owner', async () => {
  const h = harness();
  try { await h.openUpload(); await h.submit(); await h.flush(); assert.match(h.text(), /uploaded securely/i); h.identity({ email: 'synthetic-B@example.invalid' }); h.render(); assert.doesNotMatch(h.text(), /uploaded securely/i, 'An old account upload success must not remain a current account claim'); }
  finally { h.cleanup(); }
});

test('Records upload: confirmed receipt is not undone or made retryable by records-refresh failure', async () => {
  const h = harness();
  try { await h.openUpload(); const form = h.form(); h.respondReads(() => failure(503)); await h.submit(form); await h.flush(); assert.match(h.text(), /uploaded securely|verified document reference/i); await h.submit(form); await h.flush(); assert.equal(h.writes().length, 1); }
  finally { h.cleanup(); }
});

test('Records upload: framework validation detail array remains a known precommit422 rejection', async () => {
  const h = harness();
  try { await h.openUpload(); h.respondWrites(() => ok({ detail: [{ type: 'missing', loc: ['body', 'employee_id'], msg: 'Field required', input: null }] }, 422)); await h.submit(); await h.flush(); h.respondWrites(() => ok(receipt, 201)); await h.submit(); await h.flush(); assert.equal(h.writes().length, 2); }
  finally { h.cleanup(); }
});

const { meta: validMeta, access: validAccess } = require('./hr-records-upload-harness.cjs');
const baselineRead = url => url === '/api/hr/meta' ? ok(validMeta) : url === '/api/hr/access' ? ok(validAccess) : ['/api/hr/documents', '/api/hr/lifecycle'].includes(url) ? ok([]) : failure(405);
const selectAnotherFile = h => h.change('file', new File(['SECOND SYNTHETIC MEMORY ONLY'], 'second-synthetic.pdf', { type: 'application/pdf' }));

test('Records upload: close A then reopen B rejects stale submit and Close while current B still works', async () => {
  const h = harness();
  try { await h.openUpload(); const formA = h.form(), modalA = h.modal(); h.closeUpload(); await h.flush(); await h.openUpload(); const formB = h.form(); selectAnotherFile(h); h.closeUpload(modalA); await h.submit(formA); await h.flush(); assert.equal(h.uploadVisible(), true); assert.equal(h.writes().length, 0); await h.submit(formB); await h.flush(); assert.equal(h.writes().length, 1); assert.match(h.text(), /uploaded securely/i); }
  finally { h.cleanup(); }
});

test('Records upload: confirmed Close then deliberate new upload is allowed but the old callback stays inert', async () => {
  const h = harness();
  try { await h.openUpload(); const formA = h.form(); await h.submit(formA); await h.flush(); h.closeUpload(); await h.flush(); assert.equal(h.prompts.length, 0, 'Confirmed clean result must not trigger discard warning'); await h.openUpload(); selectAnotherFile(h); await h.submit(formA); assert.equal(h.writes().length, 1); await h.submit(); await h.flush(); assert.equal(h.writes().length, 2); assert.equal(h.writes()[1].body.file.name, 'second-synthetic.pdf'); }
  finally { h.cleanup(); }
});

test('Records upload: dirty Close cancellation preserves boundary and accepting it closes without writing', async () => {
  const h = harness();
  try { await h.openUpload(); h.change('notes', 'A deliberately edited synthetic draft'); h.exit(false); h.closeUpload(); await h.flush(); assert.equal(h.uploadVisible(), true); assert.equal(h.prompts.length, 1); h.exit(true); h.closeUpload(); await h.flush(); assert.equal(h.uploadVisible(), false); assert.equal(h.prompts.length, 2); assert.equal(h.writes().length, 0); }
  finally { h.cleanup(); }
});

test('Records upload: pending fresh employee read cannot authorize old form callback when the read later succeeds', async () => {
  const h = harness(), employeeRead = deferred();
  try { await h.flush(); h.respondReads(url => url === '/api/hr/meta' ? employeeRead.promise : baselineRead(url)); await h.openUpload(); const staleForm = h.form(); await h.submit(staleForm); assert.equal(h.writes().length, 0); employeeRead.resolve(ok(validMeta)); await h.flush(); await h.submit(staleForm); assert.equal(h.writes().length, 0, 'A callback without an authoritative read receipt cannot adopt a later one'); await h.submit(); await h.flush(); assert.equal(h.writes().length, 1); }
  finally { employeeRead.resolve(ok(validMeta)); h.cleanup(); }
});

test('Records upload: empty fresh employee context cannot authorize an old employee selection', async () => {
  const h = harness();
  try { await h.flush(); h.respondReads(url => url === '/api/hr/meta' ? ok({ employees: [] }) : baselineRead(url)); await h.openUpload(); await h.submit(); await h.flush(); assert.equal(h.writes().length, 0); assert.match(h.text(), /current company employee|employee/i); }
  finally { h.cleanup(); }
});

test('Records upload: malformed fresh employee context fails closed and explicit valid retry restores current form only', async () => {
  const h = harness();
  try { await h.flush(); h.respondReads(url => url === '/api/hr/meta' ? ok({ employees: [validMeta.employees[0], validMeta.employees[0]] }) : baselineRead(url)); await h.openUpload(); const staleForm = h.form(); await h.submit(staleForm); assert.equal(h.writes().length, 0); assert.match(h.text(), /could not be verified/i); h.respondReads(baselineRead); const retry = h.button('Retry employee context'); assert.ok(retry); retry.props.onClick(); await h.flush(); await h.submit(staleForm); assert.equal(h.writes().length, 0); await h.submit(); await h.flush(); assert.equal(h.writes().length, 1); }
  finally { h.cleanup(); }
});

test('Records upload: late previous-owner employee context cannot authorize its captured form in a new owner', async () => {
  const h = harness(), oldRead = deferred();
  try { await h.flush(); h.respondReads(url => url === '/api/hr/meta' ? oldRead.promise : baselineRead(url)); await h.openUpload(); const oldForm = h.form(); h.identity({ email: 'synthetic-B@example.invalid' }); h.render(); oldRead.resolve(ok(validMeta)); await h.flush(); await h.submit(oldForm); assert.equal(h.writes().length, 0); h.respondReads(baselineRead); await h.openUpload(); selectAnotherFile(h); await h.submit(); await h.flush(); assert.equal(h.writes().length, 1); assert.equal(h.writes()[0].owner.email, 'synthetic-B@example.invalid'); }
  finally { oldRead.resolve(ok(validMeta)); h.cleanup(); }
});

test('Records upload: old-owner response and finalizer cannot unlock a new-owner pending upload', async () => {
  const h = harness(), flightA = deferred(), flightB = deferred(); let pendingA, pendingB;
  try { await h.openUpload(); h.respondWrites(() => flightA.promise); pendingA = h.submit(); await h.flush(); h.identity({ email: 'synthetic-B@example.invalid' }); h.render(); await h.flush(); h.respondWrites(() => flightB.promise); await h.openUpload(); selectAnotherFile(h); const formB = h.form(); pendingB = h.submit(formB); await h.flush(); flightA.resolve(ok(receipt, 201)); await pendingA; await h.flush(); await h.submit(formB); assert.equal(h.writes().length, 2); assert.doesNotMatch(h.text(), /uploaded securely/i, 'Old owner success must not settle a new pending upload'); flightB.resolve(ok({ id: 'synthetic-document-B', file_url: '/api/hr-documents/synthetic-document-B/file' }, 201)); await pendingB; await h.flush(); assert.match(h.text(), /synthetic-document-B/); }
  finally { flightA.resolve(ok(receipt, 201)); flightB.resolve(ok(receipt, 201)); await Promise.all([pendingA, pendingB]); await h.flush(); h.cleanup(); }
});

test('Records upload: old confirmed follow-through read401 cannot overwrite a newer verified upload receipt', async () => {
  const h = harness(), oldDocs = deferred(); let firstDocs = true;
  try { await h.openUpload(); h.respondReads(url => { if (url === '/api/hr/documents' && firstDocs) { firstDocs = false; return oldDocs.promise; } return baselineRead(url); }); await h.submit(); await h.flush(); h.closeUpload(); await h.flush(); await h.openUpload(); selectAnotherFile(h); h.respondWrites(() => ok({ id: 'synthetic-document-B', file_url: '/api/hr-documents/synthetic-document-B/file' }, 201)); await h.submit(); await h.flush(); oldDocs.resolve(failure(401, 'Stale synthetic records401')); await h.flush(); assert.match(h.text(), /synthetic-document-B/); assert.doesNotMatch(h.text(), /Stale synthetic records401/); assert.deepEqual(h.nav, []); assert.equal(h.writes().length, 2); }
  finally { oldDocs.resolve(failure(401)); await tick(); h.cleanup(); }
});
