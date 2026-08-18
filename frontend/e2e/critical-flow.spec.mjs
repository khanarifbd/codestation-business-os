import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "e2e-owner@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

const journey = [
  ["Company", "/dashboard/company"],
  ["Client", "/dashboard/clients"],
  ["Quote", "/dashboard/quotations"],
  ["Order", "/dashboard/orders"],
  ["Project", "/dashboard/projects"],
  ["Invoice", "/dashboard/accounting/invoices"],
  ["Payment", "/dashboard/accounting/money-in"],
  ["Accounting", "/dashboard/accounting"],
  ["Report", "/dashboard/accounting/reports"],
];

test("Login → Company → Client → Quote → Order → Project → Invoice → Payment → Accounting → Report", async ({ page, context }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 15_000 });

  // Simulate the stale organization cookie that can survive an old/revoked
  // browser session. Dashboard bootstrap must recover to an active membership
  // instead of surfacing tenant/report 404s.
  await context.addCookies([{
    name: "organization_id",
    value: "stale-workspace-id",
    url: baseUrl,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).not.toContainText(/Unable to load company workspace|Workspace unavailable/i);

  for (const [label, path] of journey) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response, `${label} navigation should return a document response`).not.toBeNull();
    expect(response.status(), `${label} navigation should not return an HTTP error`).toBeLessThan(400);
    await expect(page.locator("main").first(), `${label} should render its application shell`).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}(?:$|\\?|\\/)`));
    await expect(page.locator("body")).not.toContainText(/Authentication required|Permission required:|Internal Server Error/i);
  }
});
