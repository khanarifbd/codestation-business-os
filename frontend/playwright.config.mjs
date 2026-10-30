const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

const fixtureURL = new URL(baseURL);
// CI HTTP/1 fixtures only: avoid recycling idle sockets across test contexts.
// This applies to BOTH browser and APIRequestContext traffic, from first use.
// It does not certify production keep-alive behavior or retry failed requests.
const closeFixtureConnections = process.env.CI === "true"
  && fixtureURL.protocol === "http:"
  && ["localhost", "127.0.0.1", "[::1]"].includes(fixtureURL.hostname);

export default {
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "line",
  // The real session-activity limiter is shared by client IP (120 / 600s).
  // Verify a fresh browser's heartbeat before the bulk suite spends that bucket.
  // Dependencies, not filename ordering, guarantee this across workers/projects.
  projects: [
    { name: "session-contract", testMatch: "**/session-idle.spec.mjs" },
    {
      name: "browser-journeys",
      testIgnore: "**/session-idle.spec.mjs",
      dependencies: ["session-contract"],
    },
  ],
  use: {
    baseURL,
    // APIRequestContext does not synthesize the browser Origin header. Keep
    // fixture mutations subject to the same exact-origin guard as real UI requests.
    extraHTTPHeaders: {
      Origin: fixtureURL.origin,
      ...(closeFixtureConnections ? { Connection: "close" } : {}),
    },
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
};
