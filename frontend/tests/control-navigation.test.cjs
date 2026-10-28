const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./reconciliation-harness.cjs');
const nav = sourceLoader().load('src/lib/finance-controls-navigation.ts');
const root = '/dashboard/accounting/controls';

test('canonical register and historical aliases remain supported with correct defaults', () => {
  assert.equal(nav.CONTROL_PATH, root);
  assert.equal(nav.safeControlReturn('/dashboard/finance/controls'), root);
  assert.equal(nav.safeControlReturn('/dashboard/finance/auto-post'), `${root}?tab=automation`);
  assert.equal(nav.safeControlReturn('/dashboard/finance/auto-post?tab=periods&status=closed'), `${root}?tab=periods&status=closed`);
  assert.equal(nav.controlBrowse('', 'automation').tab, 'automation');
  assert.equal(nav.controlBrowse('', 'invalid').tab, 'recurring');
});
test('URL browse context is bounded, validated and round-trips without opaque params', () => {
  const browse = nav.controlBrowse('tab=recurring&search=synthetic+schedule&status=paused&page=73&focus=synthetic-id&token=discard');
  assert.deepEqual(browse, { tab: 'recurring', search: 'synthetic schedule', status: 'paused', page: 73, focus: 'synthetic-id' });
  assert.equal(nav.controlListHref(browse), `${root}?search=synthetic+schedule&status=paused&page=73&focus=synthetic-id`);
  assert.equal(nav.controlBrowse('search=' + 'x'.repeat(500)).search.length, 300);
  assert.equal(nav.controlBrowse('tab=periods&status=enabled').status, 'all');
  assert.equal(nav.controlBrowse('tab=evil&focus=..%2Fx').focus, '');
});
for (const page of ['', '0', '-1', '2.5', '1e3', 'Infinity', '9007199254740992', 'NaN', '+10']) {
  test(`invalid page ${page} becomes page1`, () => assert.equal(nav.controlBrowse('page=' + encodeURIComponent(page)).page, 1));
}
test('safe integer page values are not artificially capped', () => {
  assert.equal(nav.controlBrowse('page=51').page, 51);
  assert.equal(nav.controlBrowse('page=9007199254740991').page, Number.MAX_SAFE_INTEGER);
  assert.equal(nav.controlBrowse('page=00073').page, 73);
});
for (const [tab, statuses] of [
  ['recurring', ['all', 'active', 'paused']],
  ['automation', ['all', 'enabled', 'disabled', 'needs_attention', 'eligible', 'ineligible']],
  ['periods', ['all', 'open', 'closed']],
]) for (const status of statuses) test(`${tab} existing filter ${status} round-trip`, () => {
  const href = nav.controlListHref({ tab, status });
  assert.equal(nav.controlBrowse(href.split('?')[1] || '').tab, tab);
  assert.equal(nav.controlBrowse(href.split('?')[1] || '').status, status);
});
for (const value of [null, undefined, '', 'https://evil.invalid', '//evil.invalid/path', '/dashboard/accounting/controls-evil', '/dashboard/accounting/controls/../other', '/dashboard/accounting/controls/new', '/dashboard/accounting/controls#fragment', '/dashboard/accounting/controls?search=x#fragment', '/dashboard/accounting/controls%3Ftab=periods', '\\evil', 'javascript:alert(1)']) {
  test(`unsafe return ${String(value)} uses bounded fallback`, () => assert.equal(nav.safeControlReturn(value, 'periods'), `${root}?tab=periods`));
}
test('return parser strips nested return URLs and preserves benign encoded search text', () => {
  const safe = nav.safeControlReturn(`${root}?tab=automation&search=%2F%2Fevil.invalid&returnTo=https%3A%2F%2Fevil.invalid&status=disabled&page=4&focus=syn-4`);
  assert.equal(safe, `${root}?tab=automation&search=%2F%2Fevil.invalid&status=disabled&page=4&focus=syn-4`);
  assert.equal(nav.safeControlReturn(null, 'bad'), root);
});
for (const [kind, action] of [['recurring', 'post'], ['recurring', 'status'], ['automation', 'configure'], ['automation', 'retry'], ['periods', 'close'], ['periods', 'reopen']]) {
  test(`dedicated ${kind}/${action} action keeps exact browse return`, () => {
    const back = nav.controlListHref({ tab: kind, search: 'Synthetic & sample', page: 52, focus: 'syn-1' });
    const href = nav.controlActionHref(kind, 'syn-1', action, back), url = new URL(href, 'https://fixture.invalid');
    assert.equal(url.pathname, `${root}/${kind}/syn-1/${action}`);
    assert.equal(url.searchParams.get('returnTo'), back);
    assert.equal(url.searchParams.size, 1);
  });
}
for (const kind of ['recurring', 'automation', 'periods']) test(`${kind} detail is readonly route independent of current list`, () => {
  const href = nav.controlDetailHref(kind, 'syn-1'), url = new URL(href, 'https://fixture.invalid');
  assert.equal(url.pathname, `${root}/${kind}/syn-1`);
  assert.equal(url.searchParams.get('returnTo'), nav.controlListHref({ tab: kind }));
});
test('only supported configuration creates exist; automation has no invented schedule editor', () => {
  for (const kind of ['recurring', 'periods']) assert.equal(new URL(nav.controlCreateHref(kind), 'https://fixture.invalid').pathname, `${root}/${kind}/new`);
  assert.equal(nav.controlCreateHref('automation'), `${root}?tab=automation`);
  assert.equal(nav.controlActionHref('recurring', 'syn-1', 'edit'), root);
  assert.equal(nav.controlActionHref('periods', 'syn-1', 'delete'), `${root}?tab=periods`);
});
test('invalid action, kind or identity cannot escape to arbitrary route', () => {
  for (const id of ['', 'new', 'syn/other', '../escape', 'syn?x=1', '%2F']) {
    assert.equal(nav.controlDetailHref('recurring', id), root);
    assert.equal(nav.controlActionHref('recurring', id, 'post'), root);
  }
  assert.equal(nav.controlActionHref('recurring', 'syn-1', '../../other'), root);
  assert.equal(nav.controlDetailHref('../outside', 'syn-1'), root);
  assert.equal(nav.controlActionHref('../outside', 'syn-1', 'post'), root);
  assert.equal(nav.controlCreateHref('../outside'), root);
});
