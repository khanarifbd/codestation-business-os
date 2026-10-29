"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Plus, RotateCcw, Save, Send, Share2, Trash2, X, Edit3 } from "lucide-react";

import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { InvoiceStripeSandboxPanel } from "@/components/invoice-stripe-sandbox-panel";
import { InvoiceStripeLivePanel } from "@/components/invoice-stripe-live-panel";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";
import { PageHeader, SectionHeader } from "@/components/ui/app-page";
import { InvoiceStatus } from "@/components/invoices/invoice-ui";
import "@/components/invoices/invoice-design.css";
import "@/components/invoices/invoice-detail.css";

type Item = {
  id: string;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  discount_percent: string | number;
  tax_rate: string | number;
  line_total: string | number;
};

type Invoice = {
  id: string;
  invoice_number: string;
  client_id: string;
  client_name: string;
  order_id: string | null;
  project_id: string | null;
  status: string;
  display_status: string;
  subject: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  tax_calculation_mode: "exclusive" | "inclusive";
  total: string | number;
  amount_paid: string | number;
  balance_due: string | number;
  notes: string | null;
  terms_conditions: string | null;
  internal_notes: string | null;
  cancel_reason: string | null;
  items: Item[];
};

type Payment = {
  id: string;
  payment_number: string;
  payment_date: string;
  account_name: string;
  invoice_amount: string | number;
  invoice_currency: string;
  account_amount: string | number;
  account_currency: string;
  status: string;
  method: string;
  reference: string | null;
};

type EditLine = { description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string };
type EditForm = { tax_calculation_mode: "exclusive" | "inclusive" | ""; subject: string; issue_date: string; due_date: string; currency: string; notes: string; terms_conditions: string; internal_notes: string; lines: EditLine[] };

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function apiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : String(item)).join(" · ");
  return fallback;
}

function toForm(invoice: Invoice): EditForm {
  return {
    tax_calculation_mode: invoice.tax_calculation_mode === "inclusive" || invoice.tax_calculation_mode === "exclusive" ? invoice.tax_calculation_mode : "",
    subject: invoice.subject ?? "",
    issue_date: invoice.issue_date,
    due_date: invoice.due_date ?? "",
    currency: invoice.currency,
    notes: invoice.notes ?? "",
    terms_conditions: invoice.terms_conditions ?? "",
    internal_notes: invoice.internal_notes ?? "",
    lines: invoice.items.map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      unit_price: String(item.unit_price),
      discount_percent: String(item.discount_percent),
      tax_rate: String(item.tax_rate),
    })),
  };
}

const blankLine = (): EditLine => ({ description: "", quantity: "1", unit_price: "0", discount_percent: "0", tax_rate: "0" });

export function InvoiceDetailWorkspace({ invoiceId, onUpdated }: { invoiceId: string; onUpdated?: () => void }) {
  const { tenant } = useDashboardSession();
  const canReversePayment = Boolean(tenant?.permissions.includes("*") || tenant?.permissions.includes("finance.manage"));
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [confirmingReversal, setConfirmingReversal] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [form, setForm] = useState<EditForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellingInvoice, setCancellingInvoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const readSequence = useRef(0);
  const readPending = useRef(false);
  const [readFailed, setReadFailed] = useState(false);

  function hasCurrentInvoice() {
    return Boolean(invoice && invoice.id === invoiceId && !loading && !readPending.current && !readFailed);
  }

  const load = useCallback(async () => {
    const request = ++readSequence.current;
    readPending.current = true;
    setLoading(true); setError(null);
    try {
      const [invoiceResponse, paymentResponse] = await Promise.all([
        fetch(`/api/finance/invoices/${invoiceId}`, { cache: "no-store" }),
        fetch(`/api/finance/payments?invoice_id=${invoiceId}&limit=100`, { cache: "no-store" }),
      ]);
      const invoicePayload = await invoiceResponse.json();
      const paymentPayload = await paymentResponse.json();
      if (request !== readSequence.current) return;
      if (!invoiceResponse.ok) throw new Error(apiError(invoicePayload, "Could not load invoice"));
      if (!paymentResponse.ok) throw new Error(apiError(paymentPayload, "Could not load payment history"));
      if (invoicePayload?.id !== invoiceId) throw new Error("Invoice identity could not be verified. Retry loading.");
      if (!Array.isArray(paymentPayload)) throw new Error("Payment history could not be verified. Retry loading.");
      const nextForm = toForm(invoicePayload);
      setReadFailed(false);
      setInvoice(invoicePayload);
      setPayments(paymentPayload);
      setForm(nextForm);
    } catch (reason) {
      if (request !== readSequence.current) return;
      setReadFailed(true);
      setError(reason instanceof Error ? reason.message : "Could not load invoice");
    } finally { if (request === readSequence.current) { readPending.current = false; setLoading(false); } }
  }, [invoiceId]);

  useEffect(() => { void load(); return () => { readSequence.current++; readPending.current = true; }; }, [load]);

  async function saveDraft() {
    if (!hasCurrentInvoice()) return;
    if (!form || !invoice) return;
    if (form.tax_calculation_mode !== "exclusive" && form.tax_calculation_mode !== "inclusive") {
      setError("The saved invoice tax mode could not be verified. Reload the invoice before saving; no tax mode will be guessed.");
      return;
    }
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/finance/invoices/${invoice.id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: form.subject || null,
          issue_date: form.issue_date,
          due_date: form.due_date || null,
          currency: form.currency,
          tax_calculation_mode: form.tax_calculation_mode,
          notes: form.notes || null,
          terms_conditions: form.terms_conditions || null,
          internal_notes: form.internal_notes || null,
          items: form.lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unit_price: Number(line.unit_price),
            discount_percent: Number(line.discount_percent || 0),
            tax_rate: Number(line.tax_rate || 0),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Could not update draft invoice"));
      setMessage("Draft invoice updated successfully.");
      setEditing(false);
      await load();
      onUpdated?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update invoice");
    } finally { setSaving(false); }
  }

  async function sendInvoice() {
    if (!hasCurrentInvoice()) return;
    if (!invoice) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/finance/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Could not send invoice"));
      setMessage("Invoice sent. Commercial details are now locked.");
      setEditing(false);
      await load();
      onUpdated?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send invoice");
    } finally { setSaving(false); }
  }

  async function shareInvoice() {
    if (!hasCurrentInvoice()) return;
    if (!invoice) return;
    setError(null);
    setMessage(null);
    const relativeUrl = `/print/invoices/${invoice.id}`;
    const shareUrl = `${window.location.origin}${relativeUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Invoice ${invoice.invoice_number}`,
          text: `${invoice.invoice_number} · ${invoice.client_name}`,
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setMessage(`Invoice ${invoice.invoice_number} link copied to clipboard.`);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("Could not share this invoice. Open PDF View and use your browser share or copy the URL.");
    }
  }

  async function cancelInvoice() {
    if (!hasCurrentInvoice()) return;
    if (!invoice || cancelReason.trim().length < 3 || cancellingInvoice) return;
    setCancellingInvoice(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/finance/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: cancelReason.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError(payload, "Could not cancel invoice"));
      setCancelOpen(false);
      setCancelReason("");
      setEditing(false);
      await load();
      onUpdated?.();
      setMessage("Invoice cancelled. The reason is preserved in the audit trail and any posted invoice journal was reversed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel invoice");
    } finally {
      setCancellingInvoice(false);
    }
  }

  async function reversePayment() {
    if (!hasCurrentInvoice()) return;
    if (!selectedPayment || selectedPayment.status !== "confirmed" || reversing || reversalReason.trim().length < 3) return;
    const paymentToReverse = payments.find(payment => payment.id === selectedPayment.id && payment.status === "confirmed");
    if (!paymentToReverse) return;
    setReversing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/accounting/corrections/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "payment",
          source_id: paymentToReverse.id,
          reason: reversalReason.trim(),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError(payload, "Could not reverse invoice payment"));
      setSelectedPayment(null);
      setConfirmingReversal(false);
      setReversalReason("");
      await load();
      onUpdated?.();
      setMessage(`Payment ${paymentToReverse.payment_number} reversed. The invoice balance and accounting records have been updated.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reverse invoice payment");
      setSelectedPayment(null);
      setConfirmingReversal(false);
    } finally {
      setReversing(false);
    }
  }

  if (loading && !invoice) return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl text-sm text-neutral-500">Loading invoice…</div></main>;
  if (!invoice || invoice.id !== invoiceId || !form) return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl"><p className="text-red-600">{error ?? "Invoice not found"}</p><button type="button" disabled={loading} onClick={() => void load()}>Retry loading</button></div></main>;

  const currentRead = invoice.id === invoiceId && !loading && !readFailed;
  const draft = currentRead && invoice.status === "draft";
  const canCancelInvoice = currentRead && !["paid", "cancelled"].includes(invoice.status) && Number(invoice.amount_paid) === 0;
  const canCollectPayment = currentRead && !["draft", "cancelled", "paid"].includes(invoice.status) && Number(invoice.balance_due) > 0;
  const sourceLabel = invoice.project_id ? "Project invoice" : invoice.order_id ? "Order invoice" : "Manual client invoice";

  return <main className="invoice-detail-page"><div className="invoice-detail-content">
    <Link href="/dashboard/accounting/invoices" className="invoice-detail-back"><ArrowLeft className="size-4" aria-hidden="true" />All invoices</Link>
    <PageHeader
      className="invoice-detail-heading"
      eyebrow="FINANCE & ACCOUNTS / INVOICE"
      title={invoice.invoice_number}
      description={<>{sourceLabel}<span className="invoice-detail-separator" aria-hidden="true">/</span>{invoice.client_name}</>}
      actions={<div className="invoice-detail-actions">
        {currentRead && !editing ? <Link href={`/print/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="invoice-detail-action"><FileText className="size-4" />PDF View · saved</Link> : null}
        {currentRead && !editing ? <button type="button" onClick={() => void shareInvoice()} className="invoice-detail-action"><Share2 className="size-4" />Share</button> : null}
        {draft && !editing ? <button onClick={() => setEditing(true)} className="invoice-detail-action"><Edit3 className="size-4" />Edit draft</button> : null}
        {draft && !editing ? <button disabled={saving} onClick={() => void sendInvoice()} className="invoice-detail-action invoice-detail-action-primary"><Send className="size-4" />Send invoice</button> : null}
        {canCollectPayment && !editing ? <Link href={`/dashboard/accounting/money-in?invoice_id=${invoice.id}`} className="invoice-detail-action invoice-detail-action-primary">Collect payment</Link> : null}
        {canCancelInvoice && !editing ? <button type="button" disabled={saving || cancellingInvoice} onClick={() => { setCancelReason(""); setCancelOpen(true); setError(null); }} className="invoice-detail-action invoice-detail-action-danger"><Trash2 className="size-4" />Cancel invoice</button> : null}
        {editing ? <button onClick={() => { setForm(toForm(invoice)); setEditing(false); }} className="invoice-detail-action"><X className="size-4" />Cancel edit</button> : null}
        {editing ? <button disabled={saving || !currentRead} onClick={() => void saveDraft()} className="invoice-detail-action invoice-detail-action-primary"><Save className="size-4" />{saving ? "Saving…" : "Save changes"}</button> : null}
      </div>}
    />

    {error ? <div role="alert" className="invoice-detail-notice invoice-detail-notice-error">{error}{readFailed ? <button type="button" disabled={loading} onClick={() => void load()} className="ml-3 underline">Retry loading</button> : null}</div> : null}
    {message ? <div role="status" className="invoice-detail-notice invoice-detail-notice-success">{message}</div> : null}
    {invoice.status === "cancelled" ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><strong>Cancelled invoice.</strong>{invoice.cancel_reason ? <> Reason: {invoice.cancel_reason}</> : <> Cancellation reason is available in the audit trail for newer cancellations.</>}</div> : null}

    <section className="invoice-detail-summary" aria-label="Invoice financial summary">
      <Summary label="Status" value={invoice.display_status.replaceAll("_", " ")} status={invoice.display_status} />
      <Summary label={editing ? "Saved total" : "Total"} value={money(invoice.total, invoice.currency)} />
      <Summary label="Paid" value={money(invoice.amount_paid, invoice.currency)} />
      <Summary label="Balance due" value={money(invoice.balance_due, invoice.currency)} emphasis />
    </section>

    {editing ? <p className="invoice-detail-notice" role="status">Totals shown are the saved invoice values. Edits are recalculated when saved. Print / PDF uses the saved document, not unsaved changes.</p> : null}

    {currentRead && !editing && <InvoiceStripeSandboxPanel invoiceId={invoice.id} currency={invoice.currency} status={invoice.status} canManage={canReversePayment} />}
    {currentRead && !editing && <InvoiceStripeLivePanel invoiceId={invoice.id} currency={invoice.currency} status={invoice.status} canManage={canReversePayment} />}

    <section className="invoice-detail-card">
      <SectionHeader title="Invoice details" description={draft ? "Draft invoices can be changed until they are sent." : invoice.status === "cancelled" ? "Cancelled invoices are retained for audit history and cannot be collected." : "Sent invoices are locked to preserve the commercial record."} action={invoice.project_id ? <Link href={`/dashboard/projects/${invoice.project_id}`} className="invoice-detail-text-action">Open project →</Link> : null} />

      <div className="invoice-detail-metadata">
        <Field label="Tax calculation"><Read value={form.tax_calculation_mode === "inclusive" ? "Tax inclusive · preserved on save" : form.tax_calculation_mode === "exclusive" ? "Tax exclusive · preserved on save" : "Unknown — reload before saving"} /></Field>
        <Field label="Client"><div className="rounded-xl border bg-neutral-50 px-3 py-2.5 text-sm">{invoice.client_name}</div></Field>
        <Field label="Subject">{editing ? <input aria-label="Subject" value={form.subject} onChange={(e) => setForm((v) => v ? { ...v, subject: e.target.value } : v)} className="w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.subject || "—"} />}</Field>
        <Field label="Currency">{editing ? <SearchableSelect required value={form.currency} onValueChange={(value) => setForm((v) => v ? { ...v, currency: value } : v)} options={CURRENCY_OPTIONS} placeholder="Select currency" searchPlaceholder="Search currency..." clearable={false} /> : <Read value={invoice.currency} />}</Field>
        <Field label="Issue date">{editing ? <input aria-label="Issue date" type="date" value={form.issue_date} onChange={(e) => setForm((v) => v ? { ...v, issue_date: e.target.value } : v)} className="w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.issue_date} />}</Field>
        <Field label="Due date">{editing ? <input aria-label="Due date" type="date" value={form.due_date} onChange={(e) => setForm((v) => v ? { ...v, due_date: e.target.value } : v)} className="w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.due_date || "—"} />}</Field>
        <Field label="Source"><Read value={sourceLabel} /></Field>
      </div>

      <div className="invoice-detail-items">
        <div className="invoice-detail-section-heading"><div><h3 className="font-semibold">Invoice items</h3><p className="mt-1 text-xs text-neutral-400">Description, quantity, rate, discount and tax.</p></div>{editing ? <button type="button" onClick={() => setForm((v) => v ? { ...v, lines: [...v.lines, blankLine()] } : v)} className="inline-flex items-center gap-1 text-sm font-medium"><Plus className="size-4" />Add item</button> : null}</div>
        <div className="invoice-item-head" aria-hidden="true"><span>Description</span><span>Quantity</span><span>Unit price</span><span>Discount %</span><span>Tax %</span><span>{editing ? "Action" : "Total"}</span></div>
        <div className="invoice-item-list">{editing ? form.lines.map((line, index) => <div key={index} className="invoice-item-edit">
          <label className="invoice-item-edit-field"><span>Description</span><input aria-label={`Item ${index + 1} description`} required value={line.description} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, description: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" placeholder="Description" /></label>
          <label className="invoice-item-edit-field"><span>Quantity</span><input aria-label={`Item ${index + 1} quantity`} type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, quantity: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" /></label>
          <label className="invoice-item-edit-field"><span>Unit price</span><input aria-label={`Item ${index + 1} unit price`} type="number" min="0" step="0.01" value={line.unit_price} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, unit_price: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" /></label>
          <label className="invoice-item-edit-field"><span>Discount %</span><input aria-label={`Item ${index + 1} discount percent`} type="number" min="0" max="100" step="0.01" value={line.discount_percent} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, discount_percent: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" /></label>
          <label className="invoice-item-edit-field"><span>Tax %</span><input aria-label={`Item ${index + 1} tax rate`} type="number" min="0" step="0.01" value={line.tax_rate} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, tax_rate: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" /></label>
          <button type="button" disabled={form.lines.length === 1} onClick={() => setForm((v) => v ? { ...v, lines: v.lines.filter((_, i) => i !== index) } : v)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-30">Remove</button>
        </div>) : invoice.items.map((item) => <div key={item.id} className="invoice-item-read"><span data-label="Description"><span className="sr-only">Description: </span>{item.description}</span><span data-label="Quantity"><span className="sr-only">Quantity: </span>{item.quantity}</span><span data-label="Unit price"><span className="sr-only">Unit price: </span>{money(item.unit_price, invoice.currency)}</span><span data-label="Discount"><span className="sr-only">Discount: </span>{item.discount_percent}%</span><span data-label="Tax"><span className="sr-only">Tax: </span>{item.tax_rate}%</span><span data-label="Total"><span className="sr-only">Total: </span>{money(item.line_total, invoice.currency)}</span></div>)}</div>
      </div>

      <div className="invoice-detail-notes">
        <Field label="Notes">{editing ? <textarea aria-label="Notes" value={form.notes} onChange={(e) => setForm((v) => v ? { ...v, notes: e.target.value } : v)} className="min-h-24 w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.notes || "—"} />}</Field>
        <Field label="Terms & conditions">{editing ? <textarea aria-label="Terms & conditions" value={form.terms_conditions} onChange={(e) => setForm((v) => v ? { ...v, terms_conditions: e.target.value } : v)} className="min-h-24 w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.terms_conditions || "—"} />}</Field>
        <Field label="Internal notes">{editing ? <textarea aria-label="Internal notes" value={form.internal_notes} onChange={(e) => setForm((v) => v ? { ...v, internal_notes: e.target.value } : v)} className="min-h-24 w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.internal_notes || "—"} />}</Field>
      </div>
    </section>

    <section className="invoice-detail-card invoice-payment-history">
      <SectionHeader title="Payment history" description="All collections linked to this invoice." />
      {payments.length ? <div className="invoice-payment-table-scroll" tabIndex={0} role="region" aria-label="Payment history table; scroll horizontally for all columns"><table className="invoice-payment-table"><caption className="sr-only">Payments linked to invoice {invoice.invoice_number}</caption>
        <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th scope="col" className="px-4 py-3">Payment</th><th scope="col" className="px-4 py-3">Date</th><th scope="col" className="px-4 py-3">Account</th><th scope="col" className="px-4 py-3">Method</th><th scope="col" className="px-4 py-3">Amount</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Reference</th>{canReversePayment ? <th scope="col" className="px-4 py-3 text-right">Action</th> : null}</tr></thead>
        <tbody>{payments.map((payment) => <tr key={payment.id} className="border-b last:border-0">
          <td className="px-4 py-3 font-medium">{payment.payment_number}</td>
          <td className="px-4 py-3">{payment.payment_date}</td>
          <td className="px-4 py-3">{payment.account_name}{payment.account_currency !== payment.invoice_currency ? <span className="mt-1 block text-xs font-normal text-neutral-500">Received {money(payment.account_amount, payment.account_currency)}</span> : null}</td>
          <td className="px-4 py-3 capitalize">{payment.method.replaceAll("_", " ")}</td>
          <td className="px-4 py-3 font-semibold">{money(payment.invoice_amount, payment.invoice_currency)}</td>
          <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${payment.status === "reversed" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{payment.status === "reversed" ? "Reversed" : payment.status === "confirmed" ? "Confirmed" : payment.status}</span></td>
          <td className="px-4 py-3">{payment.reference || "—"}</td>
          {canReversePayment ? <td className="px-4 py-3 text-right">{payment.status === "confirmed" ? <button type="button" disabled={saving || reversing || !currentRead} onClick={() => { setSelectedPayment(payment); setReversalReason(""); setConfirmingReversal(false); setError(null); }} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"><RotateCcw className="size-3.5" />Reverse payment</button> : <span className="text-xs text-neutral-400">—</span>}</td> : null}
        </tr>)}</tbody></table></div> : <div className="invoice-payments-empty"><FileText size={22} strokeWidth={1.5} aria-hidden="true" /><p>No payments recorded yet.</p><span>Collections for this invoice will appear here.</span></div>}
      {canReversePayment ? <p className="invoice-payment-audit-note">Recorded by mistake? Reverse the payment instead of changing the invoice status. This does not issue a refund or move real money.</p> : null}
    </section>
    {selectedPayment && !confirmingReversal ? <div className="invoice-detail-dialog fixed inset-0 z-[69] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="payment-reversal-title">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <h2 id="payment-reversal-title" className="text-xl font-semibold">Reverse payment {selectedPayment.payment_number}</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">Use this only when a payment was recorded incorrectly. The original record remains in history; its financial movement and journal are reversed. This does not refund money to the client.</p>
        <div className="mt-4 space-y-2 rounded-xl border bg-neutral-50 p-4 text-sm">
          <p><span className="text-neutral-500">Invoice:</span> <strong>{invoice.invoice_number}</strong></p>
          <p><span className="text-neutral-500">Original date:</span> {selectedPayment.payment_date}</p>
          <p><span className="text-neutral-500">Invoice payment:</span> <strong>{money(selectedPayment.invoice_amount, selectedPayment.invoice_currency)}</strong></p>
          <p><span className="text-neutral-500">Financial account:</span> {selectedPayment.account_name} · {money(selectedPayment.account_amount, selectedPayment.account_currency)}</p>
        </div>
        <label htmlFor="payment-reversal-reason" className="mt-4 block text-sm font-medium">Reason for reversal <span className="text-red-600">*</span></label>
        <textarea id="payment-reversal-reason" rows={3} maxLength={500} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="E.g. Payment recorded by mistake; no funds were received." className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm" />
        <p className="mt-1 text-xs text-neutral-500">A reason of at least 3 characters is required and is kept in the audit trail.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={reversing} onClick={() => setSelectedPayment(null)} className="rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50">Cancel</button>
          <button type="button" disabled={reversalReason.trim().length < 3 || reversing} onClick={() => setConfirmingReversal(true)} className="inline-flex items-center gap-2 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"><RotateCcw className="size-4" />Review reversal</button>
        </div>
      </div>
    </div> : null}
    {cancelOpen ? <div className="invoice-detail-dialog fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="detail-cancel-invoice-title">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-500">Cancel invoice</p><h2 id="detail-cancel-invoice-title" className="mt-1 text-xl font-semibold">{invoice.invoice_number}</h2><p className="mt-2 text-sm leading-6 text-neutral-600">The invoice remains in history. Business OS reverses the invoice issue journal if one exists; nothing is deleted from the ledger.</p></div><button type="button" disabled={cancellingInvoice} onClick={() => setCancelOpen(false)} className="rounded-lg p-2 hover:bg-neutral-100 disabled:opacity-40" aria-label="Close cancellation"><X className="size-5" /></button></div>
        <div className="mt-4 space-y-2 rounded-xl border bg-neutral-50 p-4 text-sm"><p><span className="text-neutral-500">Client:</span> <strong>{invoice.client_name}</strong></p><p><span className="text-neutral-500">Total:</span> <strong>{money(invoice.total, invoice.currency)}</strong></p><p><span className="text-neutral-500">Paid:</span> {money(invoice.amount_paid, invoice.currency)}</p></div>
        <label htmlFor="detail-invoice-cancel-reason" className="mt-4 block text-sm font-medium">Cancellation reason <span className="text-red-600">*</span></label>
        <textarea id="detail-invoice-cancel-reason" rows={3} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="E.g. Client cancelled before payment / invoice issued for the wrong scope." className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm" />
        <p className="mt-1 text-xs text-neutral-500">At least 3 characters required. If a payment exists, reverse the incorrect payment first.</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={cancellingInvoice} onClick={() => setCancelOpen(false)} className="rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50">Go back</button><button type="button" disabled={cancellingInvoice || cancelReason.trim().length < 3} onClick={() => void cancelInvoice()} className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"><Trash2 className="size-4" />{cancellingInvoice ? "Cancelling…" : "Cancel invoice"}</button></div>
      </div>
    </div> : null}
    <FinancialConfirmationDialog
      open={Boolean(selectedPayment && reversalReason.trim().length >= 3 && confirmingReversal)}
      title={`Reverse ${selectedPayment?.payment_number ?? "payment"}?`}
      description="This action is recorded in the accounting journal and audit trail. It cannot be undone by deleting the record."
      confirmLabel="Confirm reversal"
      warning="Only reverse an incorrectly recorded payment. If the client actually paid and you returned funds, use a refund workflow instead."
      details={selectedPayment ? [
        { label: "Invoice", value: invoice.invoice_number },
        { label: "Original payment", value: money(selectedPayment.invoice_amount, selectedPayment.invoice_currency), emphasis: true },
        { label: "Receiving account", value: `${selectedPayment.account_name} · ${money(selectedPayment.account_amount, selectedPayment.account_currency)}` },
        { label: "Reason", value: reversalReason.trim() },
      ] : []}
      loading={reversing}
      onCancel={() => setConfirmingReversal(false)}
      onConfirm={() => void reversePayment()}
    />
  </div></main>;
}

function Summary({ label, value, emphasis = false, status }: { label: string; value: string; emphasis?: boolean; status?: string }) {
  return <dl className={`invoice-summary-card${emphasis ? " invoice-summary-balance" : ""}`}><dt>{label}</dt><dd>{status ? <InvoiceStatus status={status} /> : value}</dd></dl>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="invoice-detail-field"><p>{label}</p>{children}</div>; }
function Read({ value }: { value: string }) { return <div className="invoice-detail-read">{value}</div>; }
