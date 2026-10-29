import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const agingBuckets: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];
export type ReceivableInvoice = {
    id: string;
    client_id: string;
    invoice_number: string;
    client_name: string;
    status: string;
    display_status: string;
    issue_date: string;
    due_date: string | null;
    currency: string;
    total: string | number;
    amount_paid: string | number;
    balance_due: string | number;
};
export type ReceivableRow = ReceivableInvoice & {
    days_overdue: number;
    aging_bucket: AgingBucket;
    available_credit: string | number;
};
export type ReceivableAdvance = {
    id: string;
    advance_date: string;
    currency: string;
    original_amount: string | number;
    remaining_amount: string | number;
    reference: string | null;
};
export type CurrentAdvance = ReceivableAdvance & {
    client_id: string;
    client_name: string;
    financial_account_id: string;
    financial_account_name: string;
    notes: string | null;
};
export type CurrencyTotal = {
    currency: string;
    amount: string | number;
};
export type ReceivablePage = {
    items: ReceivableRow[];
    next_cursor: string | null;
    open_invoice_count: number;
    overdue_count: number;
    filtered_count: number;
    outstanding_by_currency: CurrencyTotal[];
    credit_by_currency: CurrencyTotal[];
    aging: (CurrencyTotal & {
        bucket: AgingBucket;
    })[];
};
export type ReceivableBrowse = {
    search: string;
    aging: "all" | AgingBucket;
    currency: string;
    cursor: string;
    page: number;
    focus: string;
};
export type CreditValues = {
    advance_id: string;
    amount: string;
    application_date: string;
};
export type CreditPhase = "idle" | "uncertain" | "confirmed";
export type CreditOperation = {
    key: string;
    body: string;
    advanceId: string;
    invoiceId: string;
    clientId: string;
    currency: string;
    invoiceNumber: string;
    clientName: string;
    amount: string;
    applicationDate: string;
    advanceDate: string;
};
const record = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const strings = (x: Record<string, unknown>, keys: string[]) => keys.every(k => typeof x[k] === "string" && x[k] !== "");
const money = (x: unknown) => (typeof x === "string" || typeof x === "number") && transferCents(x) !== null;
const count = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
export function validCreditDate(raw: unknown): raw is string { if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return false; const date = new Date(`${raw}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw; }
export function isReceivableInvoice(x: unknown): x is ReceivableInvoice { return record(x) && strings(x, ["id", "client_id", "invoice_number", "client_name", "status", "display_status", "currency"]) && validCreditDate(x.issue_date) && (x.due_date === null || validCreditDate(x.due_date)) && ["total", "amount_paid", "balance_due"].every(k => money(x[k])); }
export function isReceivableAdvance(x: unknown): x is ReceivableAdvance { return record(x) && strings(x, ["id", "currency"]) && validCreditDate(x.advance_date) && money(x.original_amount) && money(x.remaining_amount) && (x.reference === null || typeof x.reference === "string"); }
export function isCurrentAdvance(x: unknown): x is CurrentAdvance { return record(x) && strings(x, ["client_id", "client_name", "financial_account_id", "financial_account_name"]) && (x.notes === null || typeof x.notes === "string") && isReceivableAdvance(x); }
export function isReceivablePage(x: unknown): x is ReceivablePage {
    const total = (t: unknown) => record(t) && strings(t, ["currency"]) && money(t.amount);
    return record(x) && Array.isArray(x.items) && x.items.every(r => record(r) && count(r.days_overdue) && agingBuckets.includes(r.aging_bucket as AgingBucket) && money(r.available_credit) && isReceivableInvoice(r)) && (x.next_cursor === null || typeof x.next_cursor === "string") && ["open_invoice_count", "overdue_count", "filtered_count"].every(k => count(x[k])) && ["outstanding_by_currency", "credit_by_currency"].every(k => Array.isArray(x[k]) && x[k].every(total)) && Array.isArray(x.aging) && x.aging.every(t => total(t) && record(t) && agingBuckets.includes(t.bucket as AgingBucket));
}
export const receivableMoney = formatMoneyExact;
export const bucketLabel = (bucket: AgingBucket) => bucket === "current" ? "Current / not overdue" : `${bucket} days overdue`;
export const openReceivable = (invoice: ReceivableInvoice) => !["draft", "cancelled", "paid"].includes(invoice.status) && (transferCents(invoice.balance_due) ?? BigInt(0)) > BigInt(0);
export function centsText(cents: bigint) { return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`; }
export function creditMaximum(invoice: ReceivableInvoice | null, advance: ReceivableAdvance | null) { const balance = invoice ? transferCents(invoice.balance_due) : null, credit = advance ? transferCents(advance.remaining_amount) : null; return balance !== null && credit !== null && balance > BigInt(0) && credit > BigInt(0) ? centsText(balance < credit ? balance : credit) : ""; }
export function creditToday(timezone: string | undefined, date = new Date()) { try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date), value = (part: string) => parts.find(p => p.type === part)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
}
catch {
    return date.toISOString().slice(0, 10);
} }
/** Keep the existing JSON-number wire contract. Refuse a cent value that Number serialization changes. */
export function creditAmount(raw: string): {
    cents: bigint;
    numeric: number;
    text: string;
} | null {
    if (!raw || raw.length > 100)
        return null;
    const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
    if (!match)
        return null;
    const power = Number(match[3] || 0) - (match[2]?.length || 0) + 2;
    if (!Number.isSafeInteger(power) || Math.abs(power) > 400)
        return null;
    const coefficient = BigInt(match[1] + (match[2] || "")), scale = BigInt(10) ** BigInt(Math.abs(power));
    if (power < 0 && coefficient % scale !== BigInt(0))
        return null;
    const cents = power < 0 ? coefficient / scale : coefficient * scale, numeric = Number(raw);
    if (cents <= BigInt(0) || cents > BigInt("999999999999999999") || !Number.isFinite(numeric) || transferCents(JSON.stringify(numeric)) !== cents)
        return null;
    return { cents, numeric, text: centsText(cents) };
}
export function creditValidation(values: CreditValues, invoice: ReceivableInvoice | null, advance: ReceivableAdvance | null): string | null {
    if (!invoice || !advance || advance.id !== values.advance_id)
        return "Choose verified customer credit for this invoice.";
    if (!openReceivable(invoice))
        return "Credit can only be applied to an open invoice with an outstanding balance.";
    if (advance.currency !== invoice.currency)
        return "The advance and invoice must use the same currency.";
    if (!validCreditDate(values.application_date))
        return "Enter a valid application date.";
    if (values.application_date < invoice.issue_date || values.application_date < advance.advance_date)
        return "Application date cannot be earlier than the invoice issue date or advance receipt date.";
    const amount = creditAmount(values.amount), maximum = creditMaximum(invoice, advance);
    if (!amount)
        return "Enter a positive amount with at most two decimal places that the existing request can represent exactly.";
    if (!maximum || amount.cents > transferCents(maximum)!)
        return "The amount exceeds the last loaded invoice balance or available customer credit. Refresh before changing the operation.";
    return null;
}
export function creditPayload(values: CreditValues, invoiceId: string) { const amount = creditAmount(values.amount); if (!amount)
    return null; return { invoice_id: invoiceId, application_date: values.application_date, amount: amount.numeric }; }
