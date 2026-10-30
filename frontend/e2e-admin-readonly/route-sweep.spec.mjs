import { test, expect } from '@playwright/test';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { localBaseURL, resolveRoutes, groupedRoutes, allowedReadOnlyRequest } from './support/registry.mjs';

const fixturePath = process.env.ADMIN_SWEEP_FIXTURE;
if (!fixturePath) throw new Error('ADMIN_SWEEP_FIXTURE must identify verified disposable seed metadata');
const registry = JSON.parse(readFileSync(fixturePath, 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('./routes.json', import.meta.url), 'utf8'));
const baseURL = localBaseURL(process.env.E2E_BASE_URL || 'http://localhost:3000');
const batch = Number(process.env.ADMIN_SWEEP_BATCH);
const groups = groupedRoutes(resolveRoutes(manifest, registry), batch);
const evidenceDir = process.env.ADMIN_SWEEP_EVIDENCE;
if (!evidenceDir) throw new Error('ADMIN_SWEEP_EVIDENCE directory is required');
mkdirSync(evidenceDir, { recursive: true });
const eventFile = path.join(evidenceDir, `batch-${batch}.ndjson`);
const emit = event => appendFileSync(eventFile, `${JSON.stringify({ at: Date.now(), batch, ...event })}\n`);
let context, page, routeId = 'setup';
const responses = [], errors = [], writes = [];

test.beforeAll(async ({ browser }) => {
  const password = process.env.E2E_PASSWORD;
  if (!password || registry.owner_email !== process.env.E2E_EMAIL) throw new Error('Existing explicit disposable owner credentials required');
  context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL, Connection: 'close' }, viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const login = await page.request.post('/api/auth/login', { data: { email: registry.owner_email, password } });
  expect(login.ok(), 'Existing fixture owner authentication').toBeTruthy();
  await context.addCookies([{ name: 'organization_id', value: registry.organization_id, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  const tenantResponse = await page.request.get('/api/tenant/context');
  expect(tenantResponse.ok()).toBeTruthy();
  const tenant = await tenantResponse.json();
  expect(tenant.organization.id).toBe(registry.organization_id);
  expect(tenant.membership_id).toBe(registry.membership_id);
  expect(tenant.is_owner).toBe(true);
  await context.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname === '/api/auth/session/activity') emit({ event: 'heartbeat_request', route_id: routeId });
    if (allowedReadOnlyRequest(request.method(), pathname)) return route.continue();
    const attempted = { event: 'blocked_mutation', route_id: routeId, method: request.method(), pathname };
    writes.push(attempted); emit(attempted);
    return route.abort('blockedbyclient');
  });
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith('/api/')) return;
    const entry = { event: 'api_response', route_id: routeId, method: response.request().method(), pathname, status: response.status() };
    responses.push(entry); emit(entry);
    if (entry.status >= 400) errors.push(entry);
  });
  page.on('pageerror', error => { const entry = { event: 'page_error', route_id: routeId, message: error.message }; errors.push(entry); emit(entry); });
  page.on('console', message => { if (message.type() === 'error') { const entry = { event: 'console_error', route_id: routeId, message: message.text() }; errors.push(entry); emit(entry); } });
});

test.afterAll(async () => {
  emit({ event: 'batch_terminal', blocked_mutations: writes.length, errors: errors.length });
  if (context) await context.close();
});

for (const [index, group] of groups.entries()) test(`readonly batch${batch} group${index}: ${group.map(r => r.id).join(',')}`, async ({}, info) => {
  for (const route of group) {
    const contract = registry.route_contracts?.[route.pattern];
    if (route.status !== 'ready' || !contract?.heading || contract.expected_mode !== 'ready') {
      emit({ event: 'blocked_route', route_id: route.id, pattern: route.pattern, reason: route.status !== 'ready' ? route.status : 'missing_reviewed_readiness_contract' });
      continue;
    }
    await test.step(route.pattern, async () => {
      routeId = route.id;
      const startErrors = errors.length, startResponses = responses.length;
      const response = await page.goto(route.url, { timeout: 30_000 });
      expect(response?.status(), route.pattern).toBeLessThan(400);
      await expect(page).not.toHaveURL(/\/login(?:[/?]|$)/);
      await expect(page.locator('body')).not.toContainText(/Application error: a client-side exception|This page could not be found/);
      const heading = page.getByRole('heading', { name: contract.heading, exact: true, ...(contract.heading_level ? { level: contract.heading_level } : {}) });
      await expect(heading).toBeVisible();
      for (const value of contract.ready_text || []) await expect(page.locator('body')).toContainText(value);
      if (contract.ready_button) await expect(page.getByRole('button', { name: contract.ready_button, exact: true })).toBeEnabled();
      for (const requiredPath of contract.expected_get_paths || []) await expect.poll(() => responses.slice(startResponses).some(r => r.method === 'GET' && r.pathname === requiredPath && r.status >= 200 && r.status < 300)).toBe(true);
      const captures = [];
      for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(heading).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route.id} ${size} width`).toBe(true);
        const filename = `admin-readonly-${route.id}-${size}.png`;
        await page.screenshot({ path: info.outputPath(filename) }); captures.push(filename);
        if (size === 'mobile' && await page.evaluate(() => document.documentElement.scrollHeight > innerHeight * 1.25)) {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const bottom = `admin-readonly-${route.id}-mobile-bottom.png`;
          await page.screenshot({ path: info.outputPath(bottom) }); captures.push(bottom);
        }
      }
      expect(errors.slice(startErrors), route.pattern).toEqual([]);
      expect(writes).toEqual([]);
      emit({ event: 'route_rendered', route_id: route.id, pattern: route.pattern, actual_url: new URL(page.url()).pathname + new URL(page.url()).search, expected_state: contract.expected_mode, heading: contract.heading, captures, visual_review: 'pending_actual_pixel_inspection', source: contract.source });
    });
  }
});
