import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "e2e-owner@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";

test("foreground activity keeps a browser-session login without persistent auth cookies", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 15_000 });

  await page.goto("/dashboard/profile", { waitUntil: "domcontentloaded" });
  const securityTab = page.getByRole("tab", { name: /security/i });
  await expect(securityTab).toBeVisible();
  await page.bringToFront();

  // A foreground click, not dashboard polling, triggers the session extension.
  const activityRequest = page.waitForResponse(
    (response) => response.url().includes("/api/auth/session/activity")
      && response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await securityTab.click();
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
  await expect(page).toHaveURL(/\/login(?:$|\?)/, { timeout: 15_000 });
});
