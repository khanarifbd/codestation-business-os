import { expect, test } from "@playwright/test";

const quotation = {
  id: "e2e-quotation",
  quotation_number: "Q-E2E-0001",
  root_quotation_id: "e2e-root",
  supersedes_quotation_id: "e2e-revision-1",
  revision_number: 2,
  revision_reason: "Updated delivery and payment terms.",
  status: "sent",
  subject: "International SaaS implementation",
  project_title: "International SaaS Platform",
  executive_summary: "Design, implementation, testing, and production delivery of the agreed SaaS platform.",
  issue_date: "2026-09-11",
  valid_until: "2026-09-25",
  estimated_start_date: "2026-10-01",
  estimated_end_date: "2026-11-15",
  estimated_duration: "6 weeks",
  start_condition: "Project starts after quotation acceptance and the first scheduled payment.",
  currency: "USD",
  tax_calculation_mode: "exclusive",
  seller_name_snapshot: "Seller Example Ltd",
  seller_email_snapshot: "sales@example.test",
  seller_phone_snapshot: "+1 555 0100",
  seller_address_snapshot: "100 Example Street\nCheyenne, WY",
  seller_tax_identifier_snapshot: "US-TAX-100",
  client_name_snapshot: "Acme Client LLC",
  client_contact_snapshot: "Jane Client",
  client_email_snapshot: "jane@client.test",
  client_phone_snapshot: "+1 555 0200",
  client_address_snapshot: "200 Client Avenue\nAustin, TX",
  client_tax_identifier_snapshot: "CLIENT-TAX-200",
  prepared_by_name_snapshot: "A. Engineer",
  prepared_by_email_snapshot: "engineer@example.test",
  prepared_by_designation_snapshot: "Lead Software Engineer",
  subtotal: "5000.00",
  discount_total: "0.00",
  tax_total: "500.00",
  total: "5500.00",
  sent_at: "2026-09-11T12:00:00Z",
  accepted_at: null,
  rejected_at: null,
  cancelled_at: null,
  items: [
    {
      id: "item-1",
      sort_order: 0,
      item_name_snapshot: "SaaS implementation",
      sku_snapshot: "SAAS-001",
      item_type_snapshot: "service",
      unit_snapshot: "project",
      description: "Full-stack product implementation and delivery.",
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
  sections: [
    {
      id: "section-scope",
      section_type: "scope",
      title: "Scope of work",
      content: "Backend APIs, responsive web application, testing, and deployment readiness.",
      sort_order: 0,
      is_visible: true,
    },
    {
      id: "section-hidden",
      section_type: "additional_notes",
      title: "Private drafting note",
      content: "This text must never appear in the client document.",
      sort_order: 1,
      is_visible: false,
    },
  ],
  milestones: [
    {
      id: "milestone-1",
      title: "Production-ready release",
      description: "Complete the approved implementation and release candidate.",
      estimated_start_date: "2026-10-01",
      estimated_end_date: "2026-11-15",
      estimated_duration: "6 weeks",
      acceptance_criteria: "Approved client UAT and successful production readiness review.",
      sort_order: 0,
    },
  ],
  payment_milestones: [
    {
      id: "payment-1",
      quotation_milestone_id: "milestone-1",
      title: "Final delivery payment",
      description: "Balance due when the production-ready release is accepted.",
      payment_type: "percentage",
      percentage: "100.00",
      amount: "5500.00",
      due_condition: "on_milestone_acceptance",
      due_date: null,
      sort_order: 0,
    },
  ],
  created_at: "2026-09-10T12:00:00Z",
  updated_at: "2026-09-11T12:00:00Z",
};

test("Quotation V2 print page renders the client-safe commercial revision", async ({ page }) => {
  await page.route("**/api/sales/quotations/e2e-quotation/commercial", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(quotation),
    });
  });

  const response = await page.goto("/print/quotations/e2e-quotation", { waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);

  await expect(page.getByRole("heading", { name: "Q-E2E-0001" })).toBeVisible();
  await expect(page).toHaveTitle("Q-E2E-0001-R2");
  await expect(page.getByText("Acme Client LLC")).toBeVisible();
  await expect(page.getByRole("heading", { name: "International SaaS Platform" })).toBeVisible();
  await expect(page.getByText("USD 5,500.00").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scope of work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Production-ready release" })).toBeVisible();
  await expect(page.getByText("Final delivery payment")).toBeVisible();
  await expect(page.getByText("Due: On Milestone Acceptance")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quotation acceptance" })).toBeVisible();

  await expect(page.getByText("Private drafting note")).toHaveCount(0);
  await expect(page.getByText("This text must never appear in the client document.")).toHaveCount(0);
  await expect(page.getByText(/Generated by CodeStation AI Business OS/i)).toHaveCount(0);

  await expect(page.locator(".print-actions")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-actions")).toBeHidden();
});
