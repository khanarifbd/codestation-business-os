import { expect, test } from '@playwright/test';

test('dashboard final revision: real recovery, period and tenant isolation remain usable on mobile', async ({ page, context }, info) => {
  // One cold route plus real setup/recovery/tenant transition, not a global timeout increase.
  test.setTimeout(120_000);
  const baseURL = info.project.use.baseURL;
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL).hostname);
  const login = await page.request.post('/api/auth/login', { data: {
    email: 'neutral-theme@example.com', password: process.env.E2E_PASSWORD ?? 'E2E-Launch-Password-123!',
  } });
  expect(login.status()).toBe(200);
  const stamp = Date.now();
  const organizations = [];
  for (const [suffix, currency, timezone] of [['A', 'USD', 'America/New_York'], ['B', 'GBP', 'Europe/London']]) {
    const response = await page.request.post('/api/organizations', { data: {
      name: `Dashboard final ${suffix} ${stamp}`, currency, country_code: suffix === 'A' ? 'US' : 'GB', timezone,
    } });
    expect(response.status()).toBe(201);
    organizations.push((await response.json()).organization);
  }
  await context.addCookies([{ name: 'organization_id', value: organizations[0].id, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Hold a transport outage through StrictMode effect remounts, until the active UI observes it.
  // Recovery and all business payloads still use the real app/database.
  const reportOutage = route => route.abort('failed');
  const detailsOutage = route => route.abort('failed');
  await page.route('**/api/reports/dashboard?*', reportOutage);
  await page.route('**/api/reports/dashboard-details?*', detailsOutage);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard unavailable', exact: true })).toBeVisible();
  await expect(page.getByText(/financial reporting is restricted/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-recoverable-error.png'), fullPage: false });
  await page.unroute('**/api/reports/dashboard?*', reportOutage);
  await page.getByRole('button', { name: 'Retry dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toBeVisible();
  const retryDetails = page.getByRole('button', { name: 'Retry dashboard details', exact: true });
  await expect(retryDetails).toHaveCount(3);
  await page.unroute('**/api/reports/dashboard-details?*', detailsOutage);
  await retryDetails.first().click();
  await expect(retryDetails).toHaveCount(0);
  await expect(page.getByText('No financial accounts', { exact: true })).toBeVisible();
  const period = page.getByRole('combobox', { name: 'Reporting period', exact: true });
  // Assert the approved shared font resolves on both heading and native form control.
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toHaveCSS('font-family', /Inter/i);
  await expect(period).toHaveCSS('font-family', /Inter/i);
  await period.selectOption('last_month');
  await expect(period).toHaveValue('last_month');
  await expect(period).toBeEnabled();
  await expect(page.locator('.dashboard-heading')).toContainText('Last month');

  // Delay one actual old-tenant response; never fabricate business metrics.
  let releaseOld;
  let oldResponseReady;
  const ready = new Promise(resolve => { oldResponseReady = resolve; });
  const release = new Promise(resolve => { releaseOld = resolve; });
  let oldRouteCompleted;
  const completed = new Promise(resolve => { oldRouteCompleted = resolve; });
  await page.route('**/api/reports/dashboard?*', async route => {
    const response = await route.fetch();
    oldResponseReady();
    await release;
    await route.fulfill({ response });
    oldRouteCompleted();
  }, { times: 1 });
  await period.selectOption('year');
  await ready;
  await expect(period).toBeDisabled();
  const switcher = page.locator('.ws-sidebar .ws-switcher');
  await switcher.locator('button[aria-expanded]').click();
  await switcher.getByRole('button', { name: new RegExp(organizations[1].name) }).click();
  await expect(page.locator('.dashboard-heading')).toContainText(organizations[1].name);
  await expect(period).toHaveValue('month');
  await expect(period).toBeEnabled();
  releaseOld();
  await completed;
  await expect(page.locator('.dashboard-heading')).toContainText('Reporting currency · GBP');
  await expect(period).toHaveValue('month');
  await expect(page.locator('.dashboard-heading')).not.toContainText('This year');
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-final-desktop.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(period).toBeEnabled();
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-final-mobile.png'), fullPage: false });
});
