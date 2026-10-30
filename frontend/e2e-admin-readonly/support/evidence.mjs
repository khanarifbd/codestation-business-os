import { chmodSync } from 'node:fs';
// Evidence deliberately excludes arbitrary error strings, URLs, headers and bodies.
export function safeError(event, routeId) {
  if (!['page_error', 'console_error'].includes(event)) throw new Error('Unsupported evidence class');
  return { event, route_id: routeId, classification: event === 'page_error' ? 'uncaught_browser_exception' : 'browser_console_error' };
}
export function requestOwnership() {
  const owners = new WeakMap(), requests = [];
  let clock = 0;
  return {
    started(request, routeId) {
      if (owners.has(request)) return;
      const entry = { routeId, sequence: requests.length + 1, url: request.url(), method: request.method(), status: null, startedAt: ++clock, failedAt: null, completedAt: null };
      owners.set(request, entry); requests.push(entry);
    },
    owner(request) { return owners.get(request)?.routeId ?? 'unattributed'; },
    sequence(request) { return owners.get(request)?.sequence ?? 0; },
    completed(request, status) { const entry = owners.get(request); if (entry) { entry.status = status; entry.completedAt = ++clock; } },
    failed(request) { const entry = owners.get(request); if (entry) entry.failedAt = ++clock; },
    replacement(request) {
      const old = owners.get(request);
      if (!old || old.method !== 'GET' || old.routeId === 'unattributed') return null;
      const latest = requests.findLast(entry => entry.routeId === old.routeId && entry.method === 'GET' && entry.url === old.url);
      return old.failedAt !== null && latest.sequence > old.sequence && latest.completedAt > old.failedAt && latest.status >= 200 && latest.status < 300 ? { request_id: latest.sequence, status: latest.status, body_complete: true } : null;
    },
  };
}
// Only these actual source-owned AbortController reads are eligible. No blanket
// network-error exemption: the newest identical read must finish successfully.
export function abortableReadPath(pathname) {
  return ['/api/sales/quotations', '/api/sales/quotations/summary', '/api/sales/orders', '/api/sales/orders/summary', '/api/sales/order-value-summary', '/api/hr/access', '/api/reports/dashboard-details', '/api/finance/payment-destinations'].includes(pathname)
    || /^\/api\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/workspace)?$/.test(pathname);
}
export function supersededOwnedRead(request, ownership, code) {
  const pathname = new URL(request.url()).pathname;
  return code === 'net::ERR_ABORTED' && request.method() === 'GET'
    && abortableReadPath(pathname)
    && Boolean(ownership.replacement(request));
}
export function safeTransportCode(request) {
  const code = request.failure()?.errorText;
  return ['net::ERR_ABORTED', 'net::ERR_CONNECTION_RESET', 'net::ERR_CONNECTION_CLOSED', 'net::ERR_FAILED', 'net::ERR_BLOCKED_BY_CLIENT'].includes(code) ? code : 'unclassified_transport_failure';
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

export function reconciledReadFailure(failure, events) {
  if (failure.event !== 'api_read_failure' || failure.classification !== 'request_transport_failure' || failure.transport_code !== 'net::ERR_ABORTED' || failure.method !== 'GET' || !abortableReadPath(failure.pathname) || !Number.isSafeInteger(failure.request_id) || failure.request_id < 1) return false;
  return events.some(event => event.event === 'superseded_read' && event.classification === 'explicit_abort_replaced_by_current_success'
    && event.batch === failure.batch && event.route_id === failure.route_id && event.request_id === failure.request_id && event.pathname === failure.pathname
    && event.transport_code === failure.transport_code && event.replacement_request_id > failure.request_id
    && event.replacement_status >= 200 && event.replacement_status < 300 && event.replacement_body_complete === true);
}
