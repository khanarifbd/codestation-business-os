import { expect } from '@playwright/test';

export async function captureSharedAdmin(page, info, name) {
  const previous = page.viewportSize();
  try {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`neutral-theme-shared-admin-${name}-${size}.png`), fullPage: false });
    }
  } finally { if (previous) await page.setViewportSize(previous); }
}

export async function verifyActivityReadOwnership(page, info) {
  const marker = 'no-such-shared-admin-delayed-action';
  const matches = url => url.pathname === '/api/tenant/activity-logs' && url.searchParams.get('action') === marker;
  let release, finish, started = false, ready = false, failure;
  const gate = new Promise(resolve => { release = resolve; });
  const done = new Promise(resolve => { finish = resolve; });
  const handler = async route => {
    started = true;
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect((await response.json()).items).toEqual([]);
      ready = true;
      await gate;
      await route.fulfill({ response });
    } catch (error) { failure = error; await route.abort().catch(() => {}); }
    finally { finish(); }
  };
  try {
    await page.route(matches, handler);
    await page.getByRole('textbox', { name: 'Action contains', exact: true }).fill(marker);
    const observed = page.waitForResponse(response => matches(new URL(response.url())) && response.request().method() === 'GET').then(response => ({ response }), error => ({ error }));
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => { if (failure) throw failure; return ready; }).toBe(true);
    const resetRead = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/tenant/activity-logs' && !url.searchParams.has('action') && response.request().method() === 'GET'; }).then(response => ({ response }), error => ({ error }));
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    const reset = await resetRead;
    if (reset.error) throw reset.error;
    expect(reset.response.status()).toBe(200);
    expect((await reset.response.json()).items.length).toBeGreaterThan(0);
    const first = page.getByRole('button', { name: /^View activity / }).first();
    await expect(first).toBeVisible();
    release();
    const result = await observed;
    if (result.error) throw result.error;
    const completion = await result.response.finished();
    if (completion) throw completion;
    await done;
    if (failure) throw failure;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(first).toBeVisible();
    await expect(page.getByText('No activity logs match the current filters.', { exact: true })).toHaveCount(0);
    await first.focus();
    const detailRead = page.waitForResponse(response => /^\/api\/tenant\/activity-logs\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET').then(response => ({ response }), error => ({ error }));
    await page.keyboard.press('Enter');
    const close = page.getByRole('button', { name: 'Close activity detail', exact: true });
    await expect(close).toBeFocused();
    const detail = await detailRead;
    if (detail.error) throw detail.error;
    expect(detail.response.status()).toBe(200);
    const detailError = await detail.response.finished();
    if (detailError) throw detailError;
    await expect(page.getByRole('dialog', { name: 'Activity detail', exact: true }).getByText('Audit detail', { exact: true })).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await captureSharedAdmin(page, info, 'activity-drawer');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Activity detail', exact: true })).toHaveCount(0);
    await expect(first).toBeFocused();
  } finally {
    release();
    await page.unroute(matches, handler);
    if (started) await done;
  }
}

export async function openNotificationsAfterOutage(page) {
  const matches = url => url.pathname === '/api/workspace/notifications';
  const handler = route => route.abort('failed');
  try {
    await page.route(matches, handler);
    await page.goto('/dashboard/notifications');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await expect(page.getByText('You are all caught up', { exact: true })).toHaveCount(0);
    const metrics = page.getByRole('region', { name: 'Latest loaded task alerts', exact: true });
    await expect(metrics.getByText('—', { exact: true })).toHaveCount(3);
    await expect(page.getByText(/Failed to fetch|Unable to load notifications|Load failed|NetworkError/)).toBeVisible();
  } finally { await page.unroute(matches, handler); }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
}

export async function verifyPersonalUnknown(page, info) {
  const beforeResponse = await page.request.get('/api/profile');
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json();
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: before.full_name, exact: true })).toBeVisible();
  await captureSharedAdmin(page, info, 'profile-overview');
  await page.goto('/dashboard/profile/edit');
  const fullName = page.getByRole('textbox', { name: 'Full name', exact: true });
  await expect(fullName).toHaveValue(before.full_name);
  await fullName.fill('Synthetic unforwarded personal draft');
  const matches = url => url.pathname === '/api/profile';
  let attempts = 0, cancellations = 0, dialogFailure;
  const handler = async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    attempts++;
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: [] }) });
  };
  const cancel = async dialog => {
    try { expect(dialog.message()).toContain('may already have completed'); cancellations++; }
    catch (error) { dialogFailure = error; }
    finally { await dialog.dismiss().catch(error => { dialogFailure ||= error; }); }
  };
  try {
    await page.route(matches, handler);
    await page.getByRole('button', { name: 'Save personal details', exact: true }).click();
    await expect(page.getByText('Outcome unknown', { exact: true })).toBeVisible();
    await expect(fullName).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save personal details', exact: true })).toBeDisabled();
    await fullName.evaluate(element => element.form.requestSubmit());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(attempts).toBe(1);
    page.on('dialog', cancel);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(() => { if (dialogFailure) throw dialogFailure; return cancellations; }).toBe(1);
    await expect(page).toHaveURL(/\/dashboard\/profile\/edit$/);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/profile' && response.request().method() === 'GET').then(response => ({ response }), error => ({ error }));
    await page.getByRole('button', { name: 'Review current account information', exact: true }).click();
    const read = await refreshed;
    if (read.error) throw read.error;
    expect(read.response.status()).toBe(200);
    const readError = await read.response.finished();
    if (readError) throw readError;
    await expect(page.getByText('Verifying your account…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Refreshing current information; changes are unavailable until verified.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Outcome unknown', { exact: true })).toBeVisible();
    await expect(fullName).toBeDisabled();
    const after = await page.request.get('/api/profile');
    expect(after.status()).toBe(200);
    const current = await after.json();
    expect([current.id, current.full_name, current.phone, current.timezone]).toEqual([before.id, before.full_name, before.phone, before.timezone]);
    expect(attempts).toBe(1);
    await captureSharedAdmin(page, info, 'profile-unknown');
  } finally { page.off('dialog', cancel); await page.unroute(matches, handler); }
}
