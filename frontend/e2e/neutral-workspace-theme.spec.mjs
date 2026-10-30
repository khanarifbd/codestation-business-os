import { expect, test } from '@playwright/test';

// Real local app + disposable CI database, not mocked screenshots or live data.
async function isolatedWorkspace(page, context, info) {
  const baseURL = info.project.use.baseURL;
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL).hostname);
  const login = await page.request.post('/api/auth/login', { data: {
    // Dedicated seeded account: these organizations must not affect other login tests.
    email: 'neutral-theme@example.com',
    password: process.env.E2E_PASSWORD ?? 'E2E-Launch-Password-123!',
  } });
  expect(login.status()).toBe(200);
  const response = await page.request.post('/api/organizations', { data: {
    name: `Neutral theme fixture ${info.workerIndex}-${Date.now()}`,
    currency: 'USD', country_code: 'US', timezone: 'UTC',
  } });
  expect(response.status()).toBe(201);
  const { organization } = await response.json();
  await context.addCookies([{ name: 'organization_id', value: organization.id, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

async function readable(locator) {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    let ancestor = element;
    let background = style.backgroundColor;
    while (background === 'rgba(0, 0, 0, 0)' && ancestor.parentElement) {
      ancestor = ancestor.parentElement;
      background = getComputedStyle(ancestor).backgroundColor;
    }
    // Computed Tailwind colors can be lab()/oklch(), not RGB tuples.
    // Let the browser resolve CSS Color 4 into actual sRGB pixel channels.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('Canvas2D unavailable for contrast normalization');
    const srgb = (color) => {
      if (!CSS.supports('color', color)) throw new Error(`Invalid computed CSS color: ${color}`);
      // Canvas silently retains its old fillStyle for unsupported values.
      // Two distinct sentinels prove the assignment was actually accepted.
      context.fillStyle = '#010203';
      context.fillStyle = color;
      const first = context.fillStyle;
      context.fillStyle = '#040506';
      context.fillStyle = color;
      if (first !== context.fillStyle) throw new Error(`Canvas cannot normalize CSS color: ${color}`);
      context.clearRect(0, 0, 1, 1);
      context.fillRect(0, 0, 1, 1);
      const pixel = Array.from(context.getImageData(0, 0, 1, 1).data);
      // Transparent backgrounds are resolved by the ancestor walk above.
      // Partial alpha requires compositing; fail rather than report false contrast.
      if (pixel[3] !== 255) throw new Error(`Contrast requires opaque resolved colors: ${color}`);
      return pixel.slice(0, 3);
    };
    return { foreground: srgb(style.color), background: srgb(background), computed: { foreground: style.color, background } };
  });
  const luminance = (color) => {
    const rgb = color.map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const foreground = luminance(colors.foreground), background = luminance(colors.background);
  expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05), JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
}

test('neutral workspace: real desktop company and inventory surfaces remain white and readable', async ({ page, context }, info) => {
  // Two independent cold Next routes plus real fixture setup, not a global timeout change.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await isolatedWorkspace(page, context, info);
  await page.goto('/dashboard/company');
  const sidebar = page.locator('.ws-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.ws-context-bar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  const active = sidebar.locator('.ws-navigation-item[aria-current="page"]');
  await expect(active).toHaveCSS('background-color', 'rgb(235, 235, 235)');
  await readable(active);
  await readable(sidebar.locator('.ws-brand-title'));
  await readable(sidebar.locator('.ws-switcher > div > button > span').first());
  const inactive = sidebar.locator('.ws-navigation-item:not([aria-current])').first();
  await inactive.hover();
  await expect(inactive).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await readable(inactive);
  await page.mouse.move(1000, 5);
  await page.screenshot({ path: info.outputPath('neutral-theme-company-desktop.png'), fullPage: true });

  await page.goto('/dashboard/inventory');
  await expect(page.getByRole('heading', { name: 'Reorder watch', exact: true })).toBeVisible();
  for (const selector of ['.inventory-attention', '.inventory-work-group', '.inventory-setup', '.inventory-valuation', '.ws-context-bar']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  const primary = page.getByRole('button', { name: 'Receive purchase', exact: true });
  await expect(primary).toHaveCSS('background-color', 'rgb(23, 23, 23)');
  await readable(primary);
  await readable(page.locator('.inventory-attention-summary strong'));
  await page.screenshot({ path: info.outputPath('neutral-theme-inventory-desktop.png'), fullPage: true });
});

test('neutral workspace: mobile drawer stays white and closes repeatedly without navigation', async ({ page, context }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await isolatedWorkspace(page, context, info);
  await page.goto('/dashboard/inventory');
  await expect(page.getByRole('heading', { name: 'Reorder watch', exact: true })).toBeVisible();
  await expect(page.locator('.ws-mobile-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.inventory-attention')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: info.outputPath('neutral-theme-inventory-mobile.png'), fullPage: true });
  const before = page.url();
  const opener = page.locator('.ws-mobile-header').getByRole('button', { name: 'Open app drawer', exact: true });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'App navigation', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await readable(drawer.locator('.ws-navigation-item[aria-current="page"]'));
  await readable(drawer.locator('.ws-switcher > div > button > span').first());
  await page.screenshot({ path: info.outputPath('neutral-theme-mobile-drawer.png'), fullPage: true });
  await drawer.getByRole('button', { name: 'Close app drawer', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(before);
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(before);
  await expect(opener).toBeFocused();
});

test('neutral workspace: real business overview cards and primary action use the shared palette', async ({ page, context }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await isolatedWorkspace(page, context, info);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Business overview', exact: true })).toBeVisible();
  for (const selector of ['.dashboard-operations-rail', '.dashboard-context-actions', '.dashboard-calculation-note']) {
    await expect(page.locator(selector)).toBeVisible();
    await expect.poll(() => page.locator(selector).evaluate(element => {
      let node = element;
      while (node) {
        const color = getComputedStyle(node).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)') return color;
        node = node.parentElement;
      }
      return 'transparent';
    })).toBe('rgb(255, 255, 255)');
  }
  const reports = page.getByRole('link', { name: 'Open reports', exact: true });
  await expect(reports).toHaveCSS('background-color', 'rgb(23, 23, 23)');
  await readable(reports);
  await reports.hover();
  await expect(reports).toHaveCSS('background-color', 'rgb(51, 51, 51)');
  await readable(reports);
  await page.mouse.move(1000, 5);
  await page.screenshot({ path: info.outputPath('neutral-theme-dashboard-desktop.png'), fullPage: true });
});

test('neutral workspace: text field focus matches Company Settings without an outer box', async ({ page, context }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await isolatedWorkspace(page, context, info);
  await page.goto('/dashboard/company');
  const reference = page.getByLabel('Legal company name', { exact: true });
  await reference.focus();
  await expect(reference).toBeFocused();
  await expect(reference).toHaveCSS('outline-style', 'none');
  await expect(reference).toHaveCSS('box-shadow', 'none');
  // Wait out the existing transition before using this real reference's color.
  await expect.poll(() => reference.evaluate(element => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-neutral-500)';
    element.parentElement.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(element).borderTopColor === expected;
  })).toBe(true);
  const referenceBorder = await reference.evaluate(element => getComputedStyle(element).borderTopColor);
  await page.screenshot({ path: info.outputPath('neutral-theme-company-field-focus.png'), fullPage: true });

  await page.goto('/dashboard/clients');
  const opener = page.getByRole('button', { name: 'Add client', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Add client', exact: true });
  const legal = dialog.getByLabel('Legal name', { exact: true });
  const contact = dialog.getByLabel('Contact person', { exact: true });
  const legalUnfocused = await legal.evaluate(element => getComputedStyle(element).borderTopColor);
  await legal.fill('Focus preview only — not saved');
  await expect(legal).toBeFocused();
  await expect(legal).toHaveCSS('outline-style', 'none');
  await expect(legal).toHaveCSS('box-shadow', 'none');
  await expect(legal).toHaveCSS('border-top-width', '1px');
  await expect(legal).toHaveCSS('border-top-color', referenceBorder);
  expect(referenceBorder).not.toBe(legalUnfocused);
  await page.screenshot({ path: info.outputPath('neutral-theme-client-field-focus-desktop.png'), fullPage: true });
  await page.keyboard.press('Tab');
  await expect(contact).toBeFocused();
  await expect(contact).toHaveCSS('outline-style', 'none');
  await expect(contact).toHaveCSS('border-top-color', referenceBorder);
  await expect(legal).toHaveCSS('border-top-color', legalUnfocused);
  // The native select's wrapping label also contains its option text.
  const clientType = dialog.locator('select[name="client_type"]');
  await expect(clientType).toHaveCount(1);
  await expect(clientType).toHaveValue('company');
  for (const field of [dialog.getByLabel('Notes', { exact: true }), clientType]) {
    await field.focus();
    await expect(field).toHaveCSS('outline-style', 'none');
    await expect(field).toHaveCSS('box-shadow', 'none');
    await expect(field).toHaveCSS('border-top-color', referenceBorder);
  }
  // Buttons retain their visible keyboard focus, unlike text fields.
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.focus();
  await expect(cancel).toHaveCSS('outline-width', '3px');
  await expect(cancel).toHaveCSS('outline-style', 'solid');
  await cancel.click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/clients$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await opener.click();
  await expect(legal).toHaveValue('');
  await legal.fill('Mobile focus preview only');
  await expect(legal).toHaveCSS('outline-style', 'none');
  await expect(legal).toHaveCSS('box-shadow', 'none');
  await expect(legal).toHaveCSS('border-top-color', referenceBorder);
  await page.screenshot({ path: info.outputPath('neutral-theme-client-field-focus-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Close client form', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/clients$/);
});

test('neutral workspace: borderless HR navigation field keeps a visible inset focus cue', async ({ page, context }, info) => {
  // One cold route, normal 45s budget; its own disposable organization and one login.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await isolatedWorkspace(page, context, info);
  await page.goto('/dashboard/hr');
  const more = page.getByRole('combobox', { name: 'More People and HR pages', exact: true });
  await expect(more).toBeVisible();
  await expect(more).toHaveCSS('border-top-width', '0px');
  await more.focus();
  await expect(more).toBeFocused();
  await expect(more).toHaveCSS('outline-style', 'none');
  await expect(more).toHaveCSS('box-shadow', /inset/);
  await expect.poll(() => more.evaluate(element => {
    const style = getComputedStyle(element);
    return style.boxShadow.includes(style.color) && style.boxShadow.includes('-2px');
  })).toBe(true);
  await readable(more);
  await page.screenshot({ path: info.outputPath('neutral-theme-hr-borderless-field-focus.png'), fullPage: true });
  await page.keyboard.press('Tab');
  await expect(more).not.toBeFocused();
  await expect(more).toHaveCSS('box-shadow', 'none');
  await expect(page).toHaveURL(/\/dashboard\/hr$/);
});
