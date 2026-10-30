import { expect } from '@playwright/test';
import { withAccountingLeaveConfirmation } from './accounting-family-boundaries.mjs';
import { captureSafeAction, withUnforwardedFinancialAttempts } from './credit-recurring-safe-actions.mjs';

// Both negative attempts are intercepted before backend delivery. There is no
// additional paid expense, provider action, or assertion of fabricated success.
export async function verifyMoneyOutUnknownAction(page, info, api, account, category, today) {
  const readState = async () => ({
    expenses: await api(page, 'GET', '/finance/expenses'),
    account: (await api(page, 'GET', '/finance/accounts')).find(row => row.id === account.id),
    journals: await api(page, 'GET', '/accounting/journals?limit=200'),
  });
  const before = await readState();
  expect(before.account?.id).toBe(account.id);
  expect(before.journals.length).toBeLessThan(200);
  const description = 'Synthetic unforwarded money-out boundary';
  const reference = 'MONEY-OUT-NOT-SENT';
  await withUnforwardedFinancialAttempts(page, '/api/finance/expenses', async attempts => {
    await page.goto('/dashboard/accounting/money-out/new?purpose=company');
    const categoryControl = page.getByRole('button', { name: 'Expense category', exact: true });
    await expect(categoryControl).toBeEnabled();
    await categoryControl.click();
    await page.getByRole('listbox').getByRole('button').filter({ has: page.getByText(category.name, { exact: true }) }).click();
    await page.getByLabel('Description', { exact: true }).fill(description);
    await page.getByRole('button', { name: 'Paid from / charged to', exact: true }).click();
    await page.getByRole('listbox').getByRole('button').filter({ has: page.getByText(account.name, { exact: true }) }).click();
    await page.getByLabel(/^Gross expense amount/).fill('1.01');
    await page.getByLabel('Expense date', { exact: true }).fill(today);
    const paymentMethod = page.locator('label').filter({ has: page.locator('span').filter({ hasText: /^Payment method$/ }) }).locator('select');
    await expect(paymentMethod).toHaveCount(1);
    await paymentMethod.selectOption('bank_transfer');
    await expect(paymentMethod).toHaveValue('bank_transfer');
    await page.getByLabel('Reference (optional)', { exact: true }).fill(reference);
    const review = page.getByRole('button', { name: 'Review paid expense', exact: true });
    await expect(review).toBeEnabled();
    await review.click();
    await page.getByRole('dialog', { name: 'Record this paid expense?', exact: true }).getByRole('button', { name: 'Confirm & record', exact: true }).click();
    const uncertain = page.getByRole('heading', { name: 'This expense may already be recorded', exact: true });
    await expect(uncertain).toBeVisible();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].key).toBeTruthy();
    expect(JSON.parse(attempts[0].body)).toEqual({ description, category_id: category.id, account_id: account.id, vendor_id: null, client_id: null, project_id: null, expense_date: today, expense_currency: 'USD', expense_amount: '1.01', account_amount: null, tax_amount: '0', payment_method: 'bank_transfer', reference, notes: null });
    const retained = page.locator('section.aa-register').filter({ has: page.getByRole('heading', { name: 'Retained expense instructions', exact: true }) });
    await expect(retained).toContainText('USD 1.01');
    await expect(retained).toContainText(reference);
    await expect(page.getByLabel('Description', { exact: true })).toHaveCount(0);
    await expect(review).toHaveCount(0);
    // Independent read evidence: unknown UI exposes a separate verification
    // link, not an in-place setup refresh. Reads cannot unlock the retained key.
    expect(await readState()).toEqual(before);
    expect(attempts).toHaveLength(1);
    await expect(uncertain).toBeVisible();
    await page.getByRole('button', { name: 'Review same-operation retry', exact: true }).click();
    await page.getByRole('dialog', { name: 'Retry this same expense operation?', exact: true }).getByRole('button', { name: 'Retry same operation', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(uncertain).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await expect(page.getByLabel('Description', { exact: true })).toHaveCount(0);
    expect(await readState()).toEqual(before);
    await captureSafeAction(page, info, 'money-out-unknown-original-key');
    // Deliberate teardown only: both attempts were provably never forwarded.
    await withAccountingLeaveConfirmation(page, () => page.getByRole('button', { name: 'Leave recovery workspace', exact: true }).click());
    expect(attempts).toHaveLength(2);
  });
}
