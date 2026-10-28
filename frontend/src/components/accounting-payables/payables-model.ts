import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { decimalInput, centsText } from "@/components/accounting-money-out/money-out-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
export { decimalInput, centsText };
export const payableMoney = formatMoneyExact;
export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const agingBuckets: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];
export type Bill = {
    id: string;
    purchase_receipt_id: string | null;
    bill_number: string;
    supplier_name: string;
    bill_date: string;
    due_date: string | null;
    currency: string;
    subtotal_amount: string | number;
    tax_code_id: string | null;
    tax_rate_snapshot: string | number | null;
    input_tax_amount: string | number;
    recoverable_tax_amount: string | number;
    withholding_tax_code_id: string | null;
    withholding_rate_snapshot: string | number | null;
    withholding_tax_amount: string | number;
    original_amount: string | number;
    net_payable_amount: string | number;
    amount_paid: string | number;
    balance_due: string | number;
    expense_ledger_account_id: string;
    expense_ledger_account_name: string;
    description: string;
    reference: string | null;
    notes: string | null;
    status: string;
    created_at: string;
};
export type Payment = {
    id: string;
    bill_id: string;
    financial_account_id: string;
    financial_account_name: string;
    payment_date: string;
    currency: string;
    amount: string | number;
    reference: string | null;
    notes: string | null;
    status: "posted" | "reversed";
    created_at: string;
};
export type LedgerAccount = {
    id: string;
    name: string;
    category: string;
    is_active: boolean;
};
export type Account = {
    id: string;
    name: string;
    account_type: string;
    currency: string;
    current_balance: string | number;
    is_active: boolean;
};
export type Vendor = {
    id: string;
    name: string;
    is_active: boolean;
};
export type TaxCode = {
    id: string;
    code: string;
    name: string;
    tax_kind: "sales" | "purchase" | "withholding";
    rate: string | number;
    recoverable_percent: string | number;
    effective_from: string | null;
    effective_to: string | null;
    is_active: boolean;
};
export type CurrencyAmount = {
    currency: string;
    amount: string | number;
};
export type PayablesPage = {
    items: Bill[];
    next_cursor: string | null;
    business_date: string;
    open_bill_count: number;
    overdue_count: number;
    filtered_count: number;
    outstanding_by_currency: CurrencyAmount[];
    aging: (CurrencyAmount & {
        bucket: AgingBucket;
    })[];
};
export type PayablesBrowse = {
    search: string;
    status: "all" | "open" | "overdue" | "partial" | "paid";
    currency: string;
    cursor: string;
    page: number;
    focus: string;
};
export type BillValues = {
    supplier_name: string;
    bill_date: string;
    due_date: string;
    currency: string;
    amount: string;
    tax_code_id: string;
    withholding_tax_code_id: string;
    expense_ledger_account_id: string;
    description: string;
    reference: string;
    notes: string;
};
export type PaymentValues = {
    financial_account_id: string;
    payment_date: string;
    amount: string;
    reference: string;
    notes: string;
};
export type PayablesMeta = {
    categories: LedgerAccount[];
    accounts: Account[];
    vendors: Vendor[];
    taxes: TaxCode[];
    businessDate: string;
    currency: string;
};
export type BillPreview = {
    subtotal: string;
    inputTax: string;
    recoverableTax: string;
    nonRecoverableTax: string;
    grossBill: string;
    withholdingTax: string;
    netPayable: string;
    expenseRecognized: string;
};
export type PayablesOperation = {
    kind: "bill" | "payment";
    key: string | null;
    body: string;
    currency: string;
    amount: string;
    billId: string;
    billNumber: string;
    supplierName: string;
    accountName: string;
    accountType: string;
    categoryName: string;
    date: string;
    dueDate: string;
    reference: string;
    notes: string;
    preview: BillPreview | null;
    beforeBalance: string | number;
    beforeAccountBalance: string | number;
};
export const initialBillValues = (): BillValues => ({ supplier_name: "", bill_date: "", due_date: "", currency: "", amount: "", tax_code_id: "", withholding_tax_code_id: "", expense_ledger_account_id: "", description: "", reference: "", notes: "" });
export const initialPaymentValues = (): PaymentValues => ({ financial_account_id: "", payment_date: "", amount: "", reference: "", notes: "" });
export const record = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const fields = (x: Record<string, unknown>, keys: string[]) => keys.every(k => typeof x[k] === "string" && x[k] !== "");
const nullable = (x: unknown) => x === null || typeof x === "string";
const amount = (x: unknown) => (typeof x === "string" || typeof x === "number") && transferCents(x) !== null;
export function validPayableDate(raw: unknown): raw is string { if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return false; const date = new Date(`${raw}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw; }
export function isBill(x: unknown): x is Bill { return record(x) && fields(x, ["id", "bill_number", "supplier_name", "currency", "expense_ledger_account_id", "expense_ledger_account_name", "description", "status", "created_at"]) && validPayableDate(x.bill_date) && (x.due_date === null || validPayableDate(x.due_date)) && ["purchase_receipt_id", "tax_code_id", "withholding_tax_code_id", "reference", "notes"].every(k => nullable(x[k])) && ["subtotal_amount", "input_tax_amount", "recoverable_tax_amount", "withholding_tax_amount", "original_amount", "net_payable_amount", "amount_paid", "balance_due"].every(k => amount(x[k])) && ["tax_rate_snapshot", "withholding_rate_snapshot"].every(k => x[k] === null || amount(x[k])); }
export function isPayment(x: unknown): x is Payment { return record(x) && fields(x, ["id", "bill_id", "financial_account_id", "financial_account_name", "currency", "created_at"]) && validPayableDate(x.payment_date) && amount(x.amount) && nullable(x.reference) && nullable(x.notes) && (x.status === "posted" || x.status === "reversed"); }
export function isPayablesPage(x: unknown): x is PayablesPage { const total = (t: unknown) => record(t) && fields(t, ["currency"]) && amount(t.amount); return record(x) && Array.isArray(x.items) && x.items.every(isBill) && (x.next_cursor === null || typeof x.next_cursor === "string" && x.next_cursor.trim().length > 0) && validPayableDate(x.business_date) && ["open_bill_count", "overdue_count", "filtered_count"].every(k => typeof x[k] === "number" && Number.isSafeInteger(x[k]) && x[k] >= 0) && Array.isArray(x.outstanding_by_currency) && x.outstanding_by_currency.every(total) && Array.isArray(x.aging) && x.aging.every(t => record(t) && agingBuckets.includes(t.bucket as AgingBucket) && total(t)); }
export function isAccounts(x: unknown): x is Account[] { return Array.isArray(x) && x.every(a => record(a) && fields(a, ["id", "name", "account_type", "currency"]) && amount(a.current_balance) && typeof a.is_active === "boolean"); }
export function isCategories(x: unknown): x is LedgerAccount[] { return Array.isArray(x) && x.every(a => record(a) && fields(a, ["id", "name", "category"]) && typeof a.is_active === "boolean"); }
export function isTaxCodes(x: unknown): x is TaxCode[] { return Array.isArray(x) && x.every(a => record(a) && fields(a, ["id", "code", "name"]) && ["sales", "purchase", "withholding"].includes(String(a.tax_kind)) && amount(a.rate) && amount(a.recoverable_percent) && (a.effective_from === null || validPayableDate(a.effective_from)) && (a.effective_to === null || validPayableDate(a.effective_to)) && typeof a.is_active === "boolean"); }
export function isVendors(x: unknown): x is Vendor[] { return Array.isArray(x) && x.every(a => record(a) && fields(a, ["id", "name"]) && typeof a.is_active === "boolean"); }
export function effectiveTax(tax: TaxCode | null | undefined, date: string) { return Boolean(tax?.is_active && date && (!tax.effective_from || date >= tax.effective_from) && (!tax.effective_to || date <= tax.effective_to)); }
const ZERO = BigInt(0), HUNDRED = BigInt(100), MAX_CENTS = BigInt("999999999999999999");
function ratio(value: string | number) { const raw = decimalInput(String(value)); if (raw === null)
    return null; const [whole, fraction = ""] = raw.split("."); return { n: BigInt(whole + fraction), d: BigInt(10) ** BigInt(fraction.length) }; }
const halfUp = (n: bigint, d: bigint) => n / d + (n % d * BigInt(2) >= d ? BigInt(1) : ZERO);
/** Exact existing backend stages: HALF_UP2 at subtotal, tax, recovery, gross, withholding and payable. */
export function payableBillPreview(v: BillValues, taxes: TaxCode[]): {
    amounts: BillPreview | null;
    error: string | null;
} {
    const raw = decimalInput(v.amount), subtotal = raw === null ? null : transferCents(raw);
    if (subtotal === null || subtotal <= ZERO || subtotal > MAX_CENTS)
        return { amounts: null, error: "Enter a positive subtotal that fits the stored monetary precision." };
    const purchase = v.tax_code_id ? taxes.find(t => t.id === v.tax_code_id) : null, withholding = v.withholding_tax_code_id ? taxes.find(t => t.id === v.withholding_tax_code_id) : null;
    if (v.tax_code_id && (!purchase || purchase.tax_kind !== "purchase" || !effectiveTax(purchase, v.bill_date)))
        return { amounts: null, error: "Select an active purchase tax effective on the bill date." };
    if (v.withholding_tax_code_id && (!withholding || withholding.tax_kind !== "withholding" || !effectiveTax(withholding, v.bill_date)))
        return { amounts: null, error: "Select an active withholding tax effective on the bill date." };
    const taxRate = ratio(purchase?.rate || "0"), recoveryRate = ratio(purchase?.recoverable_percent || "0"), withholdingRate = ratio(withholding?.rate || "0");
    if (!taxRate || !recoveryRate || !withholdingRate || recoveryRate.n > HUNDRED * recoveryRate.d)
        return { amounts: null, error: "Tax rates or recoverable percentage could not be verified." };
    const inputTax = halfUp(subtotal * taxRate.n, taxRate.d * HUNDRED), recoverableTax = halfUp(inputTax * recoveryRate.n, recoveryRate.d * HUNDRED), nonRecoverableTax = inputTax - recoverableTax, grossBill = subtotal + inputTax, withholdingTax = halfUp(subtotal * withholdingRate.n, withholdingRate.d * HUNDRED), netPayable = grossBill - withholdingTax, expenseRecognized = subtotal + nonRecoverableTax;
    if (netPayable <= ZERO)
        return { amounts: null, error: "Withholding tax leaves no supplier payable. Review the selected tax codes." };
    if ([subtotal, inputTax, recoverableTax, nonRecoverableTax, grossBill, withholdingTax, netPayable, expenseRecognized].some(n => n < ZERO || n > MAX_CENTS))
        return { amounts: null, error: "This bill breakdown exceeds the stored monetary precision. Amounts were not clamped." };
    return { amounts: { subtotal: centsText(subtotal), inputTax: centsText(inputTax), recoverableTax: centsText(recoverableTax), nonRecoverableTax: centsText(nonRecoverableTax), grossBill: centsText(grossBill), withholdingTax: centsText(withholdingTax), netPayable: centsText(netPayable), expenseRecognized: centsText(expenseRecognized) }, error: null };
}
export function billValidation(v: BillValues, meta: PayablesMeta | null) { if (!meta)
    return "Bill setup is unavailable."; if (!v.supplier_name.trim() || v.supplier_name.length > 220)
    return "Enter a supplier name of 1–220 characters."; if (!v.description.trim() || v.description.length > 500)
    return "Enter a description of 1–500 characters."; if (!validPayableDate(v.bill_date) || (v.due_date && (!validPayableDate(v.due_date) || v.due_date < v.bill_date)))
    return "Choose a valid bill date and a due date on or after it."; if (!/^[A-Z]{3}$/.test(v.currency))
    return "Choose a valid three-letter currency."; if (!meta.categories.some(c => c.id === v.expense_ledger_account_id && c.category === "expense" && c.is_active))
    return "Choose an active expense category."; if (v.reference.length > 180)
    return "Reference must be 180 characters or fewer."; return payableBillPreview(v, meta.taxes).error; }
export function paymentValidation(v: PaymentValues, bill: Bill | null, account: Account | null) { if (!bill || !account || account.id !== v.financial_account_id || !account.is_active || account.currency !== bill.currency)
    return "Choose an active financial account in the bill currency."; if (!validPayableDate(v.payment_date))
    return "Choose a valid payment date."; const canonical = decimalInput(v.amount), cents = canonical === null ? null : transferCents(canonical), balance = transferCents(bill.balance_due), available = transferCents(account.current_balance); if (cents === null || cents <= ZERO || cents > MAX_CENTS || balance === null || cents > balance)
    return "Payment must be positive and cannot exceed the last loaded payable balance."; if (account.account_type !== "credit_card" && (available === null || cents > available))
    return "The last loaded asset account balance is insufficient."; if (v.reference.length > 180)
    return "Reference must be 180 characters or fewer."; return null; }
/** Canonical decimal strings accepted by the unchanged Decimal schemas; parity is separately verified. */
export function billPayload(v: BillValues) { const amount = decimalInput(v.amount); return amount === null ? null : { supplier_name: v.supplier_name, bill_date: v.bill_date, due_date: v.due_date || null, currency: v.currency, amount, tax_code_id: v.tax_code_id || null, withholding_tax_code_id: v.withholding_tax_code_id || null, expense_ledger_account_id: v.expense_ledger_account_id, description: v.description, reference: v.reference || null, notes: v.notes || null }; }
export function paymentPayload(v: PaymentValues) { const amount = decimalInput(v.amount); return amount === null ? null : { financial_account_id: v.financial_account_id, payment_date: v.payment_date, amount, reference: v.reference || null, notes: v.notes || null }; }
export const payableOverdue = (bill: Bill, businessDate: string) => (transferCents(bill.balance_due) ?? ZERO) > ZERO && Boolean(bill.due_date && bill.due_date < businessDate);
export const bucketLabel = (bucket: AgingBucket) => bucket === "current" ? "Current / not overdue" : `${bucket} days overdue`;
