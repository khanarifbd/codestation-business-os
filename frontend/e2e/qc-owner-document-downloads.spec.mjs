import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// API-only setup creates an isolated synthetic company and, where needed, its
// client/order/project. Uploads and download clicks are actual owner-browser UI
// actions against Next.js + FastAPI + PostgreSQL. No routes are intercepted.
const email = process.env.E2E_QC_EMAIL ?? "qc-owner@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";

test.beforeEach(async ({ page }) => { page.setDefaultTimeout(15_000); });

function syntheticPdf(label) {
  const content = `BT /F1 12 Tf 40 100 Td (Synthetic owner document QC: ${label}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

async function json(response, label) {
  const text = await response.text();
  expect(response.ok(), `${label}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return JSON.parse(text);
}

async function setup(page, kind) {
  const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL).hostname);
  await json(await page.request.post("/api/auth/login", { timeout: 15_000, data: { email, password } }), "API-only owner fixture login");
  const workspace = await json(await page.request.post("/api/organizations", { timeout: 15_000, data: {
    name: `QC document ${kind} ${randomUUID().slice(0, 8)}`,
    country_code: "US", timezone: "UTC", currency: "USD", business_type: "Synthetic QC fixture",
  } }), "API-only isolated organization setup");
  expect(workspace.is_owner).toBe(true);
  const people = await json(await page.request.get("/api/hr/people", { timeout: 15_000 }), "Read setup employee");
  expect(people.people).toHaveLength(1);
  return { organizationId: workspace.organization.id, employee: people.people[0] };
}

async function uploadThroughUI(page, path, button) {
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === path && item.request().method() === "POST");
  await button.click();
  return json(await response, `Owner UI upload ${path}`);
}

async function downloadThroughUI(page, button, expectedBytes, filename, testInfo, kind) {
  // A normal attachment may be emitted by the initiating tab or by a tab opened
  // by window.open. Observe both without changing the app's navigation behavior.
  const context = page.context();
  const watched = new Set();
  let timeout;
  let resolveDownload;
  let rejectDownload;
  const pending = new Promise((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject; });
  const onDownload = (download) => resolveDownload(download);
  const watch = (tab) => { watched.add(tab); tab.on("download", onDownload); };
  context.pages().forEach(watch);
  context.on("page", watch);
  timeout = setTimeout(() => rejectDownload(new Error(`${kind}: owner download click produced no browser download event in 15 seconds`)), 15_000);
  let download;
  try {
    [download] = await Promise.all([pending, button.click()]);
  } finally {
    clearTimeout(timeout);
    context.off("page", watch);
    for (const tab of watched) tab.off("download", onDownload);
  }
  expect(await download.failure(), `${kind}: browser download must complete`).toBeNull();
  expect(download.suggestedFilename()).toBe(filename);
  const savedPath = testInfo.outputPath(`${kind}-download.pdf`);
  await download.saveAs(savedPath);
  const saved = await readFile(savedPath);
  expect(saved.equals(expectedBytes), `${kind}: downloaded bytes must exactly match the uploaded synthetic PDF`).toBe(true);
  await testInfo.attach(`${kind}-download-evidence`, {
    body: Buffer.from(JSON.stringify({
      coverage: "Actual owner-browser upload, download event, saveAs and exact byte comparison",
      suggestedFilename: download.suggestedFilename(), url: download.url(),
      bytes: saved.length, sha256: createHash("sha256").update(saved).digest("hex"),
    }, null, 2)), contentType: "application/json",
  });
}

test("owner uploads and downloads company PDF with exact saved bytes", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await test.step("API-only isolated company setup", async () => { await setup(page, "company"); });
  const pdf = syntheticPdf("company");
  await page.goto("/dashboard/company");
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: "Document type", exact: true }).click();
  await page.getByRole("listbox").getByRole("button", { name: "Other / Custom" }).click();
  await page.getByLabel("Title", { exact: true }).fill("QC Company PDF");
  await page.locator('input[name="file"]').setInputFiles({ name: "qc-company-fixture.pdf", mimeType: "application/pdf", buffer: pdf });
  const document = await uploadThroughUI(page, "/api/company-settings/documents/upload", page.getByRole("button", { name: "Upload document", exact: true }));
  expect(document.title).toBe("QC Company PDF");
  await expect(page.getByText("Document uploaded", { exact: true })).toBeVisible();
  const link = page.getByRole("link", { name: "Download", exact: true });
  await expect(link).toHaveAttribute("href", `/api/company-settings/documents/${document.id}/file`);
  await downloadThroughUI(page, link, pdf, "QC-Company-PDF.pdf", testInfo, "company");
});

test("owner uploads and downloads employee HR PDF with exact saved bytes", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  let employee;
  await test.step("API-only isolated company and owner employee setup", async () => { ({ employee } = await setup(page, "HR")); });
  const pdf = syntheticPdf("employee-HR");
  await page.goto("/dashboard/hr/records");
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await page.getByRole("button", { name: "Employee", exact: true }).click();
  await page.getByRole("listbox").getByRole("button", { name: employee.employee_code }).click();
  await page.getByLabel("Document title", { exact: true }).fill("QC HR PDF");
  await page.getByRole("combobox", { name: /^Document type/ }).selectOption("other");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "qc-hr-fixture.pdf", mimeType: "application/pdf", buffer: pdf });
  const document = await uploadThroughUI(page, "/api/hr-documents/upload", page.getByRole("button", { name: "Upload securely", exact: true }));
  expect(document.file_url).toBe(`/api/hr-documents/${document.id}/file`);
  await expect(page.getByText("Employee document uploaded securely", { exact: true })).toBeVisible();
  await expect(page.getByText("QC HR PDF", { exact: true })).toBeVisible();
  await downloadThroughUI(page, page.getByRole("button", { name: "Open file", exact: true }), pdf, "qc-hr-fixture.pdf", testInfo, "employee-hr");
});

test("owner uploads and downloads project PDF with exact saved bytes", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  let project;
  await test.step("API-only isolated company, synthetic client, order and project setup", async () => {
    const { employee } = await setup(page, "project");
    const client = await json(await page.request.post("/api/crm/clients", { timeout: 15_000, data: { display_name: "Synthetic document QC client", currency: "USD" } }), "API-only client without email/portal");
    const order = await json(await page.request.post("/api/sales/orders", { timeout: 15_000, data: {
      client_id: client.id, subject: "Synthetic document QC order", order_date: new Date().toISOString().slice(0, 10), currency: "USD",
      items: [{ item_name: "Document QC", item_type: "service", description: "Local document storage QC fixture", quantity: "1", unit_price: "10.00" }],
    } }), "API-only synthetic order setup");
    project = await json(await page.request.post(`/api/projects/from-order/${order.id}`, { timeout: 15_000, data: {
      name: "Synthetic document QC project", project_manager_employee_id: employee.id,
    } }), "API-only synthetic project setup");
  });
  const pdf = syntheticPdf("project");
  await page.goto(`/dashboard/projects/${project.id}`);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("QC Project PDF");
  await page.getByRole("combobox", { name: /^Document type/ }).selectOption("other");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "qc-project-fixture.pdf", mimeType: "application/pdf", buffer: pdf });
  const document = await uploadThroughUI(page, `/api/projects/${project.id}/documents/upload`, page.getByRole("button", { name: "Save", exact: true }));
  expect(document.original_filename).toBe("qc-project-fixture.pdf");
  expect(document.size_bytes).toBe(pdf.length);
  await expect(page.getByText("Project document uploaded.", { exact: true })).toBeVisible();
  const card = page.locator("article").filter({ hasText: "QC Project PDF" });
  await downloadThroughUI(page, card.getByRole("button", { name: "Download", exact: true }), pdf, "QC-Project-PDF.pdf", testInfo, "project");
});
