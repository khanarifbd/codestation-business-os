import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Real Next.js proxy + FastAPI + disposable PostgreSQL only. Do not mock business
// APIs, visit employee/client portals, send invitations, or invoke payment rails.
const email = process.env.E2E_QC_EMAIL ?? "qc-owner@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function json(response, label = "API request") {
  const body = await response.text();
  expect(response.ok(), `${label}: HTTP ${response.status()} ${body}`).toBeTruthy();
  return JSON.parse(body);
}

async function get(page, path) {
  return json(await page.request.get(path), `GET ${path}`);
}

async function post(page, path, data) {
  return json(await page.request.post(path, { data }), `POST ${path}`);
}

async function setupWorkspace(page, label) {
  await post(page, "/api/auth/login", { email, password });
  const name = `QC owner ${label} ${randomUUID().slice(0, 8)}`;
  const workspace = await post(page, "/api/organizations", {
    name, country_code: "US", timezone: "UTC", currency: "USD",
    business_type: "Synthetic quality-control fixture", team_size: "1-5",
  });
  expect(workspace.is_owner).toBe(true);
  const tenant = await get(page, "/api/tenant");
  expect(tenant.organization.id).toBe(workspace.organization.id);
  const people = await get(page, "/api/hr/people");
  expect(people.people).toHaveLength(1);
  return { workspace, employee: people.people[0], name };
}

async function choose(page, label, option) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("listbox").getByRole("button", { name: option }).click();
}

async function submit(page, button, path, method = "POST") {
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === path && item.request().method() === method);
  await button.click();
  return json(await response, `${method} ${path} through owner UI`);
}

function cents(value) { return Math.round(Number(value) * 100); }

test("owner edits employee, records precise attendance and approves leave without entering a portal", async ({ page }) => {
  test.setTimeout(150_000);
  const { employee } = await setupWorkspace(page, "HR");

  await test.step("Edit the owner's real employee record through People", async () => {
    await page.goto("/dashboard/hr/people");
    await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
    await page.getByRole("row").filter({ hasText: employee.employee_code }).getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Work location", { exact: true }).fill("Synthetic QC office");
    await page.getByLabel("Join date", { exact: true }).fill(monthStart);
    await page.getByLabel("Internal HR note", { exact: true }).fill("Isolated owner-side QC employee record; no invitation sent.");
    const updated = await submit(page, page.getByRole("button", { name: "Save profile", exact: true }), `/api/hr/people/${employee.id}`, "PATCH");
    expect(updated).toEqual({ id: employee.id, updated: true });
    await expect(page.getByText("Employee profile updated", { exact: true })).toBeVisible();
    const persisted = (await get(page, "/api/hr/people")).people.find((item) => item.id === employee.id);
    expect(persisted.join_date).toBe(monthStart);
    expect(persisted.work_location).toBe("Synthetic QC office");
  });

  await test.step("Record fractional hours and verify stored minutes", async () => {
    await page.goto("/dashboard/hr/time");
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await choose(page, "Employee", employee.employee_code);
    await page.getByLabel("Date", { exact: true }).fill(today);
    await page.getByLabel("Worked hours", { exact: true }).fill("7.75");
    await page.getByLabel("Overtime hours", { exact: true }).fill("1.25");
    await page.getByLabel("Note", { exact: true }).fill("QC fractional hours");
    await submit(page, page.getByRole("button", { name: "Save attendance", exact: true }), "/api/hr/attendance");
    await expect(page.getByText("Attendance recorded", { exact: true })).toBeVisible();
    const records = await get(page, "/api/hr/attendance");
    const record = records.find((item) => item.employee_id === employee.id && item.attendance_date === today);
    expect(record.work_minutes).toBe(465);
    expect(record.overtime_minutes).toBe(75);
    expect(record.notes).toBe("QC fractional hours");
  });

  await test.step("Approve an API-created pending request in the owner Time & Leave UI", async () => {
    const type = await post(page, "/api/hr/leave-types", { name: "QC annual leave", code: "QC-ANNUAL", annual_allowance_days: "20", is_paid: true, requires_approval: true });
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() + 2);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 2);
    const leave = await post(page, "/api/hr/leave-requests", {
      employee_id: employee.id, leave_type_id: type.id,
      start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), reason: "Synthetic owner approval QC",
    });
    expect(leave.status).toBe("pending");
    await page.reload();
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page.getByText("Synthetic owner approval QC", { exact: true })).toBeVisible();
    await expect(page.getByText(/3 day\(s\)/)).toBeVisible();
    const approved = await submit(page, page.getByRole("button", { name: "Approve", exact: true }), `/api/hr/leave-requests/${leave.id}`, "PATCH");
    expect(approved.status).toBe("approved");
    await expect(page.getByText("Leave request approved", { exact: true })).toBeVisible();
    const persisted = (await get(page, "/api/hr/leave-requests")).find((item) => item.id === leave.id);
    expect(persisted.status).toBe("approved");
    expect(Number(persisted.days)).toBe(3);
    expect((await get(page, "/api/hr/workspace-summary")).attention.pending_leave).toBe(0);
    const overlap = await page.request.post("/api/hr/leave-requests", { data: {
      employee_id: employee.id, leave_type_id: type.id,
      start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), reason: "Overlapping negative control",
    } });
    expect(overlap.status()).toBe(409);
  });
});

test("owner approves exact payroll, views payslip and reconciles expense with posted financial statements", async ({ page, context }) => {
  test.setTimeout(210_000);
  const { employee, name } = await setupWorkspace(page, "payroll-finance");
  // This is a synthetic ledger account, not a connected bank or payment provider.
  const account = await post(page, "/api/accounting/financial-accounts", {
    name: "QC synthetic USD cash", account_type: "cash", currency: "USD", opening_balance: "10000.00",
    notes: "Local disposable database fixture. No real bank or payment connection.",
  });
  let run;

  await test.step("Create salary profile and payroll period in owner UI", async () => {
    await page.goto("/dashboard/payroll");
    await page.getByRole("button", { name: "Salary Profiles", exact: true }).click();
    await choose(page, "Employee", employee.employee_code);
    await choose(page, "Currency", "USD");
    await page.getByLabel("Base salary", { exact: true }).fill("1000.00");
    await page.getByLabel("Effective from", { exact: true }).fill(monthStart);
    const profile = await submit(page, page.getByRole("button", { name: "Save profile", exact: true }), "/api/payroll/salary-profiles");
    expect(profile.employee_id).toBe(employee.id);
    expect(cents(profile.base_salary)).toBe(100000);
    await page.getByRole("button", { name: "Payroll Periods", exact: true }).click();
    await page.getByLabel("Period name", { exact: true }).fill("QC monthly payroll");
    await page.getByLabel("Start date", { exact: true }).fill(monthStart);
    await page.getByLabel("End date", { exact: true }).fill(monthEnd);
    await page.getByLabel("Pay date", { exact: true }).fill(monthEnd);
    await submit(page, page.getByRole("button", { name: "Create period", exact: true }), "/api/payroll/periods");
    await page.getByRole("button", { name: "Payroll Runs", exact: true }).click();
    await choose(page, "Payroll period", "QC monthly payroll");
    await choose(page, "Currency", "USD");
    run = await submit(page, page.getByRole("button", { name: "Generate draft", exact: true }), "/api/payroll/runs");
    expect(run.status).toBe("draft");
    expect(run.employee_count).toBe(1);
    expect(cents(run.net_total)).toBe(100000);
  });

  await test.step("Adjust allowance, deduction and withholding with cent-accurate totals", async () => {
    await page.getByRole("button", { name: "Adjust", exact: true }).click();
    // The component sections do not have landmark roles; select their own heading's parent section.
    await page.getByRole("heading", { name: "Allowances", exact: true }).locator("..").getByRole("button", { name: "Add", exact: true }).click();
    const bonus = page.getByPlaceholder("Bonus / transport / housing");
    await bonus.fill("QC transport allowance");
    await bonus.locator("..").locator('input[type="number"]').fill("250.25");
    await page.getByRole("heading", { name: "Deductions", exact: true }).locator("..").getByRole("button", { name: "Add", exact: true }).click();
    const deduction = page.getByPlaceholder("Advance / unpaid leave / other");
    await deduction.fill("QC advance recovery");
    await deduction.locator("..").locator('input[type="number"]').fill("50.10");
    await page.getByLabel("Tax / withholding", { exact: true }).fill("100.15");
    await page.getByLabel("Notes", { exact: true }).fill("QC exact payroll arithmetic");
    run = await submit(page, page.getByRole("button", { name: "Save adjustment", exact: true }), `/api/payroll/runs/${run.id}/entries/${run.entries[0].id}`, "PATCH");
    expect(cents(run.gross_total)).toBe(125025);
    expect(cents(run.allowance_total)).toBe(25025);
    expect(cents(run.deduction_total)).toBe(5010);
    expect(cents(run.tax_total)).toBe(10015);
    expect(cents(run.net_total)).toBe(110000);
    expect(cents(run.entries[0].net_pay)).toBe(110000);
    const draftReport = await get(page, `/api/accounting/reports/financial-statements?date_from=${monthStart}&date_to=${monthEnd}`);
    expect(cents(draftReport.total_expenses), "Draft payroll must not recognize an expense").toBe(0);
  });

  await test.step("Approve payroll once, verify locked amounts, and inspect the owner payslip", async () => {
    run = await submit(page, page.getByRole("button", { name: "Approve payroll", exact: true }), `/api/payroll/runs/${run.id}/approve`);
    expect(run.status).toBe("approved");
    await expect(page.getByText("Payroll approved and locked.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Adjust", exact: true })).toHaveCount(0);
    const locked = await page.request.patch(`/api/payroll/runs/${run.id}/entries/${run.entries[0].id}`, { data: { tax_amount: "0" } });
    expect(locked.status()).toBe(409);
    const duplicateApproval = await page.request.post(`/api/payroll/runs/${run.id}/approve`);
    expect(duplicateApproval.status()).toBe(409);
    const popupPromise = context.waitForEvent("page");
    await page.getByRole("link", { name: "Payslip", exact: true }).click();
    const payslip = await popupPromise;
    await expect(payslip.getByRole("heading", { name, exact: true })).toBeVisible();
    const article = payslip.locator("article");
    await expect(article).toContainText(employee.full_name);
    await expect(article).toContainText("USD 1,250.25");
    await expect(article).toContainText("USD 150.25");
    await expect(article).toContainText("USD 1,100.00");
    await expect(article).toContainText("QC exact payroll arithmetic");
    await expect(article).toContainText("This document reflects the approved payroll record");
    await payslip.emulateMedia({ media: "print" });
    await expect(article).toBeVisible();
    await payslip.close();
  });

  await test.step("Post a synthetic cash expense through the owner UI", async () => {
    await page.goto("/dashboard/expenses");
    await page.getByRole("button", { name: "+ New expense", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("QC office supplies");
    await page.getByLabel("Expense date", { exact: true }).fill(today);
    await page.getByLabel("Expense amount (USD)", { exact: true }).fill("123.45");
    await page.getByLabel("Reference", { exact: true }).fill("QC-SYNTHETIC-RECEIPT");
    const expense = await submit(page, page.getByRole("button", { name: "Post expense", exact: true }), "/api/finance/expenses");
    expect(expense.status).toBe("posted");
    expect(cents(expense.expense_amount)).toBe(12345);
    expect(cents(expense.account_amount)).toBe(12345);
    expect(expense.account_id).toBe(account.id);
    await expect(page.getByRole("row").filter({ hasText: "QC office supplies" })).toContainText("USD 123.45");
    const actualAccount = (await get(page, "/api/finance/accounts")).find((item) => item.id === account.id);
    expect(cents(actualAccount.current_balance)).toBe(987655);
    const ledger = await get(page, `/api/finance/accounts/${account.id}/ledger`);
    expect(ledger.filter((item) => item.direction === "debit").map((item) => cents(item.amount))).toContain(12345);
  });

  await test.step("Reconcile payroll liabilities, expense, equity and cash in financial reports", async () => {
    const report = await get(page, `/api/accounting/reports/financial-statements?date_from=${monthStart}&date_to=${monthEnd}`);
    expect(report.accounting_currency).toBe("USD");
    expect(cents(report.total_income)).toBe(0);
    expect(cents(report.total_expenses)).toBe(137370);
    expect(cents(report.net_profit)).toBe(-137370);
    expect(cents(report.total_liabilities)).toBe(125025);
    expect(cents(report.total_assets)).toBe(987655);
    expect(cents(report.total_assets)).toBe(cents(report.total_liabilities_and_equity));
    expect(report.liabilities.some((row) => cents(row.amount) === 110000), "Net salary payable must equal 1,100.00").toBe(true);
    expect(report.liabilities.some((row) => cents(row.amount) === 15025), "Deductions plus tax must remain payable").toBe(true);
    await page.goto("/dashboard/accounting/reports");
    await expect(page.getByRole("heading", { name: "Financial reports", exact: true })).toBeVisible();
    await page.getByLabel("From", { exact: true }).fill(monthStart);
    await page.getByLabel("To", { exact: true }).fill(monthEnd);
    const displayed = page.waitForResponse((response) => response.url().includes("/api/accounting/reports/financial-statements?") && response.url().includes(`date_to=${monthEnd}`));
    await page.getByRole("button", { name: "Apply period", exact: true }).click();
    expect(cents((await json(await displayed)).total_expenses)).toBe(137370);
    await expect(page.getByText("Equation balanced", { exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("USD 1,373.70");
    await expect(page.locator("body")).not.toContainText(/Internal Server Error|Permission required:|Unable to load/);
  });
});
