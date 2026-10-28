import { formatMoneyExact } from "@/lib/sales-money-preview";
import type { PortalContext, PortalDetailMap, PortalKind, PortalRecordMap } from "./portal-types";

const ZERO = BigInt(0);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);
const present = (value: unknown) => text(value) && value.trim().length > 0;
const currency = (value: unknown) => text(value) && /^[A-Z]{3}$/.test(value);
const nullableCurrency = (value: unknown) => value === null || currency(value);
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value);
const count = (value: unknown) => integer(value) && (value as number) >= 0;
const progress = (value: unknown) => count(value) && (value as number) <= 100;
export const portalId = (value: unknown): value is string => text(value) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const nullableId = (value: unknown) => value === null || portalId(value);
const unique = <T,>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;

/** Bounded exact decimal parsing for read-only display and sign checks, not financial recomputation. */
function decimal(value: unknown): { coefficient: bigint; exponent: number } | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) return null;
  const raw = String(value);
  if (!raw || raw.length > 100) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match) return null;
  const exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 400) return null;
  return { coefficient: BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${match[3] || ""}`), exponent };
}
export const portalAmount = (value: unknown): value is string | number => decimal(value) !== null;
export function portalPositive(value: unknown) { return (decimal(value)?.coefficient ?? ZERO) > ZERO; }
export function portalMoney(value: unknown, code: string) {
  return portalAmount(value) ? formatMoneyExact(value, code) : `${code} —`;
}
/** Preserve quantity/rate precision instead of rounding to money cents or converting the whole value to Number. */
export function portalDecimalText(value: unknown) {
  const parsed = decimal(value);
  if (!parsed) return "—";
  const negative = parsed.coefficient < ZERO;
  let digits = String(negative ? -parsed.coefficient : parsed.coefficient), fraction = "";
  if (parsed.exponent >= 0) digits += "0".repeat(parsed.exponent);
  else {
    const places = -parsed.exponent;
    digits = digits.padStart(places + 1, "0");
    fraction = digits.slice(-places).replace(/0+$/, "");
    digits = digits.slice(0, -places);
  }
  const whole = BigInt(digits);
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const signedWhole = negative && whole === ZERO ? -0 : negative ? -whole : whole;
  const wholeText = formatter.format(signedWhole);
  if (!fraction) return wholeText;
  const separator = new Intl.NumberFormat().formatToParts(1.1).find(part => part.type === "decimal")?.value || ".";
  const digitFormat = new Intl.NumberFormat(undefined, { useGrouping: false });
  return `${wholeText}${separator}${[...fraction].map(digit => digitFormat.format(Number(digit))).join("")}`;
}
export function portalDate(value: unknown): value is string {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const nullableDate = (value: unknown) => value === null || portalDate(value);
const timestamp = (value: unknown) => text(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && portalDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) => value === null || timestamp(value);
const fields = (row: Record<string, unknown>, keys: string[], validate: (value: unknown) => boolean) => keys.every(key => validate(row[key]));

export function isPortalContext(value: unknown): value is PortalContext {
  if (!record(value) || !portalId(value.organization_id) || !portalId(value.membership_id) || !text(value.organization_name)) return false;
  if (!fields(value, ["project_count", "order_count", "quotation_count"], count)) return false;
  if (!Array.isArray(value.clients) || !value.clients.length || !value.clients.every(row => record(row) && portalId(row.id) && fields(row, ["client_code", "display_name", "client_type"], text) && fields(row, ["email", "phone"], nullableText) && nullableCurrency(row.currency) && typeof row.is_primary_contact === "boolean") || !unique(value.clients, row => row.id)) return false;
  return Array.isArray(value.financials) && value.financials.every(row => record(row) && currency(row.currency) && count(row.invoice_count) && portalAmount(row.invoiced_total) && portalAmount(row.balance_due)) && unique(value.financials, row => row.currency);
}
function baseRecord(value: unknown): value is Record<string, unknown> {
  return record(value) && portalId(value.id) && portalId(value.client_id) && present(value.status) && currency(value.currency);
}
export function isPortalRecord<K extends PortalKind>(kind: K, value: unknown): value is PortalRecordMap[K] {
  if (!baseRecord(value)) return false;
  if (kind === "projects") return text(value.project_number) && text(value.name) && progress(value.progress_percent) && nullableDate(value.planned_start_date) && nullableDate(value.due_date) && portalAmount(value.contract_value) && nullableText(value.description) && nullableTimestamp(value.actual_started_at) && nullableTimestamp(value.completed_at);
  if (kind === "orders") return text(value.order_number) && nullableId(value.quotation_id) && nullableText(value.subject) && portalDate(value.order_date) && fields(value, ["total", "approved_change_value", "revised_contract_value"], portalAmount) && timestamp(value.confirmed_at) && fields(value, ["started_at", "completed_at", "cancelled_at"], nullableTimestamp);
  if (value.status === "draft" || value.status === "cancelled") return false;
  if (kind === "quotations") return text(value.quotation_number) && nullableText(value.subject) && portalDate(value.issue_date) && nullableDate(value.valid_until) && portalAmount(value.total);
  return kind === "invoices" && text(value.invoice_number) && nullableId(value.project_id) && nullableId(value.quotation_id) && nullableText(value.subject) && portalDate(value.issue_date) && nullableDate(value.due_date) && fields(value, ["total", "amount_paid", "balance_due"], portalAmount);
}
export function isPortalList<K extends PortalKind>(kind: K, value: unknown): value is PortalRecordMap[K][] {
  return Array.isArray(value) && value.every(row => isPortalRecord(kind, row)) && unique(value, row => row.id);
}
function commercialDetails(value: Record<string, unknown>) {
  return fields(value, ["seller_name", "client_name"], text)
    && fields(value, ["seller_email", "seller_address", "client_contact", "client_email", "client_address", "notes", "terms_conditions"], nullableText)
    && fields(value, ["subtotal", "discount_total", "tax_total"], portalAmount);
}
function commercialItem(value: unknown, order: boolean): value is Record<string, unknown> & { id: string } {
  if (!record(value) || !portalId(value.id) || !fields(value, ["item_name", "description", "unit"], text) || !fields(value, ["quantity", "unit_price", "discount_percent", "tax_rate", "line_total"], portalAmount)) return false;
  return !order || (value.service_duration_months === null || count(value.service_duration_months)) && nullableDate(value.service_start_date) && nullableDate(value.service_end_date);
}
export function isPortalDocument<K extends PortalKind>(kind: K, value: unknown): value is PortalDetailMap[K] {
  // Keep detail-only fields on a validated record, separate from the generic base DTO narrowing.
  const detail: unknown = value;
  if (!isPortalRecord(kind, value) || !record(detail)) return false;
  if (kind === "projects") return Array.isArray(detail.milestones) && detail.milestones.every(row => record(row) && portalId(row.id) && text(row.title) && nullableText(row.description) && present(row.status) && progress(row.progress_percent) && nullableDate(row.due_date) && nullableTimestamp(row.completed_at)) && unique(detail.milestones, row => row.id);
  if (!commercialDetails(detail) || !Array.isArray(detail.items) || !detail.items.every(row => commercialItem(row, kind === "orders")) || !unique(detail.items, row => row.id)) return false;
  if (kind === "orders") return true;
  if (kind === "quotations") return nullableTimestamp(detail.accepted_at) && nullableTimestamp(detail.rejected_at);
  return fields(detail, ["payment_method", "payment_account_name", "payment_provider", "payment_account_holder", "payment_account_reference", "payment_url", "payment_instructions"], nullableText)
    && nullableCurrency(detail.payment_currency)
    && Array.isArray(detail.payments) && detail.payments.every(row => record(row) && portalId(row.id) && portalDate(row.payment_date) && currency(row.invoice_currency) && portalAmount(row.invoice_amount) && text(row.method) && nullableText(row.reference)) && unique(detail.payments, row => row.id);
}
/** Validate an existing link for rendering only. Never fetch, prefetch, open or transform a signed payment capability. */
export function portalPaymentHref(value: unknown): string | null {
  if (!text(value) || !value || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const relative = value.startsWith("/") && !value.startsWith("//");
    if (!relative && !/^https?:\/\//i.test(value)) return null;
    const parsed = new URL(value, "https://portal.invalid");
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    if (relative && parsed.origin !== "https://portal.invalid") return null;
    return value;
  } catch { return null; }
}
