import { expect, test } from "@playwright/test";

const quotation = {
  id: "e2e-pagination-quotation",
  quotation_number: "Q-PAGE-0001",
  root_quotation_id: "e2e-pagination-root",
  supersedes_quotation_id: null,
  revision_number: 1,
  revision_reason: null,
  status: "sent",
  subject: "Mobile App Development",
  project_title: "Mobile App Development",
  executive_summary: null,
  issue_date: "2026-09-12",
  valid_until: "2026-10-12",
  estimated_start_date: null,
  estimated_end_date: null,
  estimated_duration: null,
  start_condition: null,
  currency: "USD",
  tax_calculation_mode: "exclusive",
  seller_name_snapshot: "Seller Example Ltd",
  seller_email_snapshot: "sales@example.test",
  seller_phone_snapshot: "+1 555 0100",
  seller_address_snapshot: "100 Example Street\nCheyenne, WY",
  seller_tax_identifier_snapshot: null,
  client_name_snapshot: "Position Rank Agency LLC",
  client_contact_snapshot: "Ahmed Adeoshun",
  client_email_snapshot: "hello@example.test",
  client_phone_snapshot: "+1 555 0200",
  client_address_snapshot: "2933 Vauxhall Road\nUnited States",
  client_tax_identifier_snapshot: null,
  prepared_by_name_snapshot: "A. Engineer",
  prepared_by_email_snapshot: "engineer@example.test",
  prepared_by_designation_snapshot: "Lead Engineer",
  subtotal: "750.00",
  discount_total: "225.00",
  tax_total: "0.00",
  total: "525.00",
  sent_at: "2026-09-12T12:00:00Z",
  accepted_at: null,
  rejected_at: null,
  cancelled_at: null,
  items: [
    {
      id: "item-1",
      sort_order: 0,
      item_name_snapshot: "Native Mobile App",
      sku_snapshot: null,
      item_type_snapshot: "service",
      unit_snapshot: "unit",
      description: "Native mobile app development with push notification and app submission.",
      quantity: "1.00",
      unit_price: "750.00",
      discount_percent: "30.00",
      tax_rate: "0.00",
      line_subtotal: "750.00",
      discount_amount: "225.00",
      taxable_amount: "525.00",
      tax_amount: "0.00",
      line_total: "525.00",
    },
  ],
  sections: [],
  milestones: [],
  payment_milestones: [],
  created_at: "2026-09-12T10:00:00Z",
  updated_at: "2026-09-12T12:00:00Z",
};

test("Quotation print mode uses compact A4 spacing and keeps pricing totals attached", async ({ page }) => {
  await page.route("**/api/sales/quotations/e2e-pagination-quotation/commercial", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(quotation),
    });
  });

  const response = await page.goto("/print/quotations/e2e-pagination-quotation", {
    waitUntil: "domcontentloaded",
  });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);

  await expect(page.getByRole("heading", { name: "Q-PAGE-0001" })).toBeVisible();
  await page.emulateMedia({ media: "print" });

  const layout = await page.evaluate(() => {
    const sheet = document.querySelector(".print-sheet");
    if (!sheet) throw new Error("Print sheet not found");

    const header = sheet.querySelector(":scope > header");
    const partyRow = sheet.querySelector(":scope > header + section");
    const tableSection = Array.from(sheet.querySelectorAll(":scope > section")).find((section) =>
      section.querySelector(":scope > table"),
    );
    const totals = tableSection?.nextElementSibling;

    if (!header || !partyRow || !tableSection || !totals) {
      throw new Error("Expected quotation print blocks were not found");
    }

    return {
      headerPaddingBottom: Number.parseFloat(getComputedStyle(header).paddingBottom),
      partyMarginTop: Number.parseFloat(getComputedStyle(partyRow).marginTop),
      tableBreakAfter: getComputedStyle(tableSection).breakAfter,
      totalsBreakBefore: getComputedStyle(totals).breakBefore,
      totalsPaddingTop: Number.parseFloat(getComputedStyle(totals).paddingTop),
    };
  });

  expect(layout.headerPaddingBottom).toBeLessThan(20);
  expect(layout.partyMarginTop).toBeLessThan(20);
  expect(["avoid", "avoid-page"]).toContain(layout.tableBreakAfter);
  expect(["avoid", "avoid-page"]).toContain(layout.totalsBreakBefore);
  expect(layout.totalsPaddingTop).toBeLessThan(20);
});
