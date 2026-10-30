import { expect, test } from '@playwright/test';

// Real application and disposable CI database; never runs against a live tenant.
test('clients final revision: international create/edit, validation recovery and responsive detail', async ({ page, context }, info) => {
  // One authenticated journey across two cold Next routes, no request retries.
  test.setTimeout(90_000);
  const baseURL = info.project.use.baseURL;
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL).hostname);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const login = await page.request.post('/api/auth/login', { data: {
    email: 'neutral-theme@example.com', password: process.env.E2E_PASSWORD ?? 'E2E-Launch-Password-123!',
  } });
  expect(login.status()).toBe(200);
  const organizationResponse = await page.request.post('/api/organizations', { data: {
    name: `Clients final fixture ${info.workerIndex}-${Date.now()}`, country_code: 'GB', currency: 'GBP', timezone: 'Europe/London',
  } });
  expect(organizationResponse.status()).toBe(201);
  const { organization } = await organizationResponse.json();
  await context.addCookies([{ name: 'organization_id', value: organization.id, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);

  for (const data of [{ display_name: '   ' }, { display_name: 'Invalid country', country_code: 'ZZ' }, { display_name: 'Invalid currency', currency: 'QQQ' }]) {
    const response = await page.request.post('/api/crm/clients', { data });
    expect(response.status()).toBe(422);
  }
  const normalized = await page.request.post('/api/crm/clients', { data: {
    display_name: '  Müller 株式会社  ', country_code: ' gb ', currency: ' gbp ', postal_code: '02108',
  } });
  expect(normalized.status()).toBe(201);
  const normalizedClient = await normalized.json();
  expect(normalizedClient).toMatchObject({ display_name: 'Müller 株式会社', country_code: 'GB', currency: 'GBP' });
  for (const data of [{ display_name: null }, { display_name: '\u00a0' }, { client_type: null }, { status: null }]) {
    const response = await page.request.patch(`/api/crm/clients/${normalizedClient.id}`, { data });
    expect(response.status()).toBe(422);
  }
  const retainedResponse = await page.request.get(`/api/crm/clients/${normalizedClient.id}/detail`);
  expect(retainedResponse.status()).toBe(200);
  expect(await retainedResponse.json()).toMatchObject({ display_name: 'Müller 株式会社', status: 'active', postal_code: '02108' });

  const clearResponse = await page.request.patch(`/api/crm/clients/${normalizedClient.id}`, { data: { country_code: null, currency: null } });
  expect(clearResponse.status()).toBe(200);
  await page.goto('/dashboard/clients');
  await page.getByRole('button', { name: 'Edit Müller 株式会社', exact: true }).click();
  const clearedEditor = page.getByRole('dialog', { name: 'Edit client record', exact: true });
  await expect(clearedEditor.locator('input[name="country_code"]')).toHaveValue('');
  await expect(clearedEditor.locator('input[name="currency"]')).toHaveValue('');
  await clearedEditor.getByLabel('Contact person', { exact: true }).fill('Optional clear preserved');
  const clearedSave = page.waitForResponse(response => response.url().endsWith(`/api/crm/clients/${normalizedClient.id}`) && response.request().method() === 'PATCH');
  await clearedEditor.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await clearedSave).status()).toBe(200);
  await expect(clearedEditor.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await clearedEditor.getByRole('button', { name: 'Close client editor', exact: true }).click();
  const clearReadback = await page.request.get(`/api/crm/clients/${normalizedClient.id}/detail`);
  expect(clearReadback.status()).toBe(200);
  expect(await clearReadback.json()).toMatchObject({ country_code: null, currency: null, contact_name: 'Optional clear preserved' });
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add client', exact: true });
  await expect(form.getByLabel('Display name', { exact: true })).toBeFocused();
  await form.getByRole('button', { name: 'Create client', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(form.getByRole('button', { name: 'Close client form', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(form.getByRole('button', { name: 'Create client', exact: true })).toBeFocused();
  await form.getByRole('button', { name: 'Country', exact: true }).click();
  await expect(form.getByPlaceholder('Search country...')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toBeVisible();
  await expect(form.getByRole('button', { name: 'Country', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Add client', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Add client', exact: true }).click();
  await form.getByLabel('Display name', { exact: true }).fill('   ');
  await form.getByLabel('Legal name', { exact: true }).fill('Preserve this unsaved value');
  const invalidRequest = page.waitForResponse(response => response.url().endsWith('/api/crm/clients') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create client', exact: true }).click();
  expect((await invalidRequest).status()).toBe(422);
  await expect(form.getByRole('alert')).toContainText(/display[ _]name/i);
  await expect(form.getByRole('alert')).not.toContainText('[object Object]');
  await expect(form.getByLabel('Legal name', { exact: true })).toHaveValue('Preserve this unsaved value');
  const displayName = 'José O’Connor / মোঃ আরিফ';
  await form.getByLabel('Display name', { exact: true }).fill(displayName);
  await form.getByLabel('Phone', { exact: true }).fill('+44 20 7946 0958 ext 12');
  await form.getByLabel('WhatsApp', { exact: true }).fill('+880 1712 345678');
  await expect(form.getByLabel('Phone', { exact: true })).toHaveAttribute('type', 'tel');
  await expect(form.getByLabel('Phone', { exact: true })).toHaveAttribute('maxlength', '64');
  await form.getByLabel('Postal / ZIP code', { exact: true }).fill('SW1A 1AA');
  await form.getByLabel('Address line 1', { exact: true }).fill('10 Example Road');
  const createRequest = page.waitForResponse(response => response.url().endsWith('/api/crm/clients') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create client', exact: true }).click();
  const createdResponse = await createRequest;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  await expect(form).not.toBeVisible();
  await page.getByRole('button', { name: `Edit ${displayName}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit client record', exact: true });
  await expect(editor.getByLabel('Phone', { exact: true })).toHaveValue('+44 20 7946 0958 ext 12');
  await expect(editor.getByLabel('Postal / ZIP code', { exact: true })).toHaveValue('SW1A 1AA');
  await editor.getByLabel('Contact person', { exact: true }).fill('François Müller');
  const updateRequest = page.waitForResponse(response => response.url().endsWith(`/api/crm/clients/${created.id}`) && response.request().method() === 'PATCH');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await updateRequest).status()).toBe(200);
  await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Close client editor', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const updatedResponse = await page.request.get(`/api/crm/clients/${created.id}/detail`);
  expect(updatedResponse.status()).toBe(200);
  expect(await updatedResponse.json()).toMatchObject({ contact_name: 'François Müller', phone: '+44 20 7946 0958 ext 12', whatsapp: '+880 1712 345678', postal_code: 'SW1A 1AA', country_code: 'GB', currency: 'GBP' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath('neutral-theme-clients-final-directory-desktop.png') });

  await page.goto(`/dashboard/clients/${created.id}`);
  await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible();
  await expect(page.locator('.client-profile-surface')).toContainText('WhatsApp');
  await expect(page.locator('.client-profile-surface')).toContainText('+880 1712 345678');
  await expect(page.locator('.client-business-surface')).toContainText('GBP');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath('neutral-theme-clients-final-detail-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('neutral-theme-clients-final-detail-mobile.png') });
  await page.goto(`/dashboard/clients?edit=${created.id}`);
  const mobileEditor = page.getByRole('dialog', { name: 'Edit client record', exact: true });
  await expect(mobileEditor.getByLabel('Display name', { exact: true })).toHaveValue(displayName);
  await mobileEditor.getByLabel('Display name', { exact: true }).focus();
  await expect(mobileEditor.getByLabel('Display name', { exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('neutral-theme-clients-final-editor-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(mobileEditor).not.toBeVisible();

});
