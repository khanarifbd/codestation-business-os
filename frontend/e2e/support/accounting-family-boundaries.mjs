import { expect } from '@playwright/test';

// Negative transport fixtures below are intercepted BEFORE backend delivery. They
// never manufacture financial success and never establish a production retry rule.
export async function withAccountingBoundaryRoute(page, endpoint, handler, action) {
  const viewport = page.viewportSize();
  await page.route(endpoint, handler);
  try { return await action(); }
  finally {
    try { await page.unroute(endpoint, handler); }
    finally { if (viewport) await page.setViewportSize(viewport); }
  }
}

export async function withAccountingLeaveConfirmation(page, action) {
  const pending = [];
  const accept = dialog => { pending.push(dialog.accept().then(() => null, error => error)); };
  page.on('dialog', accept);
  try { return await action(); }
  finally {
    page.off('dialog', accept);
    const errors = await Promise.all(pending);
    if (errors.some(Boolean)) throw errors.find(Boolean);
  }
}

export async function verifyPayableRetainedRetry(page, info, endpoint, originalSubmit) {
  const requests = [];
  const handler = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    if (requests.length === 1) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Unexpected upstream response' }) });
    // Any unexpected repeat outside the original capture is blocked, not sent.
    await route.abort("blockedbyclient");
  };
  return withAccountingBoundaryRoute(page, `**${endpoint}`, handler, async () => {
    await page.getByRole('button', { name: 'Confirm & settle bill', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The outcome needs verification', exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].key).toBeTruthy();

    const history = await page.request.get(endpoint);
    expect(history.ok()).toBeTruthy();
    expect(await history.json()).toEqual([]);
    await page.getByRole('button', { name: 'Read current bill & history', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review same-operation retry', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'The outcome needs verification', exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('neutral-theme-payable-unknown-retained-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Review same-operation retry', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Retry the retained settlement?', exact: true })).toBeVisible();
    // captureJsonResponse is installed by originalSubmit and owns the one real
    // forwarding request. Observe at page request level so overlapping route
    // precedence cannot conceal a changed body/key or duplicate dispatch.
    const replay = [];
    const observe = request => {
      if (new URL(request.url()).pathname === endpoint && request.method() === 'POST') replay.push({ body: request.postData(), key: request.headers()['idempotency-key'] });
    };
    page.on('request', observe);
    try {
      const result = await originalSubmit(page.getByRole('button', { name: 'Retry same settlement', exact: true }));
      expect(replay).toHaveLength(1);
      expect(replay[0]).toEqual(requests[0]);
      return result;
    } finally { page.off('request', observe); }
  });
}

export async function verifyAdvancedReviewRefresh(page, info, marker) {
  const endpoint = '**/api/accounting/chart-of-accounts';
  let posts = 0;
  const handler = async route => {
    if (route.request().method() === 'POST') {
      posts++;
      return route.abort('blockedbyclient');
    }
    return route.continue();
  };
  const before = await page.request.get('/api/accounting/chart-of-accounts');
  expect(before.ok()).toBeTruthy();
  const chart = await before.json();
  await withAccountingBoundaryRoute(page, endpoint, handler, async () => {
    await page.goto('/dashboard/accounting/advanced/ledgers/new');
    await expect(page.getByLabel(/^Account code/)).toBeEnabled();
    await page.getByLabel(/^Account code/).fill(`DRAFT${marker}`);
    await page.getByLabel('Account name', { exact: true }).fill('Synthetic unsaved review');
    await page.getByRole('button', { name: 'Review ledger creation', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Go back', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh chart', exact: true }).click();
    await expect(page.getByLabel(/^Account code/)).toBeEnabled();
    await expect(page.getByLabel(/^Account code/)).toHaveValue(`DRAFT${marker}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Review ledger creation', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Synthetic unsaved review');
    await page.screenshot({ path: info.outputPath('neutral-theme-advanced-fresh-review-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('neutral-theme-advanced-fresh-review-mobile.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Go back', exact: true }).click();
    const after = await page.request.get('/api/accounting/chart-of-accounts');
    expect(after.ok()).toBeTruthy();
    expect(await after.json()).toEqual(chart);
    expect(posts).toBe(0);
    await withAccountingLeaveConfirmation(page, () => page.getByRole('button', { name: 'Cancel & back', exact: true }).click());
  });
}

export async function verifyManualBillUnknown(page, info, marker) {
  const endpoint = '**/api/accounting/payables';
  let posts = 0;
  const handler = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Unexpected upstream response' }) });
  };
  const before = await page.request.get('/api/accounting/payables?include_paid=true');
  expect(before.ok()).toBeTruthy();
  const bills = await before.json();
  await withAccountingBoundaryRoute(page, endpoint, handler, async () => {
    await page.goto('/dashboard/accounting/payables/new');
    await page.getByRole('button', { name: 'Supplier', exact: true }).click();
    await page.getByPlaceholder('Search...', { exact: true }).fill(`Synthetic not delivered ${marker}`);
    await page.getByRole('listbox').getByRole('button', { name: `Use “Synthetic not delivered ${marker}”`, exact: true }).click();
    await page.getByLabel(/^Subtotal before tax/).fill('10.01');
    await page.getByLabel(/^Supplier reference/).fill(`NEVER-SENT-${marker}`);
    await page.getByRole('button', { name: 'Expense category', exact: true }).click();
    await page.getByRole('listbox').getByRole('button').filter({ hasText: 'Operating Expenses' }).click();
    await page.getByLabel('What is this bill for?', { exact: true }).fill('Synthetic before-forward rejection only');
    await page.getByRole('button', { name: 'Review new bill', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm & recognize bill', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Do not create this bill again', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review new bill', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review same-operation retry', exact: true })).toHaveCount(0);
    const after = await page.request.get('/api/accounting/payables?include_paid=true');
    expect(after.ok()).toBeTruthy();
    expect(await after.json()).toEqual(bills);
    expect(posts).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath('neutral-theme-manual-bill-unknown-mobile.png') });
    // Only this fixture proves non-delivery. A production empty GET cannot prove it.
    await withAccountingLeaveConfirmation(page, () => page.getByRole('button', { name: 'Back to payables', exact: true }).click());
    expect(posts).toBe(1);
  });
}
