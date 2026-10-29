import { centsText, decimalInput } from "@/components/accounting-money-out/money-out-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { lenderTypes } from "./loan-types";
import type { AgreementForm, FinancialAccount, Loan, LoanActionKind, LoanHistory, ReceiveForm, ReceiveResult, RepayForm, RepayResult, ScheduleItem } from "./loan-types";
export const loanMoney = formatMoneyExact, loanCentsText = centsText;
export const LOAN_PAGE_SIZE = 20;
const MAX_MONEY = BigInt("999999999999999999"), MAX_RATE = BigInt("999999999");
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string";
const present = (value: unknown): value is string => text(value) && value.trim().length > 0;
const nullable = (value: unknown) => value === null || text(value);
const currency = (value: unknown): value is string => text(value) && /^[A-Z]{3}$/.test(value);
export const loanId = (value: unknown): value is string => text(value) && /^[A-Za-z0-9_-]{1,200}$/.test(value) && value !== "new";
export const pretty = (value: string | null | undefined) => value ? value.replaceAll("_", " ").replace(/\b\w/g, s => s.toUpperCase()) : "—";
export function loanDate(value: unknown): value is string { if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false; const d = new Date(value + "T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }
function scaled(value: unknown, digits: number): bigint | null {
  if (!text(value) && (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) return null;
  const raw = String(value).trim(), negative = raw.startsWith("-"), canonical = decimalInput(negative ? raw.slice(1) : raw);
  if (canonical === null || negative && raw[1] === "+") return null;
  const [whole, fraction = ""] = canonical.split("."); if (fraction.length > digits) return null;
  return (negative ? -BigInt(1) : BigInt(1)) * (BigInt(whole) * BigInt(10) ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0"));
}
/** Read values are exact, never rounded or coerced from null. Aggregate balances have no single-row storage cap. */
export const loanCents = (value: unknown) => scaled(value, 2);
function amount(value: unknown, signed = false, stored = false) { const n = loanCents(value); return n !== null && (signed || n >= BigInt(0)) && (!stored || n <= MAX_MONEY && n >= -MAX_MONEY); }
const rate = (value: unknown) => { const n = scaled(value, 4); return n !== null && n >= BigInt(0) && n <= MAX_RATE; };
export function loanRate(value: unknown) { const n = scaled(value, 4); return n === null ? "—" : `${n / BigInt(10000)}.${String(n % BigInt(10000)).padStart(4, "0")}`; }
const unique = <T,>(rows: T[], key: (item: T) => string) => new Set(rows.map(key)).size === rows.length;
export function isLoan(value: unknown): value is Loan {
  return record(value) && loanId(value.id) && present(value.lender_name) && present(value.lender_type) && currency(value.currency)
    && amount(value.approved_amount, false, true) && amount(value.disbursed_amount) && amount(value.undisbursed_amount) && amount(value.outstanding_principal, false, true) && rate(value.annual_interest_rate)
    && loanDate(value.approval_date) && (value.maturity_date === null || loanDate(value.maturity_date)) && present(value.status) && nullable(value.reference) && nullable(value.notes);
}
export function isLoanList(value: unknown): value is Loan[] { return Array.isArray(value) && value.every(isLoan) && unique(value, row => row.id); }
export function isFinancialAccountList(value: unknown): value is FinancialAccount[] { return Array.isArray(value) && value.every(row => record(row) && loanId(row.id) && present(row.name) && present(row.account_type) && currency(row.currency) && amount(row.current_balance, true) && typeof row.is_active === "boolean") && unique(value, row => row.id); }
export function isScheduleList(value: unknown): value is ScheduleItem[] { return Array.isArray(value) && value.every(row => record(row) && loanId(row.id) && Number.isSafeInteger(row.installment_number) && Number(row.installment_number) > 0 && loanDate(row.due_date) && ["principal_due","interest_due","fee_due","principal_paid","interest_paid","fee_paid"].every(key => amount(row[key], false, true)) && present(row.status)) && unique(value, row => row.id) && unique(value, row => String(row.installment_number)); }
function historyBase(value: unknown): value is Record<string, unknown> { return record(value) && loanId(value.id) && loanDate(value.date) && nullable(value.reference) && nullable(value.notes) && present(value.created_at); }
export function isLoanHistory(value: unknown): value is LoanHistory {
  if (!record(value) || !Array.isArray(value.disbursements) || !Array.isArray(value.repayments) || !Array.isArray(value.fees)) return false;
  return value.disbursements.every(row => historyBase(row) && loanId(row.account_id) && present(row.account_name) && ["principal_amount","fee_withheld_amount","net_received_amount"].every(key => amount(row[key], true, true)) && present(row.status) && loanCents(row.principal_amount)! - loanCents(row.fee_withheld_amount)! === loanCents(row.net_received_amount))
    && value.repayments.every(row => historyBase(row) && loanId(row.account_id) && present(row.account_name) && amount(row.principal_amount, true, true) && amount(row.interest_amount, true, true) && present(row.status))
    && value.fees.every(row => historyBase(row) && present(row.fee_type) && amount(row.amount, true, true) && present(row.payment_status))
    && [value.disbursements, value.repayments, value.fees].every(rows => unique(rows, row => row.id));
}
export function isReceiveResult(value: unknown): value is ReceiveResult { return record(value) && loanId(value.id) && isLoan(value.loan) && loanId(value.journal_entry_id) && ["principal_amount","fee_withheld_amount","net_received_amount"].every(key => amount(value[key], false, true)) && loanCents(value.principal_amount)! > BigInt(0) && loanCents(value.net_received_amount)! > BigInt(0) && loanCents(value.principal_amount)! - loanCents(value.fee_withheld_amount)! === loanCents(value.net_received_amount); }
export function isRepayResult(value: unknown): value is RepayResult { return record(value) && loanId(value.id) && isLoan(value.loan) && loanId(value.journal_entry_id) && ["principal_amount","interest_amount","fee_amount","cash_paid"].every(key => amount(value[key], false, true)) && loanCents(value.cash_paid)! > BigInt(0) && loanCents(value.principal_amount)! + loanCents(value.interest_amount)! + loanCents(value.fee_amount)! === loanCents(value.cash_paid); }
/** The same HALF_UP boundary as stored Decimal columns; never pass binary floating-point payloads. */
function rounded(raw: string, digits: number) { const canonical = decimalInput(raw); if (canonical === null) return null; const [whole, fraction = ""] = canonical.split("."); return BigInt(whole) * BigInt(10) ** BigInt(digits) + BigInt(fraction.slice(0, digits).padEnd(digits, "0") || "0") + (Number(fraction[digits] || 0) >= 5 ? BigInt(1) : BigInt(0)); }
const storedInput = (raw: string, emptyZero = false) => { const n = rounded(emptyZero && !raw.trim() ? "0" : raw, 2); return n !== null && n >= BigInt(0) && n <= MAX_MONEY ? n : null; };
const clean = (value: string | null) => value?.trim() || null;
export function agreementPayload(form: AgreementForm) {
  const principal = storedInput(form.approved_amount), annual = rounded(form.annual_interest_rate.trim() || "0", 4), name = form.lender_name.trim(), reference = clean(form.reference);
  let error: string | null = null;
  if (name.length < 2 || name.length > 220 || !lenderTypes.includes(form.lender_type)) error = "Enter a lender name (2–220 characters) and a valid lender type.";
  else if (!currency(form.currency) || !loanDate(form.approval_date) || form.maturity_date && (!loanDate(form.maturity_date) || form.maturity_date < form.approval_date)) error = "Choose a currency and valid approval/maturity dates; maturity cannot precede approval.";
  else if (principal === null || principal <= BigInt(0)) error = "The approved amount must remain positive after rounding and fit 16 whole digits and 2 decimals.";
  else if (annual === null || annual < BigInt(0) || annual > MAX_RATE) error = "The annual rate must fit 5 whole digits and 4 decimals after rounding.";
  else if ((reference?.length || 0) > 180) error = "Keep the reference within 180 characters.";
  const body = { lender_name: name, lender_type: form.lender_type, currency: form.currency, approved_amount: principal === null ? "" : centsText(principal), annual_interest_rate: annual === null ? "" : `${annual / BigInt(10000)}.${String(annual % BigInt(10000)).padStart(4, "0")}`, approval_date: form.approval_date, maturity_date: form.maturity_date || null, reference, notes: clean(form.notes) };
  return { error, body: error ? null : body };
}
export function canLoanAction(loan: Loan, kind: LoanActionKind) { if (kind === "approve") return loan.status === "draft"; if (kind === "receive") return ["approved", "active"].includes(loan.status) && (loanCents(loan.undisbursed_amount) ?? BigInt(0)) > BigInt(0); if (kind === "repay") return loan.status === "active"; return kind === "close" && ["approved", "paid"].includes(loan.status) && loanCents(loan.outstanding_principal) === BigInt(0) && (loanCents(loan.disbursed_amount) ?? BigInt(0)) > BigInt(0); }
const compatible = (accounts: FinancialAccount[] | null, id: string, loan: Loan) => accounts?.find(account => account.id === id && account.is_active && account.currency === loan.currency);
export function receivePayload(form: ReceiveForm, loan: Loan | null, accounts: FinancialAccount[] | null) {
  const principal = storedInput(form.principal_amount), fee = storedInput(form.fee_withheld_amount, true), reference = clean(form.reference);
  let error: string | null = null;
  if (!loan || !isLoan(loan) || !canLoanAction(loan, "receive")) error = "Only an approved or active loan with available funding can receive principal.";
  else if (!accounts || !isFinancialAccountList(accounts) || !compatible(accounts, form.account_id, loan)) error = "Choose a verified active account in the loan currency.";
  else if (!loanDate(form.disbursement_date) || form.disbursement_date < loan.approval_date) error = "The received date cannot precede the approval date.";
  else if (principal === null || fee === null || principal <= BigInt(0) || principal <= fee || principal > loanCents(loan.undisbursed_amount)!) error = "Enter available principal and a smaller withheld fee; rounded net cash must remain positive.";
  else if ((reference?.length || 0) > 180) error = "Keep the reference within 180 characters.";
  const body = { account_id: form.account_id, disbursement_date: form.disbursement_date, principal_amount: principal === null ? "" : centsText(principal), fee_withheld_amount: fee === null ? "" : centsText(fee), reference, notes: clean(form.notes) };
  return { error, body: error ? null : body };
}
export function repayPayload(form: RepayForm, loan: Loan | null, accounts: FinancialAccount[] | null, history: LoanHistory | null) {
  const principal = storedInput(form.principal_amount, true), interest = storedInput(form.interest_amount, true), fee = storedInput(form.fee_amount, true), total = principal === null || interest === null || fee === null ? null : principal + interest + fee, reference = clean(form.reference);
  let error: string | null = null;
  if (!loan || !isLoan(loan) || !canLoanAction(loan, "repay")) error = "Only an active loan can be repaid.";
  else if (!accounts || !isFinancialAccountList(accounts) || !compatible(accounts, form.account_id, loan)) error = "Choose a verified active account in the loan currency.";
  else if (!history || !isLoanHistory(history)) error = "Load verified disbursement history before reviewing repayment.";
  else if (!loanDate(form.payment_date) || !history.disbursements.some(row => row.status === "posted" && loanCents(row.principal_amount)! > BigInt(0) && row.date <= form.payment_date)) error = "Repayment must be on or after an active posted disbursement; the server verifies final eligibility.";
  else if (principal === null || interest === null || fee === null || total === null || total <= BigInt(0) || total > MAX_MONEY || principal > loanCents(loan.outstanding_principal)!) error = "The rounded payment must be positive, fit stored amount limits, and not exceed outstanding principal.";
  else if (total > loanCents(compatible(accounts, form.account_id, loan)!.current_balance)!) error = "The selected account does not have enough current balance for this payment.";
  else if (form.fee_type.length > 40 || (reference?.length || 0) > 180) error = "Keep fee type within 40 and reference within 180 characters.";
  const body = { account_id: form.account_id, payment_date: form.payment_date, principal_amount: principal === null ? "" : centsText(principal), interest_amount: interest === null ? "" : centsText(interest), fee_amount: fee === null ? "" : centsText(fee), fee_type: form.fee_type, reference, notes: clean(form.notes) };
  return { error, body: error ? null : body };
}
export function agreementMatchesPayload(value: unknown, body: NonNullable<ReturnType<typeof agreementPayload>["body"]>): value is Loan { return isLoan(value) && value.status === "draft" && value.lender_name === body.lender_name && value.lender_type === body.lender_type && value.currency === body.currency && loanCents(value.approved_amount) === loanCents(body.approved_amount) && scaled(value.annual_interest_rate, 4) === scaled(body.annual_interest_rate, 4) && value.approval_date === body.approval_date && value.maturity_date === body.maturity_date && value.reference === body.reference && value.notes === body.notes && loanCents(value.disbursed_amount) === BigInt(0) && loanCents(value.outstanding_principal) === BigInt(0) && loanCents(value.undisbursed_amount) === loanCents(body.approved_amount); }
/** Idempotent replay returns the original posting amounts with the loan's current aggregate state. */
export function receiveMatchesPayload(value: unknown, body: NonNullable<ReturnType<typeof receivePayload>["body"]>, loan: Loan): value is ReceiveResult { return isReceiveResult(value) && value.loan.id === loan.id && value.loan.currency === loan.currency && loanCents(value.principal_amount) === loanCents(body.principal_amount) && loanCents(value.fee_withheld_amount) === loanCents(body.fee_withheld_amount); }
export function repayMatchesPayload(value: unknown, body: NonNullable<ReturnType<typeof repayPayload>["body"]>, loan: Loan): value is RepayResult { return isRepayResult(value) && value.loan.id === loan.id && value.loan.currency === loan.currency && loanCents(value.principal_amount) === loanCents(body.principal_amount) && loanCents(value.interest_amount) === loanCents(body.interest_amount) && loanCents(value.fee_amount) === loanCents(body.fee_amount); }
export function lifecycleMatches(value: unknown, loan: Loan, target: "approved" | "closed"): value is Loan { return isLoan(value) && value.id === loan.id && value.currency === loan.currency && value.status === target; }
export function pageRows<T>(rows: T[], page: number) { const pages = Math.max(1, Math.ceil(rows.length / LOAN_PAGE_SIZE)), current = Math.min(Number.isSafeInteger(page) && page > 0 ? page : 1, pages); return { rows: rows.slice((current - 1) * LOAN_PAGE_SIZE, current * LOAN_PAGE_SIZE), page: current, pages, total: rows.length }; }
