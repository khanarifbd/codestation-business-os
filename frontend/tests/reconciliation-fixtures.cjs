const account = {
  id: 'synthetic-account', name: 'Synthetic bank', account_type: 'bank', currency: 'USD',
  last_reconciled_date: '2026-09-30', last_statement_balance: '100.00',
};
const values = { account_id: account.id, statement_end_date: '2026-10-31', statement_ending_balance: '125.00', notes: '' };
const session = {
  id: 'synthetic-reconciliation', account_id: account.id, account_name: account.name, currency: 'USD',
  statement_start_date: '2026-10-01', statement_end_date: '2026-10-31', statement_ending_balance: '125.00',
  cleared_book_balance: '100.00', difference: '25.00', status: 'draft', matched_transactions: 1,
  notes: null, finalized_at: null, created_at: '2026-10-26T12:00:00Z',
};
const transaction = {
  id: 'synthetic-credit', transaction_date: '2026-10-25', direction: 'credit', amount: '25.00', currency: 'USD',
  source_type: 'accounting_money_entry', reference: 'SYN-REF', description: 'Synthetic receipt', selected: false,
};
const detail = { ...session, transactions: [{ ...transaction }], unmatched_count: 1 };
const clone = value => JSON.parse(JSON.stringify(value));
const ok = (body, status = 200) => ({ ok: true, status, json: async () => clone(body) });
const failure = (status = 422, message = 'Synthetic rejection') => ({ ok: false, status, json: async () => ({ detail: message }) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
module.exports = { account, values, session, transaction, detail, clone, ok, failure, deferred, tick };
