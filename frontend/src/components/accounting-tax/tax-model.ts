import { centsText, decimalInput } from "@/components/accounting-money-out/money-out-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { settlementTypes, taxKinds } from "./tax-types";
import type { SettlementBody, SettlementForm, SettlementMeta, TaxCode, TaxCodeCreateBody, TaxCodeForm, TaxCodePatch, TaxReport, TaxReportBrowse, TaxSettlement } from "./tax-types";
export const taxMoney = formatMoneyExact, taxCentsText = centsText;
export const TAX_PAGE_SIZE = 20, SETTLEMENT_REGISTER_CAP = 50, SETTLEMENT_DETAIL_CAP = 500;
const MAX_MONEY = BigInt("999999999999999999"), MAX_RATE = BigInt(10000000), MAX_RECOVERABLE = BigInt(1000000);
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown): v is string => typeof v === "string";
const present = (v: unknown): v is string => text(v) && v.trim().length > 0;
const nullable = (v: unknown) => v === null || text(v);
const currency = (v: unknown): v is string => text(v) && /^[A-Z]{3}$/.test(v);
const characters = (v: string) => Array.from(v).length;
const clean = (v: string) => v.trim() || null;
export const taxId = (v: unknown): v is string => text(v) && /^[A-Za-z0-9_-]{1,200}$/.test(v) && !["new", "edit", "codes", "settlements"].includes(v);
export const pretty = (v: string | null | undefined) => v ? v.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()) : "—";
export function taxDate(v: unknown): v is string { if (!text(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith("0000-")) return false; const d = new Date(v + "T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; }
export function taxToday(timezone: string | undefined, now: Date = new Date()): string {
  if (!timezone || !Number.isFinite(now.getTime())) return "";
  try { const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", calendar: "gregory", numberingSystem: "latn" }).formatToParts(now), get = (type: string) => parts.find(part => part.type === type)?.value || ""; const date = `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`; return taxDate(date) ? date : ""; } catch { return ""; }
}
function scaled(v: unknown, digits: number): bigint | null {
  if (!text(v) && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER)) return null;
  const raw = String(v).trim(), negative = raw.startsWith("-"), canonical = decimalInput(negative ? raw.slice(1) : raw);
  if (canonical === null || negative && raw[1] === "+") return null;
  const [whole, fraction = ""] = canonical.split("."); if (fraction.length > digits) return null;
  return (negative ? -BigInt(1) : BigInt(1)) * (BigInt(whole) * BigInt(10) ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0"));
}
export const taxCents = (v: unknown) => scaled(v, 2);
const percent = (v: unknown, recoverable = false) => { const n = scaled(v, 4); return n !== null && n >= BigInt(0) && n <= (recoverable ? MAX_RECOVERABLE : MAX_RATE); };
export function taxRate(v: unknown) { const n = scaled(v, 4); return n === null || n < BigInt(0) || n > MAX_RATE ? "—" : `${n / BigInt(10000)}.${String(n % BigInt(10000)).padStart(4, "0")}`; }
function amount(v: unknown, { signed = false, stored = false, positive = false } = {}) { const n = taxCents(v); return n !== null && (signed || n >= BigInt(0)) && (!positive || n > BigInt(0)) && (!stored || n <= MAX_MONEY && n >= -MAX_MONEY); }
const optionalDate = (v: unknown) => v === null || taxDate(v);
const timestamp = (v: unknown) => text(v) && taxDate(v.slice(0, 10)) && v[10] === "T" && Number.isFinite(Date.parse(v));
const unique = <T,>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;
export function isTaxCode(v: unknown): v is TaxCode { return record(v) && taxId(v.id) && present(v.code) && present(v.name) && taxKinds.includes(v.tax_kind as TaxCode["tax_kind"]) && percent(v.rate) && percent(v.recoverable_percent, true) && (v.country_code === null || text(v.country_code) && characters(v.country_code) === 2) && nullable(v.jurisdiction) && optionalDate(v.effective_from) && optionalDate(v.effective_to) && (!v.effective_from || !v.effective_to || String(v.effective_from) <= String(v.effective_to)) && typeof v.is_active === "boolean" && nullable(v.notes); }
export function isTaxCodeList(v: unknown): v is TaxCode[] { return Array.isArray(v) && v.every(isTaxCode) && unique(v, row => row.id); }
export function isTaxReport(v: unknown): v is TaxReport { return record(v) && taxDate(v.date_from) && taxDate(v.date_to) && v.date_from <= v.date_to && Array.isArray(v.rows) && v.rows.every(row => record(row) && currency(row.currency) && ["output_tax", "input_tax", "recoverable_input_tax", "withholding_tax"].every(key => amount(row[key])) && amount(row.net_indirect_tax_payable, { signed: true }) && taxCents(row.output_tax)! - taxCents(row.recoverable_input_tax)! === taxCents(row.net_indirect_tax_payable)) && unique(v.rows, row => row.currency); }
export function reportMatchesDates(v: unknown, range: TaxReportBrowse): v is TaxReport { if (!taxDate(range.date_from) || !taxDate(range.date_to) || !isTaxReport(v)) return false; const [from, to] = [range.date_from, range.date_to].sort(); return v.date_from === from && v.date_to === to; }
export function isSettlementMeta(v: unknown): v is SettlementMeta { return record(v) && currency(v.currency) && Array.isArray(v.accounts) && v.accounts.every(row => record(row) && taxId(row.id) && present(row.name) && amount(row.balance, { signed: true })) && unique(v.accounts, row => row.id); }
export function isTaxSettlement(v: unknown): v is TaxSettlement { return record(v) && taxId(v.id) && settlementTypes.includes(v.settlement_type as TaxSettlement["settlement_type"]) && taxDate(v.settlement_date) && currency(v.currency) && amount(v.amount, { stored: true, positive: true }) && (v.settlement_type === "input_tax_offset" ? v.account_id === null : taxId(v.account_id)) && nullable(v.reference) && nullable(v.notes) && timestamp(v.created_at); }
export function isSettlementList(v: unknown): v is TaxSettlement[] { return Array.isArray(v) && v.length <= SETTLEMENT_DETAIL_CAP && v.every(isTaxSettlement) && unique(v, row => row.id); }
export function isRecentSettlementList(v: unknown): v is TaxSettlement[] { return isSettlementList(v) && v.length <= SETTLEMENT_REGISTER_CAP; }
export function taxCodeForm(code: TaxCode): TaxCodeForm { return { code: code.code, name: code.name, tax_kind: code.tax_kind, rate: taxRate(code.rate), recoverable_percent: taxRate(code.recoverable_percent), country_code: code.country_code || "", jurisdiction: code.jurisdiction || "", effective_from: code.effective_from || "", effective_to: code.effective_to || "", notes: code.notes || "", is_active: code.is_active }; }
function validForm(form: TaxCodeForm) { return ["code", "name", "rate", "recoverable_percent", "country_code", "jurisdiction", "effective_from", "effective_to", "notes"].every(key => text(form[key as keyof TaxCodeForm])) && typeof form.is_active === "boolean" && taxKinds.includes(form.tax_kind); }
function normalizedCode(form: TaxCodeForm, creating: boolean): { error: string | null; body: TaxCodeCreateBody | null } {
  if (!validForm(form)) return { error: "Code identity, rates and active state must have explicit non-null values.", body: null };
  if (creating && !form.is_active) return { error: "New tax codes are created active; change active status only in the existing-code editor.", body: null };
  const code = form.code.trim().toUpperCase(), name = form.name.trim(), country = clean(form.country_code)?.toUpperCase() || null, jurisdiction = clean(form.jurisdiction), from = form.effective_from || null, to = form.effective_to || null;
  let error: string | null = null;
  if (characters(code) < 1 || characters(code) > 40 || characters(name) < 2 || characters(name) > 160) error = "Enter a code (1–40 characters) and name (2–160) after trimming.";
  else if (!percent(form.rate) || form.tax_kind === "purchase" && !percent(form.recoverable_percent, true)) error = "Use exact rates with at most 4 decimal places: tax 0–1000 and purchase recoverability 0–100.";
  else if (country && characters(country) !== 2 || jurisdiction && characters(jurisdiction) > 120) error = "Country must have 2 characters; jurisdiction may have up to 120.";
  else if (!optionalDate(from) || !optionalDate(to) || from && to && from > to) error = "Choose valid effective dates; the end cannot precede the start.";
  if (error) return { error, body: null };
  return { error: null, body: { code, name, tax_kind: form.tax_kind, rate: taxRate(form.rate), recoverable_percent: form.tax_kind === "purchase" ? taxRate(form.recoverable_percent) : "100.0000", country_code: country, jurisdiction, effective_from: from, effective_to: to, notes: clean(form.notes) } };
}
export const codeCreatePayload = (form: TaxCodeForm) => normalizedCode(form, true);
export function codeUpdatePayload(form: TaxCodeForm, original: TaxCode | null): { error: string | null; body: TaxCodePatch | null } {
  if (!original || !isTaxCode(original)) return { error: "Load the exact saved tax code before editing.", body: null };
  const checked = normalizedCode(form, false); if (!checked.body) return { error: checked.error, body: null };
  const next = checked.body;
  if (next.code !== original.code || next.tax_kind !== original.tax_kind || next.country_code !== original.country_code) return { error: "Code, kind and country are read-only for an existing tax code.", body: null };
  const body: TaxCodePatch = {};
  if (next.name !== original.name.trim()) body.name = next.name;
  if (scaled(next.rate, 4) !== scaled(original.rate, 4)) body.rate = next.rate;
  if (original.tax_kind === "purchase" && scaled(next.recoverable_percent, 4) !== scaled(original.recoverable_percent, 4)) body.recoverable_percent = next.recoverable_percent;
  if (next.jurisdiction !== clean(original.jurisdiction || "")) body.jurisdiction = next.jurisdiction;
  if (next.effective_from !== original.effective_from) body.effective_from = next.effective_from;
  if (next.effective_to !== original.effective_to) body.effective_to = next.effective_to;
  if (next.notes !== clean(original.notes || "")) body.notes = next.notes;
  if (form.is_active !== original.is_active) body.is_active = form.is_active;
  return Object.keys(body).length ? { error: null, body } : { error: "No changes to save.", body: null };
}
export function codeMatchesCreate(v: unknown, body: TaxCodeCreateBody): v is TaxCode { return isTaxCode(v) && v.code === body.code && v.name === body.name && v.tax_kind === body.tax_kind && scaled(v.rate, 4) === scaled(body.rate, 4) && scaled(v.recoverable_percent, 4) === scaled(body.recoverable_percent, 4) && v.country_code === body.country_code && v.jurisdiction === body.jurisdiction && v.effective_from === body.effective_from && v.effective_to === body.effective_to && v.notes === body.notes && v.is_active; }
export function codeMatchesUpdate(v: unknown, original: TaxCode, body: TaxCodePatch): v is TaxCode {
  if (!isTaxCode(v) || v.id !== original.id || v.code !== original.code || v.tax_kind !== original.tax_kind || v.country_code !== original.country_code) return false;
  return Object.entries(body).every(([key, value]) => key === "rate" || key === "recoverable_percent" ? scaled(v[key], 4) === scaled(value, 4) : v[key as keyof TaxCode] === value);
}
export function settlementPayload(form: SettlementForm, meta: SettlementMeta | null): { error: string | null; body: SettlementBody | null; warning: string | null } {
  if (!["settlement_date", "amount", "account_id", "reference", "notes"].every(key => text(form[key as keyof SettlementForm]))) return { error: "Enter explicit settlement values; required fields cannot be null.", body: null, warning: null };
  const amountValue = taxCents(form.amount), reference = clean(form.reference), offset = form.settlement_type === "input_tax_offset";
  const account = meta && isSettlementMeta(meta) ? meta.accounts.find(row => row.id === form.account_id) : null;
  let error: string | null = null;
  if (!meta || !isSettlementMeta(meta)) error = "Load verified metadata for the selected settlement date.";
  else if (!settlementTypes.includes(form.settlement_type) || !taxDate(form.settlement_date)) error = "Choose a valid settlement type and date.";
  else if (!amount(form.amount, { stored: true, positive: true }) || amountValue === null) error = "Use a positive, exactly representable amount with at most 2 decimal places and 16 whole digits.";
  else if (!offset && !account) error = "Choose an account from the verified date-specific metadata.";
  else if (reference && characters(reference) > 180) error = "Keep the reference within 180 characters.";
  if (error || amountValue === null) return { error: error || "Verify the settlement amount.", body: null, warning: null };
  const payment = form.settlement_type === "indirect_tax_payment" || form.settlement_type === "withholding_tax_payment";
  const warning = payment && account && amountValue > taxCents(account.balance)! ? "Amount exceeds the last-read account balance. Refresh or verify funding; the server rechecks available balance when posting." : null;
  return { error: null, warning, body: { settlement_type: form.settlement_type, settlement_date: form.settlement_date, amount: centsText(amountValue), account_id: offset ? null : form.account_id, reference, notes: clean(form.notes) } };
}
export function settlementMatchesPayload(v: unknown, body: SettlementBody, functionalCurrency: string): v is TaxSettlement { return isTaxSettlement(v) && v.settlement_type === body.settlement_type && v.settlement_date === body.settlement_date && v.currency === functionalCurrency && taxCents(v.amount) === taxCents(body.amount) && v.account_id === body.account_id && v.reference === body.reference && v.notes === body.notes; }
export function pageRows<T>(rows: T[], page: number) { const pages = Math.max(1, Math.ceil(rows.length / TAX_PAGE_SIZE)), current = Math.min(Number.isSafeInteger(page) && page > 0 ? page : 1, pages); return { rows: rows.slice((current - 1) * TAX_PAGE_SIZE, current * TAX_PAGE_SIZE), page: current, pages, total: rows.length }; }
