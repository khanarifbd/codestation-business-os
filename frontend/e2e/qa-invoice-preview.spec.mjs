import { expect, test } from "@playwright/test";

// Authentication is real against the isolated local fixture. Every invoice/payment
// request below is mocked: these tests cannot send mail or move money.
const password = process.env.E2E_PASSWORD;
if (!password?.trim()) throw new Error("E2E_PASSWORD must be supplied by the isolated CI fixture.");

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(process.env.E2E_EMAIL ?? "e2e-owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 15_000 });
});

function invoiceFixture(status = "draft", total = 12.34) {
  return { id: "qa-preview", invoice_number: "QA-PREVIEW-001", client_id: "qa-client", client_name: "Synthetic QA Client", client_name_snapshot: "Synthetic QA Client", seller_name_snapshot: "Synthetic QA Company", seller_tax_identifier_snapshot: null, status, display_status: status, tax_calculation_mode: "exclusive", subject: "Synthetic regression invoice", issue_date: "2026-10-20", due_date: "2026-10-31", currency: "USD", total, subtotal: total, discount_total: 0, tax_total: 0, amount_paid: status === "paid" ? total : 0, balance_due: status === "paid" ? 0 : total, items: [{ id: "qa-line", description: "Synthetic service", quantity: 1, unit_price: total, discount_percent: 0, tax_rate: 0, line_total: total }] };
}
async function mockInvoice(page, invoice, payments = []) {
  let reads = 0;
  await page.route("**/api/finance/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("stripe-checkout")) return route.fulfill({ json: { gateway_connected: false, checkout_available: false, attempts: [], sessions: [] } });
    if (url.pathname.endsWith("/payment-destinations")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/payment-instructions")) return route.fulfill({ json: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, invoice_status: invoice.status, invoice_currency: invoice.currency, locked: invoice.status !== "draft", payment_method: null, payment_account_id: null, payment_account_name: null, payment_provider: null, payment_account_holder: null, payment_account_reference: null, payment_currency: null, payment_url: null, payment_instructions: null } });
    if (url.pathname.endsWith("/payments")) return route.fulfill({ json: payments });
    if (url.pathname.endsWith("/draft") && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      const total = body.items.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
      Object.assign(invoice, body, { total, subtotal: total, balance_due: total, items: body.items.map((line, index) => ({ ...line, id: `qa-line-${index}`, line_total: line.quantity * line.unit_price })) });
      return route.fulfill({ json: invoice });
    }
    if (url.pathname.endsWith("/status") && route.request().method() === "PATCH") {
      Object.assign(invoice, { status: "sent", display_status: "sent" });
      return route.fulfill({ json: invoice });
    }
    if (url.pathname.endsWith(`/invoices/${invoice.id}`)) { reads++; return route.fulfill({ json: invoice }); }
    return route.fulfill({ status: 404, json: { detail: "Unmocked synthetic finance request" } });
  });
  await page.route("**/api/accounting/corrections/reverse", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ source_type: "payment", source_id: "qa-receipt" });
    Object.assign(invoice, { status: "partially_paid", display_status: "partially_paid", amount_paid: 80, balance_due: 120 });
    payments[0].status = "reversed";
    await route.fulfill({ json: { status: "reversed" } });
  });
  return () => reads;
}

test("QA-012 draft edit and issuance refresh the visible client preview without navigation", async ({ page }, testInfo) => {
  const invoice = invoiceFixture();
  const readCount = await mockInvoice(page, invoice);
  await page.goto(`/dashboard/accounting/invoices/${invoice.id}`);
  const preview = page.locator("#invoice-client-preview");
  await expect(preview).toContainText("USD 12.34");
  await expect(preview.getByText("draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Item 1 unit price", exact: true }).fill("24.68");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(preview).toContainText("USD 24.68");
  await expect(preview).not.toContainText("USD 12.34");
  await page.getByRole("button", { name: "Send invoice", exact: true }).click();
  await expect(preview.getByText("sent", { exact: true })).toBeVisible();
  await expect(preview.getByText("draft", { exact: true })).toHaveCount(0);
  expect(readCount()).toBeGreaterThanOrEqual(6); // Detail + preview, initial/edit/issue.
  await preview.screenshot({ path: testInfo.outputPath("qa012-edited-issued-preview.png") });
});

test("QA-012 reversal updates paid and due in client preview immediately", async ({ page }, testInfo) => {
  const invoice = invoiceFixture("paid", 200);
  await mockInvoice(page, invoice, [{ id: "qa-receipt", payment_number: "QA-PAY-120", payment_date: "2026-10-20", account_name: "Synthetic cash", account_currency: "USD", invoice_currency: "USD", invoice_amount: 120, account_amount: 120, method: "cash", status: "confirmed" }]);
  await page.goto(`/dashboard/accounting/invoices/${invoice.id}`);
  const preview = page.locator("#invoice-client-preview");
  await expect(preview.getByText("Paid", { exact: true }).locator("..")).toContainText("USD 200.00");
  await page.getByRole("button", { name: "Reverse payment", exact: true }).click();
  await page.getByLabel("Reason for reversal").fill("Synthetic receipt entered in error");
  await page.getByRole("button", { name: "Review reversal", exact: true }).click();
  await page.getByRole("button", { name: "Confirm reversal", exact: true }).click();
  await expect(preview.getByText("Paid", { exact: true }).locator("..")).toContainText("USD 80.00");
  for (const due of await preview.getByText("Amount due", { exact: true }).all()) await expect(due.locator("..")).toContainText("USD 120.00");
  await expect(preview.getByText("partially paid", { exact: true })).toBeVisible();
  await preview.screenshot({ path: testInfo.outputPath("qa012-reversed-preview.png") });
});

test("QA-015 outstanding excludes cancelled and draft rows even with legacy residual balances", async ({ page }, testInfo) => {
  const items = ["cancelled", "draft", "sent", "paid"].map((status) => ({ ...invoiceFixture(status, 24.68), id: `qa-${status}`, invoice_number: `QA-${status.toUpperCase()}`, balance_due: status === "paid" ? 0 : 24.68 }));
  await page.route("**/api/finance/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/invoice-page") ? { items, next_cursor: null } : path.endsWith("/meta") ? { clients: [], orders: [], projects: [] } : [] });
  });
  await page.route("**/api/inventory/products", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/accounting/tax/codes", (route) => route.fulfill({ json: [] }));
  await page.goto("/dashboard/accounting/invoices");
  await expect(page.getByRole("link", { name: "QA-CANCELLED", exact: true })).toBeVisible();
  await page.locator("select").filter({ has: page.locator('option[value="outstanding"]') }).selectOption("outstanding");
  await expect(page.getByRole("link", { name: "QA-SENT", exact: true })).toBeVisible();
  for (const status of ["CANCELLED", "DRAFT", "PAID"]) await expect(page.getByRole("link", { name: `QA-${status}`, exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("qa015-outstanding-filter.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("link", { name: "QA-CANCELLED", exact: true })).toBeVisible();
  await page.unroute("**/api/finance/**");
  await mockInvoice(page, { ...invoiceFixture("cancelled", 24.68), balance_due: 0 });
  await page.goto("/dashboard/accounting/invoices/qa-preview");
  await expect(page.getByText("Cancelled invoices are retained for audit history and cannot be collected.", { exact: true })).toBeVisible();
  await expect(page.getByText("Sent invoices are locked to preserve the commercial record.", { exact: true })).toHaveCount(0);
});
