// Negative fixture requests are fulfilled before forwarding. No backend write or
// idempotency claim is made by these synthetic browser boundary checks.
export async function companyWrite({ page, expect, ui, path, method, action, message = 'Changes saved' }) {
  const result = await ui(page, path, method, action);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'General', exact: true })).toBeEnabled();
  return result;
}
export async function withSyntheticCompanyWrite(page, path, method, work, held = false) {
  let release;
  const gate = held ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const tasks = [], failures = [];
  let count = 0, body = null;
  const matcher = url => url.pathname === path;
  const handler = route => {
    const task = (async () => {
      if (route.request().method() !== method) return route.continue();
      count++;
      body = route.request().postDataJSON?.() ?? null;
      await gate;
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Unexpected upstream response' }) });
    })();
    tasks.push(task);
    task.catch(error => { failures.push(error); });
    return task;
  };
  await page.route(matcher, handler);
  try {
    await work({ count: () => count, body: () => body, release: () => release?.() });
    if (failures.length) throw failures[0];
  } finally {
    release?.();
    try { await page.unroute(matcher, handler); }
    finally { await Promise.allSettled(tasks); }
  }
}
export async function companyLeaveDialog(page, action, accept, expect) {
  let observed = false;
  const tasks = [], failures = [];
  const handler = dialog => {
    observed = true;
    const task = Promise.resolve().then(() => accept ? dialog.accept() : dialog.dismiss());
    tasks.push(task);task.catch(error => { failures.push(error); });
  };
  page.on('dialog', handler);
  try { await action(); await expect.poll(() => observed).toBe(true); await Promise.all(tasks); if (failures.length) throw failures[0]; }
  finally { page.off('dialog', handler); await Promise.allSettled(tasks); }
}
export async function verifyCompanyUnknownBoundaries({ page, context, expect, api, info }) {
  const viewport = page.viewportSize();
  try {
    await page.goto('/dashboard/company?tab=legal');
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    await page.getByRole('listbox').getByRole('button', { name: /^Other/ }).click();
    await page.getByLabel('Display label', { exact: true }).fill('Synthetic not-forwarded identifier');
    await page.getByLabel('Value', { exact: true }).fill('SYNTHETIC-NOT-FORWARDED');
    const before = await api(context.request, '/api/company-settings', undefined, 'get');
    await withSyntheticCompanyWrite(page, '/api/company-settings/identifiers', 'POST', async boundary => {
      await page.getByRole('button', { name: 'Add identifier', exact: true }).click();
      await expect(page.getByText(/The write outcome is unknown/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add identifier', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Read current settings', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Read current settings', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Add identifier', exact: true })).toBeDisabled();
      expect(boundary.count()).toBe(1);
      expect((await api(context.request, '/api/company-settings', undefined, 'get')).identifiers).toEqual(before.identifiers);
      await page.screenshot({ path: info.outputPath('neutral-theme-company-identifier-unknown.png'), fullPage: true });
      // Deliberate exit is only safe in this known-not-forwarded disposable fixture.
      await companyLeaveDialog(page, () => page.getByRole('button', { name: 'System Defaults', exact: true }).click(), true, expect);
    });
    const days = page.getByLabel('Quotation validity days', { exact: true });
    const defaults = await api(context.request, '/api/company-settings/system-defaults', undefined, 'get');
    await expect(days).toBeEnabled();
    const changedDays = defaults.quotation_validity_days === 31 ? 32 : 31;
    await days.fill(String(changedDays));
    await companyLeaveDialog(page, () => page.getByRole('button', { name: 'General', exact: true }).click(), false, expect);
    await expect(days).toHaveValue(String(changedDays));
    await withSyntheticCompanyWrite(page, '/api/company-settings/system-defaults', 'PATCH', async boundary => {
      await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
      await expect.poll(boundary.count).toBe(1);
      await page.getByRole('button', { name: 'General', exact: true }).click();
      await expect(days).toBeDisabled();
      await expect(page.getByRole('heading', { name: 'System defaults', exact: true }).last()).toBeVisible();
      boundary.release();
      await expect(page.getByText(/The save outcome is unknown/)).toBeVisible();
      await page.getByRole('button', { name: 'Retry read only', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Retry read only', exact: true })).toBeEnabled();
      await expect(days).toHaveValue(String(changedDays));
      await expect(page.getByRole('button', { name: 'Save defaults', exact: true })).toBeDisabled();
      expect(boundary.count()).toBe(1);
      expect(await api(context.request, '/api/company-settings/system-defaults', undefined, 'get')).toEqual(defaults);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(days).toBeVisible();
      await page.screenshot({ path: info.outputPath('neutral-theme-company-defaults-unknown-mobile.png') });
      await companyLeaveDialog(page, () => page.getByRole('button', { name: 'General', exact: true }).click(), false, expect);
      await expect(days).toBeDisabled();
      await companyLeaveDialog(page, () => page.getByRole('button', { name: 'General', exact: true }).click(), true, expect);
      await expect(page.getByLabel('Legal company name', { exact: true })).toBeVisible();
    }, true);
  } finally { if (viewport) await page.setViewportSize(viewport); }
}
