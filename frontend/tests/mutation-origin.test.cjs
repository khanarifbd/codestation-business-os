const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function harness(environment = {}) {
  const calls = [], cookies = [], modules = new Map();
  const tokens = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', user: { id: 'synthetic-user' } };
  const response = (body, options = {}) => ({ body, status: options.status ?? 200, ok: (options.status ?? 200) < 400, headers: new Headers(), cookies: { set: (...args) => cookies.push(args) } });
  const substitutes = {
    'node:crypto': require('node:crypto'),
    'next/server': { NextResponse: { json: response } },
    '@/lib/auth-session': { resolveDeviceId: () => 'synthetic-device', setAuthCookies: (r, t) => { r.cookies.set('access_token', t.access_token); r.cookies.set('refresh_token', t.refresh_token); }, setDeviceIdCookie: (r, id) => r.cookies.set('device', id), clearAuthCookies: () => cookies.push(['cleared']) },
    '@/lib/request-context': { requestContextHeaders: () => ({}) },
    '@/lib/server-api': { backendFetch: async (...args) => { calls.push(args); return { ok: true, status: 200, json: async () => tokens }; } },
    '@/lib/authenticated-backend': { authenticatedBackendFetch: async (...args) => { calls.push(args); return { upstream: { ok: true, status: 200, json: async () => tokens }, rotatedTokens: null }; } },
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const filename = path.join(root, relative);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} }; modules.set(relative, mod);
    vm.runInNewContext(compiled, { module: mod, exports: mod.exports, URL, Headers, Response, process: { env: environment }, require(name) {
      if (name === '@/lib/mutation-origin') return load('src/lib/mutation-origin.ts');
      if (name === '@/lib/public-auth-proxy') return load('src/lib/public-auth-proxy.ts');
      if (!(name in substitutes)) throw new Error('Unexpected import: ' + name);
      return substitutes[name];
    } }, { filename });
    return mod.exports;
  }
  return { load, calls, cookies, guard: load('src/lib/mutation-origin.ts').guardMutationOrigin };
}
function request({ method = 'POST', url = 'http://localhost:3280/api/action', origin = 'http://localhost:3280', contentType = 'application/json', extraHeaders = {} } = {}) {
  const headers = new Headers(extraHeaders);
  if (origin !== null) headers.set('Origin', origin);
  if (contentType !== null) headers.set('Content-Type', contentType);
  return { method, url, headers, cookies: { get: () => undefined }, text: async () => '{"identifier":"synthetic@example.com","password":"Synthetic-test-password"}' };
}

test('local same-origin JSON accepts without consuming request body', () => {
  const h = harness(); const r = request(); r.text = () => { throw Error('Must not read body'); };
  assert.equal(h.guard(r, { requireJson: true }), null);
});
for (const origin of [null, 'null', 'https://attacker.example', 'http://localhost:3281', 'https://localhost:3280', 'http://localhost:3280/path', 'http://localhost:3280?x=1', 'http://user:pass@localhost:3280', 'http://localhost:3280#fragment', 'http://localhost:3280 http://attacker.example']) {
  test(`rejects absent/untrusted/non-origin header ${String(origin)}`, () => assert.equal(harness().guard(request({ origin })).status, 403));
}
for (const contentType of [null, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp']) {
  test(`JSON action rejects ${String(contentType)}`, () => assert.equal(harness().guard(request({ contentType }), { requireJson: true }).status, 415));
}
test('JSON charset and media type case accepted', () => assert.equal(harness().guard(request({ contentType: 'Application/JSON; charset=utf-8' }), { requireJson: true }), null));
test('generic origin-only guard preserves multipart and bodyless requests', () => {
  const h = harness();
  assert.equal(h.guard(request({ contentType: 'multipart/form-data; boundary=x' })), null);
  assert.equal(h.guard(request({ contentType: null })), null);
});
test('GET HEAD OPTIONS remain unchanged even without production config/Origin', () => {
  const h = harness({ NODE_ENV: 'production' });
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(h.guard(request({ method, origin: null, contentType: null })), null);
});
for (const value of [undefined, '', 'http://app.example.com', 'https://user:pass@app.example.com', 'https://app.example.com/path', 'https://app.example.com?x=1', 'null']) {
  test(`invalid production canonical config fails closed at request time (${String(value)})`, () => {
    const h = harness({ NODE_ENV: 'production', PUBLIC_APP_URL: value });
    assert.equal(h.guard(request()).status, 503);
  });
}
test('production canonical HTTPS origin works behind internal standalone hostname', () => {
  const h = harness({ NODE_ENV: 'production', PUBLIC_APP_URL: 'https://app.example.com/' });
  assert.equal(h.guard(request({ url: 'https://0.0.0.0:3000/api/action', origin: 'https://app.example.com' })), null);
  assert.equal(h.guard(request({ url: 'https://0.0.0.0:3000/api/action', origin: 'https://0.0.0.0:3000' })).status, 403);
});
test('forwarded Host/Origin/Referer never widen trusted origins', () => {
  const h = harness({ NODE_ENV: 'production', PUBLIC_APP_URL: 'https://app.example.com' });
  assert.equal(h.guard(request({ origin: 'https://attacker.example', extraHeaders: { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https', host: 'attacker.example', referer: 'https://app.example.com' } })).status, 403);
  assert.equal(h.guard(request({ origin: null, extraHeaders: { referer: 'https://app.example.com' } })).status, 403);
});
test('explicit cross-site Fetch Metadata is rejected even with matching Origin', () => assert.equal(harness().guard(request({ extraHeaders: { 'sec-fetch-site': 'cross-site' } })).status, 403));

const routes = [
  ['src/app/api/auth/login/route.ts', true], ['src/app/api/auth/google/route.ts', true],
  ['src/app/api/auth/signup/route.ts', true], ['src/app/api/auth/passkeys/verify/route.ts', true],
  ['src/app/api/auth/passkeys/options/route.ts', false], ['src/app/api/auth/logout/route.ts', false],
  ['src/app/api/auth/session/activity/route.ts', false], ['src/app/api/auth/forgot-password/route.ts', true],
  ['src/app/api/auth/reset-password/route.ts', true], ['src/app/api/auth/verify-email/route.ts', true],
  ['src/app/api/auth/verification/resend/route.ts', true],
  ['src/app/api/organizations/route.ts', true], ['src/app/api/employee-invitations/accept/route.ts', true],
  ['src/app/api/client-invitations/accept/route.ts', true],
];
for (const [file, jsonRequired] of routes) {
  test(`${file} rejects cross-origin before backend/cookies`, async () => {
    const h = harness();
    const result = await h.load(file).POST(request({ origin: 'https://attacker.example' }));
    assert.equal(result.status, 403); assert.equal(h.calls.length, 0); assert.equal(h.cookies.length, 0);
  });
  test(`${file} preserves valid same-origin request`, async () => {
    const h = harness();
    const r = request({ contentType: jsonRequired ? 'application/json' : null });
    if (file === 'src/app/api/organizations/route.ts') r.cookies.get = name => name === 'access_token' ? { value: 'synthetic-access' } : undefined;
    const result = await h.load(file).POST(r);
    assert.equal(result.status, 200); assert.equal(h.calls.length, 1);
  });
}
test('login text/plain reproduction now fails before body forwarding or auth cookies', async () => {
  const h = harness();
  const result = await h.load('src/app/api/auth/login/route.ts').POST(request({ contentType: 'text/plain' }));
  assert.equal(result.status, 415); assert.equal(h.calls.length, 0); assert.equal(h.cookies.length, 0);
});

test('authenticated helper rejects incoming unsafe request before cookies/refresh/backend', async () => {
  const h = harness();
  const r = request({ origin: 'https://attacker.example' });
  r.cookies.get = () => { throw Error('Must reject before cookie access'); };
  const result = await h.load('src/lib/authenticated-backend.ts').authenticatedBackendFetch(r, '/tenant/context', { method: 'GET' });
  assert.equal(result.upstream.status, 403); assert.equal(result.rotatedTokens, null); assert.equal(h.calls.length, 0);
});
test('authenticated helper uses incoming GET semantics, not its internal refresh POST', async () => {
  const h = harness();
  const r = request({ method: 'GET', origin: null, contentType: null });
  r.cookies.get = name => name === 'refresh_token' ? { value: 'synthetic-refresh' } : undefined;
  const result = await h.load('src/lib/authenticated-backend.ts').authenticatedBackendFetch(r, '/profile', { method: 'GET' });
  assert.equal(result.upstream.status, 200); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0][0], '/auth/refresh'); assert.equal(h.calls[0][1].method, 'POST');
  assert.equal(h.calls[0][1].headers.Origin, undefined); assert.equal(h.calls[1][0], '/profile');
});
test('authenticated helper preserves same-origin bodyless DELETE and multipart payload', async () => {
  for (const [method, contentType, body] of [['DELETE', null, undefined], ['POST', 'multipart/form-data; boundary=synthetic', 'synthetic-multipart-body']]) {
    const h = harness(); const r = request({ method, contentType });
    r.cookies.get = name => name === 'access_token' ? { value: 'synthetic-access' } : undefined;
    const result = await h.load('src/lib/authenticated-backend.ts').authenticatedBackendFetch(r, '/synthetic-resource', { method, body, headers: contentType ? { 'Content-Type': contentType } : undefined });
    assert.equal(result.upstream.status, 200); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][1].method, method); assert.equal(h.calls[0][1].body, body);
  }
});
test('organizations GET read/automatic refresh remains allowed without Origin', async () => {
  const h = harness(); const r = request({ method: 'GET', origin: null, contentType: null });
  r.cookies.get = name => name === 'refresh_token' ? { value: 'synthetic-refresh' } : undefined;
  const result = await h.load('src/app/api/organizations/route.ts').GET(r);
  assert.equal(result.status, 200); assert.equal(h.calls.length, 2); assert.equal(h.calls[0][0], '/auth/refresh');
});
