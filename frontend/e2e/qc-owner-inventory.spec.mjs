import { captureJsonResponse } from "./support/capture-json-response.mjs";
import { expect, test, request as playwrightRequest } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

// Local-only owner QC: all business requests hit the real application and DB.
// Only the empty company and fictional cash account are setup via API. Supplier,
// warehouse, stock item, receipt, settlements and adjustments are created in UI.
// Never reuse the manual-review company or mock financial responses. Receipt
// instrumentation forwards once and releases the unchanged upstream response.
const email = process.env.E2E_QC_EMAIL ?? "qc-owner@example.com";
const password = process.env.E2E_PASSWORD;

test.beforeEach(() => {
  expect(password, 'E2E_PASSWORD must be configured for the disposable CI fixture').toBeTruthy();
});
const appUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

async function api(page, path, data) {
  const response = data === undefined
    ? await page.request.get(path)
    : await page.request.post(path, { data });
  const text = await response.text();
  expect(response.ok(), `${path}: ${response.status()} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

async function choose(page, accessibleName, text) {
  await page.getByRole("button", { name: accessibleName, exact: true }).click();
  await page.getByRole("listbox").getByRole("button").filter({ hasText: text }).click();
}

async function postUi(page, path, button, method = "POST") {
  return captureJsonResponse(page, { path, method, action: () => button.click() });
}

function observeInventoryRequestFailure(page, predicate) {
  // Attach rejection ownership immediately, even if the UI action throws before waiting.
  const result = page.waitForEvent("requestfailed", predicate).then(() => ({ error: null }), error => ({ error }));
  return async () => { const outcome = await result; if (outcome.error) throw outcome.error; };
}
async function withInventoryTemporaryRoute(page, endpoint, handler, action) {
  const viewport = page.viewportSize();
  await page.route(endpoint, handler);
  try { return await action(); }
  finally {
    try { await page.unroute(endpoint, handler); }
    finally { if (viewport) await page.setViewportSize(viewport); }
  }
}

test("fresh owner: inventory receipt → partial/final payable settlement → stock controls, with persisted ledger reconciliation", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  expect(["localhost", "127.0.0.1", "::1"], "Synthetic financial QC must never target a live host").toContain(new URL(appUrl).hostname);
  await page.setViewportSize({ width: 1440, height: 1080 });
  const suffix = randomUUID().slice(0, 8);
  const names = {
    company: `Owner Inventory QC ${suffix}`,
    supplier: `Fictional Inventory Supplier ${suffix}`,
    warehouse: `QC Warehouse ${suffix}`,
    product: `QC Stock Unit ${suffix}`,
    sku: `QC-STOCK-${suffix.toUpperCase()}`,
    cash: `QC Fictional Cash ${suffix}`,
    receiptReference: `QC-RECEIPT-${suffix}`,
  };
  const snapshots = [];

  await test.step("Authenticate and create an isolated empty synthetic company", async () => {
    await page.goto("/login");
    await page.getByLabel(/email or username/i).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: /sign in securely/i }).click();
    await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 20_000 });
  });
  // An owner with several prior QC workspaces may not have selected an active
  // tenant at login. Resolve an authorized comparison company from memberships.
  const memberships = await api(page, "/api/organizations");
  const originalMembership = memberships.find((item) => item.status === "active" && item.organization.status === "active");
  expect(originalMembership, "A seeded authorized company is needed for the tenant-isolation assertion").toBeTruthy();
  const originalOrganizationId = originalMembership.organization.id;
  const membership = await api(page, "/api/organizations", {
    name: names.company, country_code: "US", timezone: "UTC", currency: "USD",
    business_type: "Synthetic local QA", team_size: "1-5", financial_year_start_month: 1,
  });
  const cash = await api(page, "/api/finance/accounts", {
    name: names.cash, account_type: "cash", currency: "USD", opening_balance: 1000,
    notes: "Fictional local owner QC ledger. No bank connection or real payment.",
  });
  expect((await api(page, "/api/tenant/context")).organization.id).toBe(membership.organization.id);
  await page.goto("/dashboard/inventory");
  await expect(page.getByText("Loading inventory…", { exact: true })).toHaveCount(0);

  await test.step("Create supplier, warehouse and stock item through owner forms", async () => {
    await page.getByRole("button", { name: "Suppliers", exact: true }).click();
    await page.getByRole("button", { name: "Add supplier", exact: true }).click();
    await page.getByLabel("Supplier name", { exact: true }).fill(names.supplier);
    const supplierForm = page.locator("form").filter({ has: page.getByLabel("Supplier name", { exact: true }) });
    await postUi(page, "/api/inventory/suppliers", supplierForm.getByRole("button", { name: "Add supplier", exact: true }));
    await expect(page.getByRole("row").filter({ hasText: names.supplier })).toBeVisible();

    await page.getByRole("button", { name: "Warehouses", exact: true }).click();
    await page.getByRole("button", { name: "Add warehouse", exact: true }).click();
    await page.getByLabel("Warehouse code", { exact: true }).fill(`QC-${suffix}`);
    await page.getByLabel("Warehouse name", { exact: true }).fill(names.warehouse);
    await page.getByLabel("Use as default warehouse", { exact: true }).check();
    const warehouseForm = page.locator("form").filter({ has: page.getByLabel("Warehouse code", { exact: true }) });
    await postUi(page, "/api/inventory/warehouses", warehouseForm.getByRole("button", { name: "Add warehouse", exact: true }));
    await expect(page.getByRole("row").filter({ hasText: names.warehouse })).toBeVisible();

    await page.getByRole("button", { name: "Products & services", exact: true }).click();
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.getByLabel("SKU / Code", { exact: true }).fill(names.sku);
    await page.getByLabel("Name", { exact: true }).fill(names.product);
    await page.getByLabel("Standard unit cost", { exact: true }).fill("6");
    await page.getByLabel("Selling price", { exact: true }).fill("15");
    await page.getByLabel("Low-stock alert level", { exact: true }).fill("2");
    const itemForm = page.locator("form").filter({ has: page.getByLabel("SKU / Code", { exact: true }) });
    await postUi(page, "/api/inventory/products", itemForm.getByRole("button", { name: "Add item", exact: true }));
    await expect(page.getByRole("row").filter({ hasText: names.sku })).toBeVisible();
    expect(await api(page, "/api/inventory/stock")).toHaveLength(0);
  });

  const product = (await api(page, "/api/inventory/products")).find((item) => item.sku === names.sku);
  const warehouse = (await api(page, "/api/inventory/warehouses")).find((item) => item.name === names.warehouse);
  expect(product.currency).toBe("USD");
  let receipt;
  let bill;

  async function reconcile(label, expected) {
    const [purchases, payables, stocks, accounts, journals, trial, chart, movements] = await Promise.all([
      api(page, "/api/inventory/purchases"), api(page, "/api/accounting/payables?include_paid=true"),
      api(page, "/api/inventory/stock"), api(page, "/api/finance/accounts"),
      api(page, "/api/accounting/journals"), api(page, "/api/accounting/trial-balance"),
      api(page, "/api/accounting/chart-of-accounts"), api(page, "/api/inventory/movements"),
    ]);
    const savedReceipt = purchases.find((item) => item.id === receipt.id);
    const savedBill = payables.find((item) => item.purchase_receipt_id === receipt.id);
    const stock = stocks.find((item) => item.product_id === product.id && item.warehouse_id === warehouse.id);
    const savedCash = accounts.find((item) => item.id === cash.id);
    const ledgerBalance = (key) => {
      const account = chart.find((item) => item.system_key === key);
      return account ? Number(trial.rows.find((row) => row.ledger_account_id === account.id)?.balance ?? 0) : 0;
    };
    expect(purchases).toHaveLength(1);
    expect(payables).toHaveLength(1);
    expect(Number(savedReceipt.total)).toBe(60);
    expect(Number(savedReceipt.balance_due), `${label}: receipt due`).toBe(expected.due);
    expect(Number(savedBill.balance_due), `${label}: payable due`).toBe(expected.due);
    expect(Number(savedBill.amount_paid)).toBe(60 - expected.due);
    expect(Number(savedCash.current_balance), `${label}: cash subledger`).toBe(expected.cash);
    expect(Number(stock.on_hand)).toBe(expected.quantity);
    expect(Number(stock.average_unit_cost)).toBe(6);
    expect(Number(stock.inventory_value)).toBe(expected.quantity * 6);
    expect(Number(stock.inventory_value_base)).toBe(expected.quantity * 6);
    expect(ledgerBalance("inventory_asset"), `${label}: inventory GL`).toBe(expected.quantity * 6);
    expect(ledgerBalance("accounts_payable"), `${label}: AP GL`).toBe(0 - expected.due);
    expect(ledgerBalance(`financial_account:${cash.id}`), `${label}: cash GL matches subledger`).toBe(expected.cash);
    expect(ledgerBalance("inventory_adjustment_gain")).toBe(0 - (expected.gain ?? 0));
    expect(ledgerBalance("inventory_adjustment_expense")).toBe(expected.loss ?? 0);
    expect(journals, `${label}: no duplicate recognition journal`).toHaveLength(expected.journals);
    expect(journals.filter((item) => item.source_type === "inventory_purchase_receipt")).toHaveLength(1);
    expect(journals.filter((item) => item.source_type === "payable_bill")).toHaveLength(0);
    for (const entry of journals) expect(Number(entry.total_debit), `${label}: ${entry.entry_number} balances`).toBe(Number(entry.total_credit));
    expect(Number(trial.total_debit)).toBe(Number(trial.total_credit));
    const expenseBalance = trial.rows.filter((row) => row.category === "expense").reduce((sum, row) => sum + Number(row.balance), 0);
    expect(expenseBalance, `${label}: no duplicate purchase expense`).toBe(expected.loss ?? 0);
    expect(movements).toHaveLength(expected.movements);
    snapshots.push({ label, organization_id: membership.organization.id, receipt: savedReceipt, bill: savedBill, stock, cash: savedCash.current_balance, journals, trial, movements });
    return savedBill;
  }

  await test.step("Receive ten units at USD 6 and reconcile one inventory/AP recognition", async () => {
    await page.getByRole("button", { name: "Purchases", exact: true }).click();
    await page.getByRole("button", { name: "Receive purchase", exact: true }).click();
    await choose(page, "Supplier", names.supplier);
    await choose(page, "Receive into warehouse", names.warehouse);
    await choose(page, "Product", names.product);
    await page.getByLabel("Qty", { exact: true }).fill("10");
    await page.getByLabel("Unit cost", { exact: true }).fill("6");
    await page.getByLabel("Supplier invoice / reference", { exact: true }).fill(names.receiptReference);
    receipt = await postUi(page, "/api/inventory/purchases", page.getByRole("button", { name: "Receive purchase & update stock", exact: true }));
    await expect(page.getByRole("row").filter({ hasText: names.receiptReference })).toBeVisible();
    bill = await reconcile("received", { due: 60, cash: 1000, quantity: 10, journals: 2, movements: 1 });
    await page.getByRole("button", { name: "Purchases", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: names.receiptReference });
    await expect(row).toContainText("USD 60.00");
    await row.getByRole("link", { name: "Settle in Payables", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/accounting\/payables$/);
  });

  async function payment(amount, reference, checkControls = false) {
    await page.goto("/dashboard/accounting/payables");
    const row = page.locator(`#payable-row-${bill.id}`);
    await row.getByRole("link", { name: "Settle bill", exact: true }).click();
    await choose(page, "Pay from / charge to", names.cash);
    const amountInput = page.getByLabel(/^Payment amount/);
    if (checkControls) {
      await amountInput.fill("61");
      await expect(page.getByRole("button", { name: "Review settlement", exact: true })).toBeDisabled();
      await expect(page.getByText("Payment must be positive and cannot exceed the last loaded payable balance.", { exact: true })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await api(page, `/api/accounting/payables/${bill.id}/payments`)).toHaveLength(0);
    }
    await amountInput.fill(String(amount));
    await page.getByLabel("Payment reference", { exact: true }).fill(reference);
    await page.getByRole("button", { name: "Review settlement", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Settle this supplier bill?" });
    await expect(confirmation).toContainText(`USD ${amount.toFixed(2)}`);
    await expect(confirmation).toContainText("No second expense is recognized.");
    if (checkControls) {
      await confirmation.getByRole("button", { name: "Go back", exact: true }).click();
      await reconcile("review cancelled without posting", { due: 60, cash: 1000, quantity: 10, journals: 2, movements: 1 });
      await page.getByRole("button", { name: "Review settlement", exact: true }).click();
    }
    await postUi(page, `/api/accounting/payables/${bill.id}/payments`, confirmation.getByRole("button", { name: "Confirm & settle bill", exact: true }));
    await expect(page.getByRole("heading", { name: "Settlement request acknowledged", exact: true })).toBeVisible();
    // Acknowledgment retains identity; current status requires an explicit read.
    await page.getByRole("button", { name: "Read current bill & history", exact: true }).click();
    await expect(page.getByRole("article").filter({ hasText: `Reference: ${reference}` })).toContainText(`USD ${amount.toFixed(2)}`);
    await page.locator(".pb-actions").getByRole("button", { name: "Back to payables", exact: true }).click();
  }

  await test.step("Reject overpayment, cancel review safely, then partially settle USD 20", async () => {
    await payment(20, `QC-PARTIAL-${suffix}`, true);
    await reconcile("partial payment", { due: 40, cash: 980, quantity: 10, journals: 3, movements: 1 });
    const row = page.locator(`#payable-row-${bill.id}`);
    await expect(row).toContainText("USD 40.00");
    await expect(row.getByText("Still due", { exact: true }).locator("..")).toContainText("USD 40.00");
    await page.screenshot({ path: testInfo.outputPath("owner-inventory-partial-payment.png"), fullPage: true });
  });

  await test.step("Settle the final USD 40 without recognizing a second expense", async () => {
    await payment(40, `QC-FINAL-${suffix}`);
    await reconcile("final payment", { due: 0, cash: 940, quantity: 10, journals: 4, movements: 1 });
    expect(await api(page, `/api/accounting/payables/${bill.id}/payments`)).toHaveLength(2);
    await page.locator("select").filter({ has: page.locator('option[value="paid"]') }).selectOption("paid");
    const row = page.locator(`#payable-row-${bill.id}`);
    await expect(row).toContainText("USD 0.00");
    await expect(row.getByRole("link", { name: "Settle bill", exact: true })).toHaveCount(0);
    await page.reload();
    await reconcile("paid state survives reload", { due: 0, cash: 940, quantity: 10, journals: 4, movements: 1 });
  });

  await test.step("Reverse the final supplier payment through correction UI, then re-pay", async () => {
    const finalPayment = (await api(page, `/api/accounting/payables/${bill.id}/payments`)).find((item) => item.reference === `QC-FINAL-${suffix}`);
    expect(Number(finalPayment.amount)).toBe(40);
    await page.goto("/dashboard/accounting/advanced/corrections");
    await page.locator(`#correction-row-${finalPayment.id}`).getByRole("link", { name: "Open correction", exact: true }).click();
    const reason = `QC owner correction of final supplier payment ${suffix}`;
    await page.getByLabel(/^Reason for correction/).fill(reason);
    await page.getByRole("button", { name: "Review business reversal", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("USD 40.00");
    await expect(dialog).toContainText(names.supplier);
    const requestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/accounting/corrections/reverse" && request.method() === "POST");
    const correction = await postUi(page, "/api/accounting/corrections/reverse", dialog.getByRole("button", { name: "Confirm business reversal", exact: true }));
    expect((await requestPromise).postDataJSON()).toMatchObject({ source_type: "payable_payment", source_id: finalPayment.id, reason });
    expect(correction).toMatchObject({ source_type: "payable_payment", source_id: finalPayment.id });
    expect(correction.reversal_journal_id).toEqual(expect.any(String));
    expect(correction.reversal_journal_id).not.toBe("");
    // Successful corrections navigate to their verified journal; the retained
    // acknowledgment is a fallback only when automatic navigation cannot finish.
    await expect(page).toHaveURL((url) => url.pathname === `/dashboard/accounting/advanced/journals/${correction.reversal_journal_id}`);
    const reversalJournal = await api(page, `/api/accounting/journals/${correction.reversal_journal_id}`);
    expect(reversalJournal).toMatchObject({ id: correction.reversal_journal_id, status: "posted", functional_currency: "USD" });
    expect(Number(reversalJournal.total_debit)).toBe(40);
    expect(Number(reversalJournal.total_credit)).toBe(40);
    await expect(page.getByRole("heading", { name: reversalJournal.entry_number, exact: true })).toBeVisible();
    await expect(page.getByText("Read-only posted journal", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm business reversal", exact: true })).toHaveCount(0);
    await reconcile("final payment reversed", { due: 40, cash: 980, quantity: 10, journals: 5, movements: 1 });
    const reversedHistory = await api(page, `/api/accounting/payables/${bill.id}/payments`);
    expect(reversedHistory.find((item) => item.id === finalPayment.id).status).toBe("reversed");
    expect(reversedHistory.filter((item) => item.status === "posted").reduce((sum, item) => sum + Number(item.amount), 0)).toBe(20);
    const candidates = await api(page, "/api/accounting/corrections/candidates?limit=200");
    expect(candidates.some((item) => item.source_type === "payable_payment" && item.source_id === finalPayment.id)).toBe(false);
    await page.getByRole("button", { name: "Back to business corrections", exact: true }).click();
    await page.getByRole("button", { name: "Correction history", exact: true }).click();
    const correctionRow = page.getByRole("article").filter({ hasText: reason });
    await expect(correctionRow).toContainText("Reversed");
    await page.screenshot({ path: testInfo.outputPath("owner-inventory-payment-reversed.png"), fullPage: true });
    await correctionRow.getByRole("link", { name: "Open source module", exact: true }).click();
    const billRow = page.locator(`#payable-row-${bill.id}`);
    await expect(billRow).toContainText("USD 40.00");
    await payment(40, `QC-REPAY-${suffix}`);
    await reconcile("re-payment restores settled state", { due: 0, cash: 940, quantity: 10, journals: 6, movements: 1 });
    const repaidHistory = await api(page, `/api/accounting/payables/${bill.id}/payments`);
    expect(repaidHistory).toHaveLength(3);
    expect(repaidHistory.filter((item) => item.status === "reversed")).toHaveLength(1);
    expect(repaidHistory.filter((item) => item.status === "posted").reduce((sum, item) => sum + Number(item.amount), 0)).toBe(60);
  });

  await page.goto("/dashboard/inventory");
  await expect(page.getByText("Loading inventory…", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Stock on hand", exact: true }).click();
  async function adjustment(delta, reason, succeeds = true) {
    await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
    await page.getByLabel("Product", { exact: true }).selectOption(product.id);
    await page.getByLabel("Warehouse", { exact: true }).selectOption(warehouse.id);
    await page.getByLabel("Quantity change (+ add / - remove)", { exact: true }).fill(String(delta));
    if (delta > 0) await page.getByLabel("Unit cost for stock added", { exact: true }).fill("6");
    await page.getByLabel("Reason", { exact: true }).fill(reason);
    await page.getByLabel("Reference", { exact: true }).fill(`QC-ADJUST-${suffix}-${delta}`);
    if (succeeds) {
      await postUi(page, "/api/inventory/adjustments", page.getByRole("button", { name: "Post adjustment", exact: true }));
      await expect(page).toHaveURL(/\/dashboard\/inventory\?(?=.*tab=stock)/);
      await expect(page.getByRole("row").filter({ hasText: names.product })).toBeVisible();
    } else {
      const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/inventory/adjustments" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Post adjustment", exact: true }).click();
      const response = await pending;
      expect(response.status()).toBe(409);
      const result = await response.json();
      expect(result.detail).toMatch(/insufficient|not enough|negative/i);
      await expect(page.locator("body")).toContainText(result.detail);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  }
  await test.step("Post +1/-1 inventory adjustments and reject an overdraw without side effects", async () => {
    await adjustment(1, "Synthetic owner counted one additional unit");
    await reconcile("positive adjustment", { due: 0, cash: 940, quantity: 11, gain: 6, journals: 7, movements: 2 });
    await adjustment(-1, "Synthetic owner damaged unit removed");
    await reconcile("negative adjustment", { due: 0, cash: 940, quantity: 10, gain: 6, loss: 6, journals: 8, movements: 3 });
    await adjustment(-11, "Synthetic overdraw must be rejected", false);
    await reconcile("rejected overdraw unchanged", { due: 0, cash: 940, quantity: 10, gain: 6, loss: 6, journals: 8, movements: 3 });
    await page.getByRole("button", { name: "Movements", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: names.product })).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("owner-inventory-stock-movements.png"), fullPage: true });
  });
  await test.step("Create, edit and disable a fixed-term service without affecting stock or ledgers", async () => {
    const serviceSku = `QC-SERVICE-${suffix.toUpperCase()}`;
    const serviceName = `QC Fictional Maintenance ${suffix}`;
    await page.getByRole("button", { name: "Products & services", exact: true }).click();
    await page.getByRole("button", { name: "Add item", exact: true }).first().click();
    await page.getByLabel("Item type", { exact: true }).selectOption("service");
    await page.getByLabel("SKU / Code", { exact: true }).fill(serviceSku);
    await page.getByLabel("Name", { exact: true }).fill(serviceName);
    await page.getByLabel("Selling price", { exact: true }).fill("75");
    await page.getByLabel(/^Service duration/).selectOption("fixed");
    await page.getByLabel(/^Duration \(months\)/).fill("3");
    await expect(page.getByLabel("Standard unit cost", { exact: true })).toHaveCount(0);
    const form = page.locator("form").filter({ has: page.getByLabel("SKU / Code", { exact: true }) });
    const service = await postUi(page, "/api/inventory/products", form.getByRole("button", { name: "Add item", exact: true }));
    await expect(page.getByRole("row").filter({ hasText: serviceSku })).toBeVisible();
    const serviceRow = page.getByRole("row").filter({ hasText: serviceSku });
    await expect(serviceRow).toContainText("3 months");
    await expect(serviceRow.getByRole("cell").nth(6)).toHaveText("—");
    const serviceProduct = (await api(page, "/api/inventory/products")).find((item) => item.id === service.id);
    expect(serviceProduct.track_inventory).toBe(false);
    expect(Number(serviceProduct.on_hand)).toBe(0);
    expect(Number(serviceProduct.inventory_value)).toBe(0);
    expect((await api(page, "/api/services/catalog")).find((item) => item.product_id === service.id).duration_months).toBe(3);

    await serviceRow.getByRole("button", { name: /^Edit / }).click();
    await expect(page.getByLabel(/^Duration \(months\)/)).toHaveValue("3");
    await page.getByLabel("Name", { exact: true }).fill(`${serviceName} Updated`);
    await page.getByLabel("Selling price", { exact: true }).fill("90");
    await page.getByLabel(/^Duration \(months\)/).fill("6");
    await postUi(page, `/api/inventory/products/${service.id}`, form.getByRole("button", { name: "Update item", exact: true }), "PATCH");
    await expect(page.getByRole("row").filter({ hasText: `${serviceName} Updated` })).toBeVisible();
    await expect(serviceRow).toContainText("6 months");
    await expect(serviceRow).toContainText("USD 90.00");
    await page.reload();
    await page.getByRole("button", { name: "Products & services", exact: true }).click();
    await expect(serviceRow).toContainText(`${serviceName} Updated`);
    await expect(serviceRow).toContainText("6 months");
    await postUi(page, `/api/inventory/products/${service.id}`, serviceRow.getByRole("button", { name: /^Disable / }), "PATCH");
    await expect(serviceRow.getByText("Inactive", { exact: true })).toBeVisible();
    await expect(serviceRow.getByRole("button", { name: /^Enable / })).toBeVisible();
    const serviceCatalog = await api(page, "/api/services/catalog?include_inactive=true");
    const savedService = serviceCatalog.find((item) => item.product_id === service.id);
    expect(savedService.duration_months).toBe(6);
    expect(savedService.is_active).toBe(false);
    expect(Number(savedService.selling_price)).toBe(90);
    expect((await api(page, "/api/services/catalog?include_inactive=false")).some((item) => item.product_id === service.id)).toBe(false);
    expect((await api(page, "/api/inventory/stock")).some((item) => item.product_id === service.id)).toBe(false);
    expect((await api(page, "/api/inventory/movements")).some((item) => item.product_id === service.id)).toBe(false);
    await reconcile("service catalog changes leave inventory/finance unchanged", { due: 0, cash: 940, quantity: 10, gain: 6, loss: 6, journals: 8, movements: 3 });
    snapshots.push({ label: "disabled fixed-term service", service: savedService });
    await page.screenshot({ path: testInfo.outputPath("owner-service-created-edited-disabled.png"), fullPage: true });
  });
  await test.step("Another authorized company cannot read this company's supplier payment history", async () => {
    const state = await page.context().storageState();
    const otherTenant = await playwrightRequest.newContext({
      baseURL: appUrl,
      storageState: { ...state, cookies: state.cookies.map((cookie) => cookie.name === "organization_id" ? { ...cookie, value: originalOrganizationId } : cookie) },
    });
    try {
      const response = await otherTenant.get(`/api/accounting/payables/${bill.id}/payments`);
      expect(response.status()).toBe(404);
      expect(await response.json()).toMatchObject({ detail: "Payable bill not found" });
    } finally {
      await otherTenant.dispose();
    }
  });
  await test.step("A committed adjustment with a lost browser response locks posting and only permits read-only review", async () => {
    await page.goto("/dashboard/inventory?tab=stock");
    await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
    await page.getByLabel("Product", { exact: true }).selectOption(product.id);
    await page.getByLabel("Warehouse", { exact: true }).selectOption(warehouse.id);
    await page.getByLabel("Quantity change (+ add / - remove)", { exact: true }).fill("1");
    await page.getByLabel("Unit cost for stock added", { exact: true }).fill("6");
    await page.getByLabel("Reason", { exact: true }).fill("Synthetic committed response lost once");
    await page.getByLabel("Reference", { exact: true }).fill(`QC-LOST-${suffix}`);
    let postingRequests = 0;
    const loseCommittedResponse = async route => {
      if (route.request().method() !== "POST") return route.continue();
      postingRequests += 1;
      try {
        expect(postingRequests, "Never forward a repeated financial write").toBe(1);
        expect(route.request().postDataJSON().quantity_delta).toBe("1");
        expect(route.request().postDataJSON().unit_cost).toBe("6");
        const upstream = await route.fetch({ maxRetries: 0 });
        expect(upstream.ok()).toBeTruthy();
        expect((await upstream.json()).status).toBe("posted");
      } finally { await route.abort("connectionreset"); }
    };
    await withInventoryTemporaryRoute(page, "**/api/inventory/adjustments", loseCommittedResponse, async () => {
      const failedBrowserRequest = observeInventoryRequestFailure(page, request => new URL(request.url()).pathname === "/api/inventory/adjustments" && request.method() === "POST");
      await page.getByRole("button", { name: "Post adjustment", exact: true }).click();
      await failedBrowserRequest();
      await expect(page.getByRole("heading", { name: "Posting outcome unknown", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Post adjustment", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Refresh read-only data", exact: true }).click();
      await expect(page.getByRole("button", { name: "Refresh read-only data", exact: true })).toBeEnabled();
      await expect(page.getByRole("heading", { name: "Posting outcome unknown", exact: true })).toBeVisible();
      expect(postingRequests).toBe(1);
      await reconcile("lost response commits exactly once without browser retry", { due: 0, cash: 940, quantity: 11, gain: 12, loss: 6, journals: 9, movements: 4 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("neutral-theme-inventory-unknown-post-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("neutral-theme-inventory-unknown-post-mobile.png") });
      // Explicit discard of the retained editor draft is navigation, never permission to repost.
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Review inventory records", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/inventory\?(?=.*tab=stock)/);
    });
  });
  const evidencePath = testInfo.outputPath("persisted-inventory-and-ledger-evidence.json");
  await writeFile(evidencePath, JSON.stringify({ names, snapshots }, null, 2));
  await testInfo.attach("persisted-inventory-and-ledger-evidence", { path: evidencePath, contentType: "application/json" });
  await test.step("Reversed supplier payment remains distinguishable in the owner payment history", async () => {
    await page.goto("/dashboard/accounting/payables");
    await page.locator("select").filter({ has: page.locator('option[value="paid"]') }).selectOption("paid");
    const billRow = page.locator(`#payable-row-${bill.id}`);
    await billRow.getByRole("link", { name: "View bill", exact: true }).click();
    const reversedPaymentCard = page.getByRole("article").filter({ hasText: `Reference: QC-FINAL-${suffix}` });
    await expect(reversedPaymentCard).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("owner-payable-history-after-reversal.png"), fullPage: true });
    await expect(reversedPaymentCard, "Reversed USD40 must not look like a current payment beside the replacement USD40").toContainText(/reversed/i);
  });
});
