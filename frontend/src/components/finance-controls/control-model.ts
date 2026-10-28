import { decimalInput } from "@/components/accounting-money-out/money-out-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { controlFrequencies, controlPaymentMethods } from "./control-types";
import type { ControlAccount, ControlAutomation, ControlMeta, ControlPayload, ControlPeriod, ControlRecurring, PeriodCreateBody, PeriodForm, RecurringCreateBody, RecurringForm } from "./control-types";

export const CONTROL_PAGE_SIZE = 20, CONTROL_CLIENT_CAP = 500, CONTROL_PROJECT_CAP = 500;
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown): v is string => typeof v === "string";
const present = (v: unknown): v is string => text(v) && v.trim().length > 0;
const nullable = (v: unknown) => v === null || text(v);
const currency = (v: unknown): v is string => text(v) && /^[A-Z]{3}$/.test(v);
const characters = (v: string) => Array.from(v).length;
const clean = (v: string) => v.trim() || null;
const ZERO = BigInt(0), HUNDRED = BigInt(100), MAX_STORED_CENTS = BigInt("999999999999999999");
export const controlId = (v: unknown): v is string => text(v) && /^[A-Za-z0-9_-]{1,200}$/.test(v) && !["new", "post", "status", "configure", "retry", "close", "reopen", "recurring", "automation", "periods"].includes(v);
export const pretty = (v: string | null | undefined) => v ? v.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()) : "—";
export function controlDate(v: unknown): v is string {
  if (!text(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith("0000-")) return false;
  const date = new Date(v + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}
/** No browser-timezone fallback: server organization time is authoritative. */
export function controlToday(timezone: string | undefined, now: Date = new Date()): string {
  if (!timezone || !Number.isFinite(now.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", calendar: "gregory", numberingSystem: "latn" }).formatToParts(now);
    const get = (type: string) => parts.find(part => part.type === type)?.value || "";
    const date = `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
    return controlDate(date) ? date : "";
  } catch { return ""; }
}
function decimal(v: unknown): { canonical: string; negative: boolean } | null {
  if (!text(v) && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER)) return null;
  const raw = String(v).trim(), negative = raw.startsWith("-");
  if (negative && raw[1] === "+") return null;
  const canonical = decimalInput(negative ? raw.slice(1) : raw);
  return canonical === null ? null : { canonical, negative };
}
/** Exact HALF_UP cents for existing server rounding, not a floating-point sum. */
export function controlCents(v: unknown): bigint | null {
  const parsed = decimal(v); if (!parsed) return null;
  const [whole, fraction = ""] = parsed.canonical.split(".");
  const value = BigInt(whole) * HUNDRED + BigInt(fraction.slice(0, 2).padEnd(2, "0")) + (fraction.length > 2 && fraction[2] >= "5" ? BigInt(1) : ZERO);
  return parsed.negative ? -value : value;
}
function storedAmount(v: unknown, signed = false): boolean {
  const parsed = decimal(v); if (!parsed || (parsed.canonical.split(".")[1]?.length || 0) > 2) return false;
  const value = controlCents(v)!;
  return (signed || value >= ZERO) && value >= -MAX_STORED_CENTS && value <= MAX_STORED_CENTS;
}
export function controlMoney(value: unknown, code: string): string {
  if (!currency(code)) return "—";
  const parsed = decimal(value); if (!parsed) return `${code} —`;
  return formatMoneyExact(`${parsed.negative ? "-" : ""}${parsed.canonical}`, code);
}
const optionalDate = (v: unknown) => v === null || controlDate(v);
const timestamp = (v: unknown) => text(v) && controlDate(v.slice(0, 10)) && v[10] === "T" && Number.isFinite(Date.parse(v));
const optionalTimestamp = (v: unknown) => v === null || timestamp(v);
const optionalId = (v: unknown) => v === null || controlId(v);
const unique = <T,>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;
const interval = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 120;

/** Server string status/frequency fields stay readable if unknown; action helpers fail closed. */
export function isRecurring(v: unknown): v is ControlRecurring {
  return record(v) && controlId(v.id) && text(v.name) && text(v.description)
    && optionalId(v.vendor_id) && nullable(v.vendor_name) && controlId(v.category_id) && text(v.category_name)
    && controlId(v.account_id) && text(v.account_name) && currency(v.account_currency)
    && optionalId(v.client_id) && nullable(v.client_name) && optionalId(v.project_id) && nullable(v.project_name)
    && currency(v.expense_currency) && storedAmount(v.expense_amount) && present(v.frequency) && interval(v.interval_count)
    && controlDate(v.next_due_date) && optionalDate(v.end_date) && storedAmount(v.tax_amount) && present(v.payment_method)
    && nullable(v.reference) && nullable(v.notes) && typeof v.is_active === "boolean" && typeof v.auto_post === "boolean"
    && optionalTimestamp(v.auto_post_last_attempt_at) && nullable(v.auto_post_last_error)
    && optionalId(v.last_posted_expense_id) && optionalTimestamp(v.last_posted_at) && timestamp(v.created_at) && timestamp(v.updated_at);
}
export function isAutomation(v: unknown): v is ControlAutomation {
  return record(v) && controlId(v.id) && text(v.name) && text(v.description) && text(v.category_name) && nullable(v.vendor_name)
    && text(v.account_name) && (currency(v.account_currency) || v.account_currency === "—") && currency(v.expense_currency)
    && storedAmount(v.expense_amount) && present(v.frequency) && interval(v.interval_count) && controlDate(v.next_due_date)
    && ["is_active", "auto_post", "eligible", "retryable"].every(key => typeof v[key] === "boolean")
    && nullable(v.eligibility_reason) && optionalTimestamp(v.last_attempt_at) && nullable(v.last_error);
}
export function isPeriod(v: unknown): v is ControlPeriod {
  return record(v) && controlId(v.id) && text(v.name) && controlDate(v.start_date) && controlDate(v.end_date)
    && v.start_date <= v.end_date && present(v.status) && nullable(v.close_notes) && optionalId(v.closed_by_user_id)
    && optionalTimestamp(v.closed_at) && optionalId(v.reopened_by_user_id) && optionalTimestamp(v.reopened_at)
    && nullable(v.reopen_reason) && timestamp(v.created_at) && timestamp(v.updated_at);
}
export function isRecurringList(v: unknown): v is ControlRecurring[] { return Array.isArray(v) && v.every(isRecurring) && unique(v, row => row.id); }
export function isAutomationList(v: unknown): v is ControlAutomation[] { return Array.isArray(v) && v.every(isAutomation) && unique(v, row => row.id); }
export function isPeriodList(v: unknown): v is ControlPeriod[] { return Array.isArray(v) && v.every(isPeriod) && unique(v, row => row.id); }
export function isControlAccount(v: unknown): v is ControlAccount {
  return record(v) && controlId(v.id) && present(v.name) && present(v.account_type) && currency(v.currency) && storedAmount(v.current_balance, true) && typeof v.is_active === "boolean";
}
export function isControlAccounts(v: unknown): v is ControlAccount[] { return Array.isArray(v) && v.every(isControlAccount) && unique(v, row => row.id); }
export function isControlMeta(v: unknown): v is ControlMeta {
  if (!record(v)) return false;
  const named = (row: unknown): row is Record<string, unknown> & { id: string; name: string } => record(row) && controlId(row.id) && present(row.name);
  const rows = (value: unknown, predicate: (row: unknown) => boolean, cap = Infinity) => Array.isArray(value) && value.length <= cap && value.every(predicate) && unique(value as { id: string }[], row => row.id);
  return rows(v.vendors, row => named(row) && typeof row.is_active === "boolean")
    && rows(v.categories, row => named(row) && present(row.cost_type) && typeof row.is_active === "boolean")
    && rows(v.accounts, row => named(row) && currency(row.currency) && storedAmount(row.current_balance, true) && typeof row.is_active === "boolean")
    && rows(v.clients, row => named(row) && (row.currency === null || currency(row.currency)), CONTROL_CLIENT_CAP)
    && rows(v.projects, row => named(row) && present(row.number) && controlId(row.client_id) && currency(row.currency) && present(row.status), CONTROL_PROJECT_CAP);
}

export function blankRecurring(code = "USD", date = ""): RecurringForm {
  return { name: "", description: "", category_id: "", account_id: "", vendor_id: "", client_id: "", project_id: "", expense_currency: currency(code) ? code : "USD", expense_amount: "", frequency: "monthly", interval_count: "1", next_due_date: controlDate(date) ? date : "", end_date: "", tax_amount: "0", payment_method: "bank_transfer", reference: "", notes: "" };
}
export function blankPeriod(): PeriodForm { return { name: "", start_date: "", end_date: "" }; }
export function recurringCreatePayload(form: RecurringForm, meta: ControlMeta | null): ControlPayload<RecurringCreateBody> {
  if (!record(form) || Object.keys(blankRecurring()).some(key => !text(form[key as keyof RecurringForm]))) return { body: null, error: "Enter explicit schedule values; fields cannot be null." };
  if (!meta || !isControlMeta(meta)) return { body: null, error: "Load verified schedule setup options before creating." };
  const name = form.name.trim(), description = form.description.trim(), code = form.expense_currency.trim().toUpperCase();
  const expense = decimalInput(form.expense_amount), tax = decimalInput(form.tax_amount), count = Number(form.interval_count);
  const project = meta.projects.find(row => row.id === form.project_id), client = meta.clients.find(row => row.id === form.client_id);
  const reference = clean(form.reference), end = form.end_date || null;
  let error: string | null = null;
  if (!name || characters(name) > 180 || !description || characters(description) > 500) error = "Enter a name (1–180 characters) and description (1–500) after trimming.";
  else if (!meta.categories.some(row => row.id === form.category_id && row.is_active) || !meta.accounts.some(row => row.id === form.account_id && row.is_active)) error = "Choose an active category and account from the loaded setup options.";
  else if (form.vendor_id && !meta.vendors.some(row => row.id === form.vendor_id && row.is_active)) error = "Choose an active vendor from the loaded setup options.";
  else if (form.project_id && (!project || project.status === "cancelled")) error = "Choose an available, non-cancelled project from the latest 500 loaded projects.";
  else if (project && form.client_id && project.client_id !== form.client_id) error = "The selected project and client must belong together.";
  else if (form.client_id && !project && !client) error = "Choose a client from the first 500 loaded active clients.";
  else if (!currency(code)) error = "Use a three-letter expense currency.";
  else if (expense === null || !/[1-9]/.test(expense) || decimalExceedsLimit(expense, "1000000000000")) error = "Expense amount must be positive and no greater than 1,000,000,000,000.";
  else if (tax === null || controlCents(tax)! > controlCents(expense)!) error = "Tax must be non-negative and cannot exceed the rounded expense amount.";
  else if (!controlFrequencies.includes(form.frequency as typeof controlFrequencies[number]) || !/^\d+$/.test(form.interval_count.trim()) || !Number.isInteger(count) || count < 1 || count > 120) error = "Choose a supported frequency and a whole-number interval from 1 to 120.";
  else if (!controlDate(form.next_due_date) || !optionalDate(end) || end && end < form.next_due_date) error = "Choose valid due and end dates; the end cannot precede the next due date.";
  else if (!controlPaymentMethods.includes(form.payment_method as typeof controlPaymentMethods[number])) error = "Choose a supported payment method.";
  else if (reference && characters(reference) > 180) error = "Keep the reference within 180 characters.";
  if (error || expense === null || tax === null) return { body: null, error: error || "Verify the monetary values." };
  const rounded = (value: string) => (value.split(".")[1]?.length || 0) > 2;
  return { error: null, warning: rounded(expense) || rounded(tax) ? "The server rounds expense and tax separately to 2 decimal places using HALF_UP. Review the rounded amounts before creating." : null, body: {
    name, description, category_id: form.category_id, account_id: form.account_id, vendor_id: clean(form.vendor_id),
    client_id: project?.client_id || clean(form.client_id), project_id: clean(form.project_id), expense_currency: code,
    expense_amount: expense, frequency: form.frequency as RecurringCreateBody["frequency"], interval_count: count,
    next_due_date: form.next_due_date, end_date: end, tax_amount: tax,
    payment_method: form.payment_method as RecurringCreateBody["payment_method"], reference, notes: clean(form.notes),
  } };
}
function decimalExceedsLimit(value: string, limit: string) {
  const [whole, fraction = ""] = value.split(".");
  return whole.length > limit.length || whole.length === limit.length && (whole > limit || whole === limit && /[1-9]/.test(fraction));
}
export function periodCreatePayload(form: PeriodForm): ControlPayload<PeriodCreateBody> {
  if (!record(form) || !text(form.name) || !text(form.start_date) || !text(form.end_date)) return { body: null, error: "Enter explicit period values." };
  const name = form.name.trim();
  if (!name || characters(name) > 120) return { body: null, error: "Enter a period name with 1–120 characters after trimming." };
  if (!controlDate(form.start_date) || !controlDate(form.end_date) || form.end_date < form.start_date) return { body: null, error: "Choose valid inclusive dates; the end cannot precede the start." };
  return { error: null, body: { name, start_date: form.start_date, end_date: form.end_date } };
}
export function periodClosePayload(notes: string): ControlPayload<{ notes: string | null }> { return text(notes) ? { error: null, body: { notes: clean(notes) } } : { error: "Enter an explicit closing note or leave it blank.", body: null }; }
export function periodReopenPayload(reason: string): ControlPayload<{ reason: string }> {
  const value = text(reason) ? reason.trim() : "";
  return characters(value) >= 5 && characters(value) <= 2000 ? { error: null, body: { reason: value } } : { error: "Enter a reopening reason with 5–2000 characters after trimming.", body: null };
}
export function recurringMatchesCreate(value: unknown, body: RecurringCreateBody): value is ControlRecurring {
  return isRecurring(value) && value.is_active && !value.auto_post && Object.entries(body).every(([key, expected]) => key === "expense_amount" || key === "tax_amount" ? controlCents(value[key]) === controlCents(expected) : value[key as keyof ControlRecurring] === expected);
}
export function recurringMatchesStatus(value: unknown, id: string, active: boolean): value is ControlRecurring { return controlId(id) && typeof active === "boolean" && isRecurring(value) && value.id === id && value.is_active === active; }
export function automationMatchesToggle(value: unknown, id: string, enabled: boolean): value is ControlAutomation { return controlId(id) && typeof enabled === "boolean" && isAutomation(value) && value.id === id && value.auto_post === enabled; }
/** A retry response is a current schedule, not an expense receipt or an old-date equality proof. */
export function automationMatchesRetry(value: unknown, id: string): value is ControlAutomation { return controlId(id) && isAutomation(value) && value.id === id; }
export function periodMatchesCreate(value: unknown, body: PeriodCreateBody): value is ControlPeriod { return isPeriod(value) && value.status === "open" && value.name === body.name && value.start_date === body.start_date && value.end_date === body.end_date; }
export function periodMatchesAction(value: unknown, id: string, action: "close" | "reopen"): value is ControlPeriod { return controlId(id) && ["close", "reopen"].includes(action) && isPeriod(value) && value.id === id && value.status === (action === "close" ? "closed" : "open"); }
export function autoRetryPayload(expectedNextDueDate: string): ControlPayload<{ expected_next_due_date: string }> { return controlDate(expectedNextDueDate) ? { error: null, body: { expected_next_due_date: expectedNextDueDate } } : { error: "Reload the exact due occurrence before reviewing this attempt.", body: null }; }

export function postingAccountContext(schedule: Pick<ControlRecurring, "account_id">, accounts: ControlAccount[] | null): { account: ControlAccount | null; supported: boolean; warning: string | null } {
  const account = accounts && isControlAccounts(accounts) ? accounts.find(row => row.id === schedule.account_id) || null : null;
  if (!account) return { account: null, supported: false, warning: "Account type is not verified. Reload account setup; do not assume a cash account." };
  if (!account.is_active) return { account, supported: false, warning: "The saved account is inactive. New recurring posting is unavailable." };
  if (account.account_type === "credit_card") return { account, supported: false, warning: "Credit-card recurring posting is unsupported. Use a supported Money Out workflow; do not treat this as a cash account." };
  if (!["bank", "cash", "mobile_wallet", "payment_gateway", "petty_cash", "other", "wallet", "gateway"].includes(account.account_type)) return { account, supported: false, warning: "The saved account type is unknown. Verify account setup before a new posting." };
  return { account, supported: true, warning: null };
}
export function profitabilityContext(schedule: Pick<ControlRecurring, "client_id" | "project_id" | "expense_currency">, meta: ControlMeta | null): { currency: string | null; warning: string | null } {
  if (!schedule.client_id && !schedule.project_id) return currency(schedule.expense_currency) ? { currency: schedule.expense_currency, warning: null } : { currency: null, warning: "Expense currency is unavailable." };
  if (!meta || !isControlMeta(meta)) return { currency: null, warning: "Load setup context to verify profitability currency." };
  if (schedule.project_id) {
    const project = meta.projects.find(row => row.id === schedule.project_id);
    if (!project) return { currency: null, warning: "Saved project is outside the latest 500 loaded projects or unavailable. Its profitability currency is not verified." };
    if (schedule.client_id && project.client_id !== schedule.client_id) return { currency: null, warning: "Saved project and client context do not match. Verify the relationship before posting." };
    return { currency: project.currency, warning: null };
  }
  const client = meta.clients.find(row => row.id === schedule.client_id);
  if (!client) return { currency: null, warning: "Saved client is unavailable in the first 500 loaded active clients; its profitability currency is not verified." };
  // The existing posting handler explicitly uses expense currency for a PRESENT
  // client whose currency is null. Absence from capped metadata is not that case.
  if (client.currency) return { currency: client.currency, warning: null };
  return currency(schedule.expense_currency) ? { currency: schedule.expense_currency, warning: null } : { currency: null, warning: "Expense currency is unavailable for the saved client's configured fallback." };
}
export function pageRows<T>(rows: T[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / CONTROL_PAGE_SIZE)), current = Math.min(Number.isSafeInteger(page) && page > 0 ? page : 1, pages);
  return { rows: rows.slice((current - 1) * CONTROL_PAGE_SIZE, current * CONTROL_PAGE_SIZE), page: current, pages, total: rows.length };
}
