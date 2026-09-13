"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Edit3, Plus, Save, Send, X } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

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
  total: string | number;
  amount_paid: string | number;
  balance_due: string | number;
  notes: string | null;
  terms_conditions: string | null;
  internal_notes: string | null;
  items: Item[];
};

type Payment = {
  id: string;
  payment_number: string;
  payment_date: string;
  account_name: string;
  invoice_amount: string | number;
  invoice_currency: string;
  method: string;
  reference: string | null;
};

type EditLine = { description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string };
type EditForm = { subject: string; issue_date: string; due_date: string; currency: string; notes: string; terms_conditions: string; internal_notes: string; lines: EditLine[] };

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

export function InvoiceDetailWorkspace({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [form, setForm] = useState<EditForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [invoiceResponse, paymentResponse] = await Promise.all([
        fetch(`/api/finance/invoices/${invoiceId}`, { cache: "no-store" }),
        fetch(`/api/finance/payments?invoice_id=${invoiceId}&limit=100`, { cache: "no-store" }),
      ]);
      const invoicePayload = await invoiceResponse.json();
      const paymentPayload = await paymentResponse.json();
      if (!invoiceResponse.ok) throw new Error(apiError(invoicePayload, "Could not load invoice"));
      if (!paymentResponse.ok) throw new Error(apiError(paymentPayload, "Could not load payment history"));
      setInvoice(invoicePayload);
      setPayments(paymentPayload);
      setForm(toForm(invoicePayload));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load invoice");
    } finally { setLoading(false); }
  }, [invoiceId]);

  useEffect(() => { void load(); }, [load]);

  async function saveDraft() {
    if (!form || !invoice) return;
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
          tax_calculation_mode: "exclusive",
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update invoice");
    } finally { setSaving(false); }
  }

  async function sendInvoice() {
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send invoice");
    } finally { setSaving(false); }
  }

  if (loading && !invoice) return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl text-sm text-neutral-500">Loading invoice…</div></main>;
  if (!invoice || !form) return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl"><p className="text-red-600">{error ?? "Invoice not found"}</p></div></main>;

  const draft = invoice.status === "draft";
  const sourceLabel = invoice.project_id ? "Project invoice" : invoice.order_id ? "Order invoice" : "Manual client invoice";

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Link href="/dashboard/accounting/invoices" className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Invoices</Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{invoice.invoice_number}</h1>
        <p className="mt-2 text-sm text-neutral-500">{sourceLabel} · {invoice.client_name}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {draft && !editing ? <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium"><Edit3 className="size-4" />Edit draft</button> : null}
        {draft && !editing ? <button disabled={saving} onClick={() => void sendInvoice()} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Send className="size-4" />Send invoice</button> : null}
        {editing ? <button onClick={() => { setForm(toForm(invoice)); setEditing(false); }} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium"><X className="size-4" />Cancel edit</button> : null}
        {editing ? <button disabled={saving} onClick={() => void saveDraft()} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Save className="size-4" />{saving ? "Saving…" : "Save changes"}</button> : null}
      </div>
    </div>
    <AccountingNav />

    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    <section className="grid gap-4 md:grid-cols-4">
      <Summary label="Status" value={invoice.display_status.replaceAll("_", " ")} />
      <Summary label="Total" value={money(invoice.total, invoice.currency)} />
      <Summary label="Paid" value={money(invoice.amount_paid, invoice.currency)} />
      <Summary label="Due" value={money(invoice.balance_due, invoice.currency)} />
    </section>

    <section className="rounded-2xl border bg-white p-5">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Invoice details</h2><p className="mt-1 text-sm text-neutral-500">{draft ? "Draft invoices can be changed until they are sent." : "Sent invoices are locked to preserve the commercial record."}</p></div>{invoice.project_id ? <Link href={`/dashboard/projects/${invoice.project_id}`} className="text-sm font-medium">Open project →</Link> : null}</div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Client"><div className="rounded-xl border bg-neutral-50 px-3 py-2.5 text-sm">{invoice.client_name}</div></Field>
        <Field label="Subject">{editing ? <input value={form.subject} onChange={(e) => setForm((v) => v ? { ...v, subject: e.target.value } : v)} className="w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.subject || "—"} />}</Field>
        <Field label="Currency">{editing ? <SearchableSelect required value={form.currency} onValueChange={(value) => setForm((v) => v ? { ...v, currency: value } : v)} options={CURRENCY_OPTIONS} placeholder="Select currency" searchPlaceholder="Search currency..." clearable={false} /> : <Read value={invoice.currency} />}</Field>
        <Field label="Issue date">{editing ? <input type="date" value={form.issue_date} onChange={(e) => setForm((v) => v ? { ...v, issue_date: e.target.value } : v)} className="w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.issue_date} />}</Field>
        <Field label="Due date">{editing ? <input type="date" value={form.due_date} onChange={(e) => setForm((v) => v ? { ...v, due_date: e.target.value } : v)} className="w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.due_date || "—"} />}</Field>
        <Field label="Source"><Read value={sourceLabel} /></Field>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between"><div><h3 className="font-semibold">Invoice items</h3><p className="mt-1 text-xs text-neutral-400">Description, quantity, rate, discount and tax.</p></div>{editing ? <button type="button" onClick={() => setForm((v) => v ? { ...v, lines: [...v.lines, blankLine()] } : v)} className="inline-flex items-center gap-1 text-sm font-medium"><Plus className="size-4" />Add item</button> : null}</div>
        <div className="mt-4 hidden grid-cols-7 gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 lg:grid"><span className="col-span-2">Description</span><span>Quantity</span><span>Unit price</span><span>Discount %</span><span>Tax %</span><span>Total</span></div>
        <div className="mt-2 space-y-3">{editing ? form.lines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border p-3 lg:grid-cols-7">
          <input required value={line.description} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, description: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2 lg:col-span-2" placeholder="Description" />
          <input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, quantity: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" />
          <input type="number" min="0" step="0.01" value={line.unit_price} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, unit_price: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" />
          <input type="number" min="0" max="100" step="0.01" value={line.discount_percent} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, discount_percent: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" />
          <input type="number" min="0" step="0.01" value={line.tax_rate} onChange={(e) => setForm((v) => v ? { ...v, lines: v.lines.map((x, i) => i === index ? { ...x, tax_rate: e.target.value } : x) } : v)} className="rounded-lg border px-3 py-2" />
          <button type="button" disabled={form.lines.length === 1} onClick={() => setForm((v) => v ? { ...v, lines: v.lines.filter((_, i) => i !== index) } : v)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-30">Remove</button>
        </div>) : invoice.items.map((item) => <div key={item.id} className="grid gap-2 rounded-xl border p-3 text-sm lg:grid-cols-7"><span className="lg:col-span-2">{item.description}</span><span>{item.quantity}</span><span>{money(item.unit_price, invoice.currency)}</span><span>{item.discount_percent}%</span><span>{item.tax_rate}%</span><span className="font-semibold">{money(item.line_total, invoice.currency)}</span></div>)}</div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Field label="Notes">{editing ? <textarea value={form.notes} onChange={(e) => setForm((v) => v ? { ...v, notes: e.target.value } : v)} className="min-h-24 w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.notes || "—"} />}</Field>
        <Field label="Terms & conditions">{editing ? <textarea value={form.terms_conditions} onChange={(e) => setForm((v) => v ? { ...v, terms_conditions: e.target.value } : v)} className="min-h-24 w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.terms_conditions || "—"} />}</Field>
        <Field label="Internal notes">{editing ? <textarea value={form.internal_notes} onChange={(e) => setForm((v) => v ? { ...v, internal_notes: e.target.value } : v)} className="min-h-24 w-full rounded-xl border px-3 py-2.5" /> : <Read value={invoice.internal_notes || "—"} />}</Field>
      </div>
    </section>

    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="border-b p-5"><h2 className="font-semibold">Payment history</h2><p className="mt-1 text-sm text-neutral-500">All collections linked to this invoice.</p></div>
      {payments.length ? <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Account</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Reference</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{payment.payment_number}</td><td className="px-4 py-3">{payment.payment_date}</td><td className="px-4 py-3">{payment.account_name}</td><td className="px-4 py-3 capitalize">{payment.method.replaceAll("_", " ")}</td><td className="px-4 py-3 font-semibold">{money(payment.invoice_amount, payment.invoice_currency)}</td><td className="px-4 py-3">{payment.reference || "—"}</td></tr>)}</tbody></table></div> : <p className="p-8 text-center text-sm text-neutral-400">No payments recorded yet.</p>}
    </section>
  </div></main>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 text-xl font-semibold capitalize">{value}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><p className="mb-1.5 text-sm font-medium text-neutral-600">{label}</p>{children}</div>; }
function Read({ value }: { value: string }) { return <div className="min-h-11 rounded-xl border bg-neutral-50 px-3 py-2.5 text-sm">{value}</div>; }
