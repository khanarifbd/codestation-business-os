import { chmodSync } from 'node:fs';
// Evidence deliberately excludes arbitrary error strings, URLs, headers and bodies.
export function safeError(event, routeId) {
  if (!['page_error', 'console_error'].includes(event)) throw new Error('Unsupported evidence class');
  return { event, route_id: routeId, classification: event === 'page_error' ? 'uncaught_browser_exception' : 'browser_console_error' };
}
export function requestOwnership() {
  const owners = new WeakMap();
  return {
    started(request, routeId) { if (!owners.has(request)) owners.set(request, routeId); },
    owner(request) { return owners.get(request) ?? 'unattributed'; },
  };
}
export function successfulRouteRead(responses, routeId, pathname) {
  return responses.some(r => r.route_id === routeId && r.method === 'GET' && r.pathname === pathname && r.status >= 200 && r.status < 300);
}
export const sensitiveFields = 'input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"], [data-sensitive="true"]';
export async function verifyReadyFields(page, expect, fields = []) {
  for (const field of fields) {
    if (typeof field.label !== 'string' || !field.label.trim() || typeof field.value !== 'string') throw new Error('Invalid exact field readiness contract');
    const control = page.getByLabel(field.label, { exact: true });
    await expect(control).toHaveCount(1);
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
    await expect(control).toHaveValue(field.value);
  }
}

export async function persistSuccessfulBatch(context, authPath, { expected, rendered, errors, writes }) {
  const completed = new Set(rendered);
  if (!expected.length || expected.length !== completed.size || expected.some(id => !completed.has(id)) || errors || writes) return false;
  await context.storageState({ path: authPath });
  chmodSync(authPath, 0o600);
  return true;
}
export function authResult(status, payload) {
  const detail = payload && typeof payload === 'object' ? payload.detail : undefined;
  const classification = status >= 200 && status < 300 ? 'accepted'
    : status === 503 && detail === 'Browser mutation origin is not configured for this deployment.' ? 'canonical_origin_unconfigured'
    : status === 403 && detail === 'A same-origin request is required for this action.' ? 'same_origin_rejected'
    : status === 401 ? 'authentication_rejected'
    : status === 429 ? 'rate_limited'
    : status >= 500 ? 'server_error' : 'unexpected_auth_response';
  return { event: 'authentication_result', status, classification };
}
