import { captureJsonResponse } from "./support/capture-json-response.mjs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Real local Next proxy, FastAPI and PostgreSQL. API setup is explicit; every
// original UI mutation/preview assertion is real. Added uncertainty cases explicitly
// abort before forwarding and then use real readback; successful writes are never mocked.
test.use({ actionTimeout: 15_000 });
const email = process.env.E2E_QC_FINANCIAL_UX_EMAIL ?? "qc-financial-ux@example.com";
const password = process.env.E2E_PASSWORD;
if (!password?.trim()) throw new Error("E2E_PASSWORD must be supplied by the isolated CI fixture.");
const today = new Date().toISOString().slice(0, 10);
const first = `${today.slice(0, 7)}-01`;
const last = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
async function api(page, method, path, data) {
  const response = await page.request.fetch(`/api${path}`, { method, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${response.status()} ${body}`).toBeTruthy();
  return body ? JSON.parse(body) : null;
}
async function setup(page, label) {
  await api(page, "POST", "/auth/login", { email, password });
  const workspace = await api(page, "POST", "/organizations", { name: `QC financial UX ${label} ${randomUUID().slice(0, 8)}`, currency: "USD", country_code: "US", timezone: "UTC" });
  expect((await api(page, "GET", "/tenant")).organization.id).toBe(workspace.organization.id);
  const client = await api(page, "POST", "/crm/clients", { display_name: "Synthetic UX client", currency: "USD" });
  return { workspace, client };
}
async function invoice(page, client, total) {
  return api(page, "POST", "/finance/invoices", { client_id: client.id, issue_date: today, currency: "USD", items: [{ item_name: "Synthetic service", description: "Synthetic service", quantity: "1", unit_price: String(total) }] });
}
async function cash(page) {
  return api(page, "POST", "/accounting/financial-accounts", { name: "Synthetic USD cash", account_type: "cash", currency: "USD", opening_balance: "0" });
}
async function issue(page, item) { return api(page, "PATCH", `/finance/invoices/${item.id}/status`, { action: "send" }); }
async function payment(page, item, account, value) { return api(page, "POST", "/finance/payments", { invoice_id: item.id, account_id: account.id, payment_date: today, invoice_amount: String(value), method: "cash" }); }
async function rejectedUI(page, button, path, method = "POST") {
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === `/api${path}` && r.request().method() === method);
  await button.click();
  const response = await pending;
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(Array.isArray(body.detail)).toBeTruthy();
  await expect(page.locator("body")).not.toContainText("[object Object]");
  return body;
}

// Current editors reject malformed values before a request. Check that UI
// protection separately from the server's independent 422 validation contract.

// Isolated-fixture uncertainty cases abort BEFORE forwarding, never fabricate a
// successful response. Only that deliberate non-delivery makes absence provable.
async function verifyAccountCreateBoundary(page, testInfo) {
  const name = `Synthetic exact account ${randomUUID().slice(0, 8)}`;
  await page.goto("/dashboard/accounting/accounts/new");
  await expect(page.getByRole("heading", { name: "Add a financial account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Currency", exact: true })).toContainText("USD");
  await page.getByLabel("Account name", { exact: true }).fill(name);
  await page.getByLabel(/^Opening balance/).fill("100.01");
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/accounting/financial-accounts" && response.request().method() === "POST");
  const [account, response] = await Promise.all([
    captureJsonResponse(page, { path: "/api/accounting/financial-accounts", action: () => page.getByRole("button", { name: "Create account", exact: true }).click() }),
    saved,
  ]);
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON().opening_balance).toBe("100.01");
  await expect(page).toHaveURL(new RegExp(`/dashboard/accounting/accounts/${account.id}`));
  const accounts = await api(page, "GET", "/finance/accounts");
  expect(accounts.filter(row => row.id === account.id)).toHaveLength(1);
  expect(accounts.find(row => row.id === account.id).opening_balance).toBe("100.01");
  expect(accounts.find(row => row.id === account.id).current_balance).toBe("100.01");
  await expect(page.locator(".aa-account-balance")).toContainText("USD 100.01");
  await page.screenshot({ path: testInfo.outputPath("neutral-theme-account-exact-desktop.png"), fullPage: true });

  const unknownName = `Synthetic not-forwarded account ${randomUUID().slice(0, 8)}`;
  await page.goto("/dashboard/accounting/accounts/new");
  await page.getByLabel("Account name", { exact: true }).fill(unknownName);
  await page.getByLabel(/^Opening balance/).fill("10.01");
  let interceptedCreates = 0;
  const createRoute = "**/api/accounting/financial-accounts";
  const abortCreate = async route => {
    if (route.request().method() !== "POST") return route.continue();
    interceptedCreates++;
    await route.abort("failed"); // Never route.fetch/continue this POST.
  };
  await page.route(createRoute, abortCreate);
  try {
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText(/Creation is not confirmed/)).toBeVisible();
    await expect(page.getByLabel("Account name", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeDisabled();
    await page.locator("form.aa-editor").evaluate(form => form.requestSubmit());
    expect(interceptedCreates).toBe(1);
    expect((await api(page, "GET", "/finance/accounts")).some(row => row.name === unknownName)).toBe(false);
    await expect(page.getByRole("link", { name: "Review Accounts in a separate tab", exact: true })).toHaveAttribute("target", "_blank");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("neutral-theme-account-unknown-mobile.png"), fullPage: false });
  } finally {
    await page.unroute(createRoute, abortCreate);
  }
}

async function verifyTransferRetryBoundary(page, testInfo) {
  const from = await api(page, "POST", "/accounting/financial-accounts", { name: "Synthetic retry source", account_type: "cash", currency: "USD", opening_balance: "100.01" });
  const to = await api(page, "POST", "/accounting/financial-accounts", { name: "Synthetic retry destination", account_type: "cash", currency: "USD", opening_balance: "0" });
  const reference = `SYN-RETRY-${randomUUID().slice(0, 8)}`;
  await page.goto("/dashboard/accounting/transfers/new");
  for (const [label, name] of [["From account", from.name], ["To account", to.name]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("listbox").getByRole("button", { name: new RegExp(name) }).click();
  }
  await page.getByLabel(/^Total deducted from source/).fill("25.01");
  await page.getByLabel("Reference", { exact: true }).fill(reference);
  const attempts = [];
  const transferRoute = "**/api/finance/transfers";
  const interceptTransfer = async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (attempts.length === 1) return route.abort("failed"); // Known not delivered.
    await route.continue(); // Explicit same-operation retry reaches the real backend.
  };
  await page.route(transferRoute, interceptTransfer);
  try {
    await page.getByRole("button", { name: "Review transfer", exact: true }).click();
    await page.getByRole("button", { name: "Confirm & record", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review same-operation retry", exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Total deducted from source/)).toBeDisabled();
    expect(attempts).toHaveLength(1);
    expect((await api(page, "GET", `/finance/transfer-page?search=${encodeURIComponent(reference)}`)).items).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("neutral-theme-transfer-unknown-desktop.png"), fullPage: true });
    await page.getByRole("button", { name: "Review same-operation retry", exact: true }).click();
    const acknowledged = page.waitForResponse(response => new URL(response.url()).pathname === "/api/finance/transfers" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Retry same operation", exact: true }).click();
    const response = await acknowledged;
    expect(response.ok()).toBeTruthy();
    const receipt = await response.json();
    await expect(page.getByRole("heading", { name: "Transfer recorded", exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[0].key).toBeTruthy();
    expect(attempts[1]).toEqual(attempts[0]);
    const recorded = await api(page, "GET", `/finance/transfers/${receipt.id}`);
    expect([recorded.source_amount, recorded.destination_amount, recorded.reference]).toEqual(["25.01", "25.01", reference]);
    const accounts = await api(page, "GET", "/finance/accounts");
    expect(accounts.find(row => row.id === from.id).current_balance).toBe("75.00");
    expect(accounts.find(row => row.id === to.id).current_balance).toBe("25.01");
    expect((await api(page, "GET", `/finance/transfer-page?search=${encodeURIComponent(reference)}`)).items).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("neutral-theme-transfer-confirmed-mobile.png"), fullPage: false });
  } finally {
    await page.unroute(transferRoute, interceptTransfer);
  }
}

// Real invoice lifecycle checks: only hold the original PATCH before forwarding.
// No financial response or successful mutation is fabricated.
async function verifyInvoiceDraftCancellation(page) {
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByRole("textbox", { name: "Subject", exact: true }).fill("Discard this synthetic draft text");
  await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit draft", exact: true })).toBeVisible();
}
async function verifyInvoiceDraftPendingBoundary(page, testInfo, invoiceId, savedSubject) {
  await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue(savedSubject || "");
  const draftRoute = `**/api/finance/invoices/${invoiceId}/draft`;
  let release, finished, started = false, forwarded = 0, forwardingError, clickError;
  const gate = new Promise(resolve => { release = resolve; });
  const completed = new Promise(resolve => { finished = resolve; });
  const holdDraft = async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    started = true; forwarded++;
    try { await gate; await route.continue(); }
    catch (error) { forwardingError = error; await route.abort("failed").catch(() => {}); }
    finally { finished(); }
  };
  await page.route(draftRoute, holdDraft);
  let click;
  try {
    click = page.getByRole("button", { name: "Save changes", exact: true }).click().catch(error => { clickError = error; });
    await expect.poll(() => started).toBe(true);
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel edit", exact: true })).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toBeDisabled();
    await expect(page.locator('input[type="number"]').nth(1)).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("neutral-theme-invoice-pending-draft.png"), fullPage: false });
  } finally {
    release();
    if (click) await click;
    if (started) await completed;
    await page.unroute(draftRoute, holdDraft);
  }
  if (clickError) throw clickError;
  if (forwardingError) throw forwardingError;
  expect(forwarded).toBe(1);
}
async function verifyInvoiceReversalBack(page) {
  await page.getByRole("dialog").getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByLabel("Reason for reversal")).toHaveValue("Synthetic correction of duplicate receipt");
  await page.getByRole("button", { name: "Review reversal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm reversal", exact: true })).toBeEnabled();
}
async function verifyInvoiceCancellationBack(page) {
  await page.getByLabel("Cancellation reason").fill("Retain this synthetic cancellation draft");
  await page.getByRole("dialog").getByRole("button", { name: "Go back", exact: true }).click();
  await page.getByRole("button", { name: "Cancel invoice", exact: true }).click();
  await expect(page.getByLabel("Cancellation reason")).toHaveValue("Retain this synthetic cancellation draft");
}

async function rejectedAPI(page, method, path, data, field) {
  const response = await page.request.fetch(`/api${path}`, { method, data });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(422);
  expect(Array.isArray(body.detail)).toBeTruthy();
  expect(JSON.stringify(body.detail)).toMatch(field);
}

 test("real invoice edits, issuance, reversal and cancellation keep preview and collection metrics coherent", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { client } = await setup(page, "invoice-lifecycle");
  const account = await cash(page);
  const edited = await invoice(page, client, 12.34);
  await page.goto(`/dashboard/accounting/invoices/${edited.id}`);
  const preview = page.locator("#invoice-client-preview");
  await expect(preview).toContainText("USD 12.34");
  await verifyInvoiceDraftCancellation(page);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.locator('input[type="number"]').nth(1).fill("24.68");
  await verifyInvoiceDraftPendingBoundary(page, testInfo, edited.id, edited.subject);
  await expect(preview).toContainText("USD 24.68");
  await expect(preview).not.toContainText("USD 12.34");
  expect(Number((await api(page, "GET", `/finance/invoices/${edited.id}`)).total)).toBe(24.68);
  await page.getByRole("button", { name: "Send invoice", exact: true }).click();
  await expect(preview.getByText("sent", { exact: true })).toBeVisible();
  await expect(preview.getByText("draft", { exact: true })).toHaveCount(0);

  const receiptInvoice = await invoice(page, client, 200);
  await issue(page, receiptInvoice);
  await payment(page, receiptInvoice, account, 80);
  const receipt = await payment(page, receiptInvoice, account, 120);
  await page.goto(`/dashboard/accounting/invoices/${receiptInvoice.id}`);
  await expect(preview.getByText("Paid", { exact: true }).locator("..")).toContainText("USD 200.00");
  await page.getByRole("row").filter({ hasText: receipt.payment_number }).getByRole("button", { name: "Reverse payment", exact: true }).click();
  await page.getByLabel("Reason for reversal").fill("Synthetic correction of duplicate receipt");
  await page.getByRole("button", { name: "Review reversal", exact: true }).click();
  await verifyInvoiceReversalBack(page);
  await page.getByRole("button", { name: "Confirm reversal", exact: true }).click();
  await expect(preview.getByText("Paid", { exact: true }).locator("..")).toContainText("USD 80.00");
  for (const due of await preview.getByText("Amount due", { exact: true }).all()) await expect(due.locator("..")).toContainText("USD 120.00");
  await expect(preview.getByText("partially paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: receipt.payment_number }).getByRole("button", { name: "Reverse payment", exact: true })).toHaveCount(0);
  const persisted = await api(page, "GET", `/finance/invoices/${receiptInvoice.id}`);
  expect([Number(persisted.amount_paid), Number(persisted.balance_due)]).toEqual([80, 120]);
  await preview.screenshot({ path: testInfo.outputPath("real-immediate-reversal-preview.png") });

  const beforeDraftJournals = await api(page, "GET", "/accounting/journals");
  const draft = await invoice(page, client, 47.25);
  const cancelled = await invoice(page, client, 12.34);
  await page.goto(`/dashboard/accounting/invoices/${cancelled.id}`);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.locator('input[type="number"]').nth(1).fill("24.68");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(preview).toContainText("USD 24.68");
  await page.getByRole("button", { name: "Cancel invoice", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation.getByRole("button", { name: "Cancel invoice", exact: true })).toBeDisabled();
  await verifyInvoiceCancellationBack(page);
  await page.getByLabel("Cancellation reason").fill("Synthetic duplicate draft, never issued");
  await confirmation.getByRole("button", { name: "Cancel invoice", exact: true }).click();
  await expect(page.getByText("Cancelled invoices are retained for audit history and cannot be collected.", { exact: true })).toBeVisible();
  await expect(page.getByText("Sent invoices are locked to preserve the commercial record.", { exact: true })).toHaveCount(0);
  const cancelledState = await api(page, "GET", `/finance/invoices/${cancelled.id}`);
  expect(cancelledState.status).toBe("cancelled");
  expect(Number(cancelledState.balance_due)).toBe(0);
  expect(Number(cancelledState.total)).toBe(24.68);
  expect(await api(page, "GET", "/accounting/journals")).toEqual(beforeDraftJournals);
  await page.reload();
  await expect(page.locator("body")).toContainText("Synthetic duplicate draft, never issued");
  await expect(page.getByRole("link", { name: "Collect payment", exact: true })).toHaveCount(0);
  await page.goto("/dashboard/accounting/invoices");
  await expect(page.getByRole("link", { name: cancelled.invoice_number, exact: true })).toBeVisible();
  await page.locator("select").filter({ has: page.locator('option[value="outstanding"]') }).selectOption("outstanding");
  for (const item of [edited, receiptInvoice]) await expect(page.getByRole("link", { name: item.invoice_number, exact: true })).toBeVisible();
  for (const item of [draft, cancelled]) await expect(page.getByRole("link", { name: item.invoice_number, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  for (const item of [draft, cancelled]) await expect(page.getByRole("link", { name: item.invoice_number, exact: true })).toBeVisible();
  const overview = await api(page, "GET", `/reports/overview?date_from=${today}&date_to=${today}`);
  expect(overview.financials.map(r => [Number(r.invoiced_revenue), Number(r.collected_revenue), Number(r.receivables)])).toEqual([[224.68, 80, 144.68]]);
  await page.goto("/dashboard");
  // The operational open-document counter includes a draft by design; collection metrics do not.
  await expect(page.locator('section[aria-label="Key business metrics"]').getByRole("link", { name: /Open invoices 3 Not paid or cancelled/ })).toBeVisible();
  expect((await api(page, "GET", "/dashboard-pulse/overview")).finance.open_invoices).toBe(2);
  const collections = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Collections', exact: true }) });
  await expect(collections).toContainText("USD 144.68");
  await expect(collections).toContainText("2 open invoices");
  await expect(page.getByText("Period receivables", { exact: true }).locator("..")).toContainText("USD 144.68");
  await testInfo.attach("real-invoice-state-evidence", { body: JSON.stringify({ fixture: "isolated synthetic", issued: 224.68, collected: 80, receivable: 144.68, excludedDraft: 47.25, excludedCancelled: 24.68, openDocuments: 3, collectableInvoices: 2 }), contentType: "application/json" });
});

 test("real invalid asset, payroll and numbering forms reject invalid values; draft payslip is not approved", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await setup(page, "validation-draft-payslip");
  await page.goto("/dashboard/accounting/assets");
  await page.getByRole("link", { name: "Record asset", exact: true }).click();
  await page.getByRole("radio", { name: /Existing \/ opening asset/ }).check();
  // Field labels include adjacent hint text; match the unique caption prefix.
  for (const [label, value] of [["Asset code", "QC-INVALID"], ["Asset name", "Synthetic invalid asset"], ["Category", "equipment"], ["Acquisition cost", "100"], ["Salvage value", "101"], ["Opening balance date", today], ["Acquisition date", today], ["In-service date", today]]) await page.getByLabel(new RegExp(`^${label}`)).fill(value);
  await page.getByRole("button", { name: "Review asset recording", exact: true }).click();
  await expect(page.locator("body")).toContainText(/salvage.*(?:exceed|greater|lower)|(?:exceed|greater).*salvage/i);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await rejectedAPI(page, "POST", "/accounting/assets", { asset_code: "QC-INVALID", name: "Synthetic invalid asset", category: "equipment", currency: "USD", acquisition_cost: "100", salvage_value: "101", acquisition_date: today, in_service_date: today, useful_life_months: 36, record_mode: "opening", opening_balance_date: today }, /salvage/i);
  expect(await api(page, "GET", "/accounting/assets")).toEqual([]);

  await page.goto("/dashboard/payroll/periods/new");
  await page.getByLabel("Period name", { exact: true }).fill("Synthetic invalid reverse period");
  await page.getByLabel("Start date", { exact: true }).fill(last);
  const periodEnd = page.getByLabel("End date", { exact: true });
  await periodEnd.fill(first);
  await page.getByLabel(/^Pay date/).fill(last);
  expect(await periodEnd.evaluate(el => el.validity.rangeUnderflow)).toBe(true);
  await expect(page.getByRole("button", { name: "Create period", exact: true })).toBeDisabled();
  await rejectedAPI(page, "POST", "/payroll/periods", { name: "Synthetic invalid reverse period", period_start: last, period_end: first, pay_date: last }, /period_end|end date|period end/i);
  expect(await api(page, "GET", "/payroll/periods")).toEqual([]);

  const employee = (await api(page, "GET", "/hr/people")).people[0];
  await api(page, "POST", "/payroll/salary-profiles", { employee_id: employee.id, currency: "USD", base_salary: "1000", pay_frequency: "monthly", effective_from: first });
  const period = await api(page, "POST", "/payroll/periods", { name: "Synthetic valid month", period_start: first, period_end: last, pay_date: last });
  const run = await api(page, "POST", "/payroll/runs", { period_id: period.id, currency: "USD" });
  expect(run.status).toBe("draft");
  await page.goto(`/dashboard/payroll/runs/${run.id}/entries/${run.entries[0].id}/edit`);
  const tax = page.getByLabel(/^Tax \/ withholding · USD/);
  await tax.fill("-1");
  await page.getByLabel(/^Adjustment reason/).fill("Synthetic invalid withholding validation");
  expect(await tax.evaluate(el => el.validity.patternMismatch)).toBe(true);
  await expect(page.getByRole("button", { name: "Save draft adjustment", exact: true })).toBeDisabled();
  await rejectedAPI(page, "PATCH", `/payroll/runs/${run.id}/entries/${run.entries[0].id}`, { tax_amount: "-1", adjustment_reason: "Synthetic invalid withholding validation" }, /tax_amount/);
  expect(Number((await api(page, "GET", `/payroll/runs/${run.id}`)).entries[0].tax_amount)).toBe(0);
  await page.goto(`/dashboard/payroll/runs/${run.id}/payslip/${run.entries[0].id}`);
  await expect(page.locator("footer")).toContainText("This is a draft payroll statement, not an approved payroll record. Amounts may change before approval.");
  await expect(page.locator("footer")).not.toContainText("This document reflects the approved payroll record");
  await page.screenshot({ path: testInfo.outputPath("real-draft-payslip-footer.png"), fullPage: true });

  const before = await api(page, "GET", "/company-settings");
  await page.goto("/dashboard/company");
  await page.getByRole("button", { name: "Numbering", exact: true }).click();
  for (const sequence of ["invoice", "client"]) {
    const form = page.locator("form").filter({ has: page.getByText(sequence, { exact: true }) });
    await form.getByLabel("Next number", { exact: true }).fill("0");
    await rejectedUI(page, form.getByRole("button", { name: "Save", exact: true }), `/company-settings/sequences/${sequence}`, "PUT");
  }
  await expect(page.locator("body")).toContainText("next_number");
  expect((await api(page, "GET", "/company-settings")).sequences).toEqual(before.sequences);
});

 test("real invoice tax identity snapshots exclude Other identifiers and retain recognized VAT", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { client } = await setup(page, "tax-identity");
  await api(page, "POST", "/company-settings/identifiers", { identifier_type: "other", label: "Synthetic internal reference", value: "QC-NON-TAX-REFERENCE", is_primary: true });
  const otherInvoice = await invoice(page, client, 10);
  await issue(page, otherInvoice);
  await page.goto(`/dashboard/accounting/invoices/${otherInvoice.id}`);
  const preview = page.locator("#invoice-client-preview");
  await expect(preview).toContainText(otherInvoice.invoice_number);
  await expect(preview).not.toContainText("QC-NON-TAX-REFERENCE");
  await expect(preview).not.toContainText("Tax ID");
  expect((await api(page, "GET", `/finance/invoices/${otherInvoice.id}`)).seller_tax_identifier_snapshot).toBeNull();
  const vat = await api(page, "POST", "/company-settings/identifiers", { identifier_type: "vat", label: "Synthetic VAT registration", value: "QC-VAT-2026", is_primary: false });
  const vatInvoice = await invoice(page, client, 20);
  await issue(page, vatInvoice);
  await page.goto(`/dashboard/accounting/invoices/${vatInvoice.id}`);
  await expect(preview).toContainText("QC-VAT-2026");
  await expect(preview).toContainText("Tax ID");
  await expect(preview).not.toContainText("QC-NON-TAX-REFERENCE");
  await page.goto(`/dashboard/accounting/invoices/${otherInvoice.id}`);
  await expect(preview).toContainText(otherInvoice.invoice_number);
  await expect(preview).not.toContainText("Tax ID");
  await page.goto(`/dashboard/accounting/invoices/${vatInvoice.id}`);
  await api(page, "DELETE", `/company-settings/identifiers/${vat.id}`);
  await page.reload();
  await expect(preview).toContainText("QC-VAT-2026");
  await page.goto(`/dashboard/accounting/invoices/${otherInvoice.id}`);
  await expect(preview).not.toContainText("Tax ID");
  await testInfo.attach("tax-snapshot-evidence", { body: JSON.stringify({ otherExcluded: true, recognizedVatIncluded: true, issuedSnapshotsImmutable: true }), contentType: "application/json" });
  await verifyAccountCreateBoundary(page, testInfo);
});

 test("rendered operational and accrual reporting reconciles project revenue and cost-only client", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { client } = await setup(page, "reporting-basis");
  const quotation = await api(page, "POST", "/sales/quotations", { client_id: client.id, subject: "Synthetic report source", issue_date: today, currency: "USD", items: [{ item_name: "Synthetic service", description: "Synthetic service", quantity: "1", unit_price: "200" }] });
  for (const status of ["sent", "accepted"]) await api(page, "PATCH", `/sales/quotations/${quotation.id}/status`, { status });
  const order = await api(page, "POST", `/sales/orders/from-quotation/${quotation.id}`);
  const project = await api(page, "POST", `/projects/from-order/${order.id}`, { name: "Synthetic order-only project" });
  const item = await api(page, "POST", `/finance/invoices/from-order/${order.id}`);
  expect(item.project_id).toBeNull();
  await issue(page, item);
  const account = await cash(page);
  await payment(page, item, account, 200);
  const costClient = await api(page, "POST", "/crm/clients", { display_name: "Synthetic expense-only client", currency: "USD" });
  const category = await api(page, "POST", "/finance/expense-categories", { name: "Synthetic operating cost", cost_type: "operating" });
  const directCategory = await api(page, "POST", "/finance/expense-categories", { name: "Synthetic direct cost", cost_type: "direct" });
  for (const relation of [{ project_id: project.id, expense_amount: "25" }, { client_id: costClient.id, expense_amount: "6" }]) await api(page, "POST", "/finance/expenses", { ...relation, account_id: account.id, category_id: relation.project_id ? directCategory.id : category.id, expense_date: today, expense_currency: "USD", payment_method: "cash", description: "Synthetic reconciliation cost" });
  const chart = await api(page, "GET", "/accounting/chart-of-accounts");
  await api(page, "POST", "/accounting/payables", { supplier_name: "Synthetic accrual supplier", bill_date: today, currency: "USD", amount: "10", expense_ledger_account_id: chart.find(r => r.system_key === "operating_expenses").id, description: "Unpaid accrual-only cost" });
  await page.goto("/dashboard/reports");
  await expect(page.locator(".or-result").filter({ has: page.getByText("Operational margin", { exact: true }) })).toContainText("USD 169.00");
  await expect(page.locator("body")).toContainText("Operational margin, not accrual net profit");
  await page.getByRole("navigation", { name: "Report sections" }).getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: project.project_number })).toContainText("USD 175.00");
  await expect(page.getByRole("row").filter({ hasText: project.project_number })).toContainText("USD 200.00");
  await page.getByRole("navigation", { name: "Report sections" }).getByRole("link", { name: "Clients", exact: true }).click();
  const costs = page.getByRole("row").filter({ hasText: costClient.display_name });
  await expect(costs).toContainText("USD 0.00");
  await expect(costs).toContainText("USD 6.00");
  await expect(costs).toContainText("USD -6.00");
  await page.goto("/dashboard/accounting/reports");
  await expect(page.getByText("Net profit / loss · selected period", { exact: true }).locator("..")).toContainText("USD 159.00");
  await page.goto("/dashboard");
  await expect(page.getByText("Operational margin", { exact: true }).locator("..")).toContainText("USD 169.00");
  await expect(page.locator(`a[href="/dashboard/projects/${project.id}"]`)).toContainText("USD 175.00");
  await expect(page.locator(`a[href="/dashboard/clients/${costClient.id}"]`)).toContainText("USD -6.00");
  await testInfo.attach("rendered-report-reconciliation", { body: JSON.stringify({ issued: 200, collected: 200, projectCost: 25, costOnlyClient: 6, operationalMargin: 169, unpaidAP: 10, accrualProfit: 159, projectProfit: 175, cash: 169 }), contentType: "application/json" });
  await verifyTransferRetryBoundary(page, testInfo);
});

test("owner source selectors omit billed work and overpayment is blocked before confirmation", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const { client } = await setup(page, "invoice-eligibility");
  const records = [];
  for (const name of ["Billed synthetic work", "Unbilled synthetic work"]) {
    const quote = await api(page, "POST", "/sales/quotations", { client_id: client.id, subject: name, issue_date: today, currency: "USD", items: [{ item_name: name, description: name, quantity: "1", unit_price: "200" }] });
    for (const status of ["sent", "accepted"]) await api(page, "PATCH", `/sales/quotations/${quote.id}/status`, { status });
    const order = await api(page, "POST", `/sales/orders/from-quotation/${quote.id}`);
    const project = await api(page, "POST", `/projects/from-order/${order.id}`, { name });
    records.push({ order, project });
  }
  const billed = await api(page, "POST", `/finance/invoices/from-project/${records[0].project.id}`);
  await issue(page, billed);
  await page.goto("/dashboard/accounting/invoices");
  await page.getByRole("button", { name: "New invoice", exact: true }).click();
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await expect(page.getByRole("listbox").getByRole("button").filter({ hasText: records[1].project.project_number })).toBeVisible();
  await expect(page.getByRole("listbox").getByRole("button").filter({ hasText: records[0].project.project_number })).toHaveCount(0);
  await page.getByRole("heading", { name: "Create invoice", exact: true }).click();
  await page.getByRole("button", { name: "From order", exact: true }).click();
  await page.getByRole("button", { name: "Order", exact: true }).click();
  await expect(page.getByRole("listbox").getByRole("button").filter({ hasText: records[1].order.order_number })).toBeVisible();
  await expect(page.getByRole("listbox").getByRole("button").filter({ hasText: records[0].order.order_number })).toHaveCount(0);

  const account = await cash(page);
  await payment(page, billed, account, 80);
  await page.goto(`/dashboard/accounting/money-in?invoice_id=${billed.id}`);
  await expect(page.locator("body")).toContainText("Last verified amount due: USD 120.00");
  await page.getByRole("button", { name: "Money received into", exact: true }).click();
  await page.getByRole("listbox").getByRole("button").filter({ hasText: "Synthetic USD cash" }).click();
  const amount = page.getByLabel(/Amount received/);
  await amount.fill("121");
  await expect(page.getByRole("status").filter({ hasText: "The amount exceeds the last verified invoice balance due." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review money received", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(amount).toHaveValue("121");
  const unchanged = await api(page, "GET", `/finance/invoices/${billed.id}`);
  expect([Number(unchanged.amount_paid), Number(unchanged.balance_due)]).toEqual([80, 120]);
  await payment(page, billed, account, 120);
  await page.goto(`/dashboard/accounting/invoices/${billed.id}`);
  await expect(page.getByRole("link", { name: "Collect payment", exact: true })).toHaveCount(0);
  await expect(page.locator("#invoice-client-preview").getByText("paid", { exact: true })).toBeVisible();
  // FIN39: the settled taxed document itself retains both partial receipts.
  const taxed = await api(page, "POST", "/finance/invoices", { client_id: client.id, issue_date: today, currency: "USD", items: [{ item_name: "Synthetic taxed service", description: "Synthetic taxed service", quantity: "1", unit_price: "20", tax_rate: "10" }] });
  await issue(page, taxed);
  const firstReceipt = await payment(page, taxed, account, 5);
  const finalReceipt = await payment(page, taxed, account, 17);
  await page.goto(`/dashboard/accounting/invoices/${taxed.id}`);
  await expect(page.locator("#invoice-client-preview").getByText("paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Collect payment", exact: true })).toHaveCount(0);
  for (const receipt of [firstReceipt, finalReceipt]) {
    const row = page.getByRole("row").filter({ hasText: receipt.payment_number });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Confirmed");
  }
  const taxState = await api(page, "GET", `/finance/invoices/${taxed.id}`);
  expect([Number(taxState.tax_total), Number(taxState.total), Number(taxState.amount_paid), Number(taxState.balance_due)]).toEqual([2, 22, 22, 0]);
  await testInfo.attach("source-and-collection-eligibility", { body: JSON.stringify({ billedOrderHidden: true, billedProjectHidden: true, unbilledWorkAvailable: true, overpayment121Against120Blocked: true, settledCollectControlAbsent: true }), contentType: "application/json" });
});
