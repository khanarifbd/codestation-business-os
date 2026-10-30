import { expect } from '@playwright/test';
import { withAccountingBoundaryRoute, withAccountingLeaveConfirmation } from './accounting-family-boundaries.mjs';

// These two deliberate attempts NEVER reach the backend. Readable second errors
// cannot establish that an earlier unknown production request failed.
export async function withUnforwardedFinancialAttempts(page, endpoint, work) {
  const attempts = [];
  const reject = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: attempts.length === 1 ? 'Unexpected upstream response' : 'Synthetic later validation rejection' }) });
  };
  return withAccountingBoundaryRoute(page, `**${endpoint}`, reject, () => work(attempts));
}

export async function captureSafeAction(page, info, name) {
  const viewport = page.viewportSize();
  try {
    for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`neutral-theme-${name}-${size}.png`) });
    }
  } finally { if (viewport) await page.setViewportSize(viewport); }
}

export async function verifyRecurringUnknownAction(page, info, api, bank, marker, today) {
  const category = await api(page, 'POST', '/finance/expense-categories', { name: `Synthetic recurring boundary ${marker}`, cost_type: 'operating' });
  const schedule = await api(page, 'POST', '/finance-controls/recurring-expenses', { name: `Synthetic unforwarded recurring ${marker}`, description: 'Known-not-delivered negative fixture', category_id: category.id, account_id: bank.id, expense_currency: 'USD', expense_amount: '1.01', frequency: 'monthly', next_due_date: today, reference: `RECURRING-NOT-SENT-${marker}`, auto_post: false });
  const readState = async () => ({
    schedules: await api(page, 'GET', '/finance-controls/recurring-expenses'),
    expenses: await api(page, 'GET', '/finance/expenses'),
    account: (await api(page, 'GET', '/finance/accounts')).find(row => row.id === bank.id),
    journals: await api(page, 'GET', '/accounting/journals?limit=200'),
  });
  const before = await readState();
  expect(before.account?.id).toBe(bank.id);
  expect(before.journals.length).toBeLessThan(200);
  expect(before.schedules.find(row => row.id === schedule.id)).toMatchObject({ is_active: true, auto_post: false, next_due_date: today });
  const endpoint = `/api/finance-controls/recurring-expenses/${schedule.id}/post`;
  await withUnforwardedFinancialAttempts(page, endpoint, async attempts => {
    await page.goto(`/dashboard/accounting/controls/recurring/${schedule.id}/post`);
    const review = page.getByRole('button', { name: 'Review expense posting', exact: true });
    await expect(review).toBeEnabled();
    await expect(page.getByLabel('Expense amount (USD)', { exact: true })).toHaveValue('1.01');
    await review.click();
    await page.getByRole('dialog', { name: 'Post this recurring expense?', exact: true }).getByRole('button', { name: 'Post expense', exact: true }).click();
    await expect(page.getByText('Posting outcome needs verification', { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].key).toBeTruthy();
    expect(JSON.parse(attempts[0].body)).toEqual({ expense_date: today, expense_amount: '1.01', account_amount: null, profitability_amount: null, reference: `RECURRING-NOT-SENT-${marker}`, notes: null });
    await expect(page.getByLabel('Expense amount (USD)', { exact: true })).toBeDisabled();
    await expect(review).toBeDisabled();
    expect(await readState()).toEqual(before);
    expect(attempts).toHaveLength(1);
    await page.getByRole('button', { name: 'Review same-operation retry', exact: true }).click();
    await page.getByRole('dialog', { name: 'Retry this same recurring posting?', exact: true }).getByRole('button', { name: 'Retry same operation', exact: true }).click();
    await expect(page.getByText('Synthetic later validation rejection', { exact: true })).toBeVisible();
    await expect(page.getByText('Posting outcome needs verification', { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await expect(page.getByLabel('Expense amount (USD)', { exact: true })).toBeDisabled();
    expect(await readState()).toEqual(before);
    await captureSafeAction(page, info, 'recurring-unknown-original-key');
    // App Cancel deliberately refuses unknown close. This is fixture teardown,
    // not a recovery recommendation: both attempts were proven unforwarded.
    await withAccountingLeaveConfirmation(page, () => page.goto('/dashboard/accounting/advanced'));
    expect(attempts).toHaveLength(2);
  });
}

export async function verifyCreditUnknownAction(page, info, api, bank, marker, today) {
  const client = await api(page, 'POST', '/crm/clients', { display_name: `Synthetic credit boundary ${marker}`, currency: 'USD' });
  const invoice = await api(page, 'POST', '/finance/invoices', { client_id: client.id, issue_date: today, currency: 'USD', items: [{ item_name: 'Synthetic eligible credit', description: 'Isolated 1.01 fixture', quantity: '1', unit_price: '1.01' }] });
  await api(page, 'PATCH', `/finance/invoices/${invoice.id}/status`, { action: 'send' });
  // Authorized isolated CI ledger fixture only; no provider/bank movement.
  const advance = await api(page, 'POST', '/accounting/customer-advances', { client_id: client.id, financial_account_id: bank.id, advance_date: today, amount: '1.01', reference: `CREDIT-NOT-SENT-${marker}` });
  const readState = async () => ({
    invoice: await api(page, 'GET', `/finance/invoices/${invoice.id}`),
    advance: await api(page, 'GET', `/accounting/customer-advances/${advance.id}`),
    account: (await api(page, 'GET', '/finance/accounts')).find(row => row.id === bank.id),
    journals: await api(page, 'GET', '/accounting/journals?limit=200'),
  });
  const before = await readState();
  expect(before.account?.id).toBe(bank.id);
  expect(before.journals.length).toBeLessThan(200);
  expect(String(before.invoice.balance_due)).toBe('1.01');
  expect(String(before.advance.remaining_amount)).toBe('1.01');
  expect(before.advance.client_id).toBe(client.id);
  const endpoint = `/api/accounting/customer-advances/${advance.id}/apply`;
  await withUnforwardedFinancialAttempts(page, endpoint, async attempts => {
    await page.goto(`/dashboard/accounting/receivables/${invoice.id}/apply-credit`);
    const review = page.getByRole('button', { name: 'Review credit application', exact: true });
    await expect(review).toBeEnabled();
    await expect(page.getByLabel(/^Credit to apply/)).toHaveValue('1.01');
    await review.click();
    await page.getByRole('dialog', { name: 'Apply existing customer credit?', exact: true }).getByRole('button', { name: 'Confirm & apply credit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Application outcome is uncertain', exact: true })).toBeVisible();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].key).toBeTruthy();
    expect(JSON.parse(attempts[0].body)).toEqual({ invoice_id: invoice.id, application_date: today, amount: 1.01 });
    await expect(review).toHaveCount(0);
    await page.getByRole('button', { name: 'Read current records', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review same-operation retry', exact: true })).toBeEnabled();
    expect(await readState()).toEqual(before);
    expect(attempts).toHaveLength(1);
    await page.getByRole('button', { name: 'Review same-operation retry', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review the retained credit application', exact: true }).getByRole('button', { name: 'Retry same application', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Application outcome is uncertain', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await expect(review).toHaveCount(0);
    expect(await readState()).toEqual(before);
    await captureSafeAction(page, info, 'credit-unknown-original-key');
    await withAccountingLeaveConfirmation(page, () => page.locator('.rv-actions').getByRole('button', { name: 'Back to receivables', exact: true }).click());
    expect(attempts).toHaveLength(2);
  });
}

export async function verifyExistingEmployeeFinanceDenial(page, info) {
  const tenantResponse = await page.request.get('/api/tenant/context');
  expect(tenantResponse.ok()).toBeTruthy();
  const tenant = await tenantResponse.json();
  expect([...tenant.permissions].sort()).toEqual(['dashboard.view', 'hr.self', 'projects.work']);
  for (const path of ['/api/finance-controls/recurring-expenses', '/api/finance/receivable-page?limit=50']) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(403);
  }
  const mutations = [];
  const observe = request => { if (request.method() === 'POST' && /\/api\/(?:accounting|finance|finance-controls)\//.test(new URL(request.url()).pathname)) mutations.push(request.url()); };
  page.on('request', observe);
  try {
    await page.goto('/dashboard/accounting/receivables');
    await expect(page.getByRole('heading', { name: 'Receivables information is restricted', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record money received', exact: true })).toHaveCount(0);
    await page.goto('/dashboard/accounting/controls/recurring/synthetic-denied-record/post');
    await expect(page.getByRole('heading', { name: 'Finance read access required', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review expense posting', exact: true })).toHaveCount(0);
    expect(mutations).toHaveLength(0);
    await captureSafeAction(page, info, 'employee-finance-restricted');
  } finally { page.off('request', observe); }
}
