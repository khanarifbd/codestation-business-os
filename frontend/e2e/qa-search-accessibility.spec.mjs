import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "e2e-owner@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await expect(page.getByRole("button", { name: "Show password", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 15_000 });
});

for (const kind of ["leads", "clients"]) {
  test(`QA-005/006 ${kind}: typed queries apply without Enter and older results cannot overwrite them`, async ({ page }) => {
    const item = kind === "leads"
      ? { id: "synthetic-lead", lead_code: "QA-SEARCH-LEAD", contact_name: "Synthetic search record", company_name: "Synthetic search record", status_name: "New", status_color: "blue", probability_percent: 10, currency: "USD", estimated_value: 10 }
      : { id: "synthetic-client", client_code: "QA-SEARCH-CLIENT", display_name: "Synthetic search record", status: "active", currency: "USD", created_at: "2026-10-20", updated_at: "2026-10-20" };
    await page.route(new RegExp(`/api/crm/${kind}\\?`), async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const search = params.get("search");
      const inactive = kind === "clients" && params.get("status") === "inactive";
      if (search === "slow") await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({ json: { items: !inactive && (!search || search === "slow") ? [item] : [], next_cursor: null } });
    });
    await page.goto(kind === "leads" ? "/dashboard/crm" : "/dashboard/clients");
    await expect(page.getByText("Synthetic search record", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    const search = page.getByPlaceholder(kind === "leads" ? "Search code, name, email, phone..." : "Search clients...");
    await search.fill("slow");
    await page.waitForRequest((request) => request.url().includes(`/${kind}?`) && new URL(request.url()).searchParams.get("search") === "slow");
    await search.fill("zzqaimpossible20261020");
    await expect(page.getByText(kind === "leads" ? "No leads found" : "No clients found", { exact: true })).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByText("Synthetic search record", { exact: true })).toHaveCount(0);
    if (kind === "clients") {
      const status = page.locator("select").filter({ has: page.getByRole("option", { name: "All statuses", exact: true }) });
      await status.selectOption("inactive");
      await expect(page.getByText("No clients found", { exact: true })).toBeVisible();
      await status.selectOption("");
      await expect(page.getByText("No clients found", { exact: true })).toBeVisible();
    }
    await search.fill("");
    await expect(page.getByText("Synthetic search record", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  });
}
