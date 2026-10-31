import { expect, test } from '@playwright/test';

test('dashboard final revision: real recovery, period and tenant isolation remain usable on mobile', async ({ page, context }, info) => {
  // One cold route plus real setup/recovery/tenant transition, not a global timeout increase.
  test.setTimeout(120_000);
  const baseURL = info.project.use.baseURL;
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL).hostname);
  const login = await page.request.post('/api/auth/login', { data: {
    email: 'neutral-theme@example.com', password: (() => { if (!process.env.E2E_PASSWORD) throw new Error('E2E_PASSWORD is required'); return process.env.E2E_PASSWORD; })(),
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
  const seriesOutage = route => route.abort('failed');
  await page.route('**/api/reports/dashboard-series?*', seriesOutage);
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
  const trends = page.getByRole('region', { name: 'Business trends', exact: true });
  await expect(trends.getByRole('alert')).toBeVisible();
  await expect(trends.getByText(/No recorded monetary activity/)).toHaveCount(0);
  await page.unroute('**/api/reports/dashboard-series?*', seriesOutage);
  await trends.getByRole('button', { name: 'Retry trends', exact: true }).click();
  await expect(trends.getByText(/No recorded monetary activity/)).toBeVisible();
  for (const label of ['Income', 'Expenses']) await expect(trends.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
  for (const label of ['Projects', 'Orders', 'Clients']) {
    const option = trends.getByRole('checkbox', { name: label, exact: true });
    await expect(option).not.toBeChecked();
    await option.check();
  }
  const counts = trends.getByRole('region', { name: 'Records created over time', exact: true });
  await expect(counts).toBeVisible();
  await expect(counts.getByText('All selected values are zero.', { exact: false })).toBeVisible();
  for (const label of ['Income', 'Expenses', 'Projects', 'Orders', 'Clients']) await trends.getByRole('checkbox', { name: label, exact: true }).uncheck();
  await expect(trends.getByText('Select at least one series to view its history.', { exact: true })).toBeVisible();
  await expect(trends.locator('.dashboard-series-chart')).toHaveCount(0);
  await trends.getByRole('checkbox', { name: 'Projects', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(counts).toBeVisible();
  await expect(counts.locator('.dashboard-series-legend li')).toHaveCount(1);

  const period = page.getByRole('combobox', { name: 'Reporting period', exact: true });
  // Assert the approved shared font resolves on both heading and native form control.
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toHaveCSS('font-family', /Inter/i);
  await expect(period).toHaveCSS('font-family', /Inter/i);
  await period.selectOption('last_month');
  await expect(period).toHaveValue('last_month');
  await expect(period).toBeEnabled();
  const displayedRange = page.locator('.dashboard-heading span').filter({ hasText: / · \d{4}-\d{2}-\d{2} — \d{4}-\d{2}-\d{2}$/ });
  await expect(displayedRange).toHaveCount(1);
  await expect(displayedRange).toContainText('Last month ·');
  const historyPeriod = counts.getByRole('combobox', { name: 'Explore period for Records created over time', exact: true });
  await expect(historyPeriod).toBeVisible();
  const rangeText = await displayedRange.textContent();
  const [, rangeFrom, rangeTo] = rangeText.match(/(\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2})$/);
  await expect(historyPeriod.locator('option').first()).toHaveValue(rangeFrom);
  await expect(historyPeriod.locator('option').last()).toHaveValue(rangeTo);


  // Delay one actual old-tenant response; never fabricate business metrics.
  let releaseOld;
  let oldResponseReady;
  const ready = new Promise(resolve => { oldResponseReady = resolve; });
  const release = new Promise(resolve => { releaseOld = resolve; });
  let delayedRequest;
  let oldRouteCompleted;
  const completed = new Promise(resolve => { oldRouteCompleted = resolve; });
  await page.route('**/api/reports/dashboard?*', async route => {
    delayedRequest = route.request();
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
  const oldBrowserResponse = page.waitForResponse(response => response.request() === delayedRequest);
  releaseOld();
  await completed;
  expect(await (await oldBrowserResponse).finished()).toBeNull();
  // Give the delivered fetch continuation and React paint a turn before checking stale-state rejection.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('.dashboard-heading')).toContainText('Reporting currency · GBP');
  await expect(period).toHaveValue('month');
  await expect(displayedRange).toContainText('This month ·');
  await expect(displayedRange).not.toContainText('This year ·');
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  // Design A changes presentation only on this exact admin route.
  await expect(page.locator('.workspace-shell')).toHaveClass(/dashboard-design-a/);
  await expect(page.locator('.ws-sidebar')).toHaveCSS('width', '224px');
  await expect(page.locator('.dashboard-operation-link')).toHaveCount(4);
  // CSS-only probe: real chart classes, no API/data mutation or screenshot fixture.
  // A single currency spans the panel; adding another restores separate equal cells.
  const chartLayout = await page.locator('.dashboard-design-a').evaluate(root => {
    const grid = document.createElement('div');
    grid.className = 'dashboard-trend-multiples';
    grid.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px';
    const first = document.createElement('article'); first.className = 'collections-trend';
    grid.append(first); root.append(grid);
    try {
      const single = getComputedStyle(first).gridColumn;
      const second = document.createElement('article'); second.className = 'collections-trend'; grid.append(second);
      return { single, multiple: [getComputedStyle(first).gridColumn, getComputedStyle(second).gridColumn], widths: [first.getBoundingClientRect().width, second.getBoundingClientRect().width] };
    } finally { grid.remove(); }
  });
  expect(chartLayout.single).toBe('1 / -1');
  expect(chartLayout.multiple).toEqual(['auto', 'auto']);
  expect(Math.abs(chartLayout.widths[0] - chartLayout.widths[1])).toBeLessThan(1);
  expect(chartLayout.widths[0]).toBeGreaterThan(0);
  expect(chartLayout.widths[0]).toBeLessThan(300);

  for (const card of await page.locator('.dashboard-operation-link').all()) {
    await expect(card).toHaveCSS('border-top-width', '1px');
    await expect(card).toHaveCSS('border-radius', '7px');
  }
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-final-desktop.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(period).toBeEnabled();
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-final-mobile.png'), fullPage: false });
  const cards = page.locator('.dashboard-operation-link');
  const first = await cards.nth(0).boundingBox(), second = await cards.nth(1).boundingBox(), third = await cards.nth(2).boundingBox();
  expect(first).not.toBeNull(); expect(second).not.toBeNull(); expect(third).not.toBeNull();
  expect(Math.abs(first.y - second.y)).toBeLessThan(1);
  expect(third.y).toBeGreaterThan(first.y + first.height);
  await page.locator('.ws-mobile-header').getByRole('button', { name: 'Open app drawer', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'App navigation', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('neutral-theme-design-a-dashboard-mobile-navigation.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'App navigation', exact: true })).toHaveCount(0);
  // Client-side navigation keeps CSS loaded: scope must still disappear on another page.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.ws-sidebar a[href="/dashboard/company"]').click();
  await expect(page).toHaveURL(/\/dashboard\/company$/);
  await expect(page.getByRole('heading', { level: 1, name: organizations[1].name, exact: true })).toBeVisible();
  await expect(page.locator('.workspace-shell')).not.toHaveClass(/dashboard-design-a/);
  await expect(page.locator('.ws-sidebar')).toHaveCSS('width', '244px');
  await page.screenshot({ path: info.outputPath('neutral-theme-design-a-company-scope-unchanged.png'), fullPage: false });
  await page.locator('.ws-sidebar a[href="/dashboard"]').click();
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-shell')).toHaveClass(/dashboard-design-a/);
  await expect(page.locator('.ws-sidebar')).toHaveCSS('width', '224px');

});
