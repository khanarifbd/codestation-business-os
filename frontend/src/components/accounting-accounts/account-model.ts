import type { FinancialAccountEditData } from "@/components/financial-account-edit-panel";
export type FinancialAccount = FinancialAccountEditData;
export type AccountType = "bank" | "cash" | "mobile_wallet" | "credit_card" | "payment_gateway" | "petty_cash" | "other";
export const ACCOUNT_TYPES: {
    value: AccountType;
    label: string;
    help: string;
}[] = [
    { value: "bank", label: "Bank account", help: "Business current, savings or settlement account" },
    { value: "cash", label: "Cash", help: "Physical cash held by the business" },
    { value: "mobile_wallet", label: "Mobile wallet", help: "bKash, Nagad, Rocket or similar wallet" },
    { value: "credit_card", label: "Credit card", help: "Opening balance means the amount currently owed." },
    { value: "payment_gateway", label: "Payment gateway", help: "Stripe, PayPal, Payoneer, Wise or gateway balance" },
    { value: "petty_cash", label: "Petty cash", help: "Small day-to-day expense cash" },
    { value: "other", label: "Other", help: "Any other business financial account" },
];
export type AccountValues = {
    name: string;
    account_type: string;
    provider_name: string;
    gateway_connection_id: string;
    account_holder_name: string;
    account_reference: string;
    currency: string;
    opening_balance: string;
    notes: string;
    payment_url: string;
    payment_instructions: string;
    is_active: boolean;
};
export type AccountGateway = {
    id: string | null;
    provider: string;
    mode: "test" | "live";
    connected: boolean;
    stripe_account_id: string | null;
    account_label: string | null;
};
export type AccountTransaction = {
    id: string;
    transaction_date: string;
    direction: "credit" | "debit";
    amount: string | number;
    currency: string;
    source_type: string;
    source_id: string;
    reference: string | null;
    description: string | null;
    created_at: string;
};
export type AccountLedgerPage = {
    items: AccountTransaction[];
    next_cursor: string | null;
};
export type AccountingSummary = {
    overdue_count: number;
    by_currency: {
        currency: string;
        outstanding: string | number;
    }[];
};
export type AccountingLoan = {
    id: string;
    currency: string;
    outstanding_principal: string | number;
};
export type AccountingPayable = {
    id: string;
    currency: string;
    balance_due: string | number;
};
export type AccountLedgerBrowse = {
    search: string;
    direction: "all" | "credit" | "debit";
    source_type: string;
    date_from: string;
    date_to: string;
    size: number;
    cursor: string;
    page: number;
};
export const accountRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);
const amount = (value: unknown) => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
export function isFinancialAccount(value: unknown): value is FinancialAccount {
    return accountRecord(value) && ["id", "name", "account_type", "currency"].every(key => text(value[key])) && amount(value.current_balance) && amount(value.opening_balance) && typeof value.is_active === "boolean" && ["provider_name", "account_holder_name", "account_reference", "gateway_connection_id", "payment_url", "payment_instructions", "notes"].every(key => nullableText(value[key]));
}
export function isAccountList(value: unknown): value is FinancialAccount[] {
    return Array.isArray(value) && value.every(isFinancialAccount);
}
export function isAccountLedger(value: unknown): value is AccountLedgerPage {
    return accountRecord(value) && nullableText(value.next_cursor) && Array.isArray(value.items) && value.items.every(row => accountRecord(row) && ["id", "transaction_date", "currency", "source_type", "source_id", "created_at"].every(key => text(row[key])) && ["credit", "debit"].includes(String(row.direction)) && amount(row.amount) && nullableText(row.reference) && nullableText(row.description));
}
export function isAccountGateways(value: unknown): value is {
    connections: AccountGateway[];
} {
    return accountRecord(value) && Array.isArray(value.connections) && value.connections.every(row => accountRecord(row) && nullableText(row.id) && text(row.provider) && ["test", "live"].includes(String(row.mode)) && typeof row.connected === "boolean" && nullableText(row.stripe_account_id) && nullableText(row.account_label));
}
export function isAccountingSummary(value: unknown): value is AccountingSummary {
    return accountRecord(value) && typeof value.overdue_count === "number" && Number.isFinite(value.overdue_count) && Array.isArray(value.by_currency) && value.by_currency.every(row => accountRecord(row) && text(row.currency) && amount(row.outstanding));
}
export function isAccountingLoans(value: unknown): value is AccountingLoan[] {
    return Array.isArray(value) && value.every(row => accountRecord(row) && text(row.id) && text(row.currency) && amount(row.outstanding_principal));
}
export function isAccountingPayables(value: unknown): value is AccountingPayable[] {
    return Array.isArray(value) && value.every(row => accountRecord(row) && text(row.id) && text(row.currency) && amount(row.balance_due));
}
export function accountInitialValues(account?: FinancialAccount | null): AccountValues {
    return {
        name: account?.name ?? "", account_type: account?.account_type ?? "bank", provider_name: account?.provider_name ?? "", gateway_connection_id: account?.gateway_connection_id ?? "", account_holder_name: account?.account_holder_name ?? "", account_reference: account?.account_reference ?? "", currency: account?.currency ?? "BDT", opening_balance: String(account?.opening_balance ?? "0"), notes: account?.notes ?? "", payment_url: account?.payment_url ?? "", payment_instructions: account?.payment_instructions ?? "", is_active: account?.is_active ?? true
    };
}
/** Preserve the two existing endpoint payloads; immutable ledger fields never enter PATCH. */
export function accountPayload(values: AccountValues, editing: boolean, account?: FinancialAccount | null) {
    if (editing) {
        if (!account)
            throw new Error("Load the account before editing it.");
        return {
            name: values.name, provider_name: values.provider_name.trim() || null, account_holder_name: values.account_holder_name.trim() || null, account_reference: values.account_reference.trim() || null, gateway_connection_id: account.account_type === "payment_gateway" ? values.gateway_connection_id || null : null, payment_url: values.payment_url.trim() || null, payment_instructions: values.payment_instructions.trim() || null, notes: values.notes.trim() || null, is_active: values.is_active
        };
    }
    return {
        name: values.name, account_type: values.account_type, currency: values.currency, opening_balance: Number(values.opening_balance || 0), provider_name: values.provider_name || null, account_holder_name: values.account_holder_name || null, account_reference: values.account_reference || null, gateway_connection_id: values.account_type === "payment_gateway" ? values.gateway_connection_id || null : null, payment_url: values.payment_url || null, payment_instructions: values.payment_instructions || null, notes: values.notes || null
    };
}
export function accountMoney(value: string | number, currency: string) {
    return `${currency} ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function accountLabel(value: string) {
    return ACCOUNT_TYPES.find(type => type.value === value)?.label ?? value.replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}
export function accountGroups<T>(rows: T[], currency: (row: T) => string, value: (row: T) => number): [
    string,
    number
][] {
    const totals = new Map<string, number>();
    rows.forEach(row => {
        const code = currency(row);
        totals.set(code, (totals.get(code) ?? 0) + value(row));
    });
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
}
export function accountPositions(accounts: FinancialAccount[]) {
    const active = accounts.filter(row => row.is_active);
    return { active, available: accountGroups(active.filter(row => row.account_type !== "credit_card"), row => row.currency, row => Number(row.current_balance)), liabilities: accountGroups(active.filter(row => row.account_type === "credit_card"), row => row.currency, row => Number(row.current_balance)) };
}
export function accountLedgerTotals(rows: AccountTransaction[]) {
    return rows.reduce((sum, row) => ({ credit: sum.credit + (row.direction === "credit" ? Number(row.amount) : 0), debit: sum.debit + (row.direction === "debit" ? Number(row.amount) : 0) }), { credit: 0, debit: 0 });
}
export function accountLedgerCsv(rows: AccountTransaction[]) {
    const header = ["Date", "Description", "Source", "Source ID", "Reference", "Debit", "Credit"];
    const lines = rows.map(row => [row.transaction_date, row.description || accountLabel(row.source_type), accountLabel(row.source_type), row.source_id, row.reference || "", row.direction === "debit" ? row.amount : "", row.direction === "credit" ? row.amount : ""]);
    return [header, ...lines].map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}
