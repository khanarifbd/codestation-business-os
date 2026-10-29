const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./reconciliation-harness.cjs');
const f = require('./control-fixtures.cjs');
const m = sourceLoader().load('src/components/finance-controls/control-model.ts');
const types = sourceLoader().load('src/components/finance-controls/control-types.ts');

for (const [name, fixture, single, list] of [
  ['recurring', f.recurring, m.isRecurring, m.isRecurringList],
  ['automation', f.automation, m.isAutomation, m.isAutomationList],
  ['period', f.period, m.isPeriod, m.isPeriodList],
]) {
  test(`${name}: exact synthetic DTO and uncapped bare array accepted`, () => {
    assert.equal(single(fixture()), true);
    assert.equal(list([]), true);
    assert.equal(list(Array.from({ length: 1001 }, (_, i) => fixture({ id: `synthetic-${i}` }))), true);
    assert.equal(list({ items: [fixture()], next_cursor: null }), false);
  });
  test(`${name}: duplicate identities, malformed rows and missing identity rejected`, () => {
    assert.equal(list([fixture(), fixture()]), false);
    assert.equal(single({ ...fixture(), id: '../other' }), false);
    assert.equal(list([null]), false);
    assert.equal(single(null), false);
  });
}
for (const id of ['../a', 'a/b', 'a?x=1', 'a#hash', '%2f', '', 'new', 'post', 'retry', 'status', 'periods', 'a'.repeat(201)]) {
  test(`route identity rejected: ${JSON.stringify(id)}`, () => assert.equal(m.controlId(id), false));
}
test('route identity accepts UUID, opaque safe strings and length boundary', () => {
  for (const id of ['550e8400-e29b-41d4-a716-446655440000', 'synthetic_ID-1', 'a'.repeat(200)]) assert.equal(m.controlId(id), true);
});
for (const date of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01', '2026-01-01T00:00:00Z', '', null]) {
  test(`invalid calendar date ${date}`, () => assert.equal(m.controlDate(date), false));
}
test('dates retain leap-year and inclusive same-day boundary', () => {
  assert.equal(m.controlDate('2024-02-29'), true);
  assert.equal(m.controlDate('0099-01-01'), true);
  assert.ok(m.periodCreatePayload({ name: 'Day', start_date: '2026-10-26', end_date: '2026-10-26' }).body);
});
test('organization-local today never falls back to browser timezone', () => {
  const now = new Date('2026-10-26T23:30:00Z');
  assert.equal(m.controlToday('Asia/Dhaka', now), '2026-10-27');
  assert.equal(m.controlToday('America/New_York', now), '2026-10-26');
  assert.equal(m.controlToday(undefined, now), '');
  assert.equal(m.controlToday('Invalid/Zone', now), '');
  assert.equal(m.controlToday('UTC', new Date('invalid')), '');
});
test('money uses exact bigint HALF_UP and never fabricates zero for missing values', () => {
  assert.equal(m.controlCents('90071992547409.91'), 9007199254740991n);
  assert.equal(m.controlCents('1.005'), 101n);
  assert.equal(m.controlCents('-1.005'), -101n);
  assert.equal(m.controlCents('.005'), 1n);
  assert.equal(m.controlCents('1e3'), 100000n);
  assert.equal(m.controlCents(null), null);
  assert.equal(m.controlCents(undefined), null);
  assert.equal(m.controlCents(''), null);
  assert.equal(m.controlCents(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(m.controlMoney(null, 'USD'), 'USD —');
  assert.equal(m.controlMoney(undefined, 'GBP'), 'GBP —');
  assert.equal(m.controlMoney('1', '—'), '—');
  assert.match(m.controlMoney('90071992547409.91', 'USD'), /90,071,992,547,409\.91/);
  assert.match(m.controlMoney('-0.005', 'USD'), /-0\.01/);
});
test('read-side unknown lifecycle fields stay readable, malformed money does not', () => {
  assert.equal(m.isPeriod(f.period({ status: 'future_status' })), true);
  assert.equal(m.isRecurring(f.recurring({ frequency: 'future_frequency', payment_method: 'future_method' })), true);
  assert.equal(m.isRecurring(f.recurring({ expense_amount: '0.00' })), true); // Existing rounded zero is visible, never invented.
  for (const expense_amount of [null, '', 'NaN', '-1', '1.001', '10000000000000000.00']) assert.equal(m.isRecurring(f.recurring({ expense_amount })), false);
});
test('auto account fallback is preserved as unavailable context, not rejected whole row', () => {
  assert.equal(m.isAutomation(f.automation({ account_currency: '—', eligible: false, eligibility_reason: 'Account unavailable' })), true);
  assert.equal(m.isAutomation(f.automation({ account_currency: 'garbage' })), false);
});
test('DTO timestamps and booleans must be explicit and valid', () => {
  assert.equal(m.isRecurring(f.recurring({ auto_post: 'false' })), false);
  assert.equal(m.isRecurring(f.recurring({ last_posted_at: 'not-a-date' })), false);
  assert.equal(m.isPeriod(f.period({ closed_at: '2026-02-30T00:00:00Z' })), false);
  assert.equal(m.isAutomation(f.automation({ retryable: null })), false);
  assert.equal(m.isPeriod(f.period({ end_date: '2026-09-30' })), false);
});
test('metadata limits only clients/projects, other supported arrays uncapped', () => {
  assert.equal(m.isControlMeta(f.meta()), true);
  const rows = count => Array.from({ length: count }, (_, i) => ({ id: `id-${i}`, name: `Synthetic ${i}`, currency: 'USD' }));
  assert.equal(m.isControlMeta(f.meta({ clients: rows(500) })), true);
  assert.equal(m.isControlMeta(f.meta({ clients: rows(501) })), false);
  assert.equal(m.isControlMeta(f.meta({ vendors: rows(800).map(row => ({ ...row, is_active: true })) })), true);
  assert.equal(m.isControlMeta(f.meta({ projects: Array.from({ length: 501 }, (_, i) => ({ ...f.meta().projects[0], id: `p-${i}` })) })), false);
});
test('metadata rejects duplicate/malformed currencies and missing fields', () => {
  const original = f.meta();
  for (const key of ['vendors', 'categories', 'accounts', 'clients', 'projects']) {
    assert.equal(m.isControlMeta({ ...original, [key]: undefined }), false);
    assert.equal(m.isControlMeta({ ...original, [key]: [original[key][0], original[key][0]] }), false);
  }
  assert.equal(m.isControlMeta(f.meta({ clients: [{ ...original.clients[0], currency: null }] })), true);
  assert.equal(m.isControlMeta(f.meta({ accounts: [{ ...original.accounts[0], current_balance: '-20.00' }] })), true);
  assert.equal(m.isControlMeta(f.meta({ accounts: [{ ...original.accounts[0], current_balance: null }] })), false);
});
test('account subset validates amounts and identity without exposing extra fields', () => {
  assert.equal(m.isControlAccounts([f.account()]), true);
  assert.equal(m.isControlAccounts([f.account({ current_balance: '-12.50' })]), true);
  assert.equal(m.isControlAccounts([f.account(), f.account()]), false);
  assert.equal(m.isControlAccounts([f.account({ current_balance: NaN })]), false);
  assert.equal(m.isControlAccount(f.account({ account_type: 'future_type' })), true);
});
test('blank forms are fresh and never auto-enable or manufacture an invalid date', () => {
  const a = m.blankRecurring('GBP', '2026-10-26');
  a.name = 'Changed';
  assert.equal(m.blankRecurring().name, '');
  assert.equal(m.blankRecurring('bad', '2026-02-30').next_due_date, '');
  assert.equal(a.expense_currency, 'GBP');
  assert.equal(a.next_due_date, '2026-10-26');
  assert.equal(a.auto_post, undefined);
  assert.deepEqual(m.blankPeriod(), { name: '', start_date: '', end_date: '' });
});
test('create normalizes only exact old payload fields, strings/nulls and numeric interval', () => {
  const result = m.recurringCreatePayload(f.recurringForm({ name: ' Schedule ', description: ' Description ', expense_amount: '+1.250e2', expense_currency: ' usd ', interval_count: '02', reference: '  REF  ', notes: '  Note  ' }), f.meta());
  assert.equal(result.error, null);
  assert.deepEqual(result.body, { name: 'Schedule', description: 'Description', category_id: 'synthetic-category-1', account_id: 'synthetic-account-1', vendor_id: 'synthetic-vendor-1', client_id: null, project_id: null, expense_currency: 'USD', expense_amount: '125', frequency: 'monthly', interval_count: 2, next_due_date: '2026-10-01', end_date: null, tax_amount: '5', payment_method: 'bank_transfer', reference: 'REF', notes: 'Note' });
  assert.equal(Object.hasOwn(result.body, 'auto_post'), false);
});
for (const [key, value] of [
  ['name', ' '], ['name', 'x'.repeat(181)], ['description', ' '], ['description', 'x'.repeat(501)],
  ['category_id', 'missing'], ['account_id', 'missing'], ['vendor_id', 'missing'], ['client_id', 'missing'], ['project_id', 'missing'],
  ['expense_currency', 'US'], ['expense_amount', '0'], ['expense_amount', '-1'], ['expense_amount', 'NaN'],
  ['expense_amount', '1000000000000.0001'], ['expense_amount', '1e13'], ['tax_amount', '-1'], ['tax_amount', '126'],
  ['frequency', 'daily'], ['interval_count', '0'], ['interval_count', '121'], ['interval_count', '1.5'], ['interval_count', '1e1'],
  ['next_due_date', '2026-02-30'], ['end_date', '2026-09-30'], ['payment_method', 'unsupported'], ['reference', 'x'.repeat(181)],
  ['notes', null],
]) {
  test(`create rejects ${key}=${String(value).slice(0, 35)}`, () => {
    const result = m.recurringCreatePayload(f.recurringForm({ [key]: value }), f.meta());
    assert.equal(result.body, null); assert.ok(result.error);
  });
}
for (const frequency of types.controlFrequencies) test(`create permits existing frequency ${frequency}`, () => assert.ok(m.recurringCreatePayload(f.recurringForm({ frequency }), f.meta()).body));
for (const payment_method of types.controlPaymentMethods) test(`create permits existing payment method ${payment_method}`, () => assert.ok(m.recurringCreatePayload(f.recurringForm({ payment_method }), f.meta()).body));
test('create exact maximum and Unicode trimmed schema lengths', () => {
  assert.ok(m.recurringCreatePayload(f.recurringForm({ expense_amount: '1000000000000', name: '😀'.repeat(180), description: '😀'.repeat(500) }), f.meta()).body);
  assert.equal(m.recurringCreatePayload(f.recurringForm({ name: '😀'.repeat(181) }), f.meta()).body, null);
});
test('create mirrors HALF_UP tax comparison without silently changing decimal payload', () => {
  const result = m.recurringCreatePayload(f.recurringForm({ expense_amount: '1.003', tax_amount: '1.004' }), f.meta());
  assert.equal(result.error, null); assert.ok(result.warning);
  assert.equal(result.body.expense_amount, '1.003'); assert.equal(result.body.tax_amount, '1.004');
  assert.equal(m.recurringCreatePayload(f.recurringForm({ expense_amount: '1.004', tax_amount: '1.005' }), f.meta()).body, null);
  // API permits positive sub-cent input then rounds it; warn rather than claim a backend restriction.
  const subCent = m.recurringCreatePayload(f.recurringForm({ expense_amount: '0.001', tax_amount: '0' }), f.meta());
  assert.ok(subCent.body); assert.ok(subCent.warning);
});
test('create resolves project client but neither guesses currency nor requires capped client to be loaded', () => {
  const result = m.recurringCreatePayload(f.recurringForm({ project_id: 'synthetic-project-1' }), f.meta({ clients: [] }));
  assert.equal(result.body.client_id, 'synthetic-client-1');
  assert.equal(result.body.expense_currency, 'USD');
  assert.equal(m.recurringCreatePayload(f.recurringForm({ project_id: 'synthetic-project-1', client_id: 'other-client' }), f.meta()).body, null);
  assert.equal(m.recurringCreatePayload(f.recurringForm({ project_id: 'synthetic-project-1' }), f.meta({ projects: [{ ...f.meta().projects[0], status: 'cancelled' }] })).body, null);
});
test('create fails closed on missing metadata or inactive configuration selections', () => {
  assert.equal(m.recurringCreatePayload(f.recurringForm(), null).body, null);
  for (const key of ['accounts', 'categories', 'vendors']) assert.equal(m.recurringCreatePayload(f.recurringForm(), f.meta({ [key]: [{ ...f.meta()[key][0], is_active: false }] })).body, null);
  assert.ok(m.recurringCreatePayload(f.recurringForm({ vendor_id: '' }), f.meta({ vendors: [] })).body);
});
test('saved create response compares complete old payload and rounded money, not request spelling', () => {
  const body = m.recurringCreatePayload(f.recurringForm(), f.meta()).body;
  assert.equal(m.recurringMatchesCreate(f.recurring(), body), true);
  for (const overrides of [{ id: '../x' }, { expense_amount: '126.00' }, { tax_amount: '6.00' }, { auto_post: true }, { is_active: false }, { reference: 'other' }, { account_id: 'different' }]) assert.equal(m.recurringMatchesCreate(f.recurring(overrides), body), false);
});
test('status, configure and retry match exact identity and intended target only', () => {
  assert.equal(m.recurringMatchesStatus(f.recurring({ is_active: false }), 'synthetic-recurring-1', false), true);
  assert.equal(m.recurringMatchesStatus(f.recurring(), 'different', true), false);
  assert.equal(m.automationMatchesToggle(f.automation(), 'synthetic-recurring-1', true), true);
  assert.equal(m.automationMatchesToggle(f.automation(), 'synthetic-recurring-1', false), false);
  assert.equal(m.automationMatchesRetry(f.automation({ next_due_date: '2026-11-01', is_active: false, retryable: false }), 'synthetic-recurring-1'), true);
  assert.equal(m.automationMatchesRetry(f.automation(), 'different'), false);
});
test('retry payload carries only optional contract date precondition, no invented key or receipt', () => {
  assert.deepEqual(m.autoRetryPayload('2026-10-01'), { body: { expected_next_due_date: '2026-10-01' }, error: null });
  for (const value of ['', '2026-02-30', null, undefined]) assert.equal(m.autoRetryPayload(value).body, null);
});
for (const form of [
  { name: ' ', start_date: '2026-01-01', end_date: '2026-01-31' },
  { name: 'x'.repeat(121), start_date: '2026-01-01', end_date: '2026-01-31' },
  { name: 'Period', start_date: '2026-01-31', end_date: '2026-01-01' },
  { name: 'Period', start_date: '2026-02-30', end_date: '2026-03-31' },
  { name: null, start_date: '2026-01-01', end_date: '2026-01-31' },
]) test(`period invalid input ${JSON.stringify(form).slice(0, 90)}`, () => assert.equal(m.periodCreatePayload(form).body, null));
test('period create trims name, preserves inclusive dates and matches open response', () => {
  const result = m.periodCreatePayload({ name: ' Synthetic October ', start_date: '2026-10-01', end_date: '2026-10-31' });
  assert.equal(result.error, null); assert.equal(m.periodMatchesCreate(f.period(), result.body), true);
  assert.equal(m.periodMatchesCreate(f.period({ status: 'closed' }), result.body), false);
  assert.equal(m.periodMatchesCreate(f.period({ end_date: '2026-10-30' }), result.body), false);
});
test('period close/reopen payload boundaries and explicit action identity', () => {
  assert.deepEqual(m.periodClosePayload('  '), { error: null, body: { notes: null } });
  assert.deepEqual(m.periodClosePayload(' Reviewed '), { error: null, body: { notes: 'Reviewed' } });
  assert.equal(m.periodClosePayload(null).body, null);
  for (const reason of ['', '1234', 'x'.repeat(2001), null]) assert.equal(m.periodReopenPayload(reason).body, null);
  assert.equal(m.periodReopenPayload(' 12345 ').body.reason, '12345');
  assert.ok(m.periodReopenPayload('😀'.repeat(2000)).body);
  assert.equal(m.periodMatchesAction(f.period({ status: 'closed' }), 'synthetic-period-1', 'close'), true);
  assert.equal(m.periodMatchesAction(f.period(), 'synthetic-period-1', 'reopen'), true);
  assert.equal(m.periodMatchesAction(f.period(), 'different', 'reopen'), false);
  assert.equal(m.periodMatchesAction(f.period(), 'synthetic-period-1', 'unsupported'), false);
});
test('posting account support depends on type and active state, never name or payment method', () => {
  const schedule = f.recurring({ payment_method: 'card' });
  assert.equal(m.postingAccountContext(schedule, [f.account({ name: 'Card-like name' })]).supported, true);
  assert.equal(m.postingAccountContext(schedule, [f.account({ account_type: 'credit_card' })]).supported, false);
  assert.equal(m.postingAccountContext(schedule, [f.account({ is_active: false })]).supported, false);
  assert.equal(m.postingAccountContext(schedule, [f.account({ account_type: 'future_type' })]).supported, false);
  assert.equal(m.postingAccountContext(schedule, null).supported, false);
  assert.equal(m.postingAccountContext(schedule, [f.account({ id: 'different' })]).account, null);
  for (const account_type of ['bank', 'cash', 'mobile_wallet', 'payment_gateway', 'petty_cash', 'other', 'wallet', 'gateway']) assert.equal(m.postingAccountContext(schedule, [f.account({ account_type })]).supported, true);
});
test('profitability currencies retain explicit project/client/company separation', () => {
  assert.deepEqual(m.profitabilityContext(f.recurring(), null), { currency: 'USD', warning: null });
  assert.deepEqual(m.profitabilityContext(f.recurring({ client_id: 'synthetic-client-1' }), f.meta()), { currency: 'GBP', warning: null });
  assert.deepEqual(m.profitabilityContext(f.recurring({ client_id: 'synthetic-client-1', project_id: 'synthetic-project-1' }), f.meta()), { currency: 'EUR', warning: null });
  const explicitNullClient = f.meta({ clients: [{ ...f.meta().clients[0], currency: null }] });
  assert.deepEqual(m.profitabilityContext(f.recurring({ client_id: 'synthetic-client-1' }), explicitNullClient), { currency: 'USD', warning: null });
  assert.deepEqual(m.profitabilityContext(f.recurring({ client_id: 'synthetic-client-1', project_id: 'synthetic-project-1' }), explicitNullClient), { currency: 'EUR', warning: null });
  for (const [schedule, metadata] of [
    [f.recurring({ client_id: 'synthetic-client-1' }), null],
    [f.recurring({ client_id: 'synthetic-client-1' }), f.meta({ clients: [] })],
    [f.recurring({ project_id: 'synthetic-project-1' }), f.meta({ projects: [] })],
    [f.recurring({ project_id: 'synthetic-project-1', client_id: 'other' }), f.meta()],
  ]) { const result = m.profitabilityContext(schedule, metadata); assert.equal(result.currency, null); assert.ok(result.warning); }
});
test('local pagination has no arbitrary 50-page ceiling and does not invent server counts', () => {
  const rows = Array.from({ length: 1021 }, (_, i) => i);
  assert.deepEqual(m.pageRows(rows, 51), { rows: rows.slice(1000, 1020), page: 51, pages: 52, total: 1021 });
  assert.deepEqual(m.pageRows(rows, 999), { rows: [1020], page: 52, pages: 52, total: 1021 });
  for (const page of [-1, 0, 1.5, NaN, Infinity]) assert.equal(m.pageRows(rows, page).page, 1);
  assert.deepEqual(m.pageRows([], 51), { rows: [], page: 1, pages: 1, total: 0 });
});
