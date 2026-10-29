const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default {
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    // APIRequestContext does not synthesize the browser Origin header. Keep
    // fixture mutations subject to the same exact-origin guard as real UI requests.
    extraHTTPHeaders: { Origin: new URL(baseURL).origin },
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
};
