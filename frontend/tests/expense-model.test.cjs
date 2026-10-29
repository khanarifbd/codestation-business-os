const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness, root } = require('./accounting-money-out-harness.cjs');
function model(fn) { const h = harness(); try { return fn(h.load(path.join(root, 'src/components/expenses/expense-model.ts'))); } finally { h.cleanup(); } }
const account = { id: 'bank', name: 'Synthetic bank', currency: 'USD', current_balance: '1000000000000', account_type: 'bank', is_active: true };
const client = { id: 'client', code: 'SYN', name: 'Synthetic client', currency: 'BDT' };
const order = { id: 'order', client_id: client.id, currency: 'GBP', number: 'SYN-ORDER' };
const project = { id: 'project', order_id: order.id, client_id: client.id, currency: 'EUR', number: 'SYN-PROJECT', status: 'completed' };
const invoice = { id: 'invoice', client_id: client.id, order_id: order.id, project_id: project.id, currency: 'CAD', number: 'SYN-INVOICE' };
const payment = { id: 'payment', invoice_id: invoice.id, client_id: client.id, invoice_currency: 'CAD', status: 'confirmed', number: 'SYN-PAYMENT' };
const meta = { accounts: [account], categories: [{ id: 'category', is_active: true }], vendors: [{ id: 'vendor', is_active: true }], clients: [client], orders: [order], projects: [project], invoices: [invoice], payments: [payment] };
const values = { description: 'Synthetic expense', category_id: 'category', account_id: account.id, vendor_id: '', client_id: '', project_id: '', order_id: '', invoice_id: '', payment_id: '', expense_date: '', expense_currency: 'USD', expense_amount: '110.005', account_amount: '', profitability_amount: '', tax_amount: '10.005', payment_method: 'bank_transfer', reference: '', notes: '' };

test('company expense preserves exact gross, included tax and organization-day default', () => model(m => {
  const preview = m.expensePreview(values, meta, [account]);
  assert.equal(preview.error, null);
  assert.deepEqual(preview.amounts, { gross: '110.01', tax: '10.01', net: '100.00', deduction: '110.01', profitability: '110.01', rate: '1.00000000', profitabilityRate: '1.00000000' });
  const payload = m.expensePayload(values, preview);
  assert.equal(payload.expense_date, null);
  assert.equal(payload.expense_amount, '110.005');
  assert.equal(payload.tax_amount, '10.005');
  assert.equal(payload.account_amount, null);
  assert.equal(payload.profitability_amount, null);
}));
for (const [field, currency] of [['client_id', 'BDT'], ['order_id', 'GBP'], ['project_id', 'EUR'], ['invoice_id', 'EUR'], ['payment_id', 'EUR']]) test(`full-chain source priority for ${field} is ${currency}`, () => model(m => {
  const v = { ...values, [field]: field.replace('_id', ''), profitability_amount: '99.995' };
  const p = m.expensePreview(v, meta, [account]);
  assert.equal(p.error, null); assert.equal(p.relationship.currency, currency); assert.equal(p.amounts.profitability, '100.00');
  assert.equal(m.expensePayload(v, p)[field], v[field]); assert.equal(m.expensePayload(v, p).profitability_amount, '99.995');
}));
test('separate account and profitability currencies do not collapse into expense amount', () => model(m => {
  const v = { ...values, payment_id: payment.id, account_amount: '90.005', profitability_amount: '80.005' };
  const p = m.expensePreview(v, meta, [{ ...account, currency: 'JPY' }]);
  assert.equal(p.error, null); assert.equal(p.currency, 'USD'); assert.equal(p.account.currency, 'JPY'); assert.equal(p.relationship.currency, 'EUR');
  assert.equal(p.amounts.deduction, '90.01'); assert.equal(p.amounts.profitability, '80.01');
  assert.equal(p.amounts.rate, '0.81819835'); assert.equal(p.amounts.profitabilityRate, '0.72729752');
}));
test('recent payment to older missing invoice never falls back to client currency', () => model(m => {
  const p = m.expensePreview({ ...values, payment_id: payment.id, profitability_amount: '90' }, { ...meta, invoices: [] }, [account]);
  assert.equal(p.relationship.currency, null); assert.equal(p.amounts, null); assert.match(p.error, /invoice context/);
  assert.throws(() => m.expensePayload(values, p), /verified/);
}));
for (const [array, message] of [['projects', /project context/], ['orders', /order context/]]) test(`missing ${array} ancestor fails closed`, () => model(m => {
  const p = m.expensePreview({ ...values, payment_id: payment.id, profitability_amount: '90' }, { ...meta, [array]: [] }, [account]);
  assert.equal(p.amounts, null); assert.match(p.error, message);
}));
test('additive context closes old ancestors without enlarging suggestion arrays', () => model(m => {
  const sparse = { ...meta, invoices: [], projects: [], orders: [], relationship_context: { invoices: [invoice], projects: [project], orders: [order] } };
  const p = m.expensePreview({ ...values, payment_id: payment.id, profitability_amount: '90' }, sparse, [account]);
  assert.equal(p.error, null); assert.equal(p.relationship.currency, 'EUR'); assert.equal(p.relationship.clientId, client.id);
  assert.equal(sparse.invoices.length + sparse.projects.length + sparse.orders.length, 0);
}));
test('unloaded inactive ancestor client does not replace verified project currency', () => model(m => {
  const p = m.expensePreview({ ...values, payment_id: payment.id, profitability_amount: '90' }, { ...meta, clients: [] }, [account]);
  assert.equal(p.error, null); assert.equal(p.relationship.currency, 'EUR'); assert.equal(p.relationship.client, null);
}));
for (const [patch, message] of [
  [{ payment_id: 'missing' }, /confirmed payment/], [{ payment_id: payment.id, invoice_id: 'other' }, /payment does not belong/],
  [{ invoice_id: invoice.id, client_id: 'other' }, /client does not match/], [{ invoice_id: invoice.id, order_id: 'other' }, /order does not match/],
  [{ invoice_id: invoice.id, project_id: 'other' }, /project does not match/], [{ project_id: project.id, order_id: 'other' }, /order does not match/],
  [{ order_id: order.id, client_id: 'other' }, /client does not match/], [{ client_id: 'missing' }, /loaded active client/],
]) test(`relationship mismatch never silently rewrites payload: ${JSON.stringify(patch)}`, () => model(m => {
  const p = m.expensePreview({ ...values, profitability_amount: '90', ...patch }, meta, [account]); assert.match(p.error, message); assert.equal(p.amounts, null);
}));
test('unconfirmed payment is not eligible; completed project itself remains supported', () => model(m => {
  assert.match(m.expenseRelationships({ ...values, payment_id: payment.id }, { ...meta, payments: [{ ...payment, status: 'reversed' }] }).error, /confirmed/);
  assert.equal(m.expensePreview({ ...values, project_id: project.id, profitability_amount: '90' }, meta, [account]).error, null);
}));
for (const field of ['expense_amount', 'account_amount', 'profitability_amount', 'tax_amount']) for (const raw of ['1000000000000.00001', '1.00000000000000001e12', 'Infinity', '-1']) test(`${field} raw bound rejected before rounding: ${raw}`, () => model(m => {
  const p = m.expensePreview({ ...values, project_id: project.id, account_amount: '90', profitability_amount: '80', [field]: raw }, meta, [{ ...account, currency: 'JPY' }]);
  assert.equal(p.amounts, null); assert.ok(p.error);
}));
for (const field of ['expense_amount', 'account_amount', 'profitability_amount']) test(`${field} rounded zero cannot be posted`, () => model(m => {
  const p = m.expensePreview({ ...values, project_id: project.id, account_amount: '90', profitability_amount: '80', tax_amount: '0', [field]: '.004' }, meta, [{ ...account, currency: 'JPY' }]); assert.equal(p.amounts, null);
}));
for (const date of ['2026-02-30', '2025-02-29', '10/26/2026', '2026-13-01']) test(`invalid calendar date ${date}`, () => model(m => assert.match(m.expensePreview({ ...values, expense_date: date }, meta, [account]).error, /date/)));
for (const date of ['', '2024-02-29', '2026-10-26']) test(`valid organization-default or explicit date ${date}`, () => model(m => assert.equal(m.expensePreview({ ...values, expense_date: date }, meta, [account]).error, null)));
test('unsupported card liability never suggested through Money Out', () => model(m => {
  const p = m.expensePreview(values, meta, [{ ...account, account_type: 'credit_card' }]); assert.match(p.error, /does not support credit-card/); assert.doesNotMatch(p.error, /Use Money Out/);
}));
test('insufficient balance, inactive setup, tax-over-gross retain explicit errors', () => model(m => {
  assert.match(m.expensePreview(values, meta, [{ ...account, current_balance: '100' }]).error, /balance/);
  assert.match(m.expensePreview(values, { ...meta, categories: [{ id: 'category', is_active: false }] }, [account]).error, /category/);
  assert.match(m.expensePreview({ ...values, tax_amount: '110.015' }, meta, [account]).error, /tax/);
}));
for (const kind of ['account', 'profitability']) test(`positive ${kind} conversion that rounds to a zero stored rate is not verified`, () => model(m => {
  const p = m.expensePreview({ ...values, expense_amount: '1000000000000', tax_amount: '0', account_amount: '0.01', client_id: kind === 'profitability' ? client.id : '', profitability_amount: '0.01' }, meta, [{ ...account, currency: kind === 'account' ? 'EUR' : 'USD' }]);
  assert.equal(p.amounts, null); assert.match(p.error, /exchange-rate precision/);
}));
