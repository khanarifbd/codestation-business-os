"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { FileText, Plus, Send, X } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type Source = "client" | "order" | "project";
type Client = { id: string; code: string; name: string; currency: string | null };
type Order = { id: string; number: string; client_id: string; client_name: string; currency: string; total: string | number; status: string };
type Project = { id: string; number: string; order_id: string; client_id: string; name: string; currency: string; contract_value: string | number; status: string };
type Meta = { clients: Client[]; orders: Order[]; projects: Project[] };
type Invoice = { id: string; invoice_number: string; client_name: string; order_id: string | null; project_id: string | null; status: string; display_status: string; subject: string | null; issue_date: string; due_date: string | null; currency: string; total: string | number; amount_paid: string | number; balance_due: string | number };
type Line = { description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string };

function today() { return new Date().toISOString().slice(0, 10); }
function money(v: string | number, c: string) { return `${c} ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function apiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (item && typeof item === "object") {
        const entry = item as { msg?: unknown; loc?: unknown };
        const where = Array.isArray(entry.loc) ? entry.loc.join(".") : "";
        const message = typeof entry.msg === "string" ? entry.msg : "Invalid request";
        return where ? `${where}: ${message}` : message;
      }
      return String(item);
    }).filter(Boolean);
    return messages.join(" · ") || fallback;
  }
  return fallback;
}
const blank = (): Line => ({ description: "", quantity: "1", unit_price: "0", discount_percent: "0", tax_rate: "0" });

export function InvoicesWorkspace() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [meta, setMeta] = useState<Meta>({ clients: [], orders: [], projects: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [source, setSource] = useState<Source>("project");
  const [form, setForm] = useState({ source_id: "", client_id: "", subject: "", issue_date: today(), due_date: "", currency: "", notes: "", lines: [blank()] });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [m, i] = await Promise.all([
        fetch("/api/finance/meta", { cache: "no-store" }),
        fetch("/api/finance/invoice-page?limit=100", { cache: "no-store" }),
      ]);
      const mp = await m.json(); const ip = await i.json();
      if (!m.ok) throw new Error(apiError(mp, "Could not load invoice setup"));
      if (!i.ok) throw new Error(apiError(ip, "Could not load invoices"));
      setMeta(mp); setInvoices(ip.items ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load invoices"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function resetSource(next: Source) {
    setSource(next);
    setForm({ source_id: "", client_id: "", subject: "", issue_date: today(), due_date: "", currency: "", notes: "", lines: [blank()] });
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      let response: Response;
      if (source === "project") response = await fetch(`/api/finance/invoices/from-project/${form.source_id}`, { method: "POST" });
      else if (source === "order") response = await fetch(`/api/finance/invoices/from-order/${form.source_id}`, { method: "POST" });
      else response = await fetch("/api/finance/invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: form.client_id, subject: form.subject || null, issue_date: form.issue_date, due_date: form.due_date || null,
          currency: form.currency || null, tax_calculation_mode: "exclusive", notes: form.notes || null,
          items: form.lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unit_price: Number(line.unit_price), discount_percent: Number(line.discount_percent || 0), tax_rate: Number(line.tax_rate || 0) })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Could not create invoice"));
      setMessage(`Invoice ${payload.invoice_number} created as draft. Review it, then send it to make it collectible.`);
      setShowForm(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create invoice"); }
    finally { setSaving(false); }
  }

  async function sendInvoice(invoice: Invoice) {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/finance/invoices/${invoice.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Could not send invoice"));
      setMessage(`Invoice ${invoice.invoice_number} is now open for collection.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update invoice"); }
    finally { setSaving(false); }
  }

  const projectOptions = meta.projects.filter((p) => p.status !== "cancelled").map((p) => ({
    value: p.id,
    label: `${p.number} · ${p.name} · ${money(p.contract_value, p.currency)}`,
    keywords: `${p.number} ${p.name} ${p.currency} ${p.contract_value}`,
  }));
  const orderOptions = meta.orders.filter((o) => o.status !== "cancelled").map((o) => ({
    value: o.id,
    label: `${o.number} · ${o.client_name} · ${money(o.total, o.currency)}`,
    keywords: `${o.number} ${o.client_name} ${o.currency} ${o.total}`,
  }));
  const clientOptions = meta.clients.map((c) => ({
    value: c.id,
    label: `${c.code} · ${c.name}`,
    keywords: `${c.code} ${c.name} ${c.currency ?? ""}`,
  }));

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Invoices</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Create invoices from projects, orders or directly for a client. Collect actual payments from Money In.</p></div><button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Plus className="size-4" />New invoice</button></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    {showForm ? <section className="rounded-2xl border bg-white p-5">
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Create invoice</h2><p className="mt-1 text-sm text-neutral-500">Choose where the invoice comes from. Project and order details are copied automatically.</p></div><button onClick={() => setShowForm(false)} className="rounded-lg p-2 hover:bg-neutral-100"><X className="size-5" /></button></div>
      <div className="mt-4 flex flex-wrap gap-2">{(["project", "order", "client"] as Source[]).map((item) => <button type="button" key={item} onClick={() => resetSource(item)} className={`rounded-xl px-4 py-2 text-sm font-medium ${source === item ? "bg-neutral-950 text-white" : "border"}`}>{item === "client" ? "Manual client invoice" : item === "project" ? "From project" : "From order"}</button>)}</div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        {source === "project" ? <SearchableSelect label="Project" required value={form.source_id} onValueChange={(value) => setForm((v) => ({ ...v, source_id: value }))} options={projectOptions} placeholder="Select project" searchPlaceholder="Search project by number, name, amount or currency..." clearable={false} /> : null}
        {source === "order" ? <SearchableSelect label="Order" required value={form.source_id} onValueChange={(value) => setForm((v) => ({ ...v, source_id: value }))} options={orderOptions} placeholder="Select order" searchPlaceholder="Search order by number, client, amount or currency..." clearable={false} /> : null}
        {source === "client" ? <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <SearchableSelect label="Client" required value={form.client_id} onValueChange={(id) => { const c = meta.clients.find((item) => item.id === id); setForm((v) => ({ ...v, client_id: id, currency: c?.currency ?? v.currency })); }} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client by code or name..." clearable={false} />
            <Field label="Subject"><input value={form.subject} onChange={(e) => setForm((v) => ({ ...v, subject: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" placeholder="Website development" /></Field>
            <SearchableSelect label="Currency" required value={form.currency} onValueChange={(value) => setForm((v) => ({ ...v, currency: value }))} options={CURRENCY_OPTIONS} placeholder="Select currency" searchPlaceholder="Search currency by code or name..." clearable={false} />
            <Field label="Issue date"><input required type="date" value={form.issue_date} onChange={(e) => setForm((v) => ({ ...v, issue_date: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
            <Field label="Due date"><input type="date" value={form.due_date} onChange={(e) => setForm((v) => ({ ...v, due_date: e.target.value }))} className="w-full rounded-xl border px-3 py-2.5" /></Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between"><div><h3 className="font-medium">Invoice items</h3><p className="mt-1 text-xs text-neutral-400">Add what you are billing the client for.</p></div><button type="button" onClick={() => setForm((v) => ({ ...v, lines: [...v.lines, blank()] }))} className="text-sm font-medium">+ Add item</button></div>
            <div className="hidden grid-cols-6 gap-3 px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 lg:grid"><span className="col-span-2">Description</span><span>Quantity</span><span>Unit price</span><span>Discount %</span><span>Tax %</span></div>
            <div className="space-y-3">{form.lines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border p-3 lg:grid-cols-6">
              <LabeledInput label="Description" className="lg:col-span-2"><input required value={line.description} onChange={(e) => setForm((v) => ({ ...v, lines: v.lines.map((x, i) => i === index ? { ...x, description: e.target.value } : x) }))} className="w-full rounded-lg border px-3 py-2" placeholder="App development" /></LabeledInput>
              <LabeledInput label="Quantity"><input required type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setForm((v) => ({ ...v, lines: v.lines.map((x, i) => i === index ? { ...x, quantity: e.target.value } : x) }))} className="w-full rounded-lg border px-3 py-2" /></LabeledInput>
              <LabeledInput label="Unit price"><input required type="number" min="0" step="0.01" value={line.unit_price} onChange={(e) => setForm((v) => ({ ...v, lines: v.lines.map((x, i) => i === index ? { ...x, unit_price: e.target.value } : x) }))} className="w-full rounded-lg border px-3 py-2" /></LabeledInput>
              <LabeledInput label="Discount %"><input type="number" min="0" max="100" step="0.01" value={line.discount_percent} onChange={(e) => setForm((v) => ({ ...v, lines: v.lines.map((x, i) => i === index ? { ...x, discount_percent: e.target.value } : x) }))} className="w-full rounded-lg border px-3 py-2" /></LabeledInput>
              <LabeledInput label="Tax %"><input type="number" min="0" step="0.01" value={line.tax_rate} onChange={(e) => setForm((v) => ({ ...v, lines: v.lines.map((x, i) => i === index ? { ...x, tax_rate: e.target.value } : x) }))} className="w-full rounded-lg border px-3 py-2" /></LabeledInput>
            </div>)}</div>
          </div>
        </> : null}
        <div className="flex justify-end"><button disabled={saving} className="rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Creating…" : "Create draft invoice"}</button></div>
      </form>
    </section> : null}

    <section className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-5"><h2 className="font-semibold">Invoice list</h2><p className="mt-1 text-sm text-neutral-500">Draft → Sent → Partially paid → Paid. Payment entry lives in Money In, not here.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Issue / Due</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Due</th><th className="px-4 py-3"></th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-b last:border-0"><td className="px-4 py-3"><p className="font-medium">{invoice.invoice_number}</p><p className="text-xs text-neutral-400">{invoice.subject || "No subject"}</p></td><td className="px-4 py-3">{invoice.client_name}</td><td className="px-4 py-3 capitalize">{invoice.display_status.replaceAll("_", " ")}</td><td className="px-4 py-3"><p>{invoice.issue_date}</p><p className="text-xs text-neutral-400">Due {invoice.due_date || "—"}</p></td><td className="px-4 py-3">{money(invoice.total, invoice.currency)}</td><td className="px-4 py-3">{money(invoice.amount_paid, invoice.currency)}</td><td className="px-4 py-3 font-semibold">{money(invoice.balance_due, invoice.currency)}</td><td className="px-4 py-3 text-right">{invoice.status === "draft" ? <button disabled={saving} onClick={() => void sendInvoice(invoice)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium"><Send className="size-3.5" />Send</button> : Number(invoice.balance_due) > 0 ? <Link href="/dashboard/accounting/money-in" className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white">Collect</Link> : <span className="text-xs text-neutral-400">Paid</span>}</td></tr>)}</tbody></table>{!loading && !invoices.length ? <div className="py-12 text-center"><FileText className="mx-auto size-8 text-neutral-300" /><p className="mt-3 font-medium">No invoices yet</p></div> : null}</div></section>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
function LabeledInput({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) { return <label className={className}><span className="mb-1 block text-xs font-medium text-neutral-500 lg:hidden">{label}</span>{children}</label>; }
