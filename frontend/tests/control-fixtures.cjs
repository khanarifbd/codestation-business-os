/* Synthetic Controls fixtures only. No customer, account-reference or credential data. */
const at = '2026-10-26T12:00:00Z';
function recurring(overrides = {}) {
  return {
    id: 'synthetic-recurring-1', name: 'Synthetic hosting schedule', description: 'Synthetic monthly infrastructure',
    vendor_id: 'synthetic-vendor-1', vendor_name: 'Synthetic supplier',
    category_id: 'synthetic-category-1', category_name: 'Infrastructure',
    account_id: 'synthetic-account-1', account_name: 'Synthetic operating account', account_currency: 'USD',
    client_id: null, client_name: null, project_id: null, project_name: null,
    expense_currency: 'USD', expense_amount: '125.00', frequency: 'monthly', interval_count: 1,
    next_due_date: '2026-10-01', end_date: null, tax_amount: '5.00', payment_method: 'bank_transfer',
    reference: null, notes: null, is_active: true, auto_post: false,
    auto_post_last_attempt_at: null, auto_post_last_error: null,
    last_posted_expense_id: null, last_posted_at: null, created_at: at, updated_at: at,
    ...overrides,
  };
}
function automation(overrides = {}) {
  return {
    id: 'synthetic-recurring-1', name: 'Synthetic hosting schedule', description: 'Synthetic monthly infrastructure',
    category_name: 'Infrastructure', vendor_name: 'Synthetic supplier', account_name: 'Synthetic operating account',
    account_currency: 'USD', expense_currency: 'USD', expense_amount: '125.00', frequency: 'monthly', interval_count: 1,
    next_due_date: '2026-10-01', is_active: true, auto_post: true, eligible: true, eligibility_reason: null,
    retryable: true, last_attempt_at: at, last_error: 'Synthetic precommit rejection', ...overrides,
  };
}
function period(overrides = {}) {
  return {
    id: 'synthetic-period-1', name: 'Synthetic October', start_date: '2026-10-01', end_date: '2026-10-31', status: 'open',
    close_notes: null, closed_by_user_id: null, closed_at: null, reopened_by_user_id: null,
    reopened_at: null, reopen_reason: null, created_at: at, updated_at: at, ...overrides,
  };
}
function account(overrides = {}) {
  return { id: 'synthetic-account-1', name: 'Synthetic operating account', account_type: 'bank', currency: 'USD', current_balance: '9000.00', is_active: true, ...overrides };
}
function meta(overrides = {}) {
  return {
    vendors: [{ id: 'synthetic-vendor-1', name: 'Synthetic supplier', is_active: true }],
    categories: [{ id: 'synthetic-category-1', name: 'Infrastructure', cost_type: 'indirect', is_active: true }],
    accounts: [{ id: 'synthetic-account-1', name: 'Synthetic operating account', currency: 'USD', current_balance: '9000.00', is_active: true }],
    clients: [{ id: 'synthetic-client-1', name: 'Synthetic client', currency: 'GBP' }],
    projects: [{ id: 'synthetic-project-1', number: 'SYN-001', name: 'Synthetic project', client_id: 'synthetic-client-1', currency: 'EUR', status: 'active' }],
    ...overrides,
  };
}
function recurringForm(overrides = {}) {
  return {
    name: 'Synthetic hosting schedule', description: 'Synthetic monthly infrastructure', category_id: 'synthetic-category-1',
    account_id: 'synthetic-account-1', vendor_id: 'synthetic-vendor-1', client_id: '', project_id: '', expense_currency: 'USD',
    expense_amount: '125', frequency: 'monthly', interval_count: '1', next_due_date: '2026-10-01', end_date: '',
    tax_amount: '5', payment_method: 'bank_transfer', reference: '', notes: '', ...overrides,
  };
}
module.exports = { at, recurring, automation, period, account, meta, recurringForm };
