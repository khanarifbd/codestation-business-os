import { centsText, decimalInput, eligibleAccount, expenseRate, methods, type Account as VerifiedAccount } from "@/components/accounting-money-out/money-out-model";
import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import type { ExpenseForm, Meta } from "./expense-types";

export { methods };
export const expenseMoney = formatMoneyExact;
export const costTypes = ["direct", "operating", "financial", "tax", "other"];
export const blankExpense = (): ExpenseForm => ({ description: "", category_id: "", account_id: "", vendor_id: "", client_id: "", project_id: "", order_id: "", invoice_id: "", payment_id: "", expense_date: "", expense_currency: "USD", expense_amount: "", account_amount: "", profitability_amount: "", tax_amount: "0", payment_method: "bank_transfer", reference: "", notes: "" });

/** Preserve the original full-chain selection behavior, including an invoice
 * with no project link combined with an explicitly selected compatible project.
 */
export function changeExpenseValue<K extends keyof ExpenseForm>(current: ExpenseForm, key: K, value: ExpenseForm[K], meta: Meta | null): ExpenseForm {
  let next = { ...current, [key]: value };
  if (["client_id", "order_id", "project_id", "invoice_id", "payment_id", "expense_currency"].includes(key)) next.profitability_amount = "";
  if (key === "client_id") next = { ...next, order_id: "", project_id: "", invoice_id: "", payment_id: "" };
  if (key === "order_id") {
    const order = meta?.orders.find(row => row.id === value);
    next = { ...next, project_id: "", invoice_id: "", payment_id: "", client_id: order ? "" : current.client_id };
  }
  if (key === "project_id") {
    const project = meta?.projects.find(row => row.id === value);
    next = { ...next, order_id: project?.order_id || current.order_id, invoice_id: "", payment_id: "", client_id: project ? "" : current.client_id };
  }
  if (key === "invoice_id" || key === "payment_id") {
    const payment = key === "payment_id" ? meta?.payments.find(row => row.id === value) : null;
    const invoice = [...(meta?.invoices || []), ...(meta?.relationship_context?.invoices || [])].find(row => row.id === (payment?.invoice_id || (key === "invoice_id" ? value : "")));
    next = { ...next, invoice_id: key === "invoice_id" ? value : payment?.invoice_id || current.invoice_id,
      payment_id: key === "invoice_id" ? "" : value, order_id: invoice?.order_id || current.order_id,
      project_id: invoice?.project_id || current.project_id, client_id: invoice || payment ? "" : current.client_id };
  }
  if (key === "account_id" || key === "expense_currency") next.account_amount = "";
  return next;
}

/** Match the existing server's payment → invoice → project → order resolution.
 * Do not guess a currency when any required ancestor is absent from suggestions.
 * Supplementary context never enlarges user-selectable suggestion populations.
 */
export function expenseRelationships(values: ExpenseForm, meta: Meta | null) {
  const invoices = [...(meta?.invoices || []), ...(meta?.relationship_context?.invoices || [])];
  const projects = [...(meta?.projects || []), ...(meta?.relationship_context?.projects || [])];
  const orders = [...(meta?.orders || []), ...(meta?.relationship_context?.orders || [])];
  const payment = meta?.payments.find(row => row.id === values.payment_id) || null;
  let error: string | null = null;
  let clientId = values.client_id, invoiceId = values.invoice_id, projectId = values.project_id, orderId = values.order_id;
  if (values.payment_id) {
    if (!payment || payment.status !== "confirmed") error = "Choose a loaded confirmed payment.";
    else {
      if (invoiceId && invoiceId !== payment.invoice_id) error = "The payment does not belong to the selected invoice.";
      invoiceId = payment.invoice_id;
    }
  }
  const invoice = invoices.find(row => row.id === invoiceId) || null;
  if (!error && invoiceId) {
    if (!invoice) error = "The linked invoice context is not loaded. Refresh relationships before posting; its currency cannot be assumed.";
    else {
      if (clientId && clientId !== invoice.client_id) error = "The selected client does not match the invoice.";
      clientId = invoice.client_id;
      if (invoice.order_id) {
        if (orderId && orderId !== invoice.order_id) error = "The selected order does not match the invoice.";
        orderId = invoice.order_id;
      }
      if (invoice.project_id) {
        if (projectId && projectId !== invoice.project_id) error = "The selected project does not match the invoice.";
        projectId = invoice.project_id;
      }
    }
  }
  const project = projects.find(row => row.id === projectId) || null;
  if (!error && projectId) {
    if (!project) error = "The linked project context is not loaded. Refresh relationships before posting; its currency cannot be assumed.";
    else {
      if (clientId && clientId !== project.client_id) error = "The selected client does not match the project.";
      if (orderId && orderId !== project.order_id) error = "The selected order does not match the project.";
      clientId = project.client_id;
      orderId = project.order_id;
    }
  }
  const order = orders.find(row => row.id === orderId) || null;
  if (!error && orderId) {
    if (!order) error = "The linked order context is not loaded. Refresh relationships before posting; its currency cannot be assumed.";
    else {
      if (clientId && clientId !== order.client_id) error = "The selected client does not match the order.";
      clientId = order.client_id;
    }
  }
  const client = meta?.clients.find(row => row.id === clientId) || null;
  if (!error && clientId && !client && !invoice && !project && !order) error = "Choose a loaded active client.";
  const currency = error ? null : (project?.currency || order?.currency || invoice?.currency || client?.currency || values.expense_currency).toUpperCase();
  return { error, payment, invoice, project, order, client, clientId, currency };
}

function boundedDecimal(raw: string) {
  const decimal = decimalInput(raw);
  if (decimal === null) return null;
  const [integer, fraction] = decimal.split(".");
  if (integer.length > 13 || integer.length === 13 && (integer > "1000000000000" || integer === "1000000000000" && fraction)) return null;
  return decimal;
}

function validOptionalDate(raw: string) {
  if (!raw) return true; // The existing backend chooses the organization's day.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const time = new Date(raw + "T00:00:00.000Z");
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === raw;
}

export function expensePreview(values: ExpenseForm, meta: Meta | null, accounts: VerifiedAccount[] | null) {
  const relationship = expenseRelationships(values, meta);
  const account = accounts?.find(row => row.id === values.account_id) || null;
  const category = meta?.categories.find(row => row.id === values.category_id) || null;
  const vendor = meta?.vendors.find(row => row.id === values.vendor_id) || null;
  const currency = values.expense_currency.trim().toUpperCase();
  const accountFx = Boolean(account && account.currency !== currency);
  const profitabilityFx = Boolean(relationship.currency && relationship.currency !== currency);
  const original = boundedDecimal(values.expense_amount), includedTax = boundedDecimal(values.tax_amount || "0");
  const deductionRaw = accountFx ? boundedDecimal(values.account_amount) : original;
  const profitabilityRaw = profitabilityFx ? boundedDecimal(values.profitability_amount) : original;
  const gross = original === null ? null : transferCents(original), tax = includedTax === null ? null : transferCents(includedTax);
  const deduction = deductionRaw === null ? null : transferCents(deductionRaw), profitability = profitabilityRaw === null ? null : transferCents(profitabilityRaw);
  let error = relationship.error;
  if (!meta || !accounts) error = "Load verified expense relationships and account types before posting.";
  else if (!account || !eligibleAccount(account)) error = "Choose an active non-credit-card account. This workflow does not support credit-card liability postings.";
  else if (!category?.is_active) error = "Choose an active expense category.";
  else if (values.vendor_id && !vendor?.is_active) error = "Choose an active vendor or clear the optional vendor.";
  else if (!values.description.trim() || values.description.length > 500) error = "Describe the expense in 1–500 characters.";
  else if (!validOptionalDate(values.expense_date)) error = "Choose a valid expense date, or leave it blank for the organization’s current day.";
  else if (!/^[A-Z]{3}$/.test(currency)) error = "Choose a three-letter expense currency.";
  else if (!methods.includes(values.payment_method)) error = "Choose a supported payment method.";
  else if (values.reference.length > 180) error = "Reference must be 180 characters or fewer.";
  else if (gross === null || gross <= BigInt(0) || tax === null || tax < BigInt(0) || deduction === null || deduction <= BigInt(0) || profitability === null || profitability <= BigInt(0)) error = "Enter valid amounts up to 1,000,000,000,000. Gross, account and profitability amounts must round to at least 0.01.";
  else if (tax > gross) error = "Included tax cannot exceed the rounded gross expense.";
  else if (transferCents(account.current_balance) === null || deduction > transferCents(account.current_balance)!) error = "The deduction exceeds or cannot be checked against the last loaded account balance. Refresh setup.";
  const rate = gross !== null && deduction !== null ? expenseRate(deduction, gross) : null;
  const profitabilityRate = gross !== null && profitability !== null ? expenseRate(profitability, gross) : null;
  if (!error && (!rate || !profitabilityRate || rate === "0.00000000" || profitabilityRate === "0.00000000")) error = "This conversion exceeds the supported stored exchange-rate precision. A positive conversion must not round to zero.";
  const amounts = !error && gross !== null && tax !== null && deduction !== null && profitability !== null && rate && profitabilityRate
    ? { gross: centsText(gross), tax: centsText(tax), net: centsText(gross - tax), deduction: centsText(deduction), profitability: centsText(profitability), rate, profitabilityRate } : null;
  return { error, relationship, account, category, vendor, currency, accountFx, profitabilityFx, amounts };
}

export function expensePayload(values: ExpenseForm, preview: ReturnType<typeof expensePreview>) {
  if (preview.error || !preview.amounts) throw new Error("Expense amounts and relationships must be verified before posting.");
  return {
    description: values.description.trim(), category_id: values.category_id, account_id: values.account_id, vendor_id: values.vendor_id || null,
    client_id: values.client_id || null, project_id: values.project_id || null, order_id: values.order_id || null, invoice_id: values.invoice_id || null, payment_id: values.payment_id || null,
    expense_date: values.expense_date || null, expense_currency: preview.currency, expense_amount: decimalInput(values.expense_amount),
    account_amount: preview.accountFx ? decimalInput(values.account_amount) : null,
    profitability_amount: preview.profitabilityFx ? decimalInput(values.profitability_amount) : null,
    tax_amount: decimalInput(values.tax_amount || "0"), payment_method: values.payment_method, reference: values.reference.trim() || null, notes: values.notes.trim() || null,
  };
}
