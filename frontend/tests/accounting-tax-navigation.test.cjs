const test = require('node:test'), assert = require('node:assert/strict');
const { sourceLoader } = require('./reconciliation-harness.cjs');
const n = sourceLoader().load('src/lib/tax-navigation.ts');
const m = sourceLoader().load('src/components/accounting-tax/tax-model.ts');
const root = '/dashboard/accounting/tax', codes = root + '/codes', settlements = root + '/settlements';
const parse = href => new URL(href, 'https://synthetic.invalid');

test('tax has separate report, code register and original-settlement register roots', () => {
  assert.equal(n.TAX_PATH, root); assert.equal(n.TAX_CODES_PATH, codes); assert.equal(n.TAX_SETTLEMENTS_PATH, settlements);
  assert.equal(n.taxReportHref(), root); assert.equal(n.taxCodeListHref(), codes); assert.equal(n.settlementListHref(), settlements);
});
test('report dates use explicit organization defaults only when parameters are absent', () => {
  const defaults = { date_from: '2026-10-01', date_to: '2026-10-26' };
  assert.deepEqual(n.taxReportBrowse('', defaults), defaults);
  assert.deepEqual(n.taxReportBrowse('date_from=2026-09-01', defaults), { date_from: '2026-09-01', date_to: '2026-10-26' });
  assert.deepEqual(n.taxReportBrowse('date_from=&date_to=2026-02-30', defaults), { date_from: '', date_to: '' });
  assert.deepEqual(n.taxReportBrowse('', { date_from: 'guess', date_to: '0000-01-01' }), { date_from: '', date_to: '' });
  assert.deepEqual(n.taxReportBrowse(''), { date_from: '', date_to: '' });
});
test('reversed report dates remain explicit in URL and response matcher owns server normalization', () => {
  const range = { date_from: '2026-10-26', date_to: '2026-10-01' };
  assert.deepEqual(n.taxReportBrowse(parse(n.taxReportHref(range)).searchParams), range);
  assert.equal(n.taxReportHref({ date_from: '2026-02-30', date_to: undefined }), root);
});
test('code browse state round trips search, local filters, page and return focus', () => {
  assert.deepEqual(n.taxCodeBrowse(''), { search: '', kind: 'all', active: 'all', page: 1, focus: '' });
  const browse = { search: 'Synthetic & purchase + VAT', kind: 'purchase', active: 'inactive', page: 101, focus: 'tax-code-p' };
  assert.deepEqual(n.taxCodeBrowse(parse(n.taxCodeListHref(browse)).searchParams), browse);
  assert.equal(n.taxCodeListHref({ search: undefined, kind: 'all', active: 'all', page: 1 }), codes);
});
test('settlement browse state is local within the loaded cap, not invented date or reversal filters', () => {
  assert.deepEqual(n.settlementBrowse(''), { search: '', type: 'all', currency: '', page: 1, focus: '' });
  const browse = { search: 'Synthetic & payment', type: 'withholding_tax_payment', currency: 'EUR', page: 50, focus: 'settlement-a' };
  assert.deepEqual(n.settlementBrowse(parse(n.settlementListHref(browse)).searchParams), browse);
  const unsupported = n.settlementBrowse('date_from=2020-01-01&date_to=2026-10-26&status=reversed&cursor=abc');
  assert.equal(Object.hasOwn(unsupported, 'date_from'), false); assert.equal(Object.hasOwn(unsupported, 'date_to'), false);
  assert.equal(Object.hasOwn(unsupported, 'status'), false); assert.equal(Object.hasOwn(unsupported, 'cursor'), false);
});
for (const value of ['0', '-1', '1.1', 'NaN', 'Infinity', '9007199254740992']) test(`tax local page ${value} defaults safely`, () => {
  assert.equal(n.taxCodeBrowse('page=' + value).page, 1); assert.equal(n.settlementBrowse('page=' + value).page, 1);
});
test('local page input has no artificial 50-page or other low ceiling', () => {
  assert.equal(n.taxCodeBrowse('page=100000').page, 100000); assert.equal(n.settlementBrowse('page=100000').page, 100000);
  assert.equal(n.taxCodeBrowse('page=9007199254740991').page, 9007199254740991);
});
test('code browse accepts only existing kinds and explicit active filters', () => {
  for (const kind of ['sales', 'purchase', 'withholding']) assert.equal(n.taxCodeBrowse('kind=' + kind).kind, kind);
  for (const active of ['active', 'inactive']) assert.equal(n.taxCodeBrowse('active=' + active).active, active);
  assert.equal(n.taxCodeBrowse('kind=vat&active=false').kind, 'all'); assert.equal(n.taxCodeBrowse('active=false').active, 'all');
});
test('settlement browse accepts all four original-record types and normalizes currency', () => {
  for (const type of ['indirect_tax_payment', 'withholding_tax_payment', 'input_tax_refund', 'input_tax_offset']) assert.equal(n.settlementBrowse('type=' + type).type, type);
  assert.equal(n.settlementBrowse('type=reversal').type, 'all'); assert.equal(n.settlementBrowse('currency=eur').currency, 'EUR');
  for (const currency of ['EURO', 'US', '12A', '//x']) assert.equal(n.settlementBrowse('currency=' + currency).currency, '');
});
test('browse search is bounded and invalid return focus is stripped', () => {
  for (const browse of [n.taxCodeBrowse, n.settlementBrowse]) {
    assert.equal(browse('search=' + 'x'.repeat(400)).search.length, 300);
    assert.equal(browse('focus=../escape').focus, ''); assert.equal(browse('focus=new').focus, '');
    assert.equal(browse('focus=record_01-A').focus, 'record_01-A');
  }
});
for (const value of ['https://evil.invalid', '//evil.invalid', 'javascript:alert(1)', root + '-other', root + '/..', root + '/codes/../settlements', root + '#frag', root + '?date_from=2026-10-01#frag', codes + '/new', codes + '/code-a', codes + '/code-a/edit', settlements + '/new', settlements + '/settlement-a']) test(`tax return rejects non-register target ${value}`, () => {
  assert.equal(n.safeTaxReturn(value), root); assert.equal(n.safeTaxReturn(value, codes), codes); assert.equal(n.safeTaxReturn(value, settlements), settlements);
});
test('only approved report or register roots may be fallback targets', () => {
  for (const path of [root, codes, settlements]) { assert.equal(n.safeTaxReturn(null, path), path); assert.equal(n.safeTaxReturn('', path), path); }
  for (const path of ['//evil.invalid', codes + '/new', root + '?date_from=2026-01-01', '/dashboard']) assert.equal(n.safeTaxReturn('bad', path), root);
});
test('safe report return retains dates and strips arbitrary/nested parameters', () => {
  assert.equal(n.safeTaxReturn(root + '?date_from=2026-10-01&date_to=2026-10-26&returnTo=//evil.invalid&account=secret'), root + '?date_from=2026-10-01&date_to=2026-10-26');
});
test('safe register returns preserve canonical browse context, never nested navigation', () => {
  assert.equal(n.safeTaxReturn(codes + '?search=VAT&kind=purchase&active=inactive&page=3&focus=code-a&cursor=wrong&returnTo=//evil.invalid'), codes + '?search=VAT&kind=purchase&active=inactive&page=3&focus=code-a');
  assert.equal(n.safeTaxReturn(settlements + '?search=Tax&type=input_tax_offset&currency=usd&page=2&focus=settlement-a&status=reversed&date_from=2026-01-01'), settlements + '?search=Tax&type=input_tax_offset&currency=USD&page=2&focus=settlement-a');
});
test('all eight public Tax surfaces use distinct list, view, create and edit routes', () => {
  const codeBack = codes + '?search=Tax&kind=sales&page=4&focus=code-a', settlementBack = settlements + '?type=input_tax_refund&currency=USD&page=2&focus=settlement-a';
  const surfaces = [
    [n.taxReportHref(), root, null], [n.taxCodeListHref(), codes, null],
    [n.taxCodeDetailHref('code-a', codeBack), codes + '/code-a', codeBack],
    [n.taxCodeCreateHref(codeBack), codes + '/new', codeBack],
    [n.taxCodeEditHref('code-a', codeBack), codes + '/code-a/edit', codeBack],
    [n.settlementListHref(), settlements, null],
    [n.settlementDetailHref('settlement-a', settlementBack), settlements + '/settlement-a', settlementBack],
    [n.settlementCreateHref(settlementBack), settlements + '/new', settlementBack],
  ];
  assert.equal(new Set(surfaces.map(([, path]) => path)).size, 8);
  for (const [href, path, back] of surfaces) { const url = parse(href); assert.equal(url.pathname, path); assert.equal(url.searchParams.get('returnTo'), back); }
});
test('create and edit links default to matching register, without unsupported detail or external return', () => {
  for (const [href, expected] of [[n.taxCodeCreateHref(), codes], [n.taxCodeEditHref('code-a', '//evil.invalid'), codes], [n.taxCodeDetailHref('code-a'), codes], [n.settlementCreateHref(), settlements], [n.settlementDetailHref('settlement-a', codes + '/code-a'), settlements]]) assert.equal(parse(href).searchParams.get('returnTo'), expected);
});
test('an explicitly selected allowed report context survives document navigation', () => {
  const back = root + '?date_from=2026-10-01&date_to=2026-10-26';
  assert.equal(parse(n.taxCodeDetailHref('code-a', back)).searchParams.get('returnTo'), back);
  assert.equal(parse(n.settlementCreateHref(back)).searchParams.get('returnTo'), back);
});
for (const value of ['', '.', '..', 'new', 'edit', 'codes', 'settlements', 'a/b', 'a?b', 'a#b', 'a%2Fb', 'a\\b', 'x'.repeat(201)]) test(`unsafe/reserved Tax ID ${value.slice(0, 20)} never becomes an action route`, () => {
  assert.equal(m.taxId(value), false); assert.equal(n.taxCodeDetailHref(value), codes); assert.equal(n.taxCodeEditHref(value), codes); assert.equal(n.settlementDetailHref(value), settlements);
});
test('safe IDs retain exact direct-load identity and invalid IDs return safely to preserved browse', () => {
  const id = 'record_01-A', back = codes + '?search=Tax&page=3';
  assert.equal(parse(n.taxCodeDetailHref(id, back)).pathname, codes + '/' + id);
  assert.equal(n.taxCodeEditHref('../bad', back), back);
});
