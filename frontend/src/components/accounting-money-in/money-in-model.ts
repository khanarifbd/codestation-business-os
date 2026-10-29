import { formatMoneyExact } from "@/lib/sales-money-preview";
import { transferCents } from "@/components/accounting-transfers/transfer-model";
export type Purpose = "invoice" | "project" | "order" | "advance" | "other";
export type ReceiptKind = "payment" | "advance" | "income";
export type Relation = "" | "client" | "order" | "project";
export type Account = {
    id: string;
    name: string;
    currency: string;
    account_type: string;
    current_balance: string | number;
    is_active: boolean;
};
export type Client = {
    id: string;
    code: string;
    name: string;
    currency: string | null;
};
export type Project = {
    id: string;
    number: string;
    order_id: string;
    client_id: string;
    name: string;
    currency: string;
    contract_value: string | number;
    status: string;
};
export type Order = {
    id: string;
    number: string;
    client_id: string;
    client_name: string;
    currency: string;
    total: string | number;
    status: string;
};
export type Meta = {
    accounts: Account[];
    clients: Client[];
    projects: Project[];
    orders: Order[];
};
export type Category = {
    id: string;
    name: string;
    category: string;
    is_active: boolean;
};
export type Invoice = {
    id: string;
    invoice_number: string;
    client_id: string;
    client_name: string;
    order_id: string | null;
    project_id: string | null;
    currency: string;
    total: string | number;
    balance_due: string | number;
    status: string;
    subject?: string | null;
};
export type Payment = {
    id: string;
    payment_number: string;
    invoice_id: string;
    invoice_number: string;
    client_name: string;
    account_id: string;
    account_name: string;
    payment_date: string;
    invoice_currency: string;
    account_currency: string;
    invoice_amount: string | number;
    account_amount: string | number;
    exchange_rate: string | number;
    status: string;
    method: string;
    reference: string | null;
    notes: string | null;
};
export type Advance = {
    id: string;
    client_id: string;
    client_name: string;
    financial_account_id: string;
    financial_account_name: string;
    advance_date: string;
    currency: string;
    original_amount: string | number;
    remaining_amount: string | number;
    reference: string | null;
    notes: string | null;
};
export type Income = {
    id: string;
    kind: string;
    financial_account_id: string;
    financial_account_name: string;
    category_ledger_account_id: string;
    category_ledger_account_name: string;
    entry_date: string;
    currency: string;
    amount: string | number;
    description: string;
    source_label: string | null;
    source_type: string | null;
    source_id: string | null;
    reference: string | null;
    notes: string | null;
};
export type Receipt = {
    kind: "payment";
    record: Payment;
} | {
    kind: "advance";
    record: Advance;
} | {
    kind: "income";
    record: Income;
};
export type MoneyInValues = {
    source_id: string;
    account_id: string;
    amount: string;
    date: string;
    method: string;
    category_id: string;
    description: string;
    reference: string;
    notes: string;
    relation_type: Relation;
    relation_id: string;
};
export type MoneyInBrowse = {
    kind: ReceiptKind;
    cursor: string;
    page: number;
    invoice_id: string;
    focus: string;
};
export type InvoicePage = {
    items: Invoice[];
    next_cursor: string | null;
};
export const purposes: {
    value: Purpose;
    title: string;
    help: string;
}[] = [
    { value: "invoice", title: "Invoice payment", help: "Receive against an issued invoice. Reduce its receivable; do not record income twice." },
    { value: "project", title: "Project payment", help: "Use or create a project invoice, issue it, then record the payment. Each step is saved separately." },
    { value: "order", title: "Order payment", help: "Use or create an order invoice, issue it, then record the payment. Staged billing remains separate." },
    { value: "advance", title: "Client advance", help: "Receive customer credit before invoicing. This is a liability, not income." },
    { value: "other", title: "Other income", help: "Record direct income to an income category, optionally related to a business record." },
];
export const initialMoneyInValues = (): MoneyInValues => ({ source_id: "", account_id: "", amount: "", date: new Date().toISOString().slice(0, 10), method: "bank_transfer", category_id: "", description: "", reference: "", notes: "", relation_type: "", relation_id: "" });
export const moneyInMoney = formatMoneyExact;
export const eligibleAccount = (a: Account) => a.is_active && a.account_type !== "credit_card";
const record = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const fields = (x: Record<string, unknown>, keys: string[]) => keys.every(k => typeof x[k] === "string" && x[k] !== "");
const amount = (x: unknown) => (typeof x === "string" || typeof x === "number") && transferCents(x) !== null;
export function isInvoice(x: unknown): x is Invoice { return record(x) && fields(x, ["id", "invoice_number", "client_id", "client_name", "currency", "status"]) && amount(x.total) && amount(x.balance_due) && (x.order_id === null || typeof x.order_id === "string") && (x.project_id === null || typeof x.project_id === "string"); }
export function isInvoicePage(x: unknown): x is InvoicePage { return record(x) && Array.isArray(x.items) && x.items.every(isInvoice) && (x.next_cursor === null || typeof x.next_cursor === "string"); }
export function isMeta(x: unknown): x is Meta { return record(x) && Array.isArray(x.accounts) && x.accounts.every(a => record(a) && fields(a, ["id", "name", "currency", "account_type"]) && amount(a.current_balance) && typeof a.is_active === "boolean") && Array.isArray(x.clients) && x.clients.every(a => record(a) && fields(a, ["id", "code", "name"])) && Array.isArray(x.orders) && x.orders.every(a => record(a) && fields(a, ["id", "number", "client_id", "client_name", "currency", "status"]) && amount(a.total)) && Array.isArray(x.projects) && x.projects.every(a => record(a) && fields(a, ["id", "number", "order_id", "client_id", "name", "currency", "status"]) && amount(a.contract_value)); }
export function asReceipt(kind: ReceiptKind, x: unknown): Receipt | null {
    if (!record(x) || !fields(x, ["id"]))
        return null;
    if (kind === "payment" && fields(x, ["payment_number", "invoice_id", "invoice_number", "client_name", "account_id", "account_name", "payment_date", "invoice_currency", "account_currency", "status", "method"]) && amount(x.invoice_amount) && amount(x.account_amount))
        return { kind, record: x as Payment };
    if (kind === "advance" && fields(x, ["client_id", "client_name", "financial_account_id", "financial_account_name", "advance_date", "currency"]) && amount(x.original_amount) && amount(x.remaining_amount))
        return { kind, record: x as Advance };
    if (kind === "income" && x.kind === "income" && fields(x, ["financial_account_id", "financial_account_name", "category_ledger_account_id", "category_ledger_account_name", "entry_date", "currency", "description"]) && amount(x.amount))
        return { kind, record: x as Income };
    return null;
}
export function receiptInfo(r: Receipt) { return r.kind === "payment" ? { title: r.record.payment_number, context: `${r.record.invoice_number} · ${r.record.client_name}`, date: r.record.payment_date, amount: r.record.invoice_amount, currency: r.record.invoice_currency, account: r.record.account_name, status: r.record.status } : r.kind === "advance" ? { title: r.record.client_name, context: "Customer advance · not income", date: r.record.advance_date, amount: r.record.original_amount, currency: r.record.currency, account: r.record.financial_account_name, status: "Customer credit" } : { title: r.record.description, context: r.record.source_label || r.record.category_ledger_account_name, date: r.record.entry_date, amount: r.record.amount, currency: r.record.currency, account: r.record.financial_account_name, status: "Direct income" }; }
/** Preserve the existing JSON-number wire contract, but refuse a lossy cent value rather than display a different amount. */
export function moneyInAmount(raw: string): number | null { const n = Number(raw), cents = transferCents(raw); return raw.trim() && Number.isFinite(n) && n >= 0.01 && cents !== null && cents <= BigInt("999999999999999999") && transferCents(String(n)) === cents ? n : null; }
export function moneyInPayload(purpose: Purpose, values: MoneyInValues, invoiceId: string) {
    const value = moneyInAmount(values.amount);
    if (value === null)
        throw new Error("Enter a positive amount whose cents can be represented safely.");
    const common = { reference: values.reference || null, notes: values.notes || null };
    if (purpose === "advance")
        return { path: "/api/accounting/customer-advances", kind: "advance" as const, body: { client_id: values.source_id, financial_account_id: values.account_id, advance_date: values.date, amount: value, ...common } };
    if (purpose === "other")
        return { path: "/api/accounting/money", kind: "income" as const, body: { kind: "income", entry_date: values.date, financial_account_id: values.account_id, category_ledger_account_id: values.category_id, amount: value, description: values.description, ...common, source_type: values.relation_type || null, source_id: values.relation_id || null } };
    return { path: "/api/finance/payments", kind: "payment" as const, body: { invoice_id: invoiceId, account_id: values.account_id, payment_date: values.date, invoice_amount: value, method: values.method, ...common } };
}
export const invoiceCollectible = (i: Invoice) => !["draft", "cancelled", "paid"].includes(i.status) && (transferCents(i.balance_due) ?? BigInt(0)) > BigInt(0);
export type SourceIdentity = {
    purpose: Purpose;
    id: string;
    orderId: string;
    projectId: string;
    clientId: string;
    currency: string;
};
export function invoiceMatches(i: Invoice, s: SourceIdentity) { return i.currency === s.currency && (!s.clientId || i.client_id === s.clientId) && (s.purpose === "invoice" ? i.id === s.id : i.order_id === s.orderId && (s.purpose !== "project" || i.project_id === s.projectId)); }
