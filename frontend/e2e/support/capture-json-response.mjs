/** Instrument one real same-origin JSON mutation; this does not mock its result.
 * Read the original server bytes before releasing them to application code, which
 * may immediately navigate and destroy Chrome's Network.getResponseBody entry.
 * No mutation replay, redirect following, retry, or synthetic success is allowed.
 */
export async function captureJsonResponse(page, { path, method = "POST", action }) {
  const origin = new URL(page.url()).origin;
  const url = new URL(path, page.url());
  if (origin === "null" || url.origin !== origin || url.username || url.password || url.hash) {
    throw new Error("Mutation capture requires an exact same-origin URL without credentials or fragment");
  }
  const target = url.href;
  const verb = method.toUpperCase();
  const matches = (candidate) => candidate.href === target;
  const matchesRequest = (request) => request.url() === target && request.method() === verb;
  let resolve, reject, fetched = false, handlerError;
  const captured = new Promise((yes, no) => { resolve = yes; reject = no; });
  const active = new Set();
  async function handle(route) {
    let fulfilled = false;
    try {
      if (!matchesRequest(route.request())) return await route.fallback();
      if (fetched) throw new Error(`Duplicate ${verb} ${target} mutation during capture`);
      fetched = true;
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
      const status = response.status();
      if (status >= 300 && status < 400) throw new Error(`Unexpected redirect: ${verb} ${target}: HTTP ${status}`);
      const body = status === 204 ? Buffer.alloc(0) : await response.body();
      // Preserve the real response, including status and all original headers
      // (including Set-Cookie), and release the exact bytes read above.
      await route.fulfill({ response, body });
      fulfilled = true;
      const text = body.toString("utf8");
      if (!response.ok()) throw new Error(`${verb} ${target}: HTTP ${status} ${text}`);
      resolve(status === 204 ? null : JSON.parse(text));
    } catch (error) {
      handlerError ??= error;
      reject(error);
      // Never continue after fetch failed: doing so could replay a committed write.
      // fulfill may already have completed for an HTTP/JSON assertion failure.
      if (!fulfilled) {
        try { await route.abort("failed"); } catch { /* Closed transport; retain original error. */ }
      }
    }
  }
  const handler = (route) => {
    const work = handle(route);
    active.add(work);
    void work.finally(() => active.delete(work));
    return work;
  };
  await page.route(matches, handler);
  try {
    // waitForRequest preserves the page's normal timeout if action sends nothing.
    // Observe every promise before invoking action, including a synchronous throw.
    const [, payload] = await Promise.all([
      page.waitForRequest(matchesRequest), captured, Promise.resolve().then(action),
    ]);
    if (handlerError) throw handlerError;
    return payload;
  } finally {
    await page.unroute(matches, handler);
    await Promise.allSettled([...active]);
  }
}
