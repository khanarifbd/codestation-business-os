import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// FIN29 original ledger/source/reference UI controls, plus FIN22 statement UI.
// Real authenticated Next proxy + FastAPI + local PostgreSQL, no interception.
// This one fresh synthetic workspace is deliberately retained for evidence.
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 1100 } });
const email = process.env.E2E_QC_FINANCIAL_UX_EMAIL ?? "qc-financial-ux@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";
const today = new Date().toISOString().slice(0, 10);
async function api(page, method, path, data, status) {
  const response = await page.request.fetch(`/api${path}`, { method, data });
  const text = await response.text();
  if (status !== undefined) expect(response.status(), `${method} ${path}: ${text}`).toBe(status);
  else expect(response.ok(), `${method} ${path}: ${response.status()} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

test("FIN29 real owner historical trial, ledger search, source filters and rejected reference; FIN22 full statement filters", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await api(page, "POST", "/auth/login", { email, password });
  const marker = randomUUID().slice(0, 8);
  const workspace = await api(page, "POST", "/organizations", { name: `QC FIN29 ledger ${marker}`, currency: "USD", country_code: "US", timezone: "UTC" });
  expect((await api(page, "GET", "/tenant")).organization.id).toBe(workspace.organization.id);
  const eur = await api(page, "POST", "/accounting/financial-accounts", { name: `Synthetic EUR ${marker}`, account_type: "bank", currency: "EUR", opening_balance: "0" });
  await api(page, "POST", "/accounting/assets", { asset_code: `HIST-${marker}`, name: "Synthetic historical opening120", currency: "USD", acquisition_cost: "120", salvage_value: "0", acquisition_date: "2026-09-20", in_service_date: "2026-09-20", useful_life_months: 24, record_mode: "opening", opening_balance_date: "2026-09-20" });
  const ledgers = [];
  for (let i = 0; i < 2; i++) ledgers.push(await api(page, "POST", "/accounting/chart-of-accounts", { code: `QC${i}`, name: `Synthetic noncash ${i}`, category: "asset", normal_balance: "debit" }));
  function journal(reference) { return { entry_date: "2026-10-20", reference, lines: ledgers.map((ledger, i) => ({ ledger_account_id: ledger.id, currency: "USD", original_amount: "7", [i === 0 ? "debit" : "credit"]: "7" })) }; }
  const originals = [], reversals = [];
  for (let i = 0; i < 3; i++) {
    const original = await api(page, "POST", "/accounting/journals", journal(`ACCEPTED-${marker}-${i}`));
    originals.push(original);
    reversals.push(await api(page, "POST", `/accounting/journals/${original.id}/reverse`));
  }
  const period = await api(page, "POST", "/finance/accounting-periods", { name: `Synthetic closed period ${marker}`, start_date: "2026-10-20", end_date: "2026-10-20" });
  await api(page, "POST", `/finance/accounting-periods/${period.id}/close`, {});
  const beforeRejected = await api(page, "GET", "/accounting/journals?limit=200");
  const beforeTrial = await api(page, "GET", "/accounting/trial-balance?as_of=2026-10-20");
  const rejectedReference = `REJECTED-CLOSED-${marker}`;
  const rejection = await api(page, "POST", "/accounting/journals", journal(rejectedReference), 409);
  expect(rejection.detail).toMatch(/closed/i);
  expect(await api(page, "GET", "/accounting/journals?limit=200")).toEqual(beforeRejected);
  expect(await api(page, "GET", "/accounting/trial-balance?as_of=2026-10-20")).toEqual(beforeTrial);
  await api(page, "POST", `/finance/accounting-periods/${period.id}/reopen`, { reason: "Synthetic reasoned reopening after rejected reference check" });
  expect(beforeRejected).toHaveLength(7);
  expect(beforeRejected.filter(row => row.source_type === "reversal").map(row => row.id).sort()).toEqual(reversals.map(row => row.id).sort());

  await page.goto("/dashboard/accounting/advanced");
  const trialRows = page.locator(".ad-trial-row");
  const journalRows = page.locator(".ad-journal-row");
  const apply = async () => {
    const filters = await page.locator(".ad-filters").evaluate(form => Object.fromEntries(new FormData(form)));
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect.poll(() => {
      const query = new URL(page.url()).searchParams;
      return Object.keys(filters).map(key => query.get(key) || (key === "source" ? "all" : ""));
    }).toEqual(Object.values(filters));
  };
  await expect(page.getByPlaceholder("Code, name or category")).toBeVisible();
  const asOf = page.locator('input[type="date"]').first();
  for (const [day, total] of [["2026-08-20", 0], ["2026-09-20", 120], ["2026-10-20", 162]]) {
    await asOf.fill(day);
    const waiting = page.waitForResponse(response => new URL(response.url()).pathname === "/api/accounting/trial-balance" && new URL(response.url()).searchParams.get("as_of") === day);
    await apply();
    const result = await (await waiting).json();
    expect([Number(result.total_debit), Number(result.total_credit)]).toEqual([total, total]);
    for (const name of ["Total debit · full report", "Total credit · full report"]) await expect(page.getByText(name, { exact: true }).locator("..")).toContainText(`USD ${total.toFixed(2)}`);
  }
  await page.getByPlaceholder("Code, name or category").fill(`Synthetic EUR ${marker}`);
  await apply();
  await expect(trialRows).toHaveCount(1);
  await expect(page.locator(".ad-panel")).toContainText(eur.name);
  for (const name of ["Total debit · full report", "Total credit · full report"]) await expect(page.getByText(name, { exact: true }).locator("..")).toContainText("USD 162.00");
  await page.screenshot({ path: testInfo.outputPath("fin29-eur-ledger-search-global-totals.png"), fullPage: true });
  await page.getByPlaceholder("Code, name or category").fill("NOT-A-LEDGER-" + marker);
  await apply();
  await expect(trialRows).toHaveCount(0);
  await expect(page.getByText("No matching loaded records", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Code, name or category").fill("");
  await apply();
  await expect.poll(() => trialRows.count()).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Posted journals", exact: true }).click();
  const source = page.locator("select").filter({ has: page.locator('option[value="reversal"]') });
  const search = page.getByPlaceholder("Number, reference, memo or account");
  await source.selectOption("reversal");
  await apply();
  await expect(journalRows).toHaveCount(3);
  for (const reversal of reversals) await expect(page.locator(".ad-panel")).toContainText(reversal.entry_number);
  for (const original of originals) await expect(page.locator(".ad-panel").getByText(original.entry_number, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("fin29-three-retained-reversal-sources.png"), fullPage: true });
  await source.selectOption("manual");
  await apply();
  await expect(journalRows).toHaveCount(3);
  for (const original of originals) await expect(page.locator(".ad-panel")).toContainText(original.entry_number);
  await source.selectOption("operational");
  await apply();
  await expect(journalRows).toHaveCount(1);
  await expect(page.locator(".ad-panel")).toContainText("Fixed Asset Acquisition");
  await source.selectOption("all");
  await apply();
  await search.fill(originals[0].reference);
  await apply();
  await expect(journalRows).toHaveCount(2);
  await expect(page.locator(".ad-panel")).toContainText(originals[0].entry_number);
  await expect(page.locator(".ad-panel")).toContainText(reversals[0].entry_number);
  await search.fill("Synthetic noncash 0");
  await apply();
  await expect(journalRows).toHaveCount(6);
  await search.fill(rejectedReference);
  await apply();
  await expect(journalRows).toHaveCount(0);
  await expect(page.getByText("No matching loaded records", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("fin29-rejected-reference-absent.png"), fullPage: true });
  await search.fill("");
  await apply();
  await expect(journalRows).toHaveCount(7);
  await page.getByRole("button", { name: "Trial balance", exact: true }).click();
  for (const name of ["Total debit · full report", "Total credit · full report"]) await expect(page.getByText(name, { exact: true }).locator("..")).toContainText("USD 162.00");

  // FIN22 UI: complete five-row statement with independently known sums.
  const bank = await api(page, "POST", "/accounting/financial-accounts", { name: "Synthetic original Cash A", account_type: "bank", currency: "USD", opening_balance: "0" });
  const income = await api(page, "POST", "/accounting/chart-of-accounts", { code: "STINC", name: "Statement income", category: "income", normal_balance: "credit" });
  const expense = await api(page, "POST", "/accounting/chart-of-accounts", { code: "STEXP", name: "Statement expense", category: "expense", normal_balance: "debit" });
  const values = [["income", 80], ["income", 120], ["expense", 10], ["expense", 20], ["expense", 25]];
  for (const [index, [kind, value]] of values.entries()) await api(page, "POST", "/accounting/money", { kind, entry_date: today, financial_account_id: bank.id, category_ledger_account_id: (kind === "income" ? income : expense).id, amount: String(value), description: `Statement movement ${index}`, reference: `STATEMENT-${marker}-${index}` });
  await page.goto(`/dashboard/accounting/accounts/${bank.id}`);
  const statementTable = page.locator("table");
  await expect(statementTable.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByText("Opening balance", { exact: true }).locator("..")).toContainText("USD 0.00");
  await expect(page.getByText("Credit · this page", { exact: true }).locator("..")).toContainText("USD 200.00");
  await expect(page.getByText("Debit · this page", { exact: true }).locator("..")).toContainText("USD 55.00");
  await expect(page.getByText("Current balance", { exact: true }).locator("..")).toContainText("USD 145.00");
  const statementFilters = page.locator(".aa-filters-desktop");
  const statementSearch = statementFilters.getByPlaceholder("Description, reference or source…");
  await statementSearch.fill(`STATEMENT-${marker}-0`);
  await statementFilters.getByRole("button", { name: "Search", exact: true }).click();
  await expect(statementTable.locator("tbody tr")).toHaveCount(1);
  await expect(statementTable).toContainText("USD 80.00");
  const direction = statementFilters.locator("select").filter({ has: page.locator('option[value="debit"]') });
  await direction.selectOption("debit");
  await expect(statementTable.locator("tbody tr")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No matching account transactions", exact: true })).toBeVisible();
  await statementFilters.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(statementTable.locator("tbody tr")).toHaveCount(5);
  await direction.selectOption("debit");
  await expect(statementTable.locator("tbody tr")).toHaveCount(3);
  for (const value of [10, 20, 25]) await expect(statementTable).toContainText(`USD ${value.toFixed(2)}`);
  await statementFilters.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(statementTable.locator("tbody tr")).toHaveCount(5);
  await statementFilters.getByLabel("To date", { exact: true }).fill("2026-09-30");
  await expect(statementTable.locator("tbody tr")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No matching account transactions", exact: true })).toBeVisible();
  await statementFilters.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(statementTable.locator("tbody tr")).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("fin22-five-movement-statement-reconciled.png"), fullPage: true });
  await testInfo.attach("fin29-fin22-real-owner-evidence", { body: JSON.stringify({ organizationId: workspace.organization.id, preservedSynthetic: true, trialTotals: { august: 0, september: 120, october: 162 }, journals: 7, manual: 3, reversal: 3, operational: 1, rejectedReference, rejectedStatus: 409, rejectedRowsAbsent: true, headlineTotalsUnchangedByFilters: true, bankId: bank.id, statement: { opening: 0, count: 5, credit: 200, debit: 55, closing: 145 } }), contentType: "application/json" });
});
