"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileText, Loader2, Plus, Search, Send, X, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type EmployeeOption = { id: string; employee_code: string; full_name: string };
type ClientOption = { id: string; client_code: string; display_name: string; currency: string | null; contact_name: string | null };
type Meta = { default_currency: string; default_tax_calculation_mode: string; default_tax_rate: string | number; default_validity_days: number; employees: EmployeeOption[] };
type Summary = { total: number; draft: number; sent: number; accepted: number; rejected: number; cancelled: number };
type Row = { id: string; quotation_number: string; client_id: string; client_name: string; status: string; subject: string | null; issue_date: string; valid_until: string | null; currency: string; total: string | number; assigned_employee_id: string | null; assigned_employee_name: string | null; is_expired: boolean; created_at: string; updated_at: string };
type Item = { id: string; product_id: string | null; lead_interest_id: string | null; sort_order: number; item_name_snapshot: string; sku_snapshot: string | null; item_type_snapshot: string; unit_snapshot: string; description: string; quantity: string | number; unit_price: string | number; discount_percent: string | number; tax_rate: string | number; line_subtotal: string | number; discount_amount: string | number; taxable_amount: string | number; tax_amount: string | number; line_total: string | number };
type Detail = Row & { source_lead_id: string | null; tax_calculation_mode: string; seller_name_snapshot: string; seller_email_snapshot: string | null; seller_address_snapshot: string | null; seller_tax_identifier_snapshot: string | null; client_name_snapshot: string; client_contact_snapshot: string | null; client_email_snapshot: string | null; client_address_snapshot: string | null; client_tax_identifier_snapshot: string | null; subtotal: string | number; discount_total: string | number; tax_total: string | number; notes: string | null; terms_conditions: string | null; internal_notes: string | null; sent_at: string | null; accepted_at: string | null; rejected_at: string | null; cancelled_at: string | null; items: Item[] };
type CatalogOption = { id: string; sku: string; name: string; description: string | null; item_type: string; unit: string; currency: string; selling_price: string | number; tax_rate: string | number | null };
type LeadSource = { lead_id: string; lead_code: string; client_id: string; client_name: string; currency: string; subject: string; interests: { id: string; product_id: string | null; item_name: string; description: string | null; item_type: string; unit: string; currency: string; quantity: string | number; estimated_unit_price: string | number | null }[] };
type DraftItem = { product_id: string | null; lead_interest_id: string | null; item_name: string; item_type: "service" | "non_stock_item"; unit: string; description: string; quantity: number; unit_price: number; discount_percent: number; tax_rate: number };

const input = "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";
const textarea = "mt-2 min-h-24 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:border-neutral-500";
function localDate(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(text: string, days: number) { const [y, m, d] = text.split("-").map(Number); const value = new Date(y, m - 1, d); value.setDate(value.getDate() + days); return localDate(value); }
function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function previewLine(item: DraftItem, mode: string) { const subtotal = item.quantity * item.unit_price; const discount = subtotal * item.discount_percent / 100; const taxable = Math.max(0, subtotal - discount); const tax = item.tax_rate > 0 ? (mode === "inclusive" ? taxable - taxable / (1 + item.tax_rate / 100) : taxable * item.tax_rate / 100) : 0; return { subtotal, discount, tax, total: mode === "inclusive" ? taxable : taxable + tax }; }
function customLine(taxRate = 0): DraftItem { return { product_id: null, lead_interest_id: null, item_name: "", item_type: "service", unit: "unit", description: "", quantity: 1, unit_price: 0, discount_percent: 0, tax_rate: taxRate }; }

export function QuotationWorkspace() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [sourceLeadId, setSourceLeadId] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [subject, setSubject] = useState("");
  const [issueDate, setIssueDate] = useState(localDate());
  const [validUntil, setValidUntil] = useState("");
  const [currency, setCurrency] = useState("");
  const [taxMode, setTaxMode] = useState("");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([customLine()]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/sales${path}`, init);
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    if (response.status === 403) throw new Error("Your company role does not have permission for quotations.");
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Quotation request failed.");
    return payload;
  }, [router]);

  const query = useMemo(() => { const p = new URLSearchParams({ limit: "30" }); if (search) p.set("search", search); if (statusFilter) p.set("status", statusFilter); return p.toString(); }, [search, statusFilter]);
  const loadRows = useCallback(async (showLoader = true) => { if (showLoader) setLoading(true); try { const page = await api(`/quotations?${query}`) as { items: Row[]; next_cursor: string | null }; setRows(page.items); setNextCursor(page.next_cursor); } finally { if (showLoader) setLoading(false); } }, [api, query]);
  const loadSummary = useCallback(async () => setSummary(await api("/quotations/summary") as Summary), [api]);

  useEffect(() => { void (async () => { try { const [m, s] = await Promise.all([api("/meta"), api("/quotations/summary")]); const typed = m as Meta; setMeta(typed); setSummary(s as Summary); setCurrency(typed.default_currency); setTaxMode(typed.default_tax_calculation_mode); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load quotation setup."); } })(); }, [api]);
  useEffect(() => { void loadRows().catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load quotations.")); }, [loadRows]);
  useEffect(() => { if (!createOpen) return; void api("/client-options?limit=100").then(value => setClients(value as ClientOption[])).catch(() => undefined); }, [api, createOpen]);
  useEffect(() => { if (!createOpen || !currency) return; void api(`/catalog-options?currency=${encodeURIComponent(currency)}&limit=200`).then(value => setCatalog(value as CatalogOption[])).catch(() => setCatalog([])); }, [api, createOpen, currency]);

  useEffect(() => {
    if (!meta) return;
    const p = new URLSearchParams(window.location.search);
    const quotationId = p.get("quotation_id");
    const leadId = p.get("lead_id");
    const preClient = p.get("client_id");
    if (quotationId) { void openDetail(quotationId); return; }
    if (leadId) {
      void (async () => {
        try {
          const source = await api(`/lead-quotation-source/${encodeURIComponent(leadId)}`) as LeadSource;
          const clientRows = await api(`/client-options?client_id=${encodeURIComponent(source.client_id)}&limit=1`) as ClientOption[];
          const client = clientRows[0];
          if (client) setClients([client]);
          const today = localDate();
          setSourceLeadId(source.lead_id);
          setClientId(source.client_id);
          setSubject(source.subject);
          setIssueDate(today);
          setValidUntil(addDays(today, meta.default_validity_days));
          setCurrency(source.currency);
          setTaxMode(meta.default_tax_calculation_mode);
          setAssignedEmployeeId("");
          setNotes(""); setTerms(""); setInternalNotes("");
          setItems(source.interests.length ? source.interests.map(i => ({
            product_id: i.product_id,
            lead_interest_id: i.id,
            item_name: i.item_name,
            item_type: i.item_type === "non_stock_item" ? "non_stock_item" : "service",
            unit: i.unit || "unit",
            description: i.description || i.item_name,
            quantity: Number(i.quantity || 1),
            unit_price: Number(i.estimated_unit_price || 0),
            discount_percent: 0,
            tax_rate: Number(meta.default_tax_rate),
          })) : [customLine(Number(meta.default_tax_rate))]);
          setCreateOpen(true);
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to prepare quotation from lead."); }
      })();
      return;
    }
    if (!preClient) return;
    void api(`/client-options?client_id=${encodeURIComponent(preClient)}&limit=1`).then(value => { const c = (value as ClientOption[])[0]; if (!c) return; setClients([c]); resetDraft(meta, c); setCreateOpen(true); }).catch(() => undefined);
  }, [api, meta]);

  const preview = useMemo(() => { const lines = items.map(item => previewLine(item, taxMode || "exclusive")); return { subtotal: lines.reduce((a, b) => a + b.subtotal, 0), discount: lines.reduce((a, b) => a + b.discount, 0), tax: lines.reduce((a, b) => a + b.tax, 0), total: lines.reduce((a, b) => a + b.total, 0) }; }, [items, taxMode]);

  function resetDraft(current: Meta, client?: ClientOption) {
    const today = localDate();
    setEditingQuotationId(null);
    setSourceLeadId(null); setClientId(client?.id || ""); setSubject(""); setIssueDate(today); setValidUntil(addDays(today, current.default_validity_days)); setCurrency(client?.currency || current.default_currency); setTaxMode(current.default_tax_calculation_mode); setAssignedEmployeeId(""); setNotes(""); setTerms(""); setInternalNotes(""); setItems([customLine(Number(current.default_tax_rate))]);
  }
  function openCreate() { if (!meta) return; resetDraft(meta); setCreateOpen(true); }
  function openEdit(current: Detail) {
    if (!meta || !["draft", "sent", "rejected"].includes(current.status)) return;
    setEditingQuotationId(current.id);
    setSourceLeadId(current.source_lead_id);
    setClientId(current.client_id);
    setSubject(current.subject ?? "");
    setIssueDate(current.issue_date);
    setValidUntil(current.valid_until ?? "");
    setCurrency(current.currency);
    setTaxMode(current.tax_calculation_mode);
    setAssignedEmployeeId(current.assigned_employee_id ?? "");
    setNotes(current.notes ?? "");
    setTerms(current.terms_conditions ?? "");
    setInternalNotes(current.internal_notes ?? "");
    setItems(current.items.map(item => ({
      product_id: item.product_id,
      lead_interest_id: item.lead_interest_id,
      item_name: item.item_name_snapshot,
      item_type: item.item_type_snapshot === "non_stock_item" ? "non_stock_item" : "service",
      unit: item.unit_snapshot || "unit",
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      discount_percent: Number(item.discount_percent),
      tax_rate: Number(item.tax_rate),
    })));
    setCreateOpen(true);
  }
  async function openDetail(id: string) { setDetailLoading(true); setError(null); try { setDetail(await api(`/quotations/${id}`) as Detail); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to open quotation."); } finally { setDetailLoading(false); } }
  async function refreshAffected() { await Promise.all([loadSummary(), loadRows(false)]); }
  function patchItem(index: number, patch: Partial<DraftItem>) { setItems(current => current.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  function selectLineSource(index: number, value: string) {
    if (value === "custom:service") { patchItem(index, { product_id: null, lead_interest_id: null, item_type: "service", item_name: "", unit: "unit", description: "", unit_price: 0 }); return; }
    if (value === "custom:non_stock_item") { patchItem(index, { product_id: null, lead_interest_id: null, item_type: "non_stock_item", item_name: "", unit: "unit", description: "", unit_price: 0 }); return; }
    const id = value.replace("catalog:", "");
    const product = catalog.find(item => item.id === id);
    if (!product) return;
    patchItem(index, { product_id: product.id, lead_interest_id: null, item_name: product.name, item_type: product.item_type === "non_stock_item" ? "non_stock_item" : "service", unit: product.unit, description: product.description || product.name, unit_price: Number(product.selling_price), tax_rate: product.tax_rate == null ? 0 : Number(product.tax_rate) });
  }

  async function createQuotation() {
    if (!editingQuotationId && !clientId) { setError("Select a client."); return; }
    if (items.some(item => !(item.item_name || item.description).trim() || !item.description.trim() || item.quantity <= 0 || item.unit_price < 0)) { setError("Complete all quotation items."); return; }
    setSaving(true); setError(null);
    try {
      const quotationPayload = { subject: subject.trim() || null, issue_date: issueDate, valid_until: validUntil || null, currency, tax_calculation_mode: taxMode, assigned_employee_id: assignedEmployeeId || null, notes: notes.trim() || null, terms_conditions: terms.trim() || null, internal_notes: internalNotes.trim() || null, items };
      if (editingQuotationId) {
        const wasRevision = detail?.status === "sent" || detail?.status === "rejected";
        const updated = await api(`/quotations/${editingQuotationId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quotationPayload) }) as Detail;
        setCreateOpen(false); setEditingQuotationId(null); setDetail(updated); setMessage(wasRevision ? `Quotation ${updated.quotation_number} revised and returned to Draft. Mark it Sent again after review.` : `Quotation ${updated.quotation_number} updated`); await refreshAffected();
      } else {
        const created = await api("/quotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, source_lead_id: sourceLeadId, ...quotationPayload }) }) as Detail;
        setCreateOpen(false); setDetail(created); setMessage(`Quotation ${created.quotation_number} created`); await refreshAffected();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : editingQuotationId ? "Unable to update quotation." : "Unable to create quotation."); } finally { setSaving(false); }
  }
  async function changeStatus(next: "sent" | "accepted" | "rejected" | "cancelled") { if (!detail) return; setSaving(true); setError(null); try { const updated = await api(`/quotations/${detail.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) }) as Detail; setDetail(updated); setRows(current => current.map(row => row.id === updated.id ? updated : row)); setMessage(`Quotation ${updated.quotation_number} marked ${updated.status}`); await loadSummary(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update quotation status."); } finally { setSaving(false); } }
  async function loadMore() { if (!nextCursor) return; setLoadingMore(true); try { const p = new URLSearchParams(query); p.set("cursor", nextCursor); const page = await api(`/quotations?${p}`) as { items: Row[]; next_cursor: string | null }; setRows(current => [...current, ...page.items]); setNextCursor(page.next_cursor); } finally { setLoadingMore(false); } }

  const clientOptions = [{ value: "", label: "Select client..." }, ...clients.map(c => ({ value: c.id, label: `${c.client_code} · ${c.display_name}`, keywords: `${c.contact_name ?? ""} ${c.currency ?? ""}` }))];
  const employeeOptions = [{ value: "", label: "Unassigned" }, ...(meta?.employees ?? []).map(e => ({ value: e.id, label: `${e.full_name} · ${e.employee_code}` }))];
  const lineSourceOptions = [{ value: "custom:service", label: "+ Custom service" }, { value: "custom:non_stock_item", label: "+ Custom non-stock item" }, ...catalog.map(p => ({ value: `catalog:${p.id}`, label: `${p.sku} · ${p.name}`, keywords: `${p.item_type} ${p.unit} ${p.currency}` }))];

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-neutral-500">Sales documents</p><h1 className="mt-1 text-3xl font-semibold">Quotations</h1><p className="mt-2 text-sm text-neutral-500">Create priced proposals from your catalog or one-time custom work.</p></div><button disabled={!meta} onClick={openCreate} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus className="size-4" />New quotation</button></header>
    <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Stat label="Total" value={summary?.total ?? 0} icon={FileText} /><Stat label="Draft" value={summary?.draft ?? 0} icon={Clock3} /><Stat label="Sent" value={summary?.sent ?? 0} icon={Send} /><Stat label="Accepted" value={summary?.accepted ?? 0} icon={CheckCircle2} /><Stat label="Rejected" value={summary?.rejected ?? 0} icon={XCircle} /></div>
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}{error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="grid gap-3 border-b p-4 sm:grid-cols-[minmax(260px,1fr)_220px_auto] sm:p-5"><form onSubmit={e => { e.preventDefault(); setSearch(searchDraft.trim()); }} className="relative"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={searchDraft} onChange={e => setSearchDraft(e.target.value)} placeholder="Search quotation, client or subject..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm" /></form><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="">All statuses</option>{["draft", "sent", "accepted", "rejected", "cancelled"].map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</select><button onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter(""); }} className="h-11 rounded-xl border px-4 text-sm font-semibold">Reset</button></div>
      {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : rows.length === 0 ? <Empty /> : <><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase text-neutral-400"><tr><th className="px-6 py-3">Quotation</th><th>Client</th><th>Status</th><th>Issued</th><th>Valid until</th><th>Total</th><th className="pr-6 text-right">Action</th></tr></thead><tbody className="divide-y">{rows.map(row => <tr key={row.id}><td className="px-6 py-4"><p className="font-medium">{row.quotation_number}</p><p className="mt-1 text-xs text-neutral-400">{row.subject || "No subject"}</p></td><td>{row.client_name}</td><td><StatusBadge status={row.status} expired={row.is_expired} /></td><td>{row.issue_date}</td><td>{row.valid_until ?? "—"}</td><td className="font-medium">{money(row.total, row.currency)}</td><td className="pr-6 text-right"><button onClick={() => void openDetail(row.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Open</button></td></tr>)}</tbody></table></div>{nextCursor ? <div className="border-t p-4 text-center"><button disabled={loadingMore} onClick={() => void loadMore()} className="rounded-xl border px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{loadingMore ? "Loading…" : "Load more"}</button></div> : null}</>}
    </section>
  </div>

  {createOpen && meta ? <Modal title={editingQuotationId ? "Edit quotation" : sourceLeadId ? "Create quotation from lead" : "Create quotation"} onClose={() => { setCreateOpen(false); setEditingQuotationId(null); }} wide><div className="space-y-6">
    {sourceLeadId && !editingQuotationId ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">Lead requirements are prefilled below. You can adjust descriptions, quantity and final pricing before saving the quotation.</div> : null}
    {editingQuotationId && detail && (detail.status === "sent" || detail.status === "rejected") ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">This quotation was already {detail.status}. Saving a revision will return it to Draft so you can review and send the updated version again.</div> : null}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{editingQuotationId ? <Field label="Client" value={detail?.client_name_snapshot ?? clients.find(item => item.id === clientId)?.display_name ?? ""} onChange={() => undefined} disabled /> : <SearchableSelect label="Client" name="quotation_client" value={clientId} onValueChange={value => { setClientId(value); const c = clients.find(item => item.id === value); if (c?.currency) setCurrency(c.currency); setSourceLeadId(null); }} options={clientOptions} searchPlaceholder="Search client by code or name..." />}<Field label="Subject" value={subject} onChange={setSubject} /><Field label="Issue date" type="date" value={issueDate} onChange={value => { setIssueDate(value); setValidUntil(addDays(value, meta.default_validity_days)); }} /><Field label="Valid until" type="date" value={validUntil} onChange={setValidUntil} /><SearchableSelect label="Currency" name="quotation_currency" value={currency} onValueChange={value => { setCurrency(value); setItems([customLine(Number(meta.default_tax_rate))]); setSourceLeadId(null); }} options={CURRENCY_OPTIONS} searchPlaceholder="Search currency..." /><label className="block text-sm font-medium">Tax calculation<select value={taxMode} onChange={e => setTaxMode(e.target.value)} className={input}><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option></select></label><SearchableSelect label="Assigned employee" name="quotation_employee" value={assignedEmployeeId} onValueChange={setAssignedEmployeeId} options={employeeOptions} searchPlaceholder="Search employee..." /></div>
    <div className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Quotation lines</h3><p className="mt-1 text-xs text-neutral-500">Choose a reusable catalog item or add one-time custom work.</p></div><button onClick={() => setItems(current => [...current, customLine(Number(meta.default_tax_rate))])} className="rounded-xl border px-4 py-2 text-sm font-semibold"><Plus className="mr-2 inline size-4" />Add line</button></div>
      {items.map((item, index) => { const line = previewLine(item, taxMode); const sourceValue = item.product_id ? `catalog:${item.product_id}` : item.item_type === "non_stock_item" ? "custom:non_stock_item" : "custom:service"; return <div key={index} className="rounded-2xl border bg-white p-4"><div className="grid gap-4 lg:grid-cols-[1.4fr_1.4fr_.7fr_.7fr]"><SearchableSelect label="Source" name={`quotation_line_source_${index}`} value={sourceValue} onValueChange={value => selectLineSource(index, value)} options={lineSourceOptions} searchPlaceholder="Search products and services..." /><Field label="Item / service name" value={item.item_name} onChange={value => patchItem(index, { item_name: value })} disabled={Boolean(item.product_id)} /><Field label="Quantity" type="number" value={String(item.quantity)} onChange={value => patchItem(index, { quantity: Number(value) })} /><Field label="Unit" value={item.unit} onChange={value => patchItem(index, { unit: value })} disabled={Boolean(item.product_id)} /></div><div className="mt-4 grid gap-4 lg:grid-cols-[2fr_.8fr_.7fr_.7fr_auto]"><Field label="Description" value={item.description} onChange={value => patchItem(index, { description: value })} /><Field label="Unit price" type="number" value={String(item.unit_price)} onChange={value => patchItem(index, { unit_price: Number(value) })} /><Field label="Discount %" type="number" value={String(item.discount_percent)} onChange={value => patchItem(index, { discount_percent: Number(value) })} /><Field label="Tax %" type="number" value={String(item.tax_rate)} onChange={value => patchItem(index, { tax_rate: Number(value) })} /><div className="flex items-end gap-3"><div className="pb-2 text-right"><p className="text-xs text-neutral-400">Line total</p><p className="mt-1 whitespace-nowrap font-semibold">{money(line.total, currency)}</p></div><button disabled={items.length === 1} onClick={() => setItems(current => current.filter((_, i) => i !== index))} className="mb-1 flex size-10 items-center justify-center rounded-lg border disabled:opacity-30"><X className="size-3" /></button></div></div>{item.lead_interest_id ? <p className="mt-3 text-xs text-blue-600">From lead requirement · final quotation values remain editable.</p> : null}</div>; })}
    </div>
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]"><div className="space-y-4"><TextArea label="Client notes" value={notes} onChange={setNotes} /><TextArea label="Terms & conditions" value={terms} onChange={setTerms} /><TextArea label="Internal notes" value={internalNotes} onChange={setInternalNotes} /></div><div className="h-fit rounded-2xl border bg-neutral-50 p-5"><h3 className="font-semibold">Quotation totals</h3><Total label="Subtotal" value={money(preview.subtotal, currency)} /><Total label="Discount" value={`- ${money(preview.discount, currency)}`} /><Total label="Tax" value={money(preview.tax, currency)} /><div className="mt-4 border-t pt-4"><Total label="Total" value={money(preview.total, currency)} strong /></div></div></div><div className="flex justify-end gap-2 border-t pt-5"><button onClick={() => { setCreateOpen(false); setEditingQuotationId(null); }} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} onClick={() => void createQuotation()} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? (editingQuotationId ? "Saving…" : "Creating…") : (editingQuotationId ? "Save changes" : "Create draft")}</button></div>
  </div></Modal> : null}
  {(detailLoading || detail) ? <Drawer detail={detail} loading={detailLoading} saving={saving} onClose={() => setDetail(null)} onEdit={openEdit} onStatus={changeStatus} onOrder={id => router.push(`/dashboard/orders?quotation_id=${encodeURIComponent(id)}`)} /> : null}
  </main>;
}

function Empty() { return <div className="px-6 py-20 text-center"><FileText className="mx-auto size-8 text-neutral-300" /><h2 className="mt-4 font-semibold">No quotations found</h2><p className="mt-1 text-sm text-neutral-500">Create a quotation to start the sales document flow.</p></div>; }
function StatusBadge({ status, expired }: { status: string; expired?: boolean }) { const styles: Record<string, string> = { draft: "bg-neutral-50 text-neutral-600", sent: "border-blue-200 bg-blue-50 text-blue-700", accepted: "border-emerald-200 bg-emerald-50 text-emerald-700", rejected: "border-red-200 bg-red-50 text-red-700", cancelled: "bg-neutral-100 text-neutral-500" }; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${styles[status] ?? "bg-neutral-50"}`}>{status}{expired ? " · expired" : ""}</span>; }
function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof FileText }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-2xl font-semibold">{value}</p></article>; }
function Field({ label, value, onChange, type = "text", disabled = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) { return <label className="block text-sm font-medium">{label}<input value={value} disabled={disabled} onChange={e => onChange(e.target.value)} type={type} step={type === "number" ? "any" : undefined} className={`${input} disabled:bg-neutral-50 disabled:text-neutral-500`} /></label>; }
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) { return <label className="block text-sm font-medium">{label}<textarea value={value} onChange={e => onChange(e.target.value)} className={textarea} /></label>; }
function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={`mt-2 flex justify-between gap-4 text-sm ${strong ? "text-base font-semibold" : "text-neutral-600"}`}><span>{label}</span><span>{value}</span></div>; }
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`max-h-[94vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl ${wide ? "max-w-6xl" : "max-w-3xl"}`}><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="p-6">{children}</div></div></div>; }
function Drawer({ detail, loading, saving, onClose, onEdit, onStatus, onOrder }: { detail: Detail | null; loading: boolean; saving: boolean; onClose: () => void; onEdit: (detail: Detail) => void; onStatus: (s: "sent" | "accepted" | "rejected" | "cancelled") => Promise<void>; onOrder: (id: string) => void }) { return <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside className="ml-auto h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><h2 className="text-xl font-semibold">{detail?.quotation_number ?? "Quotation"}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{loading || !detail ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : <div className="space-y-6 p-6"><div className="flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between"><div><StatusBadge status={detail.status} expired={detail.is_expired} /><p className="mt-3 text-sm text-neutral-500">{detail.client_name_snapshot} · {money(detail.total, detail.currency)}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => window.open(`/print/quotations/${encodeURIComponent(detail.id)}`, "_blank", "noopener,noreferrer")} className="rounded-xl border px-3 py-2 text-xs font-semibold">Print / PDF</button>{detail.status === "draft" ? <><Action label="Edit" disabled={saving} onClick={() => onEdit(detail)} /><Action label="Mark Sent" primary disabled={saving} onClick={() => void onStatus("sent")} /><Action label="Cancel" disabled={saving} onClick={() => void onStatus("cancelled")} /></> : null}{detail.status === "sent" ? <><Action label="Edit" disabled={saving} onClick={() => onEdit(detail)} /><Action label="Accept" primary disabled={saving} onClick={() => void onStatus("accepted")} /><Action label="Reject" disabled={saving} onClick={() => void onStatus("rejected")} /></> : null}{detail.status === "rejected" ? <Action label="Revise" disabled={saving} onClick={() => onEdit(detail)} /> : null}{detail.status === "accepted" ? <Action label="Create / View Order" primary onClick={() => onOrder(detail.id)} /> : null}</div></div><div className="grid gap-4 sm:grid-cols-2"><Info label="Client" value={detail.client_name_snapshot} /><Info label="Contact" value={detail.client_contact_snapshot ?? "—"} /><Info label="Email" value={detail.client_email_snapshot ?? "—"} /><Info label="Assigned" value={detail.assigned_employee_name ?? "Unassigned"} /><Info label="Issued" value={detail.issue_date} /><Info label="Valid until" value={detail.valid_until ?? "—"} /></div><div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-neutral-50 text-xs uppercase text-neutral-400"><tr><th className="px-4 py-3 text-left">Item / service</th><th>Qty</th><th>Price</th><th>Tax</th><th className="pr-4 text-right">Total</th></tr></thead><tbody className="divide-y">{detail.items.map(item => <tr key={item.id}><td className="px-4 py-3"><p className="font-medium">{item.item_name_snapshot}</p><p className="mt-1 text-xs text-neutral-400">{item.sku_snapshot ? `${item.sku_snapshot} · ` : ""}{item.description}</p></td><td>{Number(item.quantity)} {item.unit_snapshot}</td><td>{money(item.unit_price, detail.currency)}</td><td>{Number(item.tax_rate)}%</td><td className="pr-4 text-right font-medium">{money(item.line_total, detail.currency)}</td></tr>)}</tbody></table></div><div className="ml-auto max-w-sm rounded-2xl border bg-neutral-50 p-5"><Total label="Subtotal" value={money(detail.subtotal, detail.currency)} /><Total label="Discount" value={`- ${money(detail.discount_total, detail.currency)}`} /><Total label="Tax" value={money(detail.tax_total, detail.currency)} /><div className="mt-4 border-t pt-4"><Total label="Total" value={money(detail.total, detail.currency)} strong /></div></div>{detail.notes ? <Block label="Client notes" value={detail.notes} /> : null}{detail.terms_conditions ? <Block label="Terms & conditions" value={detail.terms_conditions} /> : null}{detail.internal_notes ? <Block label="Internal notes" value={detail.internal_notes} /> : null}</div>}</aside></div>; }
function Action({ label, onClick, disabled, primary = false }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) { return <button disabled={disabled} onClick={onClick} className={`rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50 ${primary ? "bg-neutral-950 text-white" : "border"}`}>{label}</button>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-neutral-50 p-3"><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>; }
function Block({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border p-4"><p className="text-xs uppercase text-neutral-400">{label}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{value}</p></div>; }
