import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { captureJsonResponse } from '../e2e/support/capture-json-response.mjs';

const origin = 'http://127.0.0.1:3000';
const path = '/api/documents/upload';
function fixture({ status = 201, text = '{"id":"persisted"}', bodyError, fetchError, fulfillError, requestError, bodyGate, onBody } = {}) {
  const calls = { fetch: 0, body: 0, fulfill: 0, abort: 0, fallback: 0, action: 0, unroute: 0 };
  let matcher, handler, requestMatcher, requestResolve;
  const bytes = Buffer.from(text);
  const response = {
    status: () => status, ok: () => status >= 200 && status < 300,
    headersArray: () => [{ name: 'set-cookie', value: 'one=1' }, { name: 'set-cookie', value: 'two=2' }],
    body: async () => { calls.body++; onBody?.(); if (bodyGate) await bodyGate; if (bodyError) throw bodyError; return bytes; },
  };
  const page = {
    url: () => `${origin}/dashboard/documents`,
    route: async (m, h) => { matcher = m; handler = h; },
    unroute: async (m, h) => { assert.equal(m, matcher); assert.equal(h, handler); calls.unroute++; },
    waitForRequest: (m) => { requestMatcher = m; return requestError ? Promise.reject(requestError) : new Promise(r => { requestResolve = r; }); },
  };
  async function send({ url = origin + path, method = 'POST' } = {}) {
    const request = { url: () => url, method: () => method };
    if (requestMatcher?.(request)) requestResolve(request);
    if (!matcher(new URL(url))) return;
    await handler({
      request: () => request,
      fetch: async (options) => {
        calls.fetch++;
        assert.deepEqual(options, { maxRedirects: 0, maxRetries: 0 });
        if (fetchError) throw fetchError;
        return response;
      },
      fulfill: async (options) => {
        calls.fulfill++;
        assert.equal(options.response, response); // Original status + headers/cookies.
        assert.deepEqual(options.body, status === 204 ? Buffer.alloc(0) : bytes);
        assert.equal(calls.body, status === 204 ? 0 : 1, 'Body read before app receives it and navigates');
        if (fulfillError) throw fulfillError;
      },
      abort: async () => { calls.abort++; },
      fallback: async () => { calls.fallback++; },
    });
  }
  const action = async () => { calls.action++; await send(); };
  return { page, action, send, calls, response };
}
const capture = (f, action = f.action) => captureJsonResponse(f.page, { path, action });

test('fetch once, read real bytes before navigation, fulfill original response, unroute', async () => {
  const f = fixture();
  assert.deepEqual(await capture(f), { id: 'persisted' });
  assert.deepEqual(f.calls, { fetch: 1, body: 1, fulfill: 1, abort: 0, fallback: 0, action: 1, unroute: 1 });
});
test('exact URL excludes other origins, paths and query; other method falls back', async () => {
  const f = fixture();
  await capture(f, async () => {
    await f.send({ url: 'https://external.example' + path });
    await f.send({ url: origin + path + '?other=1' });
    await f.send({ url: origin + '/api/unrelated' });
    await f.send({ method: 'GET' });
    await f.action();
  });
  assert.equal(f.calls.fetch, 1);
  assert.equal(f.calls.fallback, 1);
});
test('cross-origin configuration rejects before installing instrumentation or action', async () => {
  const f = fixture();
  await assert.rejects(captureJsonResponse(f.page, { path: 'https://external.example/api', action: f.action }), /same-origin/);
  assert.equal(f.calls.action, 0);
  assert.equal(f.calls.fetch, 0);
});
test('HTTP error retains real status/body for app, fails test, never retries', async () => {
  const f = fixture({ status: 409, text: '{"detail":"conflict"}' });
  await assert.rejects(capture(f), /HTTP 409.*conflict/);
  assert.equal(f.calls.fetch, 1);
  assert.equal(f.calls.fulfill, 1);
  assert.equal(f.calls.abort, 0);
  assert.equal(f.calls.unroute, 1);
});
test('malformed successful response is fulfilled unchanged but never accepted as success', async () => {
  const f = fixture({ text: 'not JSON' });
  await assert.rejects(capture(f), SyntaxError);
  assert.equal(f.calls.fetch, 1);
  assert.equal(f.calls.fulfill, 1);
  assert.equal(f.calls.unroute, 1);
});
for (const kind of ['fetchError', 'bodyError', 'fulfillError']) {
  test(`${kind} aborts without continue, retry, fallback or mutation replay`, async () => {
    const f = fixture({ [kind]: new Error(kind) });
    await assert.rejects(capture(f), new RegExp(kind));
    assert.equal(f.calls.fetch, 1);
    assert.equal(f.calls.abort, 1);
    assert.equal(f.calls.fallback, 0);
    assert.equal(f.calls.unroute, 1);
  });
}
test('unexpected redirect is rejected and aborted, never followed', async () => {
  const f = fixture({ status: 307 });
  await assert.rejects(capture(f), /Unexpected redirect.*307/);
  assert.equal(f.calls.fetch, 1);
  assert.equal(f.calls.body, 0);
  assert.equal(f.calls.fulfill, 0);
  assert.equal(f.calls.abort, 1);
});
test('HTTP 204 preserves no-body contract', async () => {
  const f = fixture({ status: 204, bodyError: new Error('No body') });
  assert.equal(await capture(f), null);
  assert.equal(f.calls.body, 0);
  assert.equal(f.calls.fulfill, 1);
});
test('action failure is not swallowed and removes route without posting', async () => {
  const f = fixture();
  await assert.rejects(capture(f, () => { throw new Error('click failed'); }), /click failed/);
  assert.equal(f.calls.fetch, 0);
  assert.equal(f.calls.unroute, 1);
});
test('duplicate matching request is aborted without a second server mutation', async () => {
  const f = fixture();
  await assert.rejects(capture(f, async () => { await f.action(); await f.send(); }), /Duplicate/);
  assert.equal(f.calls.fetch, 1);
  assert.equal(f.calls.fulfill, 1);
  assert.equal(f.calls.abort, 1);
  assert.equal(f.calls.unroute, 1);
});

test('missing request uses the page request timeout and still removes route', async () => {
  const f = fixture({ requestError: new Error('page request timeout') });
  await assert.rejects(capture(f, async () => {}), /page request timeout/);
  assert.equal(f.calls.fetch, 0);
  assert.equal(f.calls.unroute, 1);
});
test('action failure after a committed response does not replay or hide failure', async () => {
  const f = fixture();
  await assert.rejects(capture(f, async () => { await f.action(); throw new Error('navigation failed'); }), /navigation failed/);
  assert.equal(f.calls.fetch, 1);
  assert.equal(f.calls.fulfill, 1);
  assert.equal(f.calls.unroute, 1);
});

test('action failure waits for in-flight real response before cleanup completes', async () => {
  let release, started;
  const bodyGate = new Promise(r => { release = r; });
  const bodyStarted = new Promise(r => { started = r; });
  const f = fixture({ bodyGate, onBody: started });
  let handlerWork, settled = false;
  const pending = capture(f, async () => {
    handlerWork = f.send();
    await bodyStarted;
    throw new Error('action failed while upstream pending');
  });
  const checked = assert.rejects(pending, /action failed while upstream pending/).then(() => { settled = true; });
  await bodyStarted;
  await setImmediate();
  assert.equal(f.calls.unroute, 1);
  assert.equal(settled, false, 'Cleanup must await the active upstream handler');
  assert.equal(f.calls.fetch, 1);
  release();
  await checked;
  await handlerWork;
  assert.equal(f.calls.fetch, 1);
  assert.equal(f.calls.fulfill, 1);
  assert.equal(f.calls.fallback, 0);
});
