import { expect } from '@playwright/test';
import { withAccountingBoundaryRoute, withAccountingLeaveConfirmation } from './accounting-family-boundaries.mjs';
import { captureSafeAction } from './credit-recurring-safe-actions.mjs';

// Fail closed: these are review/cancel probes, never posting/funding evidence.
export async function withNoFinancialReviewWrites(page, work) {
  const writes = [];
  const endpoint = /\/api\/accounting\/(?:loans|tax\/settlements|reconciliations)(?:[/?]|$)/;
  const handler = async route => {
    if (['GET', 'HEAD'].includes(route.request().method())) return route.continue();
    writes.push({ method: route.request().method(), url: route.request().url() });
    return route.abort('blockedbyclient');
  };
  return withAccountingBoundaryRoute(page, endpoint, handler, () => work(writes));
}
function field(page, label, tag = 'input') {
  return page.locator('label').filter({ has: page.locator('span').filter({ hasText: label }) }).locator(tag);
}
async function choose(page, label, option) {
  const trigger = page.getByRole('button', { name: label, exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.getByRole('listbox').getByRole('button').filter({ has: page.getByText(option, { exact: true }) }).click();
}
async function closeReview(page, dialog) {
  await dialog.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
export async function verifyFinancialReviewCancel(page, info, api, account, today) {
  const readState = async () => ({
    loans: await api(page, 'GET', '/accounting/loans'),
    settlements: await api(page, 'GET', '/accounting/tax/settlements'),
    reconciliations: await api(page, 'GET', '/accounting/reconciliations'),
    account: (await api(page, 'GET', '/finance/accounts')).find(row => row.id === account.id),
    journals: await api(page, 'GET', '/accounting/journals?limit=200'),
  });
  const before = await readState();
  expect(before.account?.id).toBe(account.id);
  expect(before.journals.length).toBeLessThan(200);
  await withNoFinancialReviewWrites(page, async writes => {
    await page.goto('/dashboard/accounting/loans/new');
    const lender = field(page, /^Lender name$/), principal = page.getByLabel(/^Approved principal/), approval = field(page, /^Approval date$/);
    await expect(lender).toBeEnabled();
    await lender.fill('Synthetic review only lender');
    await expect(page.getByRole('button', { name: 'Agreement currency', exact: true })).toContainText('USD');
    await principal.fill('1.01');
    await approval.fill(today);
    await page.getByRole('button', { name: 'Review draft agreement', exact: true }).click();
    const loanDialog = page.getByRole('dialog', { name: 'Create this draft agreement?', exact: true });
    await expect(loanDialog).toContainText('Synthetic review only lender');
    await expect(loanDialog).toContainText('USD 1.01');
    await expect(loanDialog).toContainText(today);
    await expect(loanDialog).toContainText('no cash, liability or journal is posted now');
    expect(writes).toHaveLength(0);
    await captureSafeAction(page, info, 'loan-draft-review-cancel');
    await closeReview(page, loanDialog);
    await expect(lender).toHaveValue('Synthetic review only lender');
    await expect(principal).toHaveValue('1.01');
    await expect(approval).toHaveValue(today);
    await withAccountingLeaveConfirmation(page, () => page.getByRole('button', { name: 'Cancel & back', exact: true }).click());

    const dated = await api(page, 'GET', `/accounting/tax/settlement-meta?settlement_date=${today}`);
    expect(dated.currency).toBe('USD');
    expect(dated.accounts.some(row => row.id === account.id)).toBe(true);
    await page.goto('/dashboard/accounting/tax/settlements/new');
    const type = field(page, /^Settlement type$/, 'select'), postingDate = field(page, /^Posting date$/), currency = field(page, /^Functional currency$/), taxAmount = page.getByLabel(/^Settlement amount/);
    await expect(type).toBeEnabled();
    await type.selectOption('indirect_tax_payment');
    await postingDate.fill(today);
    await expect(currency).toHaveValue(dated.currency);
    await choose(page, 'Pay from account', account.name);
    await taxAmount.fill('1.01');
    await page.getByRole('button', { name: 'Review settlement', exact: true }).click();
    const taxDialog = page.getByRole('dialog', { name: 'Post this tax settlement?', exact: true });
    await expect(taxDialog).toContainText('indirect tax payment');
    await expect(taxDialog).toContainText('USD 1.01');
    await expect(taxDialog).toContainText(account.id);
    await expect(taxDialog).toContainText(today);
    await expect(taxDialog).toContainText('it is not a draft');
    expect(writes).toHaveLength(0);
    await captureSafeAction(page, info, 'tax-dated-review-cancel');
    await closeReview(page, taxDialog);
    await expect(type).toHaveValue('indirect_tax_payment');
    await expect(postingDate).toHaveValue(today);
    await expect(taxAmount).toHaveValue('1.01');
    await expect(page.getByRole('button', { name: 'Pay from account', exact: true })).toContainText(account.name);
    await withAccountingLeaveConfirmation(page, () => page.getByRole('button', { name: 'Cancel and return', exact: true }).click());

    await page.goto('/dashboard/accounting/reconciliation/new');
    await choose(page, 'Financial account', `${account.name} · USD`);
    const endDate = field(page, /^Statement end date$/), balance = field(page, /^Statement ending balance \(USD\)$/);
    await endDate.fill(today);
    await balance.fill('-1.01');
    await page.getByRole('button', { name: 'Review reconciliation', exact: true }).click();
    const reconciliationDialog = page.getByRole('dialog', { name: 'Create this reconciliation draft?', exact: true });
    await expect(reconciliationDialog).toContainText(account.name);
    await expect(reconciliationDialog).toContainText('USD -1.01');
    await expect(reconciliationDialog).toContainText(today);
    await expect(reconciliationDialog).toContainText('does not move money');
    expect(writes).toHaveLength(0);
    await captureSafeAction(page, info, 'reconciliation-signed-review-cancel');
    await closeReview(page, reconciliationDialog);
    await expect(endDate).toHaveValue(today);
    await expect(balance).toHaveValue('-1.01');
    await withAccountingLeaveConfirmation(page, () => page.getByRole('button', { name: 'Cancel', exact: true }).click());
    expect(writes).toHaveLength(0);
    expect(await readState()).toEqual(before);
  });
}
