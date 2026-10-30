import { companyLeaveDialog, withSyntheticCompanyWrite } from './company-settings-boundaries.mjs';

export async function companyPanelReads(page, expect, paths, action) {
  const receipts = paths.map(path => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === new URL(page.url()).origin && url.pathname === path && !url.search && response.request().method() === 'GET';
  }).then(response => ({ response }), error => ({ error })));
  await action();
  const bodies = [];
  for (const pending of receipts) {
    const result = await pending;
    if (result.error) throw result.error;
    expect(result.response.status()).toBe(200);
    expect(await result.response.finished()).toBeNull();
    bodies.push(await result.response.json());
  }
  return bodies;
}
export async function captureCompanyPanel(page, expect, info, name, ready) {
  const previous = page.viewportSize();
  try {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      await expect(ready).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`neutral-theme-company-${name}-${size}.png`) });
      if (name === 'gateways' && size === 'mobile') {
        for (const mode of ['Test', 'Live']) {
          const heading = page.getByRole('heading', { name: `Stripe ${mode} Mode`, exact: true });
          await heading.scrollIntoViewIfNeeded();
          await expect(heading).toBeInViewport({ratio:1});
          await page.screenshot({ path: info.outputPath(`neutral-theme-company-gateways-${mode.toLowerCase()}-mobile-card.png`) });
        }
      }
    }
  } finally { if (previous) await page.setViewportSize(previous); }
}
export async function verifyCompanyOuterPanels({ page, context, expect, api, info }) {
  const [before, rates] = await companyPanelReads(page, expect, ['/api/company-settings/currencies', '/api/settings/exchange-rates'], () => page.getByRole('button', { name: 'Currencies & FX', exact: true }).click());
  expect(before.accounting_currency).toMatch(/^[A-Z]{3}$/);
  expect(Array.isArray(rates.rates)).toBe(true);
  const save = page.getByRole('button', { name: 'Save currencies', exact: true });
  await expect(save).toBeEnabled();
  await captureCompanyPanel(page, expect, info, 'currencies', page.getByRole('heading', { name: 'Currency roles', exact: true }));
  await withSyntheticCompanyWrite(page, '/api/company-settings/currencies', 'PATCH', async boundary => {
    await save.click();
    await expect.poll(boundary.count).toBe(1);
    expect(boundary.body()).toEqual({ accounting_currency: before.accounting_currency, reporting_currency: before.reporting_currency, default_client_currency: before.default_client_currency || null });
    await page.getByRole('button', { name: 'Payment Gateways', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Currency roles', exact: true })).toBeVisible();
    boundary.release();
    await expect(page.getByText('The currency operation outcome is unknown.', { exact: false })).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Read currency settings only', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Read currency settings only', exact: true })).toBeEnabled();
    await expect(save).toBeDisabled();
    expect(boundary.count()).toBe(1);
    expect(await api(context.request, '/api/company-settings/currencies', undefined, 'get')).toEqual(before);
    await companyLeaveDialog(page, () => page.getByRole('button', { name: 'Payment Gateways', exact: true }).click(), false, expect);
    await expect(save).toBeDisabled();
    const [gateway] = await companyPanelReads(page, expect, ['/api/finance/payment-gateways/stripe'], () => companyLeaveDialog(page, () => page.getByRole('button', { name: 'Payment Gateways', exact: true }).click(), true, expect));
    expect(gateway.connections.map(row => row.mode).sort()).toEqual(['live', 'test']);
    await expect(page.getByRole('heading', { name: 'Stripe Test Mode', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stripe Live Mode', exact: true })).toBeVisible();
    await captureCompanyPanel(page, expect, info, 'gateways', page.getByRole('heading', { name: 'Payment gateways', exact: true }));
  }, true);
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await expect(page.getByLabel('Legal company name', { exact: true })).toBeVisible();
}
