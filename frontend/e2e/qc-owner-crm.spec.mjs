import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Real owner browser + PostgreSQL journey. No business API mocks or direct DB
// writes. API mutations are limited to fresh-organization setup and explicit
// negative guard probes that the UI prevents. All successful CRM mutations use UI.
const email = process.env.E2E_QC_EMAIL ?? "qc-owner@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

async function readJson(request, path) {
  const response = await request.get(path);
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function mutateViaUI(page, path, method, action) {
  const pending = page.waitForResponse((response) =>
    new URL(response.url()).pathname === path && response.request().method() === method);
  await action();
  const response = await pending;
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

// Verify that typing/filtering actually reaches the real API, not just local
// state, and that no Enter press is needed to apply the debounced search.
async function filterViaUI(page, kind, params, action) {
  const pending = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/crm/${kind}` && response.request().method() === "GET"
      && Object.entries(params).every(([key, value]) => (url.searchParams.get(key) ?? "") === value);
  });
  await action();
  const response = await pending;
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

function statusFilter(page) {
  return page.locator("select").filter({ has: page.getByRole("option", { name: "All statuses", exact: true }) });
}

test("fresh owner: create leads → qualify → win → convert one client → real search/status filters and duplicate guard", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL).hostname);
  const marker = `QC-CRM-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const companyName = `${marker} Prospect Alpha`;
  const otherName = `${marker} Prospect Beta`;
  const contactName = "Synthetic CRM Contact";
  const evidence = { marker, setup: "API-only fresh organization isolation; owner UI login and successful business mutations", uiActions: [], records: {}, guardProbes: [] };
  const pageErrors = [];
  const failedAPI = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/") && response.status() >= 400) {
      failedAPI.push(`${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()}`);
    }
  });
  let lead;
  let other;
  let client;
  let meta;
  let won;
  let qualified;

  try {
    await test.step("Owner login and API-only fresh organization setup", async () => {
      await page.goto("/login");
      await page.getByLabel(/email or username/i).fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: /sign in securely/i }).click();
      await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 30_000 });
      const created = await context.request.post("/api/organizations", { data: {
        name: marker, country_code: "BD", timezone: "UTC", currency: "BDT",
        business_type: "Software & IT Services", team_size: "1-5", financial_year_start_month: 1,
      } });
      expect(created.ok(), await created.text()).toBeTruthy();
      const membership = await created.json();
      evidence.records.organizationId = membership.organization.id;
      expect((await context.cookies()).find((cookie) => cookie.name === "organization_id")?.value).toBe(membership.organization.id);
      await page.goto("/dashboard/crm");
      await expect(page.getByRole("heading", { name: "CRM & Leads", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No leads found", exact: true })).toBeVisible();
      meta = await readJson(context.request, "/api/crm/meta");
      won = meta.statuses.find((item) => item.is_active && item.category === "won");
      qualified = meta.statuses.find((item) => item.is_active && item.category === "qualified");
      expect(won).toBeTruthy();
      expect(qualified).toBeTruthy();
    });

    await test.step("Create two distinguishable synthetic leads through owner UI", async () => {
      for (const name of [companyName, otherName]) {
        await page.getByRole("button", { name: "New lead", exact: true }).click();
        await page.getByLabel("Company name", { exact: true }).fill(name);
        await page.getByLabel("Contact person", { exact: true }).fill(contactName);
        // Leave all mail fields blank so this isolated fixture cannot receive mail.
        await page.getByLabel("City", { exact: true }).fill("Dhaka");
        await page.getByLabel("Estimated value", { exact: true }).fill("12500.50");
        await page.getByLabel("Probability %", { exact: true }).fill("35");
        await page.getByLabel("Notes", { exact: true }).fill("Synthetic owner QC lead; no external communication or fulfillment.");
        const created = await mutateViaUI(page, "/api/crm/leads", "POST", () =>
          page.getByRole("button", { name: "Create lead", exact: true }).click());
        await expect(page.getByText("Lead created", { exact: true })).toBeVisible();
        await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
        expect(created.company_name).toBe(name);
        expect(created.converted_client_id).toBeNull();
        if (name === companyName) lead = created;
        else other = created;
      }
      const saved = await readJson(context.request, `/api/crm/leads/${lead.id}`);
      expect(saved.lead.contact_name).toBe(contactName);
      expect(saved.lead.email).toBeNull();
      expect(Number(saved.lead.estimated_value)).toBeCloseTo(12500.5, 2);
      expect(saved.city).toBe("Dhaka");
      evidence.records.leadIds = [lead.id, other.id];
      evidence.uiActions.push("Created Alpha and Beta leads through owner UI with blank email fields");
    });

    await test.step("Real lead search by name/code, no-match search, and clearing/reset", async () => {
      const search = page.getByPlaceholder("Search code, name, email, phone...");
      let result = await filterViaUI(page, "leads", { search: "Prospect Alpha" }, () => search.fill("Prospect Alpha"));
      expect(result.items.map((item) => item.id)).toEqual([lead.id]);
      await expect(page.getByRole("row").filter({ hasText: companyName })).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: otherName })).toHaveCount(0);
      result = await filterViaUI(page, "leads", { search: lead.lead_code }, () => search.fill(lead.lead_code));
      expect(result.items.map((item) => item.id)).toEqual([lead.id]);
      result = await filterViaUI(page, "leads", { search: "no-such-crm-record" }, () => search.fill("no-such-crm-record"));
      expect(result.items).toHaveLength(0);
      await expect(page.getByRole("heading", { name: "No leads found", exact: true })).toBeVisible();
      result = await filterViaUI(page, "leads", { search: "" }, () => search.fill(""));
      expect(result.items.map((item) => item.id).sort()).toEqual([lead.id, other.id].sort());
      await expect(page.locator("tbody tr")).toHaveCount(2);
      evidence.uiActions.push("Lead typed name/code searches and empty search clear hit real API and return exactly expected persisted records");
    });

    await test.step("Qualify and win through the lead drawer; status filters use real data", async () => {
      await page.getByRole("row").filter({ hasText: companyName }).getByRole("button", { name: "Open", exact: true }).click();
      await expect(page.getByRole("button", { name: "Convert to Client", exact: true })).toHaveCount(0);
      await mutateViaUI(page, `/api/crm/leads/${lead.id}/status`, "PATCH", () =>
        page.getByLabel("Lead status", { exact: true }).selectOption(qualified.id));
      await expect(page.getByText(`Lead status changed to ${qualified.name}`, { exact: true })).toBeVisible();
      expect((await readJson(context.request, `/api/crm/leads/${lead.id}`)).lead.status_category).toBe("qualified");
      await page.goto("/dashboard/crm");
      let result = await filterViaUI(page, "leads", { status_id: qualified.id }, () => statusFilter(page).selectOption(qualified.id));
      expect(result.items.map((item) => item.id)).toEqual([lead.id]);
      await expect(page.locator("tbody tr")).toHaveCount(1);
      result = await filterViaUI(page, "leads", { status_id: won.id }, () => statusFilter(page).selectOption(won.id));
      expect(result.items).toHaveLength(0);
      await expect(page.getByRole("heading", { name: "No leads found", exact: true })).toBeVisible();
      result = await filterViaUI(page, "leads", { status_id: "", search: "" }, () => page.getByRole("button", { name: "Reset", exact: true }).click());
      expect(result.items).toHaveLength(2);
      await expect(statusFilter(page)).toHaveValue("");
      await page.getByRole("row").filter({ hasText: companyName }).getByRole("button", { name: "Open", exact: true }).click();
      await mutateViaUI(page, `/api/crm/leads/${lead.id}/status`, "PATCH", () =>
        page.getByLabel("Lead status", { exact: true }).selectOption(won.id));
      await expect(page.getByRole("heading", { name: "Opportunity marked as Won", exact: true })).toBeVisible();
      await expect(page.getByText(`Lead status changed to ${won.name}`, { exact: true })).toBeVisible();
      await expect(page.getByLabel("Lead status", { exact: true })).toHaveCount(0);
      evidence.uiActions.push("Qualified lead, tested positive/negative status filters and Reset, then marked Won and verified UI status lock");
    });

    await test.step("Convert won lead through UI and verify preserved data and unique linkage", async () => {
      // The last match is the foreground Won decision dialog's action.
      await page.getByRole("button", { name: "Convert to Client", exact: true }).last().click();
      await expect(page.getByRole("heading", { name: "Create client from won lead", exact: true })).toBeVisible();
      await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(companyName);
      await expect(page.getByLabel("Contact person", { exact: true })).toHaveValue(contactName);
      await expect(page.getByLabel("City", { exact: true })).toHaveValue("Dhaka");
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
      client = await mutateViaUI(page, `/api/crm/leads/${lead.id}/convert`, "POST", () =>
        page.getByRole("button", { name: "Create Client", exact: true }).click());
      await expect(page.getByText("Lead converted to client", { exact: true })).toBeVisible();
      await expect(page.getByText("This won lead has been converted and permanently linked to a client.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Convert to Client", exact: true })).toHaveCount(0);
      const savedLead = await readJson(context.request, `/api/crm/leads/${lead.id}`);
      const savedClient = await readJson(context.request, `/api/crm/clients/${client.id}/detail`);
      expect(savedLead.lead.converted_client_id).toBe(client.id);
      expect(savedLead.lead.status_category).toBe("won");
      expect(savedLead.interactions.filter((item) => item.subject === "Converted to client")).toHaveLength(1);
      expect(savedClient.source_lead_id).toBe(lead.id);
      expect(savedClient.source_lead_code).toBe(lead.lead_code);
      expect(savedClient.display_name).toBe(companyName);
      expect(savedClient.contact_name).toBe(contactName);
      expect(savedClient.city).toBe("Dhaka");
      expect(savedClient.country_code).toBe("BD");
      expect(savedClient.currency).toBe("BDT");
      expect(savedClient.email).toBeNull();
      expect(savedClient.billing_email).toBeNull();
      expect(savedClient.status).toBe("active");
      const clients = await readJson(context.request, "/api/crm/clients?limit=100");
      expect(clients.items.map((item) => item.id)).toEqual([client.id]);
      evidence.records.clientId = client.id;
      evidence.uiActions.push("Converted Won lead through UI into exactly one active client; verified bidirectional source link, contact, location, currency, and single conversion timeline entry");
      await page.screenshot({ path: testInfo.outputPath("crm-converted-lead.png"), fullPage: true });
    });

    await test.step("API-only negative probes for UI-blocked duplicate conversion and locked status", async () => {
      const duplicate = await context.request.post(`/api/crm/leads/${lead.id}/convert`, { data: {} });
      expect(duplicate.status()).toBe(409);
      expect((await duplicate.json()).detail).toMatch(/already been converted/i);
      const locked = await context.request.patch(`/api/crm/leads/${lead.id}/status`, { data: { status_id: qualified.id } });
      expect(locked.status()).toBe(409);
      expect((await locked.json()).detail).toMatch(/locked/i);
      const clients = await readJson(context.request, "/api/crm/clients?limit=100");
      expect(clients.items.map((item) => item.id)).toEqual([client.id]);
      const saved = await readJson(context.request, `/api/crm/leads/${lead.id}`);
      expect(saved.lead.converted_client_id).toBe(client.id);
      expect(saved.lead.status_id).toBe(won.id);
      expect(saved.interactions.filter((item) => item.subject === "Converted to client")).toHaveLength(1);
      evidence.guardProbes.push("API-only duplicate conversion rejected 409 and did not create another client/timeline entry", "API-only converted-lead status rollback rejected 409 and Won link preserved");
    });

    await test.step("Real client name/code search, clearing, status filtering, deactivate/reactivate", async () => {
      await page.getByRole("link", { name: "View Clients", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/clients$/);
      const row = page.getByRole("row").filter({ hasText: companyName });
      await expect(row).toBeVisible();
      const search = page.getByPlaceholder("Search clients...");
      let result = await filterViaUI(page, "clients", { search: "Prospect Alpha" }, () => search.fill("Prospect Alpha"));
      expect(result.items.map((item) => item.id)).toEqual([client.id]);
      result = await filterViaUI(page, "clients", { search: client.client_code }, () => search.fill(client.client_code));
      expect(result.items.map((item) => item.id)).toEqual([client.id]);
      result = await filterViaUI(page, "clients", { search: "no-such-crm-client" }, () => search.fill("no-such-crm-client"));
      expect(result.items).toHaveLength(0);
      await expect(page.getByRole("heading", { name: "No clients found", exact: true })).toBeVisible();
      result = await filterViaUI(page, "clients", { search: "", status: "" }, () => search.fill(""));
      expect(result.items.map((item) => item.id)).toEqual([client.id]);
      result = await filterViaUI(page, "clients", { status: "inactive" }, () => statusFilter(page).selectOption("inactive"));
      expect(result.items).toHaveLength(0);
      await expect(page.getByRole("heading", { name: "No clients found", exact: true })).toBeVisible();
      result = await filterViaUI(page, "clients", { status: "active" }, () => statusFilter(page).selectOption("active"));
      expect(result.items.map((item) => item.id)).toEqual([client.id]);
      await row.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByText(`Originated from CRM · ${lead.lead_code} · ${won.name}`, { exact: true })).toBeVisible();
      await mutateViaUI(page, `/api/crm/clients/${client.id}`, "PATCH", () =>
        page.getByRole("button", { name: "Deactivate", exact: true }).click());
      await expect(page.getByText("Client marked inactive", { exact: true })).toBeVisible();
      expect((await readJson(context.request, `/api/crm/clients/${client.id}/detail`)).status).toBe("inactive");
      await page.goto("/dashboard/clients");
      result = await filterViaUI(page, "clients", { status: "inactive" }, () => statusFilter(page).selectOption("inactive"));
      expect(result.items.map((item) => item.id)).toEqual([client.id]);
      await expect(row).toBeVisible();
      result = await filterViaUI(page, "clients", { status: "active" }, () => statusFilter(page).selectOption("active"));
      expect(result.items).toHaveLength(0);
      await expect(page.getByRole("heading", { name: "No clients found", exact: true })).toBeVisible();
      result = await filterViaUI(page, "clients", { status: "", search: "" }, () => page.getByRole("button", { name: "Reset", exact: true }).click());
      expect(result.items.map((item) => item.id)).toEqual([client.id]);
      await expect(statusFilter(page)).toHaveValue("");
      await expect(search).toHaveValue("");
      await row.getByRole("button", { name: "Edit", exact: true }).click();
      await mutateViaUI(page, `/api/crm/clients/${client.id}`, "PATCH", () =>
        page.getByRole("button", { name: "Activate", exact: true }).click());
      await expect(page.getByText("Client reactivated", { exact: true })).toBeVisible();
      expect((await readJson(context.request, `/api/crm/clients/${client.id}/detail`)).status).toBe("active");
      evidence.uiActions.push("Client typed name/code/no-match searches, clearing, positive/negative Active/Inactive filters, Reset, deactivate and reactivate verified against real persisted records");
    });

    await test.step("Reload durability and CRM/client summaries remain consistent", async () => {
      await page.goto("/dashboard/crm");
      await page.reload();
      await expect(page.locator("tbody tr")).toHaveCount(2);
      const row = page.getByRole("row").filter({ hasText: companyName });
      await expect(row).toContainText(won.name);
      await expect(row.getByText("Client", { exact: true })).toBeVisible();
      const result = await filterViaUI(page, "leads", { status_id: won.id }, () => statusFilter(page).selectOption(won.id));
      expect(result.items.map((item) => item.id)).toEqual([lead.id]);
      const summary = await readJson(context.request, "/api/crm/summary");
      expect(summary.total_leads).toBe(2);
      expect(summary.open_leads).toBe(1);
      expect(summary.converted_leads).toBe(1);
      expect(await readJson(context.request, "/api/crm/clients/summary")).toEqual({ total: 1, active: 1, inactive: 0 });
      await page.goto("/dashboard/clients");
      await page.reload();
      await expect(page.getByRole("row").filter({ hasText: companyName })).toBeVisible();
      await expect(page.locator("tbody tr")).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath("crm-single-converted-client.png"), fullPage: true });
      evidence.records.finalCRMSummary = summary;
      expect(pageErrors, "No uncaught browser exceptions").toEqual([]);
      expect(failedAPI, "No unexpected browser business API failures; negative probes are APIRequestContext-only").toEqual([]);
      evidence.uiActions.push("Reload preserves two leads, one Won conversion, one open prospect, and exactly one active client");
    });
  } finally {
    evidence.pageErrors = pageErrors;
    evidence.failedAPI = failedAPI;
    await testInfo.attach("owner-crm-real-backend-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  }
});
