"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Plus, Search, Send, Share2, Trash2, X } from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { SearchableSelect } from "@/components/searchable-select";
import { getApiErrorMessage } from "@/lib/api-error";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type Source = "client" | "order" | "project";
type Client = { id: string; code: string; name: string; currency: string | null };
type Order = { id: string; number: string; client_id: string; client_name: string; currency: string; total: string | number; status: string };
type Project = { id: string; number: string; order_id: string | null; client_id: string; name: string; currency: string; contract_value: string | number; status: string };
type Meta = { clients: Client[]; orders: Order[]; projects: Project[] };
type Invoice = { id: string; invoice_number: string; client_name: string; order_id: string | null; project_id: string | null; status: string; display_status: string; subject: string | null; issue_date: string; due_date: string | null; currency: string; total: string | number; amount_paid: string | number; balance_due: string | number };
type CatalogItem = { id: string; sku: string; name: string; description: string | null; item_type: string; unit: string; currency: string; selling_price: string | number; tax_code_id: string | null; is_active: boolean };
type TaxCode = { id: string; tax_kind: string; rate: string | number; is_active?: boolean };
type Line = { product_id: string | null; item_name: string; item_type: "service" | "non_stock_item"; unit: string; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string };

const blank = (): Line => ({ product_id: null, item_name: "", item_type: "service", unit: "unit", description: "", quantity: "1", unit_price: "0", discount_percent: "0", tax_rate: "0" });
const today = () => new Date().toISOString().slice(0, 10);
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function lineTotal(line: Line, taxMode: string) { const subtotal = Number(line.quantity || 0) * Number(line.unit_price || 0); const discounted = subtotal * (1 - Number(line.discount_percent || 0) / 100); if (taxMode === "inclusive") return discounted; return discounted * (1 + Number(line.tax_rate || 0) / 100); }

export function InvoicesWorkspaceV2() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [meta, setMeta] = useState<Meta>({ clients: [], orders: [], projects: [] });
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [source, setSource] = useState<Source>("project");
  const [form, setForm] = useState({ source_id: "", client_id: "", subject: "", issue_date: today(), due_date: "", currency: "", tax_calculation_mode: "exclusive", notes: "", lines: [blank()] });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "outstanding" | "paid">("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [metaResponse, invoiceResponse, catalogResponse, taxResponse] = await Promise.all([
        fetch("/api/finance/meta", { cache: "no-store" }),
        fetch("/api/finance/invoice-page?limit=100", { cache: "no-store" }),
        fetch("/api/inventory/products", { cache: "no-store" }),
        fetch("/api/accounting/tax/codes", { cache: "no-store" }),
      ]);
      const metaPayload = await metaResponse.json();
      const invoicePayload = await invoiceResponse.json();
      const catalogPayload = await catalogResponse.json();
      const taxPayload = await taxResponse.json();
      if (!metaResponse.ok) throw new Error(getApiErrorMessage(metaPayload, "Could not load invoice setup"));
      if (!invoiceResponse.ok) throw new Error(getApiErrorMessage(invoicePayload, "Could not load invoices"));
      if (!catalogResponse.ok) throw new Error(getApiErrorMessage(catalogPayload, "Could not load products and services"));
      if (!taxResponse.ok) throw new Error(getApiErrorMessage(taxPayload, "Could not load sales tax setup"));
      setMeta(metaPayload); setInvoices(invoicePayload.items ?? []); setCatalog(catalogPayload ?? []); setTaxCodes(taxPayload ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load invoices"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const projectOptions = useMemo(() => meta.projects.filter((p) => p.status !== "cancelled").map((p) => ({ value: p.id, label: `${p.number} · ${p.name} · ${money(p.contract_value, p.currency)}`, keywords: `${p.number} ${p.name} ${p.currency} ${p.contract_value}` })), [meta.projects]);
  const orderOptions = useMemo(() => meta.orders.filter((o) => o.status !== "cancelled").map((o) => ({ value: o.id, label: `${o.number} · ${o.client_name} · ${money(o.total, o.currency)}`, keywords: `${o.number} ${o.client_name} ${o.currency} ${o.total}` })), [meta.orders]);
  const clientOptions = useMemo(() => meta.clients.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}`, keywords: `${c.code} ${c.name}` })), [meta.clients]);
  const availableCatalog = useMemo(() => catalog.filter((item) => item.is_active && (!form.currency || item.currency === form.currency)), [catalog, form.currency]);
  const lineSourceOptions = useMemo(() => [{ value: "custom:service", label: "+ Custom service" }, { value: "custom:non_stock_item", label: "+ Custom non-stock item" }, ...availableCatalog.map((item) => ({ value: `catalog:${item.id}`, label: `${item.sku} · ${item.name}`, keywords: `${item.item_type} ${item.unit}` }))], [availableCatalog]);
  const statusOptions = useMemo(() => ["all", ...Array.from(new Set(invoices.map((invoice) => invoice.status)))], [invoices]);
  const currencyOptions = useMemo(() => ["all", ...Array.from(new Set(invoices.map((invoice) => invoice.currency)))], [invoices]);
  const filteredInvoices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const currentDate = today();
    return invoices.filter((invoice) => {
      if (needle && !`${invoice.invoice_number} ${invoice.client_name} ${invoice.subject ?? ""} ${invoice.currency}`.toLowerCase().includes(needle)) return false;
      if (statusFilter !== "all" && invoice.status !== statusFilter) return false;
      if (currencyFilter !== "all" && invoice.currency !== currencyFilter) return false;
      const balanceDue = Number(invoice.balance_due || 0);
      const overdue = Boolean(invoice.due_date && invoice.due_date < currentDate && balanceDue > 0 && !["draft", "cancelled"].includes(invoice.status));
      if (dueFilter === "overdue" && !overdue) return false;
      if (dueFilter === "outstanding" && balanceDue <= 0) return false;
      if (dueFilter === "paid" && balanceDue > 0) return false;
      return true;
    });
  }, [currencyFilter, dueFilter, invoices, query, statusFilter]);
  const overdueCount = useMemo(() => invoices.filter((invoice) => invoice.due_date && invoice.due_date < today() && Number(invoice.balance_due) > 0 && !["draft", "cancelled"].includes(invoice.status)).length, [invoices]);
  const outstandingCount = useMemo(() => invoices.filter((invoice) => Number(invoice.balance_due) > 0 && !["draft", "cancelled"].includes(invoice.status)).length, [invoices]);
  const draftTotal = useMemo(() => form.lines.reduce((sum, line) => sum + lineTotal(line, form.tax_calculation_mode), 0), [form.lines, form.tax_calculation_mode]);

  function resetSource(next: Source) { setSource(next); setForm({ source_id: "", client_id: "", subject: "", issue_date: today(), due_date: "", currency: "", tax_calculation_mode: "exclusive", notes: "", lines: [blank()] }); setError(null); }
  function clearFilters() { setQuery(""); setStatusFilter("all"); setCurrencyFilter("all"); setDueFilter("all"); }
  function updateLine(index: number, patch: Partial<Line>) { setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) })); }
  function changeManualCurrency(value: string) { setForm((current) => ({ ...current, currency: value, lines: current.lines.some((line) => line.product_id) ? [blank()] : current.lines })); if (form.lines.some((line) => line.product_id)) setError("Currency changed. Catalog lines were cleared so different currencies cannot be mixed."); }
  function selectLineSource(index: number, value: string) {
    if (value === "custom:service" || value === "custom:non_stock_item") { updateLine(index, { product_id: null, item_name: "", item_type: value.endsWith("non_stock_item") ? "non_stock_item" : "service", unit: "unit", description: "", unit_price: "0", tax_rate: "0" }); return; }
    const product = availableCatalog.find((item) => item.id === value.replace("catalog:", ""));
    if (!product) return;
    const tax = taxCodes.find((item) => item.id === product.tax_code_id && item.tax_kind === "sales" && item.is_active !== false);
    updateLine(index, { product_id: product.id, item_name: product.name, item_type: product.item_type === "non_stock_item" ? "non_stock_item" : "service", unit: product.unit, description: product.description || product.name, unit_price: String(product.selling_price), tax_rate: String(tax?.rate ?? 0) });
  }

  async function shareInvoice(invoice: Invoice) {
    setError(null); setMessage(null);
    const relativeUrl = `/dashboard/finance/invoices/${invoice.id}/print`;
    const shareUrl = `${window.location.origin}${relativeUrl}`;
    try {
      if (navigator.share) { await navigator.share({ title: `Invoice ${invoice.invoice_number}`, text: `${invoice.invoice_number} · ${invoice.client_name}`, url: shareUrl }); return; }
      await navigator.clipboard.writeText(shareUrl); setMessage(`Invoice ${invoice.invoice_number} link copied to clipboard.`);
    } catch (reason) { if (reason instanceof DOMException && reason.name === "AbortError") return; setError("Could not share this invoice. Open PDF View and use your browser share or copy the URL."); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      let response: Response;
      if (source === "project") response = await fetch(`/api/finance/invoices/from-project/${form.source_id}`, { method: "POST" });
      else if (source === "order") response = await fetch(`/api/finance/invoices/from-order/${form.source_id}`, { method: "POST" });
      else {
        if (form.lines.some((line) => !(line.item_name || line.description).trim() || !line.description.trim() || Number(line.quantity) <= 0 || Number(line.unit_price) < 0)) throw new Error("Complete all invoice lines.");
        response = await fetch("/api/finance/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: form.client_id, subject: form.subject || null, issue_date: form.issue_date, due_date: form.due_date || null, currency: form.currency || null, tax_calculation_mode: form.tax_calculation_mode, notes: form.notes || null, items: form.lines.map((line) => ({ product_id: line.product_id, item_name: line.item_name || line.description, item_type: line.item_type, unit: line.unit || "unit", description: line.description, quantity: Number(line.quantity), unit_price: Number(line.unit_price), discount_percent: Number(line.discount_percent || 0), tax_rate: Number(line.tax_rate || 0) })) }) });
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not create invoice"));
      setMessage(`Invoice ${payload.invoice_number} created as draft. Open it to review or edit before sending.`); setShowForm(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create invoice"); }
    finally { setSaving(false); }
  }

  async function sendInvoice(invoice: Invoice) {
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/finance/invoices/${invoice.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not send invoice"));
      setMessage(`Invoice ${invoice.invoice_number} sent. It is now locked for editing.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send invoice"); }
    finally { setSaving(false); }
  }

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Finance & Accounts</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Invoices</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Create from a project/order or bill reusable catalog items and one-time custom work directly.</p></div><button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white"><Plus className="size-4" />New invoice</button></div>
    <AccountingNav />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    {showForm ? <section className="rounded-2xl border bg-white p-5">
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Create invoice</h2><p className="mt-1 text-sm text-neutral-500">Project and order invoices copy their locked sales snapshot. Manual client invoices can use catalog or custom lines.</p></div><button onClick={() => setShowForm(false)} className="rounded-lg p-2 hover:bg-neutral-100"><X className="size-5" /></button></div>
      <div className="mt-4 flex flex-wrap gap-2">{(["project", "order", "client"] as Source[]).map((item) => <button type="button" key={item} onClick={() => resetSource(item)} className={`rounded-xl px-4 py-2 text-sm font-medium ${source === item ? "bg-neutral-950 text-white" : "border"}`}>{item === "client" ? "Direct client invoice" : item === "project" ? "From project" : "From order"}</button>)}</div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        {source === "project" ? <><SearchableSelect label="Project" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((v) => ({ ...v, source_id: value }))} options={projectOptions} placeholder="Select project" searchPlaceholder="Search project..." />{!projectOptions.length ? <p className="text-xs text-neutral-500">No uninvoiced projects are available. A full active invoice can only be created once per project/order.</p> : null}</> : null}
        {source === "order" ? <><SearchableSelect label="Order" required clearable={false} value={form.source_id} onValueChange={(value) => setForm((v) => ({ ...v, source_id: value }))} options={orderOptions} placeholder="Select order" searchPlaceholder="Search order..." />{!orderOptions.length ? <p className="text-xs text-neutral-500">No uninvoiced orders are available.</p> : null}</> : null}
        {source === "client" ? <><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <SearchableSelect label="Client" required clearable={false} value={form.client_id} onValueChange={(value) => { const client = meta.clients.find((item) => item.id === value); setForm((v) => ({ ...v, client_id: value })); if (client?.currency) changeManualCurrency(client.currency); }} options={clientOptions} placeholder="Select client" searchPlaceholder="Search client..." />
          <Field label="Subject"><input value={form.subject} onChange={(e) => setForm((v) => ({ ...v, subject: e.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm" placeholder="Website development" /></Field>
          <SearchableSelect label="Currency" required clearable={false} value={form.currency} onValueChange={changeManualCurrency} options={CURRENCY_OPTIONS} placeholder="Select currency" searchPlaceholder="Search currency..." />
          <Field label="Issue date"><input required type="date" value={form.issue_date} onChange={(e) => setForm((v) => ({ ...v, issue_date: e.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field>
          <Field label="Due date"><input type="date" value={form.due_date} onChange={(e) => setForm((v) => ({ ...v, due_date: e.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field>
          <Field label="Tax calculation"><select value={form.tax_calculation_mode} onChange={(e) => setForm((v) => ({ ...v, tax_calculation_mode: e.target.value }))} className="h-11 w-full rounded-xl border bg-white px-3 text-sm"><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option></select></Field>
        </div>
        <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium">Invoice lines</h3><p className="mt-1 text-xs text-neutral-400">Catalog is optional. One-time project/service billing does not create inventory items.</p></div><button type="button" onClick={() => setForm((v) => ({ ...v, lines: [...v.lines, blank()] }))} className="rounded-lg border px-3 py-2 text-sm font-medium">+ Add line</button></div>
          <div className="space-y-3">{form.lines.map((line, index) => { const sourceValue = line.product_id ? `catalog:${line.product_id}` : line.item_type === "non_stock_item" ? "custom:non_stock_item" : "custom:service"; return <div key={index} className="rounded-2xl border p-4"><div className="grid gap-3 lg:grid-cols-[1.4fr_1.4fr_.7fr_.7fr]"><SearchableSelect label="Source" value={sourceValue} onValueChange={(value) => selectLineSource(index, value)} options={lineSourceOptions} searchPlaceholder="Search products and services..." /><Field label="Item / service name"><input required disabled={Boolean(line.product_id)} value={line.item_name} onChange={(e) => updateLine(index, { item_name: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field><Field label="Quantity"><input type="number" min="0.0001" step="any" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Unit"><input disabled={Boolean(line.product_id)} value={line.unit} onChange={(e) => updateLine(index, { unit: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm disabled:bg-neutral-50 disabled:text-neutral-500" /></Field></div><div className="mt-3 grid gap-3 lg:grid-cols-[2fr_.8fr_.7fr_.7fr_auto]"><Field label="Description"><input required value={line.description} onChange={(e) => updateLine(index, { description: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Unit price"><input type="number" min="0" step="any" value={line.unit_price} onChange={(e) => updateLine(index, { unit_price: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Discount %"><input type="number" min="0" max="100" step="0.01" value={line.discount_percent} onChange={(e) => updateLine(index, { discount_percent: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><Field label="Tax %"><input type="number" min="0" max="100" step="0.01" value={line.tax_rate} onChange={(e) => updateLine(index, { tax_rate: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-sm" /></Field><div className="flex items-end gap-3"><div className="pb-2 text-right"><p className="text-xs text-neutral-400">Line total</p><p className="mt-1 whitespace-nowrap font-semibold">{money(lineTotal(line, form.tax_calculation_mode), form.currency || "")}</p></div><button type="button" disabled={form.lines.length === 1} onClick={() => setForm((v) => ({ ...v, lines: v.lines.filter((_, i) => i !== index) }))} className="flex size-10 items-center justify-center rounded-lg border disabled:opacity-30"><Trash2 className="size-4" /></button></div></div></div>; })}</div>
          <div className="mt-4 flex justify-end rounded-xl bg-neutral-50 p-4"><div className="text-right"><p className="text-xs uppercase tracking-wide text-neutral-400">Estimated total</p><p className="mt-1 text-lg font-semibold">{money(draftTotal, form.currency || "")}</p></div></div>
        </div><Field label="Client notes"><textarea value={form.notes} onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))} className="min-h-24 w-full rounded-xl border p-3 text-sm" /></Field></> : null}
        <div className="flex justify-end"><button disabled={saving || ((source === "project" || source === "order") && !form.source_id)} className="rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Creating…" : "Create draft invoice"}</button></div>
      </form>
    </section> : null}

    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="border-b p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="font-semibold">Invoice list</h2><p className="mt-1 text-sm text-neutral-500">Search, filter and open any invoice. Drafts remain editable until Send.</p></div><div className="flex flex-wrap gap-2 text-xs text-neutral-500"><span className="rounded-full bg-neutral-100 px-3 py-1.5">{invoices.length} total</span><span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">{outstandingCount} outstanding</span><span className="rounded-full bg-red-50 px-3 py-1.5 text-red-700">{overdueCount} overdue</span></div></div></div>
      <div className="border-b bg-neutral-50/60 p-4"><div className="grid gap-3 lg:grid-cols-[minmax(260px,1.6fr)_repeat(3,minmax(150px,0.7fr))_auto]">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, client, subject..." className="h-11 w-full rounded-xl border bg-white pl-10 pr-3 text-sm outline-none focus:border-neutral-500"/></label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All statuses</option>{statusOptions.filter((status) => status !== "all").map((status) => <option key={status} value={status}>{pretty(status)}</option>)}</select>
        <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All currencies</option>{currencyOptions.filter((currency) => currency !== "all").map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>
        <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value as typeof dueFilter)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All balances</option><option value="outstanding">Outstanding</option><option value="overdue">Overdue</option><option value="paid">Paid</option></select>
        <button type="button" onClick={clearFilters} disabled={!query && statusFilter === "all" && currencyFilter === "all" && dueFilter === "all"} className="h-11 rounded-xl border bg-white px-4 text-sm font-medium disabled:opacity-40">Clear</button>
      </div><p className="mt-3 text-xs text-neutral-400">Showing {filteredInvoices.length} of {invoices.length} invoices</p></div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Issue / Due</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Due</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{filteredInvoices.map((invoice) => <tr key={invoice.id} className="border-b last:border-0 hover:bg-neutral-50/60"><td className="px-4 py-3"><Link href={`/dashboard/accounting/invoices/${invoice.id}`} className="font-semibold hover:underline">{invoice.invoice_number}</Link><p className="text-xs text-neutral-400">{invoice.subject || "No subject"}</p></td><td className="px-4 py-3">{invoice.client_name}</td><td className="px-4 py-3 capitalize">{invoice.display_status.replaceAll("_", " ")}</td><td className="px-4 py-3"><p>{invoice.issue_date}</p><p className={`text-xs ${invoice.due_date && invoice.due_date < today() && Number(invoice.balance_due) > 0 ? "font-medium text-red-600" : "text-neutral-400"}`}>Due {invoice.due_date || "—"}</p></td><td className="px-4 py-3">{money(invoice.total, invoice.currency)}</td><td className="px-4 py-3">{money(invoice.amount_paid, invoice.currency)}</td><td className="px-4 py-3 font-semibold">{money(invoice.balance_due, invoice.currency)}</td><td className="px-4 py-3"><div className="flex min-w-max justify-end gap-2"><Link href={`/dashboard/accounting/invoices/${invoice.id}`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium"><ExternalLink className="size-3.5" />{invoice.status === "draft" ? "Open / Edit" : "Open"}</Link><Link href={`/dashboard/finance/invoices/${invoice.id}/print`} target="_blank" className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium"><FileText className="size-3.5" />PDF View</Link><button type="button" onClick={() => void shareInvoice(invoice)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium"><Share2 className="size-3.5" />Share</button>{invoice.status === "draft" ? <button disabled={saving} onClick={() => void sendInvoice(invoice)} className="inline-flex items-center gap-1 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white"><Send className="size-3.5" />Send</button> : Number(invoice.balance_due) > 0 ? <Link href={`/dashboard/accounting/money-in?invoice_id=${invoice.id}`} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white">Collect</Link> : <span className="px-3 py-2 text-xs text-neutral-400">Paid</span>}</div></td></tr>)}</tbody></table>{!loading && !filteredInvoices.length ? <div className="py-12 text-center"><FileText className="mx-auto size-8 text-neutral-300" /><p className="mt-3 font-medium">No matching invoices</p><p className="mt-1 text-sm text-neutral-400">Try clearing or changing the current filters.</p></div> : null}</div>
    </section>
  </div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-600">{label}</span>{children}</label>; }
