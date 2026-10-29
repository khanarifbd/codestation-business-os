/** Start reading the matched browser response before click() waits for navigation.
 * No route interception, duplicate HTTP request, retry, or status/body fallback.
 */
export async function captureJsonResponse(page, { path, method = "POST", action }) {
  const body = page.waitForResponse((response) =>
    new URL(response.url()).pathname === path && response.request().method() === method
  ).then(async (response) => {
    // HTTP 204 has no representation to fetch or parse (e.g. successful delete).
    if (response.status() === 204) return null;
    const text = await response.text();
    if (!response.ok()) throw new Error(`${method} ${path}: HTTP ${response.status()} ${text}`);
    return JSON.parse(text);
  });
  // Both promises are observed from the start, including click and parsing errors.
  const [payload] = await Promise.all([body, action()]);
  return payload;
}
