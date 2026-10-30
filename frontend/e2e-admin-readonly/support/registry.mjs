export const ROUTES_PER_CASE = 4;
export const ROUTES_PER_BATCH = 40;
export const RATE_WINDOW_MS = 600_000;
export function localBaseURL(raw) {
  const value = new URL(raw);
  if (value.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(value.hostname) || value.username || value.password) throw new Error('Read-only sweep requires plain loopback HTTP');
  return value.origin;
}
function exactPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/dashboard/') && raw !== '/dashboard' || raw.includes('://') || raw.includes('\\') || raw.includes('#') || /[\u0000-\u0020]/.test(raw)) throw new Error('Invalid admin fixture route');
  const value = new URL(raw, 'http://localhost');
  if (value.origin !== 'http://localhost' || value.pathname.includes('[') || value.pathname.includes(']') || /%2f|%5c|%2e/i.test(value.pathname)) throw new Error('Unresolved or encoded fixture route');
  return value;
}
function matches(pattern, value) {
  const expected = pattern.split('/'), actual = value.pathname.split('/');
  return expected.length === actual.length && expected.every((part, i) => /^\[[a-zA-Z][a-zA-Z0-9]*\]$/.test(part) ? /^[A-Za-z0-9_-]+$/.test(actual[i]) : part === actual[i]);
}
export function resolveRoutes(manifest, registry) {
  if (manifest.schema_version !== 1 || registry.schema_version !== 1 || !Array.isArray(manifest.routes) || !registry.organization_id || !registry.owner_email || registry.currency !== 'USD') throw new Error('Verified fixture registry schema required');
  const ids = new Set(), patterns = new Set();
  return manifest.routes.map(route => {
    if (ids.has(route.id) || patterns.has(route.pattern)) throw new Error('Duplicate route identity');
    ids.add(route.id); patterns.add(route.pattern);
    const resolved = registry.route_overrides?.[route.pattern] || (!route.fixture_required ? route.pattern : null);
    if (!resolved) return { ...route, status: 'blocked_missing_typed_fixture', url: null };
    const url = exactPath(resolved);
    if (!matches(route.pattern, url)) throw new Error(`Fixture route mismatches ${route.id}`);
    return { ...route, status: 'ready', url: url.pathname + url.search };
  });
}
export function groupedRoutes(routes, batch) {
  if (!Number.isSafeInteger(batch) || batch < 0) throw new Error('Explicit nonnegative batch required');
  const selected = routes.slice(batch * ROUTES_PER_BATCH, (batch + 1) * ROUTES_PER_BATCH), groups = [];
  for (let i = 0; i < selected.length; i += ROUTES_PER_CASE) groups.push(selected.slice(i, i + ROUTES_PER_CASE));
  return groups;
}
export function nextBatchDelay(events, now, reserve = ROUTES_PER_BATCH + 10) {
  if (!Array.isArray(events) || !Number.isFinite(now) || !Number.isSafeInteger(reserve) || reserve < 1 || reserve > 100 || events.some(t => !Number.isFinite(t) || t > now)) throw new Error('Verified request timestamps and bounded reservation required');
  const live = events.filter(t => now - t < RATE_WINDOW_MS).sort((a, b) => a - b);
  const excess = live.length + reserve - 100; // Leave20 below actual120 limit.
  return excess <= 0 ? 0 : Math.max(0, live[excess - 1] + RATE_WINDOW_MS + 50 - now);
}
export function allowedReadOnlyRequest(method, pathname) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) || method === 'POST' && pathname === '/api/auth/session/activity';
}
