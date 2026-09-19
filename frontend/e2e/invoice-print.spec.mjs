import { expect, test } from "@playwright/test";

const invoice = {
  id: "e2e-invoice",
  invoice_number: "INV-E2E-0001",
  client_id: "client-1",
  client_name: "Acme Client LLC",
  order_id: "order-1",
  project_id: "project-1",
  quotation_id: "quotation-1",
  status: "sent",
  display_status: "partially_paid",
  subject: "International SaaS implementation",
  issue_date: "2026-09-11",
  due_date: "2026-09-25",
  currency: "USD",
  tax_calculation_mode: "exclusive",
  seller_name_snapshot: "Seller Example Ltd",
  seller_email_snapshot: "billing@example.test",
  seller_address_snapshot: "100 Example Street\nCheyenne, WY",
  seller_tax_identifier_snapshot: "US-TAX-100",
  client_name_snapshot: "Acme Client LLC",
  client_contact_snapshot: "Jane Client",
  client_email_snapshot: "jane@client.test",
  client_address_snapshot: "200 Client Avenue\nAustin, TX",
  client_tax_identifier_snapshot: "CLIENT-TAX-200",
  subtotal: "5000.00",
  discount_total: "0.00",
  tax_total: "500.00",
  total: "5500.00",
  amount_paid: "1500.00",
  balance_due: "4000.00",
  notes: "Thank you for your business.",
  terms_conditions: "Payment is due according to the invoice schedule.",
  internal_notes: "Private accounting note that must never be printed.",
  sent_at: "2026-09-11T12:00:00Z",
  paid_at: null,
  cancelled_at: null,
  created_at: "2026-09-11T10:00:00Z",
  items: [
    {
      id: "item-1",
      source_order_item_id: "order-item-1",
      product_id: "product-1",
      sort_order: 0,
      item_name_snapshot: "SaaS implementation",
      sku_snapshot: "SAAS-001",
      item_type_snapshot: "service",
      unit_snapshot: "project",
      description: "Full-stack product implementation and production delivery.",
      quantity: "1.00",
      unit_price: "5000.00",
      discount_percent: "0.00",
      tax_rate: "10.00",
      line_subtotal: "5000.00",
      discount_amount: "0.00",
      taxable_amount: "5000.00",
      tax_amount: "500.00",
      line_total: "5500.00",
    },
  ],
};

const payment = {
  invoice_id: "e2e-invoice",
  invoice_number: "INV-E2E-0001",
  invoice_status: "sent",
  invoice_currency: "USD",
  payment_method: "payoneer",
  payment_account_id: "account-1",
  payment_account_name: "USD Payoneer Wallet",
  payment_provider: "Payoneer",
  payment_account_holder: "Seller Example Ltd",
  payment_account_reference: "US123456789",
  payment_currency: "USD",
  payment_url: "https://payoneer.example.test/pay/INV-E2E-0001",
  payment_instructions: "Please include the invoice number as your payment reference.",
  locked: true,
};

test("Invoice print page renders a tenant-safe professional client document", async ({ page }) => {
  await page.route("**/api/finance/invoices/e2e-invoice", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(invoice),
    });
  });

  await page.route("**/api/finance/invoices/e2e-invoice/payment-instructions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payment),
    });
  });

  const response = await page.goto("/print/invoices/e2e-invoice", { waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);

  await expect(page.getByRole("heading", { name: "INV-E2E-0001" })).toBeVisible();
  await expect(page).toHaveTitle("INV-E2E-0001");
  await expect(page.getByText("Seller Example Ltd").first()).toBeVisible();
  await expect(page.getByText("Acme Client LLC").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "International SaaS implementation" })).toBeVisible();
  await expect(page.getByText("USD 4,000.00").first()).toBeVisible();
  await expect(page.getByText("SaaS implementation", { exact: true })).toBeVisible();
  await expect(page.getByText("SAAS-001")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payment instructions" })).toBeVisible();
  await expect(page.getByText("Payoneer", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("US123456789")).toBeVisible();
  await expect(page.getByText("Scan to pay")).toBeVisible();
  await expect(page.getByText("Thank you for your business.")).toBeVisible();
  await expect(page.getByText("Payment is due according to the invoice schedule.")).toBeVisible();

  await expect(page.getByText("Private accounting note that must never be printed.")).toHaveCount(0);
  await expect(page.getByText(/CodeStation AI Business OS/i)).toHaveCount(0);

  await expect(page.locator(".print-actions").first()).toBeVisible();
  await page.setViewportSize({ width: 735, height: 1050 });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-actions").first()).toBeHidden();
  await expect(page.getByRole("link", { name: payment.payment_url })).toBeVisible();
  await expect(page.locator('svg[aria-label="QR code for invoice payment link"]')).toBeVisible();

  const printMetrics = await page.evaluate(() => {
    const sheet = document.querySelector(".print-sheet");
    const qr = document.querySelector('svg[aria-label="QR code for invoice payment link"]');
    const summary = document.querySelector(".invoice-summary-card");
    const paymentCard = document.querySelector(".payment-card");
    if (!sheet || !qr || !summary || !paymentCard) {
      throw new Error("Expected compact invoice print blocks were not found");
    }

    return {
      sheetHeight: sheet.getBoundingClientRect().height,
      sheetFontSize: Number.parseFloat(getComputedStyle(sheet).fontSize),
      qrWidth: qr.getBoundingClientRect().width,
      summaryMarginTop: Number.parseFloat(getComputedStyle(summary).marginTop),
      paymentPaddingTop: Number.parseFloat(getComputedStyle(paymentCard).paddingTop),
    };
  });

  // A representative one-item invoice with payment instructions, QR, notes and terms should fit one A4 content page.
  expect(printMetrics.sheetHeight).toBeLessThanOrEqual(1050);
  expect(printMetrics.sheetFontSize).toBeLessThanOrEqual(11);
  expect(printMetrics.qrWidth).toBeLessThanOrEqual(90);
  expect(printMetrics.summaryMarginTop).toBeLessThan(14);
  expect(printMetrics.paymentPaddingTop).toBeLessThan(16);
});

test("Client invoice PDF includes the saved Payoneer link and scannable QR", async ({ page }) => {
  // Unlike the dedicated print route, the client workspace requires a signed-in session.
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(process.env.E2E_EMAIL ?? "e2e-owner@example.com");
  await page.locator('input[name="password"]').fill(process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!");
  await page.getByRole("button", { name: /sign in securely/i }).click();
  await expect(page).toHaveURL(/\\/dashboard(?:$|\\/|\\?)/, { timeout: 15_000 });

  const portalInvoice = {
    ...invoice,
    seller_name: invoice.seller_name_snapshot,
    seller_email: invoice.seller_email_snapshot,
    seller_address: invoice.seller_address_snapshot,
    client_name: invoice.client_name_snapshot,
    client_contact: invoice.client_contact_snapshot,
    client_email: invoice.client_email_snapshot,
    client_address: invoice.client_address_snapshot,
    payment_method: payment.payment_method,
    payment_account_name: payment.payment_account_name,
    payment_provider: payment.payment_provider,
    payment_account_holder: payment.payment_account_holder,
    payment_account_reference: payment.payment_account_reference,
    payment_currency: payment.payment_currency,
    payment_url: payment.payment_url,
    payment_instructions: payment.payment_instructions,
    items: invoice.items.map((item) => ({
      ...item,
      item_name: item.item_name_snapshot,
      unit: item.unit_snapshot,
    })),
  };
  await page.route("**/api/client-portal/invoices/e2e-invoice", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(portalInvoice) });
  });

  await page.goto("/dashboard/client/invoices/e2e-invoice/print", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Payment information" })).toBeVisible();
  await expect(page.getByRole("link", { name: payment.payment_url })).toHaveAttribute("href", payment.payment_url);
  await expect(page.locator('svg[aria-label="QR code for invoice payment link"]')).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("link", { name: payment.payment_url })).toBeVisible();
  await expect(page.locator('svg[aria-label="QR code for invoice payment link"]')).toBeVisible();
});
