import { captureJsonResponse } from "./support/capture-json-response.mjs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Real application + PostgreSQL journey. No synthetic API responses or direct
// database writes. Receipt instrumentation forwards once and releases real bytes. Company isolation and the explicit legacy-note regression fixture use API setup; normal business mutations below
// are performed through the owner UI and checked through persisted API reads.
const email = process.env.E2E_QC_EMAIL ?? "qc-owner@example.com";
const password = process.env.E2E_PASSWORD;

test.beforeEach(() => {
  expect(password, 'E2E_PASSWORD must be configured for the disposable CI fixture').toBeTruthy();
});
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

async function readJson(request, path) {
  const response = await request.get(path);
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function mutateViaUI(page, path, method, action) {
  return captureJsonResponse(page, { path, method, action });
}

async function choose(page, label, option) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("listbox").getByRole("button", { name: option }).click();
}

function expectMoney(actual, expected, label) {
  expect(Number(actual), label).toBeCloseTo(expected, 2);
}

function expectCommercialTotals(record) {
  expectMoney(record.subtotal, 370, "2 × 125 + 3 × 40 = 370 subtotal");
  expectMoney(record.discount_total, 25, "10% discount on first 250 line");
  expectMoney(record.tax_total, 22.5, "10% tax on discounted first line, 225");
  expectMoney(record.total, 367.5, "370 − 25 + 22.5 = 367.50 total");
}

test("fresh owner: client → quote → order → project → invoice → payments → reversal → financial reports", async ({ page, context }, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(baseURL).hostname);
  const marker = `QC-COM-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const evidence = { marker, setup: "Isolated company through real organization API", uiActions: [], records: {} };
  const pageErrors = [];
  const failedAPI = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/") && response.status() >= 400) {
      failedAPI.push(`${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()}`);
    }
  });

  let client;
  let quotation;
  let order;
  let project;
  let invoice;
  let account;
  const payments = [];

  try {
    await test.step("Login and isolate a fresh company (API setup only)", async () => {
      await page.goto("/login");
      await page.getByLabel(/email or username/i).fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: /sign in securely/i }).click();
      await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 30_000 });

      const created = await context.request.post("/api/organizations", { data: {
        name: marker,
        country_code: "BD",
        timezone: "UTC",
        currency: "BDT",
        business_type: "Software & IT Services",
        team_size: "1-5",
        financial_year_start_month: 1,
      } });
      expect(created.ok(), await created.text()).toBeTruthy();
      const membership = await created.json();
      evidence.records.organizationId = membership.organization.id;
      const cookies = await context.cookies();
      expect(cookies.find((cookie) => cookie.name === "organization_id")?.value).toBe(membership.organization.id);
      await page.goto("/dashboard/company");
      await expect(page.locator("main").first()).toContainText(marker);
    });

    await test.step("Create a synthetic client through owner UI", async () => {
      await page.goto("/dashboard/clients");
      await page.getByRole("button", { name: "Add client", exact: true }).click();
      await page.getByLabel("Display name", { exact: true }).fill(`${marker} Client`);
      // No email is needed; this fixture cannot receive client communications.
      await page.getByLabel("Contact person", { exact: true }).fill("Synthetic QC Contact");
      client = await mutateViaUI(page, "/api/crm/clients", "POST", () =>
        page.getByRole("button", { name: "Create client", exact: true }).click());
      await expect(page.getByText("Client created", { exact: true })).toBeVisible();
      const persisted = await readJson(context.request, `/api/crm/clients/${client.id}/detail`);
      expect(persisted.display_name).toBe(`${marker} Client`);
      expect(persisted.email).toBeNull();
      evidence.records.clientId = client.id;
      evidence.uiActions.push("Created client without email or portal access");
    });

    await test.step("Create two-line discounted/taxed quotation and verify arithmetic", async () => {
      await page.goto("/dashboard/quotations");
      await page.getByRole("link", { name: "New quotation", exact: true }).click();
      await choose(page, "Client", `${marker} Client`);
      await page.getByLabel("Subject / project", { exact: true }).fill(`${marker} Implementation`);
      await page.getByLabel(/^Tax calculation/).selectOption("exclusive");
      await page.getByLabel("Item / service name", { exact: true }).fill("Implementation service");
      await page.getByLabel("Description", { exact: true }).fill("Synthetic implementation, no external fulfillment");
      await page.getByLabel("Quantity", { exact: true }).fill("2");
      await page.getByLabel("Unit price", { exact: true }).fill("125");
      await page.getByLabel("Discount %", { exact: true }).fill("10");
      await page.getByLabel("Tax %", { exact: true }).fill("10");
      await page.getByRole("button", { name: "Add line", exact: true }).click();
      await page.getByLabel("Item / service name", { exact: true }).nth(1).fill("Support service");
      await page.getByLabel("Description", { exact: true }).nth(1).fill("Synthetic support");
      await page.getByLabel("Quantity", { exact: true }).nth(1).fill("3");
      await page.getByLabel("Unit price", { exact: true }).nth(1).fill("40");
      await page.getByLabel("Discount %", { exact: true }).nth(1).fill("0");
      await page.getByLabel("Tax %", { exact: true }).nth(1).fill("0");
      await expect(page.getByText("BDT 367.50", { exact: true }).first()).toBeVisible();
      quotation = await mutateViaUI(page, "/api/sales/quotations", "POST", () =>
        page.getByRole("button", { name: "Create draft", exact: true }).click());
      await expect(page).toHaveURL(new RegExp(`/dashboard/quotations/${quotation.id}(?:\\?.*)?$`));
      await expect(page.getByRole("button", { name: "Mark sent", exact: true })).toBeVisible();
      const persisted = await readJson(context.request, `/api/sales/quotations/${quotation.id}`);
      expectCommercialTotals(persisted);
      expect(persisted.items).toHaveLength(2);
      expectMoney(persisted.items[0].line_total, 247.5, "Discounted/taxed first line");
      expectMoney(persisted.items[1].line_total, 120, "Untaxed second line");
      expect(persisted.client_id).toBe(client.id);
      evidence.records.quotationId = quotation.id;
      evidence.uiActions.push("Created quotation: subtotal 370, discount 25, tax 22.50, total BDT 367.50");
    });

    await test.step("Preserve legacy notes and terms during normal V2 edit/save", async () => {
      // Explicit legacy fixture: these persisted API fields are not editable in V2.
      const legacy = { notes: "Legacy note — বাংলা", terms_conditions: "Synthetic legacy terms; no external commitment" };
      const seeded = await context.request.patch(`/api/sales/quotations/${quotation.id}`, {
        headers: { Origin: baseURL }, data: legacy,
      });
      expect(seeded.status()).toBe(200);
      await page.getByRole("link", { name: "Edit draft", exact: true }).click();
      await page.getByLabel("Subject / project", { exact: true }).fill(`${marker} Implementation revised`);
      await page.getByLabel("Unit price", { exact: true }).first().fill("125.0001");
      await expect(page.getByLabel("Unit price", { exact: true }).first()).toHaveValue("125.0001");
      await mutateViaUI(page, `/api/sales/quotations/${quotation.id}`, "PATCH", () =>
        page.getByRole("button", { name: "Save draft", exact: true }).click());
      await expect(page.getByRole("button", { name: "Mark sent", exact: true })).toBeVisible();
      const persisted = await readJson(context.request, `/api/sales/quotations/${quotation.id}`);
      expect(persisted).toMatchObject(legacy);
      expect(persisted.items[0].unit_price).toBe("125.0001");
      expectCommercialTotals(persisted);
      evidence.uiActions.push("V2 edit/save preserved existing legacy notes and terms without rewriting them");
    });

    await test.step("Mark quotation sent/accepted and convert it into an order", async () => {
      // Status actions only: these endpoints do not send email or invoke payment providers.
      await mutateViaUI(page, `/api/sales/quotations/${quotation.id}/status`, "PATCH", () =>
        page.getByRole("button", { name: "Mark sent", exact: true }).click());
      const revisionOpener = page.getByRole("button", { name: "Create revision", exact: true });
      await revisionOpener.click();
      const revisionDialog = page.getByRole("dialog", { name: "Create quotation revision", exact: true });
      const reason = revisionDialog.getByLabel("Revision reason", { exact: true });
      await expect(reason).toBeFocused();
      const revisionSubmit = revisionDialog.getByRole("button", { name: "Create draft revision", exact: true });
      await revisionSubmit.focus();
      await page.keyboard.press("Tab");
      await expect(reason).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(revisionSubmit).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("neutral-theme-quotation-revision-desktop.png"), fullPage: false });
      await page.keyboard.press("Escape");
      await expect(revisionDialog).not.toBeVisible();
      await expect(revisionOpener).toBeFocused();
      const originalViewport = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 844 });
      await revisionOpener.click();
      await expect(reason).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("neutral-theme-quotation-revision-mobile.png"), fullPage: false });
      await page.keyboard.press("Escape");
      await expect(revisionDialog).not.toBeVisible();
      if (originalViewport) await page.setViewportSize(originalViewport);
      await mutateViaUI(page, `/api/sales/quotations/${quotation.id}/status`, "PATCH", () =>
        page.getByRole("button", { name: "Accept", exact: true }).click());
      await expect(page.getByText("This revision is immutable.", { exact: false })).toBeVisible();
      await expect(page.getByRole("link", { name: "Edit draft", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Create / view order", exact: true }).click();
      order = await mutateViaUI(page, `/api/sales/orders/from-quotation/${quotation.id}`, "POST", () =>
        page.getByRole("button", { name: "Create Order", exact: true }).click());
      await expect(page).toHaveURL(new RegExp(`/dashboard/orders/${order.id}(?:\\?.*)?$`));
      const persisted = await readJson(context.request, `/api/sales/orders/${order.id}`);
      expectCommercialTotals(persisted);
      expect(persisted.quotation_id).toBe(quotation.id);
      expect(persisted.client_id).toBe(client.id);
      expect(persisted.status).toBe("confirmed");
      evidence.records.orderId = order.id;
      evidence.uiActions.push("Accepted immutable quotation and converted it to a correctly linked order");
    });

    await test.step("Create a linked delivery project and complete order execution", async () => {
      await page.getByRole("link", { name: "Project workspace", exact: true }).click();
      await page.getByRole("button", { name: "Create project", exact: true }).click();
      await page.getByLabel("Project name", { exact: true }).fill(`${marker} Project`);
      project = await mutateViaUI(page, `/api/projects/from-order/${order.id}`, "POST", () =>
        page.getByRole("button", { name: "Create project", exact: true }).click());
      await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${project.id}(?:\\?.*)?$`));
      const persisted = await readJson(context.request, `/api/projects/${project.id}`);
      expect(persisted.order_id).toBe(order.id);
      expect(persisted.client_id).toBe(client.id);
      expectMoney(persisted.contract_value, 367.5, "Project preserves the contract value");
      await page.goto(`/dashboard/orders/${order.id}`);
      await mutateViaUI(page, `/api/sales/orders/${order.id}/status`, "PATCH", () =>
        page.getByRole("button", { name: "Start order", exact: true }).click());
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        expect(dialog.message()).toContain("Complete this order?");
        await dialog.accept();
      });
      await mutateViaUI(page, `/api/sales/orders/${order.id}/status`, "PATCH", () =>
        page.getByRole("button", { name: "Complete order", exact: true }).click());
      expect((await readJson(context.request, `/api/sales/orders/${order.id}`)).status).toBe("completed");
      evidence.records.projectId = project.id;
      evidence.uiActions.push("Created linked project, started and completed service order");
    });

    await test.step("Create a synthetic cash account through owner UI", async () => {
      await page.goto("/dashboard/accounting/accounts");
      await page.getByRole("link", { name: "Add account", exact: true }).click();
      await page.getByLabel("Account type", { exact: false }).selectOption("cash");
      await page.getByLabel("Account name", { exact: true }).fill(`${marker} Cash`);
      account = await mutateViaUI(page, "/api/accounting/financial-accounts", "POST", () =>
        page.getByRole("button", { name: "Create account", exact: true }).click());
      await expect(page).toHaveURL(new RegExp(`/dashboard/accounting/accounts/${account.id}(?:\\?.*)?$`));
      await expect(page.getByRole("heading", { name: `${marker} Cash`, exact: true })).toBeVisible();
      const persisted = (await readJson(context.request, "/api/finance/accounts")).find((item) => item.id === account.id);
      expect(persisted).toBeTruthy();
      expectMoney(persisted.current_balance, 0, "Synthetic cash starts at zero");
      evidence.records.accountId = account.id;
      evidence.uiActions.push("Created a local bookkeeping cash account with zero opening balance");
    });

    await test.step("Create project invoice and lock its commercial snapshot", async () => {
      await page.goto("/dashboard/accounting/invoices");
      await page.getByRole("button", { name: "New invoice", exact: true }).click();
      await choose(page, "Project", `${marker} Project`);
      invoice = await mutateViaUI(page, `/api/finance/invoices/from-project/${project.id}`, "POST", () =>
        page.getByRole("button", { name: "Create draft invoice", exact: true }).click());
      await expect(page.getByText(`Invoice ${invoice.invoice_number} created as draft with your selected payment instructions. Review it before sending.`, { exact: true })).toBeVisible();
      const persisted = await readJson(context.request, `/api/finance/invoices/${invoice.id}`);
      expectCommercialTotals(persisted);
      expect(persisted.order_id).toBe(order.id);
      expect(persisted.project_id).toBe(project.id);
      expect(persisted.client_id).toBe(client.id);
      expect(persisted.status).toBe("draft");
      await page.goto(`/dashboard/accounting/invoices/${invoice.id}`);
      await mutateViaUI(page, `/api/finance/invoices/${invoice.id}/status`, "PATCH", () =>
        page.getByRole("button", { name: "Send invoice", exact: true }).click());
      await expect(page.getByRole("link", { name: "Collect payment", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit draft", exact: true })).toHaveCount(0);
      evidence.records.invoiceId = invoice.id;
      evidence.uiActions.push("Created project invoice preserving quote/order totals and marked it sent (internal status only)");
    });

    for (const [amount, expectedPaid, expectedDue] of [[137.5, 137.5, 230], [230, 367.5, 0]]) {
      await test.step(`Record BDT ${amount.toFixed(2)} payment through Money In`, async () => {
        await page.goto(`/dashboard/accounting/money-in?invoice_id=${invoice.id}`);
        await choose(page, "Money received into", `${marker} Cash`);
        await page.getByLabel(/Amount received/).fill(String(amount));
        await page.getByLabel(/^Payment method/).selectOption("cash");
        await page.getByLabel("Reference (optional)", { exact: true }).fill(`${marker}-${amount}`);
        await page.getByRole("button", { name: "Review money received", exact: true }).click();
        const payment = await mutateViaUI(page, "/api/finance/payments", "POST", () =>
          page.getByRole("button", { name: "Confirm & record", exact: true }).click());
        payments.push(payment);
        await expect(page.getByRole("heading", { name: payment.payment_number, exact: true })).toBeVisible();
        await expect(page.getByText("The server confirmed the operation.", { exact: false })).toBeVisible();
        const persisted = await readJson(context.request, `/api/finance/invoices/${invoice.id}`);
        expectMoney(persisted.amount_paid, expectedPaid, "Persisted invoice amount paid");
        expectMoney(persisted.balance_due, expectedDue, "Persisted invoice balance due");
        expect(persisted.status).toBe(expectedDue ? "partially_paid" : "paid");
        const savedAccount = (await readJson(context.request, "/api/finance/accounts")).find((item) => item.id === account.id);
        expectMoney(savedAccount.current_balance, expectedPaid, "Cash account exactly matches receipts");
        evidence.uiActions.push(`Recorded bookkeeping receipt ${payment.payment_number}: BDT ${amount.toFixed(2)}`);
      });
    }

    await test.step("Reverse the first receipt without deleting its history", async () => {
      await page.goto(`/dashboard/accounting/invoices/${invoice.id}`);
      const row = page.getByRole("row").filter({ hasText: payments[0].payment_number });
      await row.getByRole("button", { name: "Reverse payment", exact: true }).click();
      await page.getByLabel(/Reason for reversal/).fill(`${marker}: synthetic receipt was recorded in error`);
      await page.getByRole("button", { name: "Review reversal", exact: true }).click();
      await mutateViaUI(page, "/api/accounting/corrections/reverse", "POST", () =>
        page.getByRole("button", { name: "Confirm reversal", exact: true }).click());
      await expect(page.getByText(new RegExp(`Payment ${payments[0].payment_number} reversed`))).toBeVisible();
      await expect(row).toContainText("Reversed");
      const persisted = await readJson(context.request, `/api/finance/invoices/${invoice.id}`);
      expectMoney(persisted.amount_paid, 230, "Reversal reduces paid amount only once");
      expectMoney(persisted.balance_due, 137.5, "Reversal reopens the exact receivable");
      expect(persisted.status).toBe("partially_paid");
      const paymentRead = await readJson(context.request, `/api/finance/payments?invoice_id=${invoice.id}&limit=100`);
      const rows = Array.isArray(paymentRead) ? paymentRead : paymentRead.items;
      expect(rows).toHaveLength(2);
      expect(rows.find((item) => item.id === payments[0].id).status).toBe("reversed");
      expect(rows.find((item) => item.id === payments[1].id).status).toBe("confirmed");
      const savedAccount = (await readJson(context.request, "/api/finance/accounts")).find((item) => item.id === account.id);
      expectMoney(savedAccount.current_balance, 230, "Account balance after reversal");
      evidence.records.paymentIds = payments.map((payment) => payment.id);
      evidence.uiActions.push("Reversed BDT 137.50 receipt; preserved both payment records, paid 230, due 137.50");
    });

    await test.step("Verify persisted financial reporting and reload durability", async () => {
      await page.goto("/dashboard/accounting/reports");
      await expect(page.getByRole("heading", { name: "Financial statements", exact: true })).toBeVisible();
      const statements = await readJson(context.request, "/api/accounting/reports/financial-statements");
      expectMoney(statements.total_income, 345, "Accrual income excludes tax and is not doubled by receipts");
      expectMoney(statements.total_expenses, 0, "No synthetic expenses");
      expectMoney(statements.net_profit, 345, "Net profit is unchanged by payment reversal");
      expectMoney(statements.total_assets, 367.5, "Cash 230 + receivables 137.50");
      expectMoney(statements.total_liabilities, 22.5, "Sales tax payable");
      expectMoney(statements.total_liabilities_and_equity, 367.5, "Balance sheet remains balanced");
      expectMoney(statements.cash_flow.net_change, 230, "Net cash includes the receipt reversal");
      evidence.records.finalFinancialStatements = statements;
      await page.reload();
      await expect(page.locator("body")).not.toContainText(/Internal Server Error|Could not load financial reports/);
      await page.goto(`/dashboard/accounting/invoices/${invoice.id}`);
      await expect(page.getByText("BDT 137.50", { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("invoice-after-reversal.png"), fullPage: true });
      expect(pageErrors, "No uncaught browser exceptions").toEqual([]);
      expect(failedAPI, "No business API HTTP errors during owner journey").toEqual([]);
      evidence.uiActions.push("Verified accrual reports, tax liability, net cash, balanced balance sheet, and reload durability");
    });

    await test.step("Follow order settlement links back to the invoice workspace", async () => {
      await page.goto(`/dashboard/orders/${order.id}`);
      const businessFlow = page.locator("section").filter({ has: page.getByRole("heading", { name: "Business flow", exact: true }) });
      await businessFlow.getByRole("link").filter({ hasText: invoice.invoice_number }).click();
      await expect(page).toHaveURL(/\/dashboard\/accounting\/invoices(?:\/[^/?]+)?(?:\?.*)?$/);
      await expect(page.getByRole("heading", { name: /^(Invoices|INV-)/ }).first()).toBeVisible();
      await page.goto(`/dashboard/orders/${order.id}`);
      const settlement = page.locator("section").filter({ has: page.getByRole("heading", { name: "Invoice & settlement", exact: true }) });
      await expect(settlement).toContainText(invoice.invoice_number);
      await settlement.getByRole("link", { name: "Open invoices", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/accounting\/invoices(?:\/[^/?]+)?(?:\?.*)?$/);
      await expect(page.getByRole("heading", { name: /^(Invoices|INV-)/ }).first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText("This page could not be found");
      await page.screenshot({ path: testInfo.outputPath("order-invoice-navigation.png"), fullPage: true });
      evidence.uiActions.push("Verified both Business flow and settlement links reach the invoice workspace");
    });
  } finally {
    evidence.pageErrors = pageErrors;
    evidence.failedAPI = failedAPI;
    await testInfo.attach("owner-commercial-real-backend-evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
  }
});
