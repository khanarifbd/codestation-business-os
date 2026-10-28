// Exact integer HALF_UP and actual posting hooks; no browser or live HTTP.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const money = require('./accounting-money-out-harness.cjs');
const expenses = require('./expense-harness.cjs');
const fx = require('./expense-fixtures.cjs');
const bank = { ...fx.account, current_balance: '1000000000000.00', currency: 'EUR' };
const client = { ...fx.client, currency: 'USD' };
const meta = { ...fx.meta, accounts: [bank], clients: [client], projects: [], orders: [], invoices: [], payments: [] };
const fields = { description: 'Synthetic FX expense', account_id: bank.id, category_id: fx.category.id, client_id: client.id, expense_date: '2026-10-26', expense_amount: '2000000.01', account_amount: '0.01', tax_amount: '0' };
const writes = h => h.calls.filter(call => call.init?.method);
function preview(fn) { const h = money.harness(); try { return fn(h.load(path.join(money.root, 'src/components/accounting-money-out/money-out-model.ts')), h.load(path.join(money.root, 'src/components/expenses/expense-model.ts'))); } finally { h.cleanup(); } }
for (const [gross, rate] of [['2000000.01', null], ['2000000.00', '0.00000001'], ['1999999.99', '0.00000001'], ['1000000000000', null]]) {
  test(`Money Out eight-place minimum for ${gross} expense / 0.01 deduction`, () => preview(m => {
    const values = { ...m.initialMoneyOutValues(), ...fields, expense_amount: gross };
    const p = m.moneyOutPreview(values, 'client', meta, [bank]);
    if (rate) { assert.equal(p.error, null); assert.equal(p.amounts.rate, rate); }
    else { assert.equal(p.amounts, null); assert.match(p.error, /positive conversion must not round to zero/); }
    assert.equal(values.expense_amount, gross); assert.equal(values.account_amount, '0.01');
  }));
  for (const conversion of ['account', 'profitability']) test(`Expenses ${conversion} minimum for ${gross}`, () => preview((_m, e) => {
    const values = { ...e.blankExpense(), ...fields, expense_currency: 'USD', client_id: conversion === 'account' ? '' : client.id, expense_amount: gross, profitability_amount: '0.01' };
    const a = conversion === 'account' ? bank : { ...bank, currency: 'USD' };
    const metadata = { ...meta, clients: [{ ...client, currency: 'GBP' }] };
    const p = e.expensePreview(values, metadata, [a]);
    if (rate) { assert.equal(p.error, null); assert.equal(p.amounts[conversion === 'account' ? 'rate' : 'profitabilityRate'], rate); }
    else { assert.equal(p.amounts, null); assert.match(p.error, /positive conversion must not round to zero/); assert.throws(() => e.expensePayload(values, p), /verified/); }
    assert.equal(values.expense_amount, gross);
  }));
}
function respond(url, init) { assert.equal(init?.method, undefined, 'Invalid conversion must not post'); if (url === '/api/finance/accounts') return money.ok([bank]); if (url === '/api/finance/expense-meta') return money.ok(meta); return money.fail(404); }
test('Money Out review and POST remain unavailable without losing the invalid draft; corrected minimum can be reviewed', async () => {
  const h = money.harness(); h.mode('create'); h.query('purpose=client'); h.respond(respond);
  try {
    await h.render().loadSetup(); for (const [key, value] of Object.entries(fields)) h.render().change(key, value);
    let v = h.render(); assert.equal(v.canContinue, false); assert.equal(v.preview.amounts, null); v.review(); await h.render().postExpense();
    v = h.render(); assert.equal(v.confirmOpen, false); assert.equal(writes(h).length, 0); assert.equal(v.values.expense_amount, '2000000.01'); assert.equal(v.values.account_amount, '0.01'); assert.equal(v.dirty, true);
    v.change('expense_amount', '2000000.00'); h.render().review(); v = h.render(); assert.equal(v.confirmOpen, true); assert.equal(v.preview.amounts.rate, '0.00000001'); v.cancelReview(); assert.equal(writes(h).length, 0);
  } finally { h.cleanup(); }
});
for (const conversion of ['account', 'profitability']) test(`Expenses ${conversion} invalid rate cannot arm confirmation or post and retains input`, async () => {
  const h = expenses.harness(); const a = conversion === 'account' ? bank : { ...bank, currency: 'USD' };
  const metadata = { ...meta, clients: [{ ...client, currency: 'GBP' }] };
  h.respond((url, init) => { assert.equal(init?.method, undefined); return money.ok(url === '/api/finance/accounts' ? [a] : metadata); });
  try {
    await Promise.all([h.render().metadata.refresh(), h.render().accounts.refresh()]);
    for (const [key, value] of Object.entries({ ...fields, expense_currency: 'USD', client_id: conversion === 'account' ? '' : client.id })) h.render().change(key, value);
    h.render().change('account_amount', '0.01'); h.render().change('profitability_amount', '0.01');
    let v = h.render(); assert.equal(v.preview.amounts, null); assert.match(v.preview.error, /positive conversion/); v.review(); await h.render().postExpense();
    v = h.render(); assert.equal(v.confirmOpen, false); assert.equal(writes(h).length, 0); assert.equal(v.values.expense_amount, '2000000.01'); assert.equal(v.values[conversion === 'account' ? 'account_amount' : 'profitability_amount'], '0.01'); assert.equal(v.dirty, true);
    v.change('expense_amount', '2000000.00'); h.render().review(); v = h.render(); assert.equal(v.confirmOpen, true); assert.equal(writes(h).length, 0);
  } finally { h.cleanup(); }
});
