import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "e2e-owner@example.com";
const password = process.env.E2E_PASSWORD;
if (!password) throw new Error("Explicit disposable E2E_PASSWORD fixture configuration is required");

test("foreground activity keeps a browser-session login without persistent auth cookies", async ({ page, context, browser, baseURL }) => {
  if (!baseURL) throw new Error("Explicit fixture baseURL is required");
  const origin = new URL(baseURL).origin;
  const anonymous = await browser.newContext({ javaScriptEnabled: false, baseURL, extraHTTPHeaders: { Origin: origin, Connection: "close" } });
  try {
    const ssr = await anonymous.newPage();
    let anonymousAuthRequests = 0;
    ssr.on("request", request => { if (new URL(request.url()).pathname === "/api/auth/login") anonymousAuthRequests++; });
    await ssr.goto("/login");
    await expect(ssr.locator("form.login-form")).toHaveAttribute("method", "post");
    await expect(ssr.getByLabel(/email or username/i)).toBeDisabled();
    await expect(ssr.locator('input[name="password"]')).toBeDisabled();
    await expect(ssr.getByRole("button", { name: /sign in securely/i })).toBeDisabled();
    expect(anonymousAuthRequests).toBe(0);
  } finally { await anonymous.close(); }

  // The existing login is the only authentication attempt. Hold scripts to
  // inspect the server-rendered controls, then release normal hydration.
  let releaseScripts;
  const released = new Promise(resolve => { releaseScripts = resolve; });
  let loginRequests = 0, nativeLoginQueries = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/login") loginRequests++;
    if (url.pathname === "/login" && url.searchParams.has("password")) nativeLoginQueries++;
  });
  const scriptGate = async route => {
    if (route.request().resourceType() === "script") await released;
    await route.continue();
  };
  await page.route("**/*", scriptGate);
  try {
    await page.goto("/login", { waitUntil: "commit" });
    await expect(page.locator("form.login-form")).toHaveAttribute("method", "post");
    await expect(page.getByLabel(/email or username/i)).toBeDisabled();
    await expect(page.locator('input[name="password"]')).toBeDisabled();
    await expect(page.getByRole("button", { name: /sign in securely/i })).toBeDisabled();
    expect(loginRequests).toBe(0);
  } finally {
    releaseScripts();
  }
  await expect(page.getByRole("button", { name: /sign in securely/i })).toBeEnabled();
  await page.unroute("**/*", scriptGate);
  await page.getByLabel(/email or username/i).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await expect.poll(() => /^\/dashboard(?:$|\/)/.test(new URL(page.url()).pathname), { timeout: 15_000 }).toBe(true);
  expect(loginRequests).toBe(1);
  expect(nativeLoginQueries).toBe(0);

  await page.goto("/dashboard/profile", { waitUntil: "domcontentloaded" });
  const accountHeading = page.getByRole("heading", { name: "Your account", exact: true });
  await expect(accountHeading).toBeVisible();
  await page.bringToFront();

  // A foreground click, not dashboard polling, triggers the session extension.
  const activityRequest = page.waitForResponse(
    (response) => response.url().includes("/api/auth/session/activity")
      && response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await accountHeading.click();
  const heartbeat = await activityRequest;
  expect(heartbeat.status()).toBe(200);

  const cookies = await context.cookies(page.url());
  for (const name of ["access_token", "refresh_token"]) {
    const cookie = cookies.find((entry) => entry.name === name);
    expect(cookie, `${name} cookie must exist`).toBeTruthy();
    expect(cookie.expires, `${name} must be a browser-session cookie`).toBe(-1);
    expect(cookie.httpOnly).toBe(true);
  }

  // Losing browser-session cookies requires a fresh authentication; the long
  // lived device identifier alone cannot reauthenticate the user.
  await context.clearCookies();
  await page.goto("/dashboard/profile", { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname === "/login", { timeout: 15_000 }).toBe(true);
});
