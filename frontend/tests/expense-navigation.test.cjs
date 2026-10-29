const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/expense-navigation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
const nav = loaded.exports;

test('expense register defaults match the existing unfiltered API', () => {
  const value = nav.expenseBrowse('');
  assert.equal(value.tab, 'expenses');
  assert.equal(value.status, '');
  assert.equal(value.page, 1);
  assert.equal(nav.expensesReadApi(value), '/api/finance/expenses?limit=50');
});
for (const tab of ['vendors', 'categories', 'profitability']) test(`separate ${tab} browse context survives return`, () => {
  const href = nav.expensesListHref({ tab, search: 'Synthetic & partner', focus: 'row' });
  assert.equal(nav.safeExpenseReturn(href), href);
  assert.equal(nav.expenseBrowse(href.split('?')[1]).tab, tab);
});
for (const unsafe of ['https://example.test', '//example.test/dashboard/expenses', '/dashboard/expenses/new', '/dashboard/expenses-extra', '/dashboard/expenses/../settings', 'javascript:alert(1)', '/dashboard/expenses#external']) test(`unsafe return rejected: ${unsafe}`, () => assert.equal(nav.safeExpenseReturn(unsafe), nav.EXPENSES_PATH));
test('filter values are encoded without creating API parameters', () => {
  const href = nav.expensesReadApi(nav.expenseBrowse('search=%26status%3Dvoided&status=posted&category=a%26limit%3D999'));
  const query = new URLSearchParams(href.split('?')[1]);
  assert.equal(query.get('search'), '&status=voided');
  assert.equal(query.get('status'), 'posted');
  assert.equal(query.get('category_id'), 'a&limit=999');
  assert.equal(query.get('limit'), '50');
});
test('opaque cursor and large legitimate page are preserved without artificial cap', () => {
  const value = nav.expenseBrowse('cursor=a%2Bb%2F%3D&page=5000');
  assert.equal(value.cursor, 'a+b/=');
  assert.equal(value.page, 5000);
  assert.equal(nav.expenseBrowse(nav.expensesListHref(value).split('?')[1]).cursor, value.cursor);
});
test('page cannot claim later history without cursor', () => assert.equal(nav.expenseBrowse('page=9').page, 1));
for (const page of ['-1', 'NaN', '1', '2.3', '9007199254740992']) test(`invalid cursor page is safe: ${page}`, () => assert.equal(nav.expenseBrowse(`cursor=opaque&page=${page}`).page, 2));
test('native document, create and receipt workspaces preserve browse context', () => {
  const back = nav.expensesListHref({ search: 'SYN', status: 'posted', category: 'cat', cursor: 'opaque', page: 3, focus: 'expense' });
  for (const href of [nav.expenseDocumentHref('a/b', back), nav.expenseCreateHref(back), nav.expenseReceiptHref('a/b', back)]) assert.equal(new URL(href, 'https://local.test').searchParams.get('returnTo'), back);
  assert.match(nav.expenseReceiptHref('a/b', back), /^\/dashboard\/expenses\/a%2Fb\/receipts\/new\?/);
});
