import { expect } from '@playwright/test';

export async function captureReportsPage(page, info, name) {
  const previous = page.viewportSize();
  try {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator('#report-results')).toHaveAttribute('aria-busy', 'false');
      await page.screenshot({ path: info.outputPath(`neutral-theme-reports-${name}-${size}.png`), fullPage: false });
    }
  } finally { if (previous) await page.setViewportSize(previous); }
}

export async function observeReportRead(page, day, action) {
  const observed = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/reports/overview'
      && url.searchParams.get('date_from') === day && url.searchParams.get('date_to') === day
      && url.searchParams.get('currency') === 'USD';
  }).then(response => ({ response }), error => ({ error }));
  await action();
  const result = await observed;
  if (result.error) throw result.error;
  expect(result.response.status()).toBe(200);
  const body = await result.response.json();
  expect(body.reporting_basis).toBe('operational');
  expect([body.date_from, body.date_to]).toEqual([day, day]);
  expect(body.financials.every(row => row.currency === 'USD')).toBe(true);
  const completion = await result.response.finished();
  if (completion) throw completion;
  await expect(page.locator('#report-results')).toHaveAttribute('aria-busy', 'false');
  return body;
}

export async function verifyReportsReadOnly(page, info, day, project, costClient) {
  await page.locator('.or-filters > summary').click();
  await page.getByLabel('From', { exact: true }).fill(day);
  await page.getByLabel('To', { exact: true }).fill(day);
  await page.getByRole('button', { name: 'Currency', exact: true }).click();
  await page.getByRole('listbox').getByRole('button', { name: 'USD', exact: true }).click();
  await expect(page.getByText('Filter changes are not applied yet.', { exact: true })).toBeVisible();
  await observeReportRead(page, day, () => page.getByRole('button', { name: 'Apply filters', exact: true }).click());
  await expect(page.getByRole('region', { name: 'Applied report scope', exact: true })).toContainText(`${day} — ${day}`);
  await page.locator('.or-filters > summary').click();
  const costRow = page.getByRole('row').filter({ hasText: costClient.display_name });
  await expect(costRow).toContainText('USD -6.00');
  await observeReportRead(page, day, () => page.getByRole('button', { name: 'Refresh results', exact: true }).click());
  await expect(costRow).toContainText('USD -6.00');
  await captureReportsPage(page, info, 'clients');
  const navigation = page.getByRole('navigation', { name: 'Report sections', exact: true });
  await navigation.getByRole('link', { name: 'Performance', exact: true }).click();
  await expect(page.locator('.or-result').filter({ has: page.getByText('Operational margin', { exact: true }) })).toContainText('USD 169.00');
  await captureReportsPage(page, info, 'performance');
  await navigation.getByRole('link', { name: 'Current position', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A snapshot of the workspace now', exact: true })).toBeVisible();
  await expect(page.getByText('Not an as-of-date report. Selected dates, client and project do not apply to this section.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active account balances', exact: true })).toBeVisible();
  await captureReportsPage(page, info, 'position');
  await navigation.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: project.project_number })).toContainText('USD 175.00');
  await expect(page.getByRole('region', { name: 'Applied report scope', exact: true })).toContainText(`${day} — ${day}`);
  await captureReportsPage(page, info, 'projects');
}
