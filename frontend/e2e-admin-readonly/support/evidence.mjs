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
