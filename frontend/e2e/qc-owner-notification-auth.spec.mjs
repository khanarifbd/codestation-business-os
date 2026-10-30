import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { captureJsonResponse } from './support/capture-json-response.mjs';

// Fresh owner-only local fixtures. No My Work, employee/client portals, invites,
// external SMTP, payment rails or auth bypasses are used. Mutation receipt
// instrumentation forwards once and returns the unchanged upstream response.
const email = process.env.E2E_QC_NOTIFICATION_EMAIL ?? 'qc-notification@example.com';
const password = process.env.E2E_PASSWORD;
if (!password?.trim()) throw new Error("E2E_PASSWORD must be configured for the disposable CI fixture");
const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
const python = process.env.E2E_BACKEND_PYTHON ?? (existsSync(`${backend}.venv/bin/python`) ? `${backend}.venv/bin/python` : 'python');
const dateOffset = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

function localOnly() {
  expect(['127.0.0.1', 'localhost']).toContain(new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').hostname);
}
async function body(response) {
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${text}`).toBeTruthy();
  return JSON.parse(text);
}
const get = async (page, path) => body(await page.request.get(`/api${path}`));
const post = async (page, path, data) => body(await page.request.post(`/api${path}`, { data }));
async function metric(page, label, count) {
  await expect(page.locator('section > div').filter({ has: page.getByText(label, { exact: true }) }).locator('p').last()).toHaveText(String(count));
}

// Empty HTML submission makes no server request, hence consumes no login quota.
async function visitCapturedVerification(page, token) {
  // Observe the actual UI verification request before navigation; no retry or mock.
  const observed = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== '/api/auth/verify-email' || response.request().method() !== 'POST') return false;
    try { return response.request().postDataJSON()?.token === token; } catch { return false; }
  }).then(response => ({ response }), error => ({ error }));
  await page.goto(`/verify-email?token=${encodeURIComponent(token)}`);
  const result = await observed;
  if (result.error) throw result.error;
  expect(result.response.status()).toBe(200);
  const completionError = await result.response.finished();
  if (completionError) throw completionError;
}

test('AUTH02 empty login stays on form and focuses each missing required field', async ({ page }, info) => {
  localOnly();
  const loginRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/login') loginRequests.push(request.url());
  });
  await page.goto('/login');
  const identifier = page.getByLabel(/email or username/i);
  const secret = page.getByLabel('Password', { exact: true });
  await page.getByRole('button', { name: /sign in securely/i }).click();
  expect(await identifier.evaluate((element) => element.validity.valueMissing)).toBe(true);
  await expect(identifier).toBeFocused();
  await identifier.fill(email);
  await page.getByRole('button', { name: /sign in securely/i }).click();
  expect(await secret.evaluate((element) => element.validity.valueMissing)).toBe(true);
  await expect(secret).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
  expect(loginRequests).toEqual([]);
  await info.attach('empty-login-validation.json', { body: JSON.stringify({ case: 'AUTH02', identifierMissingBlocked: true, passwordMissingBlocked: true, requests: loginRequests }), contentType: 'application/json' });
});

test('NT01 NT02 NT04 owner task deadlines generate, filter and clear after owner completion', async ({ page }, info) => {
  test.setTimeout(120000);
  localOnly();
  await post(page, '/auth/login', { email, password });
  const workspace = await post(page, '/organizations', { name: `QC notifications ${randomUUID().slice(0, 8)}`, currency: 'USD', country_code: 'US', timezone: 'UTC' });
  expect(workspace.is_owner).toBe(true);
  const owner = (await get(page, '/hr/people')).people[0];
  const client = await post(page, '/crm/clients', { display_name: 'Synthetic notification client', currency: 'USD' });
  const order = await post(page, '/sales/orders', { client_id: client.id, subject: 'Synthetic deadline work', order_date: dateOffset(0), currency: 'USD', items: [{ item_name: 'QC service', description: 'Synthetic local QC service', item_type: 'service', quantity: '1', unit_price: '10' }] });
  const project = await post(page, `/projects/from-order/${order.id}`, { name: 'Synthetic notification project', project_manager_employee_id: owner.id });
  const root = `/projects/${project.id}`;
  const overdue = await post(page, `${root}/tasks`, { title: 'Synthetic overdue owner task', assignee_employee_id: owner.id, due_date: dateOffset(-1), priority: 'normal' });
  const future = await post(page, `${root}/tasks`, { title: 'Synthetic far future control', assignee_employee_id: owner.id, due_date: dateOffset(5), priority: 'normal' });
  const unassigned = await post(page, `${root}/tasks`, { title: 'Synthetic unassigned overdue control', due_date: dateOffset(-2), priority: 'normal' });
  const before = await get(page, '/workspace/notifications');
  expect(before.unread_count).toBe(1);
  expect(before.attention_count).toBe(1);
  expect(before.items).toHaveLength(1);
  expect(before.items[0]).toMatchObject({ kind: 'task_overdue', severity: 'critical', title: `${overdue.task_code} · ${overdue.title}`, due_date: dateOffset(-1) });
  await page.goto('/dashboard/notifications');
  await metric(page, 'Needs attention', 1);
  await metric(page, 'Overdue', 1);
  await metric(page, 'Due soon', 0);
  const title = page.getByText(before.items[0].title, { exact: true });
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: 'Due soon', exact: true }).click();
  await expect(title).toHaveCount(0);
  await expect(page.getByText('You are all caught up', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overdue', exact: true }).click();
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(title).toBeVisible();
  expect((await get(page, '/workspace/notifications')).unread_count).toBe(1);
  await page.screenshot({ path: info.outputPath('owner-overdue-notification.png'), fullPage: true });

  // The app's alert links point to excluded My Work. Do not click or substitute
  // another href; complete through the actual owner project-administration UI.
  await page.goto(`/dashboard${root}`);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('row').filter({ hasText: overdue.title }).getByRole('button', { name: 'Update work', exact: true }).click();
  await page.getByRole('slider').focus();
  await page.getByRole('slider').press('End');
  await page.getByLabel('What did you work on?', { exact: true }).fill('Synthetic owner completion for notification QC.');
  await captureJsonResponse(page, { path: `/api${root}/tasks/${overdue.id}/progress`, action: () => page.getByRole('button', { name: 'Save', exact: true }).click() });
  await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${project.id}(?:\\?|$)`));
  await expect(page.getByRole('row').filter({ hasText: overdue.title })).toContainText('100%');
  const tasks = (await get(page, `${root}/workspace`)).tasks;
  expect(tasks.find((task) => task.id === overdue.id)).toMatchObject({ status: 'completed', progress_percent: 100 });
  expect(tasks.find((task) => task.id === future.id).status).not.toBe('completed');
  expect(tasks.find((task) => task.id === unassigned.id).status).not.toBe('completed');
  await page.goto('/dashboard/notifications');
  await metric(page, 'Needs attention', 0);
  await metric(page, 'Overdue', 0);
  await metric(page, 'Due soon', 0);
  await expect(page.getByText('You are all caught up', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('You are all caught up', { exact: true })).toBeVisible();
  const after = await get(page, '/workspace/notifications');
  expect(after).toEqual({ unread_count: 0, attention_count: 0, items: [] });
  await info.attach('owner-notification-readback.json', { body: JSON.stringify({ cases: ['NT01', 'NT02', 'NT04'], organization_id: workspace.organization.id, project_id: project.id, before, after, tasks, limitations: 'Live deadline alerts, not persisted read state. My Work links and NT03 deliberately not visited.' }, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('owner-notifications-cleared.png'), fullPage: true });
});

test('AUTH01 local UI signup, captured verification, sign-in and isolated owner onboarding', async ({ page }, info) => {
  test.setTimeout(120000);
  localOnly();
  const safety = JSON.parse(execFileSync(python, ['scripts/verify_qc_owner_auth_notifications.py', '--assert-local-safety'], { cwd: backend, encoding: 'utf8', env: { ...process.env, PYTHONPATH: [backend, process.env.PYTHONPATH].filter(Boolean).join(':') } }));
  expect(safety).toEqual({ environment: 'test', database: 'loopback_postgresql', smtp: 'disabled' });
  const signupEmail = `qc-auth-browser-${randomUUID().replaceAll('-', '').slice(0, 12)}@example.com`;
  const name = 'Synthetic browser owner';
  const companyName = `QC browser onboarding ${randomUUID().slice(0, 8)}`;
  await page.goto('/signup');
  await page.getByLabel('Full name', { exact: true }).fill(name);
  await page.getByLabel('Work email', { exact: true }).fill(signupEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const signup = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/signup');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  expect((await signup).status()).toBe(201);
  await expect(page).toHaveURL(/\/verify-email\?email=/);
  await expect(page.getByRole('heading', { name: 'Your next step is in your inbox.', exact: true })).toBeVisible();
  expect((await page.request.get('/api/organizations')).status()).toBe(401);
  const denied = await page.request.post('/api/auth/login', { data: { email: signupEmail, password } });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).detail).toContain('Verify your email');

  // Test-only capture wraps the actual local resend sender, which MUST return
  // false with SMTP disabled. The real signed matching token is used by UI.
  const captured = JSON.parse(execFileSync(python, ['scripts/verify_qc_owner_auth_notifications.py', '--capture-verification', signupEmail], { cwd: backend, encoding: 'utf8', env: { ...process.env, PYTHONPATH: [backend, process.env.PYTHONPATH].filter(Boolean).join(':') } }));
  expect(captured.email).toBe(signupEmail);
  expect(captured.provider_delivered).toBe(false);
  await visitCapturedVerification(page, captured.token);
  await expect(page.getByRole('heading', { name: "You're verified. You're ready.", exact: true })).toBeVisible();
  await expect(page.getByText('Email verified. You can now sign in.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Continue to sign in', exact: true }).click();
  await page.getByLabel(/email or username/i).fill(signupEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in securely/i }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(await get(page, '/organizations')).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Company identity', exact: true })).toBeVisible();
  await page.getByLabel('Company name', { exact: true }).fill(companyName);
  const workspace = await captureJsonResponse(page, { path: '/api/organizations', action: () => page.getByRole('button', { name: 'Create company workspace', exact: true }).click() });
  expect(workspace).toMatchObject({ is_owner: true, role: 'admin' });
  expect(workspace.organization).toMatchObject({ name: companyName, currency: 'BDT', country_code: 'BD', timezone: 'Asia/Dhaka', financial_year_start_month: 7 });
  await expect(page).toHaveURL(/\/dashboard$/);
  const memberships = await get(page, '/organizations');
  expect(memberships).toHaveLength(1);
  expect(memberships[0].organization.id).toBe(workspace.organization.id);
  const people = (await get(page, '/hr/people')).people;
  expect(people).toHaveLength(1);
  expect(people[0].full_name).toBe(name);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await get(page, '/organizations'))[0].organization.id).toBe(workspace.organization.id);
  await info.attach('local-onboarding-readback.json', { body: JSON.stringify({ case: 'AUTH01', email: signupEmail, organization: workspace.organization, role: workspace.role, is_owner: workspace.is_owner, owner_employee_id: people[0].id, provider_delivery: 'NOT_TESTED_SMTP_DISABLED', token_capture: 'Actual signed local resend token; no mail transport or mailbox verified' }, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('onboarded-owner-dashboard.png'), fullPage: true });
});
