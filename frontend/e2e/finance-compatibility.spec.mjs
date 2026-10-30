import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Disposable real Next/FastAPI/PostgreSQL fixture. No provider connections.
// Hold one original create before forwarding, never replay a financial write.
const password = process.env.E2E_PASSWORD;
if (!password?.trim()) throw new Error("E2E_PASSWORD must be supplied by the isolated CI fixture.");
async function api(page, method, path, data) {
  const response = await page.request.fetch(`/api${path}`, { method, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${response.status()} ${body}`).toBeTruthy();
  return body ? JSON.parse(body) : null;
}

// GET /finance/invoices returns InvoicePage, not a bare array. This isolated
// company has two records, so a cursor would invalidate the full-set proof.
function invoiceRecords(page) {
  if (!page || typeof page !== "object" || Array.isArray(page) || !Array.isArray(page.items) || page.next_cursor !== null || !page.items.every(row => row && typeof row.id === "string" && row.id.length > 0 && typeof row.invoice_number === "string" && row.invoice_number.length > 0 && (row.subject === null || typeof row.subject === "string")) || new Set(page.items.map(row => row.id)).size !== page.items.length) {
    throw new Error("Expected the complete synthetic InvoicePage { items, next_cursor: null } response.");
  }
  return page.items;
}

async function cancelExit(page, message, action) {
  // Observe the waiter immediately, including a failed click or assertion.
  const observed = page.waitForEvent("dialog").then(async dialog => {
    try { expect(dialog.message()).toContain(message); }
    finally { await dialog.dismiss(); }
  }).then(() => ({}), error => ({ error }));
  await action();
  const outcome = await observed;
  if (outcome.error) throw outcome.error;
}

test("Finance compatibility retains drafts, blocks pending tabs and preserves all three record paths", async ({ page }, testInfo) => {
  test.setTimeout(210_000);
  await api(page, "POST", "/auth/login", { email: process.env.E2E_QC_FINANCIAL_UX_EMAIL ?? "qc-financial-ux@example.com", password });
  const company = await api(page, "POST", "/organizations", { name: `QC Finance shell ${randomUUID().slice(0, 8)}`, currency: "USD", country_code: "US", timezone: "UTC" });
  expect((await api(page, "GET", "/tenant")).organization.id).toBe(company.organization.id);
  const client = await api(page, "POST", "/crm/clients", { display_name: "Synthetic compatibility client", currency: "USD" });
  const account = await api(page, "POST", "/accounting/financial-accounts", { name: "Synthetic compatibility cash", account_type: "cash", currency: "USD", opening_balance: "0" });
  const today = new Date().toISOString().slice(0, 10);
  const older = await api(page, "POST", "/finance/invoices", { client_id: client.id, issue_date: today, currency: "USD", subject: "Existing compatibility record", items: [{ item_name: "Synthetic service", description: "Synthetic service", quantity: "1", unit_price: "25.00" }] });
  await api(page, "PATCH", `/finance/invoices/${older.id}/status`, { action: "send" });
  const receipt = await api(page, "POST", "/finance/payments", { invoice_id: older.id, account_id: account.id, payment_date: today, invoice_amount: "5.00", method: "cash" });

  await page.goto(`/dashboard/finance?client_id=${client.id}`);
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  const overview = page.getByRole("region", { name: "Company-wide finance overview", exact: true });
  const metric = label => overview.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }) }).locator("dd").first();
  await expect(metric("Open invoices")).toHaveText("1");
  await expect(metric("Confirmed payments")).toHaveText("1");
  await expect(metric("Active accounts")).toHaveText("1");
  await expect(overview).toContainText("included subset, not added again");
  const nav = page.getByRole("navigation", { name: "Finance sections", exact: true });
  const form = page.getByRole("region", { name: "Create invoice", exact: true });
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "Direct client invoice", exact: true })).toHaveAttribute("aria-pressed", "true");
  await form.getByLabel("Subject", { exact: true }).fill("Retained compatibility draft");
  await form.getByLabel("Terms and conditions (optional)", { exact: true }).fill("Synthetic terms\nNo external commitment");
  await nav.getByRole("button", { name: "accounts", exact: true }).click();
  await expect(page.getByRole("button", { name: account.name, exact: true })).toBeVisible();
  await expect(page.getByText("Invoice draft retained", { exact: true })).toBeVisible();
  await expect(form).toBeHidden();
  await cancelExit(page, "unsaved invoice", () => page.getByRole("button", { name: account.name, exact: true }).click());
  await expect(page).toHaveURL(/\/dashboard\/finance\?/);
  await expect(page.getByText("Invoice draft retained", { exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "payments", exact: true }).click();
  await expect(page.getByRole("link", { name: /^View receipt / }).first()).toBeVisible();
  await nav.getByRole("button", { name: "invoices", exact: true }).click();
  await expect(form.getByLabel("Subject", { exact: true })).toHaveValue("Retained compatibility draft");
  await expect(form.getByLabel("Terms and conditions (optional)", { exact: true })).toHaveValue("Synthetic terms\nNo external commitment");
  await form.getByLabel("Item / service name", { exact: true }).fill("Synthetic compatibility service");
  await form.getByLabel("Description", { exact: true }).fill("Isolated UI fixture");
  await form.getByLabel("Unit price", { exact: true }).fill("12.34");

  let release, count = 0;
  const held = new Promise(resolve => { release = resolve; });
  const target = "**/api/finance/invoices";
  const holdCreate = async route => {
    if (route.request().method() !== "POST") return route.fallback();
    ++count; await held;
    // Forward the original request exactly once; no synthetic success/POST retry.
    await route.continue();
  };
  await page.route(target, holdCreate);
  const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === "/api/finance/invoices" && r.request().method() === "POST").then(response => ({ response }), error => ({ error }));
  try {
    await form.getByRole("button", { name: "Create draft invoice", exact: true }).click();
    await expect.poll(() => count).toBe(1);
    await expect(nav.getByRole("button", { name: "accounts", exact: true })).toBeDisabled();
    await expect(nav.getByRole("button", { name: "payments", exact: true })).toBeDisabled();
    await expect(page.getByText("Invoice request in progress", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("neutral-theme-finance-pending.png"), fullPage: false });
    release();
    const outcome = await responsePromise;
    if (outcome.error) throw outcome.error;
    expect(outcome.response.ok()).toBeTruthy();
  } finally { release(); await page.unroute(target, holdCreate); }
  expect(count).toBe(1);
  await expect(form).toBeHidden();
  const records = invoiceRecords(await api(page, "GET", "/finance/invoices"));
  const created = records.filter(item => item.subject === "Retained compatibility draft");
  expect(created).toHaveLength(1);
  expect((await api(page, "GET", `/finance/invoices/${created[0].id}`)).terms_conditions).toBe("Synthetic terms\nNo external commitment");
  await page.getByLabel("Search invoices", { exact: true }).fill("Retained compatibility draft");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page).toHaveURL(/invoice_search=Retained/);
  await expect(page.getByRole("link", { name: created[0].invoice_number, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: older.invoice_number, exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: created[0].invoice_number, exact: true }).click();
  await page.getByRole("link", { name: "Back to Finance", exact: true }).click();
  await expect(page.getByLabel("Search invoices", { exact: true })).toHaveValue("Retained compatibility draft");
  await nav.getByRole("button", { name: "payments", exact: true }).click();
  await page.getByRole("link", { name: /^View receipt / }).first().click();
  await expect(page.getByText(receipt.id, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: `Open invoice ${older.invoice_number}`, exact: true }).click();
  await page.getByRole("link", { name: "Back to Finance", exact: true }).click();
  await expect(nav.getByRole("button", { name: "payments", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "accounts", exact: true }).click();
  await page.getByRole("button", { name: account.name, exact: true }).click();
  await expect(page.getByRole("heading", { name: account.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  await expect(nav.getByRole("button", { name: "accounts", exact: true })).toHaveAttribute("aria-current", "page");
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const tab of ["invoices", "payments", "accounts"]) {
      await nav.getByRole("button", { name: tab, exact: true }).click();
      await expect(nav.getByRole("button", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
      if (tab === "invoices") await expect(page.getByRole("link", { name: created[0].invoice_number, exact: true })).toBeVisible();
      if (tab === "payments") await expect(page.getByRole("link", { name: /^View receipt / }).first()).toBeVisible();
      if (tab === "accounts") await expect(page.getByRole("button", { name: account.name, exact: true })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`neutral-theme-finance-${tab}-${name}-viewport.png`), fullPage: false });
      await page.screenshot({ path: testInfo.outputPath(`neutral-theme-finance-${tab}-${name}.png`), fullPage: true });
    }
  }
  // A deliberately aborted original write is not forwarded or replayed. The UI
  // must still treat its result conservatively, independent of test knowledge.
  await page.goto(`/dashboard/finance?client_id=${client.id}`);
  await expect(form).toBeVisible();
  await form.getByLabel("Subject", { exact: true }).fill("Synthetic uncertain draft");
  await form.getByLabel("Item / service name", { exact: true }).fill("Uncertain fixture");
  await form.getByLabel("Description", { exact: true }).fill("Never forwarded by fixture");
  await form.getByLabel("Unit price", { exact: true }).fill("1.00");
  let aborted = 0;
  const abortCreate = route => { if (route.request().method() !== "POST") return route.fallback(); ++aborted; return route.abort("failed"); };
  await page.route(target, abortCreate);
  try {
  await form.getByRole("button", { name: "Create draft invoice", exact: true }).click();
  await expect(page.getByText("Creation outcome unknown", { exact: true })).toBeVisible();
  expect(aborted).toBe(1);
  await nav.getByRole("button", { name: "accounts", exact: true }).click();
  await expect(page.getByText("Invoice creation outcome unknown", { exact: true })).toBeVisible();
  await cancelExit(page, "may already be saved", () => page.getByRole("button", { name: account.name, exact: true }).click());
  await nav.getByRole("button", { name: "invoices", exact: true }).click();
  await expect(form.getByLabel("Subject", { exact: true })).toHaveValue("Synthetic uncertain draft");
  await expect(form.getByRole("button", { name: "Create draft invoice", exact: true })).toBeDisabled();
  expect(aborted).toBe(1);
  } finally { await page.unroute(target, abortCreate); }
  const finalRecords = invoiceRecords(await api(page, "GET", "/finance/invoices"));
  expect(finalRecords.filter(item => item.subject === "Synthetic uncertain draft")).toHaveLength(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("neutral-theme-finance-unknown-mobile.png"), fullPage: false });
});
