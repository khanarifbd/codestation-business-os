import { formatMoneyExact } from "@/lib/sales-money-preview";
import { transferCents } from "@/components/accounting-transfers/transfer-model";
export type Purpose = "company" | "project" | "client";
export type Account = {
    id: string;
    name: string;
    account_type: string;
    currency: string;
    current_balance: string | number;
    is_active: boolean;
};
export type Category = {
    id: string;
    name: string;
    cost_type: string;
    is_active: boolean;
};
export type Vendor = {
    id: string;
    name: string;
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
    name: string;
    order_id: string;
    client_id: string;
    client_name: string;
    currency: string;
    status: string;
};
export type Meta = {
    accounts: Omit<Account, "account_type">[];
    categories: Category[];
    vendors: Vendor[];
    clients: Client[];
    projects: Project[];
};
export type Expense = {
    id: string;
    expense_number: string;
    description: string;
    expense_date: string;
    category_id: string;
    category_name: string;
    cost_type: string;
    vendor_id: string | null;
    vendor_name: string | null;
    account_id: string;
    account_name: string;
    client_id: string | null;
    client_name: string | null;
    project_id: string | null;
    project_number: string | null;
    project_name: string | null;
    order_id: string | null;
    order_number: string | null;
    invoice_id: string | null;
    invoice_number: string | null;
    payment_id: string | null;
    payment_number: string | null;
    expense_currency: string;
    expense_amount: string | number;
    account_currency: string;
    account_amount: string | number;
    exchange_rate: string | number;
    profitability_currency: string;
    profitability_amount: string | number;
    tax_amount: string | number;
    payment_method: string;
    reference: string | null;
    status: string;
    document_count: number;
    created_at: string;
};
export type ExpenseDocument = {
    id: string;
    expense_id: string;
    title: string;
    document_type: string;
    original_filename: string;
    content_type: string | null;
    size_bytes: number;
    notes: string | null;
};
export type ExpenseDetail = Expense & {
    profitability_exchange_rate: string | number;
    notes: string | null;
    voided_at: string | null;
    documents: ExpenseDocument[];
};
export type ExpensePage = {
    items: Expense[];
    next_cursor: string | null;
};
export type MoneyOutValues = {
    project_id: string;
    client_id: string;
    category_id: string;
    vendor_id: string;
    account_id: string;
    expense_amount: string;
    account_amount: string;
    expense_date: string;
    description: string;
    payment_method: string;
    reference: string;
    tax_amount: string;
    notes: string;
};
export type MoneyOutBrowse = {
    search: string;
    purpose: "all" | Purpose;
    currency: string;
    category_id: string;
    status: string;
    size: number;
    cursor: string;
    page: number;
    focus: string;
};
export const purposes: {
    value: Purpose;
    title: string;
    help: string;
}[] = [{ value: "company", title: "Company expense", help: "Office, software, rent and general business costs." }, { value: "project", title: "Project expense", help: "Attribute the cost to a project and its client." }, { value: "client", title: "Client-related expense", help: "A client cost outside a specific project." }];
export const methods = ["bank_transfer", "cash", "card", "payoneer", "wise", "stripe", "paypal", "fiverr", "other"];
export const initialMoneyOutValues = (): MoneyOutValues => ({ project_id: "", client_id: "", category_id: "", vendor_id: "", account_id: "", expense_amount: "", account_amount: "", expense_date: new Date().toISOString().slice(0, 10), description: "", payment_method: "bank_transfer", reference: "", tax_amount: "0", notes: "" });
export const moneyOutMoney = formatMoneyExact;
export const pretty = (v: string | null | undefined) => v ? v.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()) : "—";
const record = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const fields = (x: Record<string, unknown>, keys: string[]) => keys.every(k => typeof x[k] === "string" && x[k] !== "");
const amount = (x: unknown) => (typeof x === "string" || typeof x === "number") && transferCents(x) !== null;
const nullable = (x: unknown) => x === null || typeof x === "string";
export function isAccounts(x: unknown): x is Account[] { return Array.isArray(x) && x.every(a => record(a) && fields(a, ["id", "name", "account_type", "currency"]) && accountTypes.includes(String(a.account_type)) && amount(a.current_balance) && typeof a.is_active === "boolean"); }
export function isMeta(x: unknown): x is Meta { return record(x) && Array.isArray(x.accounts) && x.accounts.every(a => record(a) && fields(a, ["id", "name", "currency"]) && amount(a.current_balance) && typeof a.is_active === "boolean") && Array.isArray(x.categories) && x.categories.every(a => record(a) && fields(a, ["id", "name", "cost_type"]) && typeof a.is_active === "boolean") && Array.isArray(x.vendors) && x.vendors.every(a => record(a) && fields(a, ["id", "name"]) && typeof a.is_active === "boolean") && Array.isArray(x.clients) && x.clients.every(a => record(a) && fields(a, ["id", "code", "name"]) && nullable(a.currency)) && Array.isArray(x.projects) && x.projects.every(a => record(a) && fields(a, ["id", "number", "name", "order_id", "client_id", "client_name", "currency", "status"])); }
export function isExpense(x: unknown): x is Expense { return record(x) && fields(x, ["id", "expense_number", "description", "expense_date", "category_id", "category_name", "account_id", "account_name", "expense_currency", "account_currency", "profitability_currency", "payment_method", "status"]) && ["expense_amount", "account_amount", "exchange_rate", "profitability_amount", "tax_amount"].every(k => amount(x[k])) && ["vendor_id", "client_id", "project_id", "order_id", "invoice_id", "payment_id", "reference"].every(k => nullable(x[k])) && typeof x.document_count === "number" && Number.isSafeInteger(x.document_count) && x.document_count >= 0; }
export function isExpenseDetail(x: unknown): x is ExpenseDetail {
    const detail = x as Record<string, unknown>;
    return isExpense(x) && record(x) && amount(detail.profitability_exchange_rate) && nullable(detail.notes) && nullable(detail.voided_at) && Array.isArray(detail.documents) && detail.documents.every((d: unknown) => record(d) && fields(d, ["id", "expense_id", "title", "document_type", "original_filename"]) && d.expense_id === x.id && typeof d.size_bytes === "number");
}
export function isExpensePage(x: unknown): x is ExpensePage { return record(x) && Array.isArray(x.items) && x.items.every(isExpense) && (x.next_cursor === null || typeof x.next_cursor === "string"); }
const accountTypes = ["bank", "cash", "mobile_wallet", "wallet", "credit_card", "payment_gateway", "gateway", "petty_cash", "other"];
export const eligibleAccount = (a: Account) => a.is_active && accountTypes.includes(a.account_type) && a.account_type !== "credit_card";
/** Canonicalize lexical decimal input, never through Number; retain precision for server HALF_UP. */
export function decimalInput(raw: string): string | null { const trimmed = raw.trim(), s = trimmed.startsWith(".") ? "0" + trimmed : trimmed.startsWith("+.") ? "+0" + trimmed.slice(1) : trimmed; if (!s || s.length > 100)
    return null; const m = /^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s); if (!m)
    return null; const exponent = Number(m[3] || 0); if (!Number.isInteger(exponent) || Math.abs(exponent) > 100)
    return null; let digits = m[1] + (m[2] || ""), point = m[1].length + exponent; if (point <= 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
} let integer = point <= 0 ? "0" : (digits.slice(0, point) + "0".repeat(Math.max(0, point - digits.length))), fraction = point < digits.length ? digits.slice(point) : ""; integer = integer.replace(/^0+(?=\d)/, ""); fraction = fraction.replace(/0+$/, ""); return integer + (fraction ? "." + fraction : ""); }
function withinLimit(raw: string | null) { if (raw === null)
    return false; const [integer, fraction] = raw.split("."); return integer.length < 13 || (integer.length === 13 && (integer < "1000000000000" || integer === "1000000000000" && !fraction)); }
export function centsText(n: bigint) { const sign = n < BigInt(0) ? "-" : "", a = n < BigInt(0) ? -n : n; return `${sign}${a / BigInt(100)}.${String(a % BigInt(100)).padStart(2, "0")}`; }
function halfUp(n: bigint, d: bigint) { return n / d + (n % d * BigInt(2) >= d ? BigInt(1) : BigInt(0)); }
export function expenseRate(accountCents: bigint, expenseCents: bigint) { if (expenseCents <= BigInt(0) || accountCents <= BigInt(0))
    return null; const r = halfUp(accountCents * BigInt(100000000), expenseCents); if (r <= BigInt(0) || r > BigInt("999999999999999999"))
    return null; return `${r / BigInt(100000000)}.${String(r % BigInt(100000000)).padStart(8, "0")}`; }
export function moneyOutPreview(values: MoneyOutValues, purpose: Purpose, meta: Meta | null, accounts: Account[] | null) {
    const account = accounts?.find(a => a.id === values.account_id) || null, project = meta?.projects.find(p => p.id === values.project_id) || null, client = meta?.clients.find(c => c.id === (purpose === "project" ? project?.client_id : values.client_id)) || null, category = meta?.categories.find(c => c.id === values.category_id) || null, vendor = meta?.vendors.find(v => v.id === values.vendor_id) || null;
    const currency = purpose === "project" ? project?.currency || "" : purpose === "client" ? client?.currency || account?.currency || "" : account?.currency || "", crossCurrency = Boolean(account && currency !== account.currency);
    const expenseRaw = decimalInput(values.expense_amount), accountRaw = decimalInput(values.account_amount), taxRaw = decimalInput(values.tax_amount || "0"), expense = expenseRaw ? transferCents(expenseRaw) : null, tax = taxRaw ? transferCents(taxRaw) : null, deduction = crossCurrency ? (accountRaw ? transferCents(accountRaw) : null) : expense;
    const max = BigInt("100000000000000");
    let error: string | null = null;
    if (!meta || !accounts)
        error = "Load verified expense setup and account types before recording.";
    else if (!account || !eligibleAccount(account))
        error = "Choose an active non-credit-card payment account.";
    else if (!category || !category.is_active)
        error = "Choose an active expense category.";
    else if (values.vendor_id && (!vendor || !vendor.is_active))
        error = "Choose an active vendor or clear the optional vendor.";
    else if (purpose === "project" && (!project || project.status === "cancelled") || purpose === "client" && !client)
        error = "Choose the business record for this expense purpose.";
    else if (!values.description.trim() || values.description.length > 500)
        error = "Describe this expense in 1–500 characters.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.expense_date))
        error = "Choose the payment date.";
    else if (!methods.includes(values.payment_method))
        error = "Choose a supported payment method.";
    else if (values.reference.length > 180)
        error = "Reference must be 180 characters or fewer.";
    else if (!withinLimit(expenseRaw) || !withinLimit(taxRaw) || crossCurrency && !withinLimit(accountRaw) || expense === null || expense <= BigInt(0) || expense > max || deduction === null || deduction <= BigInt(0) || deduction > max || tax === null || tax < BigInt(0) || tax > max)
        error = "Enter valid monetary amounts up to 1,000,000,000,000; gross and deduction must round to at least 0.01.";
    else if (tax > expense)
        error = "Included tax cannot exceed the rounded gross expense.";
    else if (deduction > (transferCents(account.current_balance) || BigInt(0)))
        error = "The actual deduction exceeds the last loaded account balance. Refresh setup to verify it.";
    const rate = expense !== null && deduction !== null ? expenseRate(deduction, expense) : null;
    if (!error && !rate)
        error = "This conversion exceeds the supported stored exchange-rate precision. A positive conversion must not round to zero.";
    return { account, project, client, category, vendor, currency, crossCurrency, error, amounts: !error && expense !== null && tax !== null && deduction !== null && rate ? { expense: centsText(expense), tax: centsText(tax), net: centsText(expense - tax), deduction: centsText(deduction), rate } : null };
}
export function moneyOutPayload(v: MoneyOutValues, purpose: Purpose, currency: string, crossCurrency: boolean) { const expense = decimalInput(v.expense_amount), tax = decimalInput(v.tax_amount || "0"), account = crossCurrency ? decimalInput(v.account_amount) : null; if (!expense || tax === null || crossCurrency && account === null)
    throw new Error("Expense amounts could not be serialized exactly."); return { description: v.description, category_id: v.category_id, account_id: v.account_id, vendor_id: v.vendor_id || null, client_id: purpose === "client" ? v.client_id : null, project_id: purpose === "project" ? v.project_id : null, expense_date: v.expense_date, expense_currency: currency, expense_amount: expense, account_amount: account, tax_amount: tax, payment_method: v.payment_method, reference: v.reference || null, notes: v.notes || null }; }
export function expensePurpose(e: Expense): Purpose { return e.project_id ? "project" : e.client_id ? "client" : "company"; }
export function visibleExpenses(rows: Expense[], b: MoneyOutBrowse) { const q = b.search.trim().toLowerCase(); return rows.filter(e => (!q || `${e.expense_number} ${e.description} ${e.project_name || ""} ${e.client_name || ""} ${e.account_name} ${e.vendor_name || ""}`.toLowerCase().includes(q)) && (b.purpose === "all" || expensePurpose(e) === b.purpose) && (!b.currency || e.expense_currency === b.currency)); }
export function visiblePostedTotals(rows: Expense[]) { const totals = new Map<string, bigint>(); for (const e of rows)
    if (e.status === "posted") {
        const cents = transferCents(e.expense_amount);
        if (cents !== null)
            totals.set(e.expense_currency, (totals.get(e.expense_currency) || BigInt(0)) + cents);
    } return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({ currency, amount: centsText(value) })); }
