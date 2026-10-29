import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { captureJsonResponse } from '../e2e/support/capture-json-response.mjs';

function fixture({ status = 201, text = '{"id":"persisted"}', bodyError } = {}) {
  let resolve, navigated = false, reads = 0, clicks = 0;
  const response = {
    url: () => 'http://127.0.0.1/api/documents/upload',
    request: () => ({ method: () => 'POST' }),
    ok: () => status >= 200 && status < 300, status: () => status,
    text: async () => {
      reads++;
      if (bodyError) throw bodyError;
      if (navigated) throw new Error('No resource with given identifier found');
      return text;
    },
  };
  return {
    page: { waitForResponse: (predicate) => {
      assert.equal(predicate({ ...response, url: () => 'http://127.0.0.1/api/unrelated' }), false);
      assert.equal(predicate({ ...response, request: () => ({ method: () => 'GET' }) }), false);
      assert.equal(predicate(response), true);
      return new Promise(r => { resolve = r; });
    } },
    action: async () => { clicks++; resolve(response); await setImmediate(); navigated = true; },
    response, stats: () => ({ reads, clicks }),
  };
}

test('old read-after-navigation ordering reproduces discarded response body', async () => {
  const f = fixture();
  const pending = f.page.waitForResponse(r => new URL(r.url()).pathname === '/api/documents/upload' && r.request().method() === 'POST');
  await f.action();
  await assert.rejects((await pending).text(), /No resource/);
});

test('capture reads body before click navigation settles, exactly once', async () => {
  const f = fixture();
  assert.deepEqual(await captureJsonResponse(f.page, { path: '/api/documents/upload', action: f.action }), { id: 'persisted' });
  assert.deepEqual(f.stats(), { reads: 1, clicks: 1 });
});

test('HTTP rejection retains status/body without retry or success fallback', async () => {
  const f = fixture({ status: 409, text: '{"detail":"conflict"}' });
  await assert.rejects(captureJsonResponse(f.page, { path: '/api/documents/upload', action: f.action }), /HTTP 409.*conflict/);
  assert.deepEqual(f.stats(), { reads: 1, clicks: 1 });
});

test('malformed success body is not converted into successful receipt', async () => {
  const f = fixture({ text: 'not JSON' });
  await assert.rejects(captureJsonResponse(f.page, { path: '/api/documents/upload', action: f.action }), SyntaxError);
});

test('transport body failure remains a failure, no backend repeat', async () => {
  const f = fixture({ bodyError: new Error('body unavailable') });
  await assert.rejects(captureJsonResponse(f.page, { path: '/api/documents/upload', action: f.action }), /body unavailable/);
  assert.deepEqual(f.stats(), { reads: 1, clicks: 1 });
});

test('explicit HTTP 204 contract returns null without attempting a missing body', async () => {
  const f = fixture({ status: 204, bodyError: new Error('204 has no body') });
  assert.equal(await captureJsonResponse(f.page, { path: '/api/documents/upload', action: f.action }), null);
  assert.deepEqual(f.stats(), { reads: 0, clicks: 1 });
});
