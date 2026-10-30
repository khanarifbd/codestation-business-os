import { expect, test } from '@playwright/test';

test('administration workspace: company save and audit filters work across desktop and mobile', async ({ page, context }, info) => {
  // Two cold routes, a real settings save/readback and responsive checks in one isolated workspace.
  test.setTimeout(120_000);
  const baseURL = info.project.use.baseURL;
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL).hostname);
  const login = await page.request.post('/api/auth/login', { data: {
    email: 'neutral-theme@example.com', password: process.env.E2E_PASSWORD ?? 'E2E-Launch-Password-123!',
  } });
  expect(login.status()).toBe(200);
  const created = await page.request.post('/api/organizations', { data: {
    name: `Administration fixture ${Date.now()}`, currency: 'USD', country_code: 'US', timezone: 'UTC',
  } });
  expect(created.status()).toBe(201);
  const { organization } = await created.json();
  await context.addCookies([{ name: 'organization_id', value: organization.id, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dashboard/company');
  const sections = page.getByRole('complementary', { name: 'Company settings sections' });
  await expect(sections.getByRole('button')).toHaveCount(13);
  const legalName = page.getByRole('textbox', { name: 'Legal company name', exact: true });
  await legalName.fill('Administration QA Company');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();
  const saved = await page.request.get('/api/company-settings');
  expect(saved.status()).toBe(200);
  expect((await saved.json()).profile.legal_name).toBe('Administration QA Company');
  await expect(page.locator('.company-settings-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(sections.getByRole('button', { name: 'General', exact: true })).toHaveCSS('background-color', 'rgb(235, 235, 235)');
  await page.screenshot({ path: info.outputPath('neutral-theme-admin-company-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await sections.getByRole('button', { name: 'Online & Legal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Online & Legal', exact: true })).toBeVisible();
  await sections.getByRole('button', { name: 'General', exact: true }).click();
  await expect(legalName).toHaveValue('Administration QA Company');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('neutral-theme-admin-company-mobile.png'), fullPage: true });
  // Viewport evidence keeps fixed/sticky chrome in its real on-screen position.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath('neutral-theme-admin-company-mobile-viewport.png'), fullPage: false });
  await page.goto('/dashboard/activity-logs');
  await expect(page.getByRole('heading', { name: 'Company Activity Logs', exact: true })).toBeVisible();
  await expect(page.getByText(/records loaded/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Action contains', exact: true }).fill('no-such-administration-qa-action');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('No activity logs match the current filters.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Action contains', exact: true })).toHaveValue('');
  await expect(page.getByText(/records loaded/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('neutral-theme-admin-activity-mobile.png'), fullPage: true });
  // Viewport evidence keeps fixed/sticky chrome in its real on-screen position.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath('neutral-theme-admin-activity-mobile-viewport.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const detailAction = page.getByRole('button', { name: /^View activity / }).first();
  await expect(detailAction).toBeVisible();
  await detailAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Activity detail', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close activity detail', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Activity detail', exact: true })).toHaveCount(0);
  await detailAction.click();
  await expect(page.getByRole('dialog', { name: 'Activity detail', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close activity detail', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Activity detail', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('neutral-theme-admin-activity-desktop.png'), fullPage: true });
});
