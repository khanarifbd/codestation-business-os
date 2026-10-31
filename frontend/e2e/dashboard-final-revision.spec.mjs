import { expect, test } from '@playwright/test';
import { verifyDashboardChartPriority } from '../e2e-admin-readonly/support/dashboard-series.mjs';

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

  const dateTrigger = page.getByRole('button', { name: 'Choose dashboard date range', exact: true });
  const dateDialog = page.getByRole('dialog', { name: 'Dashboard date range', exact: true });
  const dateFilter = page.getByRole('form', { name: 'Dashboard date range', exact: true });
  await expect(dateDialog).not.toBeVisible();
  await dateTrigger.click();
  await expect(dateDialog).toBeVisible();
  const fromInput = dateFilter.getByLabel('From', { exact: true }), toInput = dateFilter.getByLabel('To', { exact: true });
  const applyRange = dateFilter.getByRole('button', { name: 'Apply range', exact: true });
  await expect(page.getByRole('combobox', { name: 'Reporting period', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toHaveCSS('font-family', /Inter/i);
  await expect(fromInput).toHaveCSS('font-family', /Inter/i);
  const today = await toInput.inputValue(), monthStart = `${today.slice(0, 7)}-01`;
  await expect(fromInput).toHaveValue(monthStart);
  await expect(dateFilter.getByRole('button', { name: 'This month', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const expectedReads = ['/api/reports/dashboard', '/api/reports/dashboard-details', '/api/reports/dashboard-series'];
  const dateReads = [];
  page.on('request', request => { const url = new URL(request.url()); if (expectedReads.includes(url.pathname)) dateReads.push(url); });
  let applied = { from: monthStart, to: today };
  async function applyAndVerify(range, action) {
    const changed = range.from !== applied.from || range.to !== applied.to;
    const waits = changed ? expectedReads.map(path => page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === path && url.searchParams.get('date_from') === range.from && url.searchParams.get('date_to') === range.to && response.status() === 200;
    })) : [];
    await action();
    for (const pending of waits) {
      const response = await pending; expect(await response.finished()).toBeNull();
      if (new URL(response.url()).pathname !== '/api/reports/dashboard-details') {
        const body = await response.json(); expect(body.date_from).toBe(range.from); expect(body.date_to).toBe(range.to);
      }
    }
    await expect(dateDialog).not.toBeVisible();
    await expect(dateTrigger).toBeFocused();
    await expect(dateTrigger).toContainText(`${range.from} – ${range.to}`);
    await dateTrigger.click();
    await expect(fromInput).toHaveValue(range.from); await expect(toInput).toHaveValue(range.to);
    await expect(applyRange).toBeEnabled();
    await dateFilter.getByRole('button', { name: 'Cancel', exact: true }).click();
    applied = range;
  }
  // Preset selection is draft-only; Cancel/Escape/backdrop never dispatch report reads.
  for (const dismissal of ['Cancel', 'Escape', 'backdrop']) {
    if (!await dateDialog.isVisible()) await dateTrigger.click();
    await expect(fromInput).toBeFocused();
    const before = dateReads.length;
    await dateFilter.getByRole('button', { name: 'Last month', exact: true }).click();
    await expect(fromInput).not.toHaveValue(monthStart);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(dateReads.length).toBe(before);
    if (dismissal === 'Cancel') await dateFilter.getByRole('button', { name: 'Cancel', exact: true }).click();
    else if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await page.mouse.click(1, 1);
    await expect(dateDialog).not.toBeVisible();
    await expect(dateTrigger).toBeFocused();
    expect(dateReads.length).toBe(before);
    await dateTrigger.click();
    await expect(fromInput).toHaveValue(monthStart); await expect(toInput).toHaveValue(today);
    await dateFilter.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await dateTrigger.click();
  await applyAndVerify({ from: today, to: today }, async () => { await dateFilter.getByRole('button', { name: 'Today', exact: true }).click(); await applyRange.click(); });
  await expect(counts.locator('polyline')).toHaveCount(0);
  await expect(counts).toContainText('One recorded period');
  const monday = new Date(`${today}T00:00:00Z`); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  await dateTrigger.click();
  await applyAndVerify({ from: monday.toISOString().slice(0, 10), to: today }, async () => { await dateFilter.getByRole('button', { name: 'This week (Mon–today)', exact: true }).click(); await applyRange.click(); });
  const previousEnd = new Date(`${monthStart}T00:00:00Z`); previousEnd.setUTCDate(0);
  const rangeTo = previousEnd.toISOString().slice(0, 10), rangeFrom = `${rangeTo.slice(0, 7)}-01`;
  await dateTrigger.click();
  await fromInput.fill(rangeFrom); await toInput.fill(rangeTo);
  await applyAndVerify({ from: rangeFrom, to: rangeTo }, () => applyRange.click());
  const displayedRange = page.locator('.dashboard-heading span').filter({ hasText: / · \d{4}-\d{2}-\d{2} — \d{4}-\d{2}-\d{2}$/ });
  await expect(displayedRange).toHaveCount(1); await expect(displayedRange).toContainText(`${rangeFrom} — ${rangeTo}`);
  const historyPlot = counts.locator('.dashboard-series-svg'), inspectedDate = counts.locator('.dashboard-series-current-period dd');
  await historyPlot.focus(); await historyPlot.press('Home'); await expect(inspectedDate).toHaveText(rangeFrom);
  await historyPlot.press('End'); await expect(inspectedDate).toHaveText(rangeTo);
  await dateTrigger.click();
  const readsBeforeInvalid = dateReads.length;
  await fromInput.fill(today); await toInput.fill(rangeFrom); await applyRange.click();
  await expect(dateFilter.getByRole('alert')).toHaveText('From must be on or before To.');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(dateReads.length).toBe(readsBeforeInvalid);

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
  await dateFilter.getByRole('button', { name: 'This year', exact: true }).click();
  await applyRange.click();
  await ready;
  await expect(dateDialog).not.toBeVisible();
  await expect(dateTrigger).toBeDisabled();
  const switcher = page.locator('.ws-sidebar .ws-switcher');
  await switcher.locator('button[aria-expanded]').click();
  await switcher.getByRole('button', { name: new RegExp(organizations[1].name) }).click();
  await expect(page.locator('.dashboard-heading')).toContainText(organizations[1].name);
  await dateTrigger.click();
  await expect(dateFilter.getByRole('button', { name: 'This month', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(fromInput).toBeEnabled();
  await dateFilter.getByRole('button', { name: 'Cancel', exact: true }).click();
  const oldBrowserResponse = page.waitForResponse(response => response.request() === delayedRequest);
  releaseOld();
  await completed;
  expect(await (await oldBrowserResponse).finished()).toBeNull();
  // Give the delivered fetch continuation and React paint a turn before checking stale-state rejection.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('.dashboard-heading')).toContainText('Reporting currency · GBP');
  await dateTrigger.click();
  await expect(dateFilter.getByRole('button', { name: 'This month', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(displayedRange).toContainText('This month ·');
  await expect(displayedRange).not.toContainText('This year ·');
  await dateFilter.getByRole('button', { name: 'Cancel', exact: true }).click();
  await trends.getByRole('checkbox', { name: 'Projects', exact: true }).check();
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
  await verifyDashboardChartPriority(page, expect);
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-final-desktop.png'), fullPage: false });
  await dateTrigger.click();
  await expect(fromInput).toBeFocused();
  await expect(dateDialog).toBeInViewport({ ratio: 1 });
  for (const key of ['Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key);
    expect(await dateDialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-date-popup-desktop.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(dateTrigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(dateDialog).not.toBeVisible();
  await expect(dateTrigger).toBeEnabled();
  await verifyDashboardChartPriority(page, expect);
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-final-mobile.png'), fullPage: false });
  await dateTrigger.click();
  await expect(dateDialog).toBeInViewport({ ratio: 1 });
  await expect(fromInput).toBeFocused();
  await expect(applyRange).toBeInViewport({ ratio: 1 });
  expect(await dateDialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-date-popup-mobile.png'), fullPage: false });
  await dateFilter.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dateTrigger).toBeFocused();
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
