const test = require('node:test');
const assert = require('node:assert/strict');
const { controlHarness, writes, ok, failure, deferred, tick } = require('./control-handlers-harness.cjs');
const f = require('./control-fixtures.cjs');
const root = '/dashboard/accounting/controls', id = 'synthetic-recurring-1', periodId = 'synthetic-period-1';
const browse = (tab = 'recurring') => () => controlHarness({ file: 'src/hooks/use-control-browse.ts', target: 'useControlBrowse', args: [tab] });
const document = (tab = 'recurring', recordId = id, back = root) => () => controlHarness({ file: 'src/hooks/use-control-document.ts', target: 'useControlDocument', args: [tab, recordId, back] });
const action = (tab = 'recurring', mode = 'status', recordId = id) => () => controlHarness({ file: 'src/hooks/use-control-action.ts', target: 'useControlAction', args: [tab, recordId, mode, `${root}?tab=${tab}&search=Synthetic&page=3&focus=${recordId}`] });
const create = (kind = 'recurring') => () => controlHarness({ file: 'src/hooks/use-control-create.ts', target: 'useControlCreate', args: [kind, `${root}?tab=${kind}&search=Synthetic`] });
const check = (name, make, run) => test(name, async () => { const h = make(); try { await run(h); } finally { h.cleanup(); } });
async function ready(h, reply) { h.respond(reply); await h.flush(); }
async function arm(h) { h.vm().review(); await h.flush(); assert.ok(h.vm().action.confirmation); }
async function fillRecurring(h, overrides = {}) {
  await ready(h, url => ok(url === '/api/finance/accounts' ? [f.account()] : f.meta()));
  for (const [key, value] of Object.entries(f.recurringForm(overrides))) h.vm().change(key, value);
  await h.flush();
}
async function fillPeriod(h) {
  await h.flush();
  for (const [key, value] of Object.entries({ name: 'Synthetic October', start_date: '2026-10-01', end_date: '2026-10-31' })) h.vm().changePeriod(key, value);
  await h.flush();
}

for (const [tab, endpoint, fixture] of [['recurring', 'recurring-expenses', f.recurring], ['automation', 'recurring-auto-post', f.automation], ['periods', 'accounting-periods', f.period]]) {
  check(`${tab} register reads one existing collection and no eager detail`, browse(tab), async h => {
    await ready(h, () => ok([fixture()]));
    assert.deepEqual(h.calls.map(call => call.url), [`/api/finance-controls/${endpoint}`]);
    assert.equal(h.vm().rows.length, 1); assert.equal(h.vm().total, 1); assert.equal(Object.hasOwn(h.vm(), 'selectedId'), false);
  });
}
check('loaded-array filters and pagination preserve focus without server-count claim', browse(), async h => {
  h.query('status=paused&search=Synthetic&page=2');
  await ready(h, () => ok(Array.from({ length: 25 }, (_, i) => f.recurring({ id: `syn-${i}`, is_active: false }))));
  assert.equal(h.vm().rows.length, 5); assert.equal(h.vm().filteredCount, 25); assert.equal(h.vm().pageCount, 2);
  const link = new URL(h.vm().viewHref('syn-20'), 'https://fixture.invalid');
  assert.equal(link.pathname, `${root}/recurring/syn-20`);
  const back = new URL(link.searchParams.get('returnTo'), 'https://fixture.invalid');
  assert.equal(back.searchParams.get('focus'), 'syn-20'); assert.equal(back.searchParams.get('page'), '2'); assert.equal(back.searchParams.get('status'), 'paused');
  h.vm().apply({ search: 'Changed' }); assert.match(h.nav.at(-1).href, /search=Changed/); assert.doesNotMatch(h.nav.at(-1).href, /page=|focus=/);
});
for (const [status, expected] of [['enabled', ['a', 'b']], ['disabled', ['c']], ['eligible', ['a', 'c']], ['ineligible', ['b']], ['needs_attention', ['a', 'b']]]) {
  check(`automation ${status} uses server state rather than invented browser-date readiness`, browse('automation'), async h => {
    h.query(`tab=automation&status=${status}`);
    await ready(h, () => ok([
      f.automation({ id: 'a', eligible: true, retryable: true, last_error: 'Failed' }),
      f.automation({ id: 'b', eligible: false, retryable: false, last_error: 'Setup error' }),
      f.automation({ id: 'c', auto_post: false, eligible: true, retryable: false, last_error: null }),
    ]));
    assert.deepEqual(h.vm().rows.map(row => row.id), expected);
  });
}
check('switching collections rejects late old response and does not preserve mismatched rows', browse(), async h => {
  const delayed = deferred();
  h.respond(url => url.endsWith('recurring-expenses') ? delayed.promise : ok([f.period()]));
  await h.flush(); h.query('tab=periods'); await h.flush(); assert.equal(h.vm().rows[0].id, periodId);
  delayed.resolve(ok([f.recurring()])); await h.flush(); assert.equal(h.vm().rows[0].id, periodId);
});
check('failed collection read is not empty and waits for explicit retry', browse(), async h => {
  await ready(h, () => failure(503)); assert.equal(h.vm().resource.value, null); assert.ok(h.vm().resource.error);
  await h.flush(); assert.equal(h.calls.length, 1);
  h.respond(() => ok([])); await h.vm().refresh(); await h.flush(); assert.deepEqual(h.vm().resource.value, []); assert.equal(h.vm().resource.error, null);
});
check('scope change ignores late previous-company401 and permission loss hides finance data', browse(), async h => {
  const delayed = deferred(); let count = 0;
  h.respond(() => ++count === 1 ? delayed.promise : ok([f.recurring({ name: 'Current company fixture' })]));
  await h.flush(); h.organization({ id: 'synthetic-company-b' }); await h.flush();
  delayed.resolve(failure(401)); await h.flush(); assert.equal(h.nav.length, 0); assert.equal(h.vm().rows[0].name, 'Current company fixture');
  h.permissions(['finance.manage']); await h.flush(); assert.equal(h.vm().resource.value, null); assert.equal(h.vm().rows.length, 0);
});
for (const permissions of [[], ['finance.manage']]) check(`read gate is exact finance.view ${JSON.stringify(permissions)}`, browse(), async h => {
  h.permissions(permissions); await ready(h, () => ok([f.recurring()])); assert.equal(h.calls.length, 0); assert.equal(h.vm().rows.length, 0);
});
check('detail resolves exact ID from supported array, never invented endpoint or first row', document('recurring', 'second'), async h => {
  await ready(h, () => ok([f.recurring(), f.recurring({ id: 'second' })])); assert.equal(h.vm().record.id, 'second');
  assert.equal(h.calls[0].url, '/api/finance-controls/recurring-expenses');
  h.render('recurring', 'missing', root); await h.flush(); assert.equal(h.vm().record, null);
});
check('invalid detail ID does not issue a collection request', document('recurring', '../escape'), async h => {
  await h.flush(); assert.equal(h.vm().invalidId, true); assert.equal(h.calls.length, 0);
});

check('schedule status confirms exact intended target with existing PATCH only', action(), async h => {
  await ready(h, () => ok([f.recurring()])); await arm(h);
  h.respond(() => ok(f.recurring({ is_active: false }))); await h.vm().action.confirm(); await h.flush();
  assert.equal(writes(h)[0].url, `/api/finance-controls/recurring-expenses/${id}`); assert.equal(writes(h)[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(writes(h)[0].init.body), { is_active: false }); assert.equal(h.vm().action.phase, 'acknowledged');
});
check('Auto retry freezes reviewed due date, single request and no replay key', action('automation', 'retry'), async h => {
  await ready(h, () => ok([f.automation()])); await arm(h); const delayed = deferred(); h.respond(() => delayed.promise);
  const vm = h.vm(), first = vm.action.confirm(), second = vm.action.confirm();
  assert.equal(writes(h).length, 1); assert.deepEqual(JSON.parse(writes(h)[0].init.body), { expected_next_due_date: '2026-10-01' });
  assert.equal(writes(h)[0].init.headers['Idempotency-Key'], undefined);
  delayed.resolve(ok(f.automation({ next_due_date: '2026-11-01', retryable: false, last_error: null })));
  await Promise.all([first, second]); await h.flush(); assert.equal(h.vm().action.phase, 'acknowledged');
  assert.equal(h.vm().action.result.next_due_date, '2026-11-01'); await h.vm().action.confirm(); assert.equal(writes(h).length, 1);
});
check('Auto retry is unavailable when server retryable is false despite eligible setup', action('automation', 'retry'), async h => {
  await ready(h, () => ok([f.automation({ retryable: false, last_error: null })])); h.vm().review(); await h.flush();
  assert.equal(h.vm().allowed, false); assert.equal(h.vm().action.confirmation, null); assert.equal(writes(h).length, 0);
});
check('disabling automation remains available for paused/ineligible schedules', action('automation', 'configure'), async h => {
  await ready(h, () => ok([f.automation({ is_active: false, eligible: false, auto_post: true })])); await arm(h);
  h.respond(() => ok(f.automation({ is_active: false, eligible: false, auto_post: false }))); await h.vm().action.confirm(); await h.flush();
  assert.deepEqual(JSON.parse(writes(h)[0].init.body), { enabled: false });
});
check('enabling ineligible automation is not exposed as a guaranteed safe action', action('automation', 'configure'), async h => {
  await ready(h, () => ok([f.automation({ eligible: false, auto_post: false })])); h.vm().review(); await h.flush();
  assert.equal(h.vm().action.confirmation, null); assert.equal(writes(h).length, 0);
});
check('fresh source change invalidates an old due-date confirmation before posting', action('automation', 'retry'), async h => {
  await ready(h, () => ok([f.automation()])); await arm(h); const old = h.vm().action;
  h.respond(() => ok([f.automation({ next_due_date: '2026-11-01' })])); await h.vm().refresh(); await h.flush();
  assert.equal(h.vm().action.confirmation, null); await old.confirm(); assert.equal(writes(h).length, 0);
});
for (const permissions of [[], ['finance.view'], ['finance.manage']]) check(`action permission ${JSON.stringify(permissions)} never writes`, action(), async h => {
  h.permissions(permissions); await ready(h, () => ok([f.recurring()])); h.vm().review(); await h.flush();
  assert.equal(h.vm().action.confirmation, null); assert.equal(writes(h).length, 0);
  if (!permissions.includes('finance.view')) assert.equal(h.calls.length, 0);
});
check('permission loss after review blocks captured confirmation callback', action(), async h => {
  await ready(h, () => ok([f.recurring()])); await arm(h); const old = h.vm().action;
  h.permissions(['finance.view']); await h.flush(); await old.confirm(); assert.equal(writes(h).length, 0);
});
check('wrong current schedule response is acknowledged and cannot issue another unkeyed retry', action('automation', 'retry'), async h => {
  await ready(h, () => ok([f.automation()])); await arm(h); h.respond(() => ok(f.automation({ id: 'wrong' })));
  await h.vm().action.confirm(); await h.flush(); assert.equal(h.vm().action.phase, 'acknowledged'); assert.equal(h.vm().action.result, null);
  h.vm().review(); await h.flush(); await h.vm().action.confirm(); assert.equal(writes(h).length, 1);
});
check('retry stale-date409 is explicit rejection, not evidence an older unknown write failed', action('automation', 'retry'), async h => {
  await ready(h, () => ok([f.automation()])); await arm(h); h.respond(() => failure(409));
  await h.vm().action.confirm(); await h.flush(); assert.equal(h.vm().action.phase, 'idle'); assert.equal(h.vm().action.confirmation, null); assert.equal(writes(h).length, 1);
});
check('unknown retry stays frozen after successful schedule refresh', action('automation', 'retry'), async h => {
  await ready(h, () => ok([f.automation()])); await arm(h); h.respond(() => failure(500));
  await h.vm().action.confirm(); await h.flush(); assert.equal(h.vm().action.phase, 'unknown');
  h.respond(() => ok([f.automation({ next_due_date: '2026-11-01' })])); await h.vm().refresh(); await h.flush();
  h.vm().review(); await h.flush(); await h.vm().action.confirm(); assert.equal(h.vm().action.phase, 'unknown'); assert.equal(writes(h).length, 1);
});
check('acknowledgement precedes JSON and malformed DTO cannot become safe-to-retry', action('automation', 'retry'), async h => {
  await ready(h, () => ok([f.automation()])); await arm(h); const delayed = deferred(); h.respond(() => ({ ok: true, status: 200, json: () => delayed.promise }));
  const request = h.vm().action.confirm(); await tick(); await h.flush(); assert.equal(h.vm().action.phase, 'acknowledged'); assert.equal(h.vm().action.canEdit(), false);
  delayed.reject(Error('Synthetic malformed JSON')); await request; await h.flush(); assert.equal(h.vm().action.phase, 'acknowledged'); assert.equal(h.vm().action.result, null);
});
check('period close requires organization-local date; missing timezone does not guess browser date', action('periods', 'close', periodId), async h => {
  h.organization({ timezone: undefined }); await ready(h, () => ok([f.period({ end_date: '2020-01-31', start_date: '2020-01-01' })]));
  assert.equal(h.vm().today, ''); assert.equal(h.vm().allowed, false); h.vm().review(); await h.flush(); assert.equal(writes(h).length, 0);
});
check('period close exact note payload and lifecycle gate', action('periods', 'close', periodId), async h => {
  await ready(h, () => ok([f.period({ end_date: '2020-01-31', start_date: '2020-01-01' })]));
  h.vm().change('  Synthetic close note  '); await h.flush(); await arm(h);
  h.respond(() => ok(f.period({ status: 'closed', close_notes: 'Synthetic close note' }))); await h.vm().action.confirm(); await h.flush();
  assert.deepEqual(JSON.parse(writes(h)[0].init.body), { notes: 'Synthetic close note' }); assert.match(writes(h)[0].url, /\/close$/);
});
check('period reopen validates reason, retains it on rejection and Cancel preserves return context', action('periods', 'reopen', periodId), async h => {
  await ready(h, () => ok([f.period({ status: 'closed' })])); h.vm().change('bad'); await h.flush(); h.vm().review(); await h.flush(); assert.ok(h.vm().error);
  h.vm().change('Synthetic reopening reason'); await h.flush(); await arm(h); h.respond(() => failure(422));
  await h.vm().action.confirm(); await h.flush(); assert.equal(h.vm().note, 'Synthetic reopening reason'); assert.equal(h.vm().action.phase, 'idle');
  h.exit(false); assert.equal(h.vm().cancel(), false); h.exit(true); assert.equal(h.vm().cancel(), true);
  assert.match(h.nav.at(-1).href, new RegExp(`/periods/${periodId}\\?`)); assert.match(h.nav.at(-1).href, /returnTo=/);
});

check('create schedule uses manual default and exact old API body', create(), async h => {
  await fillRecurring(h); await arm(h); assert.match(h.vm().action.confirmation.description, /manual schedule only/);
  h.respond(() => ok(f.recurring(), 201)); await h.vm().action.confirm(); await h.flush();
  const call = writes(h)[0], body = JSON.parse(call.init.body);
  assert.equal(call.url, '/api/finance-controls/recurring-expenses'); assert.equal(call.init.method, 'POST');
  assert.equal(body.expense_amount, '125'); assert.equal(body.tax_amount, '5'); assert.equal(body.interval_count, 1);
  assert.equal(body.client_id, null); assert.equal(body.project_id, null); assert.equal(Object.hasOwn(body, 'auto_post'), false);
  assert.equal(h.vm().action.phase, 'acknowledged'); assert.equal(h.nav.at(-1).options.replace, true);
});
check('create client changes clear project and project selection resolves its actual client', create(), async h => {
  await fillRecurring(h); h.vm().change('project_id', 'synthetic-project-1'); await h.flush(); assert.equal(h.vm().form.client_id, 'synthetic-client-1');
  h.vm().change('client_id', ''); await h.flush(); assert.equal(h.vm().form.project_id, '');
});
check('create field change invalidates confirmation and same-tick values win', create(), async h => {
  await fillRecurring(h); await arm(h); const old = h.vm().action;
  h.vm().change('name', 'Updated synthetic'); await h.flush(); assert.equal(h.vm().action.confirmation, null); await old.confirm(); assert.equal(writes(h).length, 0);
  const vm = h.vm(); vm.change('name', 'Same-tick synthetic'); vm.review(); await h.flush();
  h.respond(() => ok(f.recurring({ name: 'Same-tick synthetic' }), 201)); await h.vm().action.confirm(); assert.equal(JSON.parse(writes(h)[0].init.body).name, 'Same-tick synthetic');
});
check('create known422 keeps every input and requires new explicit review', create(), async h => {
  await fillRecurring(h); const before = { ...h.vm().form }; await arm(h); h.respond(() => failure(422));
  await h.vm().action.confirm(); await h.flush(); assert.deepEqual(h.vm().form, before); assert.equal(h.vm().action.phase, 'idle'); assert.equal(h.vm().action.confirmation, null);
  await h.vm().action.confirm(); assert.equal(writes(h).length, 1);
});
check('create ambiguous500 cannot repeat after successful setup read', create(), async h => {
  await fillRecurring(h); await arm(h); h.respond(() => failure(500)); await h.vm().action.confirm(); await h.flush();
  h.respond(url => ok(url === '/api/finance/accounts' ? [f.account()] : f.meta())); await h.vm().meta.refresh(); await h.vm().accounts.refresh(); await h.flush();
  h.vm().change('name', 'Cannot change'); h.vm().review(); await h.flush(); await h.vm().action.confirm();
  assert.equal(h.vm().action.phase, 'unknown'); assert.equal(h.vm().form.name, 'Synthetic hosting schedule'); assert.equal(writes(h).length, 1);
});
check('create saved result survives navigation failure without another schedule', create(), async h => {
  await fillRecurring(h); await arm(h); h.failNavigation(true); h.respond(() => ok(f.recurring(), 201));
  await h.vm().action.confirm(); await h.flush(); assert.equal(h.vm().action.phase, 'acknowledged'); assert.equal(h.vm().action.result.id, id);
  await h.vm().action.confirm(); assert.equal(writes(h).length, 1); assert.match(h.vm().action.notice, /navigation did not complete/);
});
for (const permissions of [[], ['finance.view'], ['finance.manage']]) check(`create exact permissions ${JSON.stringify(permissions)}`, create(), async h => {
  h.permissions(permissions); await fillRecurring(h); h.vm().review(); await h.flush(); assert.equal(writes(h).length, 0); assert.equal(h.vm().action.confirmation, null);
  if (!permissions.includes('finance.view')) assert.equal(h.calls.length, 0);
});
check('create missing metadata is not an available empty configuration', create(), async h => {
  await ready(h, () => failure(503)); for (const [key, value] of Object.entries(f.recurringForm())) h.vm().change(key, value);
  await h.flush(); h.vm().review(); await h.flush(); assert.equal(h.vm().action.confirmation, null); assert.ok(h.vm().error); assert.equal(writes(h).length, 0);
});
check('period create has no irrelevant metadata reads and uses exact inclusive date body', create('periods'), async h => {
  await fillPeriod(h); assert.equal(h.calls.length, 0); await arm(h); h.respond(() => ok(f.period(), 201));
  await h.vm().action.confirm(); await h.flush(); assert.deepEqual(JSON.parse(writes(h)[0].init.body), { name: 'Synthetic October', start_date: '2026-10-01', end_date: '2026-10-31' });
  assert.equal(h.vm().action.phase, 'acknowledged'); assert.match(h.vm().action.resultHref, /\/periods\/synthetic-period-1/);
});
check('create pending synchronous double confirm blocks Cancel and unmounted response cannot navigate', create('periods'), async h => {
  await fillPeriod(h); await arm(h); const delayed = deferred(); h.respond(() => delayed.promise);
  const vm = h.vm(), first = vm.action.confirm(), second = vm.action.confirm(); await h.flush(); assert.equal(writes(h).length, 1); assert.equal(h.vm().cancel(), false);
  h.unmount(); delayed.resolve(ok(f.period(), 201)); await Promise.all([first, second]); assert.equal(h.nav.length, 0);
});

check('manual schedule configuration is not blocked by new-post credit-card restriction', create(), async h => {
  await fillRecurring(h);
  h.respond(url => ok(url === '/api/finance/accounts' ? [f.account({ account_type: 'credit_card' })] : f.meta()));
  await h.vm().accounts.refresh(); await h.flush(); await arm(h);
  assert.match(h.vm().action.confirmation.warning, /[Cc]redit.card|unsupported/);
  assert.equal(writes(h).length, 0);
});
const manual = () => controlHarness({ file: 'src/hooks/use-control-manual-post.ts', target: 'useControlManualPost', args: [id, `${root}?search=Synthetic&focus=${id}`, 'synthetic-company:member:role:route'] });
const postBody = overrides => ({ expense_date: '2026-10-01', expense_amount: '125', account_amount: null, profitability_amount: null, reference: null, notes: 'Synthetic posting note', ...overrides });
const postReceipt = overrides => ({ recurring_expense: f.recurring({ next_due_date: '2026-11-01' }), expense_id: 'synthetic-expense-1', expense_number: 'SYN-EXP-001', posted_date: '2026-10-01', next_due_date: '2026-11-01', is_active: true, ...overrides });
function manualReads({ schedule = f.recurring(), account = f.account(), meta = f.meta() } = {}) {
  return url => ok(url === '/api/finance/accounts' ? [account] : url === '/api/finance/expense-meta' ? meta : [schedule]);
}
async function reviewManual(h, payload = postBody()) {
  assert.equal(h.vm().review(payload), true); await h.flush(); assert.equal(h.vm().posting.confirmOpen, true);
}
check('manual adapter seeds verified exact schedule once and preserves dirty state across rerenders', manual, async h => {
  await ready(h, manualReads()); assert.equal(h.vm().source.id, id); assert.equal(h.vm().posting.target.id, id); assert.equal(h.vm().ready, true);
  assert.equal(h.vm().posting.edit(), true); await h.flush(); assert.equal(h.vm().posting.dirty, true);
  h.render(); await h.flush(); assert.equal(h.vm().posting.dirty, true); assert.equal(h.vm().posting.target.id, id); assert.equal(writes(h).length, 0);
});
check('manual adapter never opens a paused source as an active new posting', manual, async h => {
  await ready(h, manualReads({ schedule: f.recurring({ is_active: false }) }));
  assert.equal(h.vm().posting.target, null); assert.equal(h.vm().ready, false); assert.equal(h.vm().review(postBody()), false); assert.equal(writes(h).length, 0);
});
check('manual missing linked client remains unavailable, never mistaken for explicit null currency', manual, async h => {
  await ready(h, manualReads({ schedule: f.recurring({ client_id: 'outside-first-500' }) }));
  assert.equal(h.vm().profitability.currency, null); assert.equal(h.vm().ready, false); assert.equal(h.vm().review(postBody()), false); assert.equal(writes(h).length, 0);
});
check('manual present client with null currency preserves backend expense-currency fallback', manual, async h => {
  const schedule = f.recurring({ client_id: 'synthetic-client-1', client_name: 'Synthetic client' });
  const metadata = f.meta({ clients: [{ ...f.meta().clients[0], currency: null }] });
  await ready(h, manualReads({ schedule, meta: metadata }));
  assert.deepEqual(h.vm().profitability, { currency: 'USD', warning: null }); assert.equal(h.vm().ready, true);
  await reviewManual(h); assert.equal(h.vm().reviewCurrency, 'USD');
  h.respond((url, init) => init?.method === 'POST' ? ok(postReceipt()) : manualReads({ schedule, meta: metadata })(url));
  await h.vm().confirm(); await h.flush();
  assert.equal(h.vm().posting.phase, 'confirmed'); assert.equal(writes(h).length, 1);
  assert.equal(JSON.parse(writes(h)[0].init.body).profitability_amount, null);
  assert.equal(JSON.parse(writes(h)[0].init.body).expense_date, '2026-10-01');
});
check('manual new-post readiness rejects a verified credit-card account', manual, async h => {
  await ready(h, manualReads({ account: f.account({ account_type: 'credit_card' }) }));
  assert.equal(h.vm().ready, false); assert.equal(h.vm().review(postBody()), false); assert.equal(writes(h).length, 0);
});
check('manual source/context change after first review prevents the first posting', manual, async h => {
  await ready(h, manualReads()); await reviewManual(h); const stale = h.vm();
  h.respond(manualReads({ account: f.account({ account_type: 'credit_card' }) })); await h.vm().accounts.refresh(); await h.flush();
  assert.equal(h.vm().ready, false); await stale.confirm(); await h.flush(); assert.equal(writes(h).length, 0);
});
check('manual adapter uses protected six-field body and preserved keyed controller', manual, async h => {
  await ready(h, manualReads()); const body = postBody(); await reviewManual(h, body);
  h.respond((url, init) => init?.method === 'POST' ? ok(postReceipt()) : manualReads({ schedule: f.recurring({ next_due_date: '2026-11-01' }) })(url));
  await h.vm().confirm(); await h.flush(); const call = writes(h)[0];
  assert.equal(call.url, `/api/finance-controls/recurring-expenses/${id}/post`);
  assert.deepEqual(JSON.parse(call.init.body), body); assert.equal(Object.keys(JSON.parse(call.init.body)).length, 6);
  assert.match(call.init.headers['Idempotency-Key'], /^synthetic-controls-key-/);
  assert.equal(h.vm().posting.phase, 'confirmed'); assert.equal(h.vm().posting.receipt.expense_id, 'synthetic-expense-1');
  await h.vm().confirm(); assert.equal(writes(h).length, 1);
});
check('manual acknowledged POST plus failed schedule readback never unlocks a new occurrence', manual, async h => {
  await ready(h, manualReads()); await reviewManual(h);
  h.respond((_url, init) => init?.method === 'POST' ? ok(postReceipt()) : failure(503));
  await h.vm().confirm(); await h.flush(); assert.equal(h.vm().posting.phase, 'confirmed'); assert.match(h.vm().readbackError, /acknowledged.*refresh is unavailable/);
  assert.equal(h.vm().review(postBody()), false); await h.vm().confirm(); assert.equal(writes(h).length, 1);
});
check('manual ambiguous request retains same key/body replay even if current account is now unsupported', manual, async h => {
  await ready(h, manualReads()); await reviewManual(h); h.respond(() => failure(500));
  await h.vm().confirm(); await h.flush(); assert.equal(h.vm().posting.phase, 'uncertain'); const original = writes(h)[0];
  h.respond(manualReads({ account: f.account({ account_type: 'credit_card' }) })); await h.vm().accounts.refresh(); await h.flush(); assert.equal(h.vm().ready, false);
  assert.equal(h.vm().posting.retryReview(), true); await h.flush();
  h.respond((url, init) => init?.method === 'POST' ? ok(postReceipt({ is_active: false, next_due_date: '2027-01-01' })) : manualReads()(url));
  await h.vm().confirm(); await h.flush(); assert.equal(writes(h).length, 2);
  assert.equal(writes(h)[1].init.body, original.init.body); assert.equal(writes(h)[1].init.headers['Idempotency-Key'], original.init.headers['Idempotency-Key']);
  assert.equal(h.vm().posting.phase, 'confirmed'); assert.equal(h.vm().posting.receipt.next_due_date, '2027-01-01');
});
check('manual confirmed malformed receipt is not a safe-to-retry posting', manual, async h => {
  await ready(h, manualReads()); await reviewManual(h);
  h.respond((url, init) => init?.method === 'POST' ? ok({ wrong: true }) : manualReads()(url));
  await h.vm().confirm(); await h.flush(); assert.equal(h.vm().posting.phase, 'confirmed'); assert.equal(h.vm().posting.receipt, null);
  assert.equal(h.vm().posting.retryReview(), false); assert.equal(h.vm().review(postBody()), false); await h.vm().confirm(); assert.equal(writes(h).length, 1);
});
check('manual pending/unmounted seed response makes no financial write or late navigation', manual, async h => {
  const delayed = deferred(); h.respond(url => url.endsWith('recurring-expenses') ? delayed.promise : manualReads()(url));
  await h.flush(); h.unmount(); delayed.resolve(ok([f.recurring()])); await tick(); await tick();
  assert.equal(writes(h).length, 0); assert.equal(h.nav.length, 0);
});
check('manual unknown replay retains reviewed profitability currency despite refreshed metadata', manual, async h => {
  const schedule = f.recurring({ client_id: 'synthetic-client-1', client_name: 'Synthetic client' });
  await ready(h, manualReads({ schedule })); await reviewManual(h, postBody({ profitability_amount: '100.00' }));
  assert.equal(h.vm().reviewCurrency, 'GBP'); h.respond(() => failure(500));
  await h.vm().confirm(); await h.flush(); const original = writes(h)[0];
  const changed = f.meta({ clients: [{ ...f.meta().clients[0], currency: 'EUR' }] });
  h.respond(manualReads({ schedule, meta: changed })); await h.vm().meta.refresh(); await h.flush();
  assert.equal(h.vm().profitability.currency, 'EUR'); assert.equal(h.vm().reviewCurrency, 'GBP');
  assert.equal(h.vm().posting.retryReview(), true); await h.flush(); assert.equal(h.vm().reviewCurrency, 'GBP');
  h.respond((url, init) => init?.method === 'POST' ? ok(postReceipt()) : manualReads({ schedule, meta: changed })(url));
  await h.vm().confirm(); await h.flush(); assert.equal(h.vm().posting.phase, 'confirmed');
  assert.equal(writes(h)[1].init.body, original.init.body); assert.equal(writes(h)[1].init.headers['Idempotency-Key'], original.init.headers['Idempotency-Key']);
});
check('manual adapter validates direct payloads before arming protected financial operation', manual, async h => {
  const schedule = f.recurring({ account_currency: 'EUR', client_id: 'synthetic-client-1' });
  await ready(h, manualReads({ schedule, account: f.account({ currency: 'EUR' }) }));
  for (const payload of [postBody({ expense_date: '2026-02-30' }), postBody({ expense_amount: '-10' }), postBody(), postBody({ account_amount: '110' }), postBody({ account_amount: '110', profitability_amount: '100', reference: 'x'.repeat(181) })]) {
    assert.equal(h.vm().review(payload), false); await h.flush(); assert.equal(h.vm().posting.confirmOpen, false); assert.ok(h.vm().formError);
  }
  await reviewManual(h, postBody({ expense_date: null, account_amount: '110', profitability_amount: '100' }));
  assert.equal(h.vm().posting.payload.expense_date, null); assert.equal(writes(h).length, 0);
});
