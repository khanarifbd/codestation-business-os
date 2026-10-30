"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Building2, CalendarClock, CheckCircle2, Filter, Loader2, LockKeyhole, MessageSquarePlus, Plus, Search, Settings2, Target, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { useDashboardSession } from "@/components/dashboard-session-context";
import { LeadRequirementsCard } from "@/components/lead-requirements-card";
import { SearchableSelect } from "@/components/searchable-select";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { getApiErrorMessage } from "@/lib/api-error";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from "@/lib/company-options";
import { CrmDialog } from "@/components/relationships/crm-dialog";
import { RelationshipPage, RelationshipHeader, RelationshipNotice } from "@/components/relationships/relationship-ui";
import "@/components/relationships/crm-workspace.css";

type LeadStatus = { id: string; name: string; slug: string; color: string | null; category: string; sort_order: number; is_default: boolean; is_active: boolean };
type LeadSource = { id: string; name: string; slug: string; sort_order: number; is_active: boolean };
type EmployeeOption = { id: string; employee_code: string; full_name: string };
type Meta = { statuses: LeadStatus[]; sources: LeadSource[]; employees: EmployeeOption[]; default_country_code: string | null; default_currency: string | null };
type Summary = { total_leads: number; open_leads: number; won_leads: number; lost_leads: number; due_followups: number; converted_leads: number };
type Lead = { id: string; lead_code: string; lead_type: string; company_name: string | null; contact_name: string; email: string | null; phone: string | null; status_id: string; status_name: string; status_color: string | null; status_category: string; source_id: string | null; source_name: string | null; assigned_employee_id: string | null; assigned_employee_name: string | null; estimated_value: string | number | null; currency: string | null; probability_percent: number; next_follow_up_at: string | null; converted_client_id: string | null; created_at: string; updated_at: string };
type Interaction = { id: string; interaction_type: string; subject: string | null; body: string | null; scheduled_at: string | null; completed_at: string | null; created_by_user_id: string; created_at: string };
type LeadDetail = { lead: Lead; website: string | null; whatsapp: string | null; country_code: string | null; state_region: string | null; city: string | null; address_line1: string | null; notes: string | null; interactions: Interaction[] };
type Tab = "leads" | "settings";
type RefreshPolicy = "none" | "meta" | "summary-list" | "detail" | "detail-summary-list";

const inputClass = "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500";
const textareaClass = "mt-2 min-h-24 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-neutral-500";

function text(form: FormData, key: string) { const value = String(form.get(key) ?? "").trim(); return value || null; }
function money(value: string | number | null, currency: string | null) { if (value === null || value === undefined || value === "") return "—"; return formatMoneyExact(value, currency ?? "").trim(); }
function when(value: string | null) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) + ` (${Intl.DateTimeFormat().resolvedOptions().timeZone})`; }

export default function CrmRoute() {
  const { tenant } = useDashboardSession();
  return tenant ? <CrmPage key={`${tenant.organization.id}:${tenant.membership_id}`} /> : null;
}

function CrmPage() {
  const { tenant } = useDashboardSession();
  const canManage = Boolean(tenant?.is_owner || tenant?.permissions.includes("*") || tenant?.permissions.includes("crm.manage"));
  const canPrepareQuotation = Boolean(tenant?.is_owner || tenant?.permissions.includes("*") || tenant?.permissions.includes("quotations.manage"));
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("leads");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailSelection = useRef(0);
  const selectedLead = useRef<string | null>(null);
  const alive = useRef(true);
  const mutationPending = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  useEffect(() => { alive.current = true; return () => { alive.current = false; listRequest.current += 1; detailRequest.current += 1; detailSelection.current += 1; selectedLead.current = null; }; }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const detailVersion = detailRequest.current;
    const selection = detailSelection.current;
    const listVersion = listRequest.current;
    const detailId = /^\/leads\/([^/?]+)/.exec(path)?.[1];
    const isRead = !init?.method || init.method === "GET";
    const ownsResponse = () => alive.current
      && (!detailId || (selectedLead.current === detailId && detailSelection.current === selection && (!isRead || detailRequest.current === detailVersion)))
      && (!path.startsWith("/leads?") || listRequest.current === listVersion);
    const response = await fetch(`/api/crm${path}`, init);
    // Authentication navigation is a UI outcome too: dismissed/older work cannot redirect the active workspace.
    if (!ownsResponse()) throw new Error("This CRM request is no longer current.");
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    if (response.status === 403) throw new Error("Your company role does not have permission for this CRM action.");
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getApiErrorMessage(payload, "CRM request failed."));
    return payload;
  }, [router]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: "30" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status_id", statusFilter);
    if (sourceFilter) params.set("source_id", sourceFilter);
    if (assigneeFilter) params.set("assigned_employee_id", assigneeFilter);
    return params.toString();
  }, [search, statusFilter, sourceFilter, assigneeFilter]);

  const loadMeta = useCallback(async () => { const payload = await api("/meta") as Meta; if (alive.current) setMeta(payload); }, [api]);
  const loadSummary = useCallback(async () => { try { const payload = await api("/summary") as Summary; if (alive.current) setSummary(payload); } catch (reason) { if (alive.current) setSummary(null); throw reason; } }, [api]);
  const loadLeads = useCallback(async (reportFailure = false) => {
    const request = ++listRequest.current;
    setLoading(true); setError(null);
    try { const payload = await api(`/leads?${queryString}`) as { items: Lead[]; next_cursor: string | null }; if (request !== listRequest.current) return; setLeads(payload.items); setNextCursor(payload.next_cursor); }
    catch (reason) { if (request === listRequest.current) { if (reportFailure) throw reason; setError(reason instanceof Error ? reason.message : "Unable to load leads."); } }
    finally { if (request === listRequest.current) setLoading(false); }
  }, [api, queryString]);

  const reloadDetail = useCallback(async (leadId?: string) => {
    const id = leadId ?? selectedLead.current;
    if (!id || selectedLead.current !== id) return;
    const request = ++detailRequest.current;
    try {
      const payload = await api(`/leads/${id}`) as LeadDetail;
      if (alive.current && request === detailRequest.current && selectedLead.current === id) setDetail(payload);
    } catch (reason) {
      if (alive.current && request === detailRequest.current && selectedLead.current === id) throw reason;
    }
  }, [api]);

  useEffect(() => { void Promise.all([loadMeta(), loadSummary()]).catch((reason) => { if (alive.current) setError(reason instanceof Error ? reason.message : "Unable to load CRM."); }); }, [loadMeta, loadSummary]);
  useEffect(() => { void loadLeads(); }, [loadLeads]);

  async function applyRefresh(policy: RefreshPolicy, leadId?: string) {
    if (policy === "none") return;
    if (policy === "meta") { await loadMeta(); return; }
    if (policy === "summary-list") { await Promise.all([loadSummary(), loadLeads(true)]); return; }
    if (policy === "detail") { await reloadDetail(leadId); return; }
    await Promise.all([reloadDetail(leadId), loadSummary(), loadLeads(true)]);
  }

  async function run(work: () => Promise<void>, success: string, policy: RefreshPolicy = "summary-list", leadId?: string) {
    if (!canManage || mutationPending.current) return;
    mutationPending.current = true;
    const owner = detailSelection.current;
    const current = () => alive.current && (!leadId || (selectedLead.current === leadId && detailSelection.current === owner));
    setSaving(true); setError(null); setMessage(null);
    let committed = false;
    try {
      await work(); committed = true;
      if (!current()) return;
      setMessage(success);
      // Refreshes may advance their own request version; the selected identity still owns this outcome.
      try { await applyRefresh(policy, leadId); }
      catch (reason) { if (current()) setError(`Changes were saved, but the view could not be refreshed. Refresh the view without submitting again. ${reason instanceof Error ? reason.message : "Read failed."}`); }
    } catch (reason) {
      if (current()) setError(committed ? "Changes were saved; refresh the view without submitting again." : reason instanceof Error ? reason.message : "Unable to save changes.");
    } finally {
      mutationPending.current = false;
      if (alive.current) setSaving(false);
    }
  }

  async function loadMore() {
    const request = listRequest.current;
    if (!nextCursor) return;
    setLoadingMore(true);
    try { const params = new URLSearchParams(queryString); params.set("cursor", nextCursor); const payload = await api(`/leads?${params}`) as { items: Lead[]; next_cursor: string | null }; if (request !== listRequest.current) return; setLeads((current) => [...current, ...payload.items]); setNextCursor(payload.next_cursor); }
    catch (reason) { if (request === listRequest.current) setError(reason instanceof Error ? reason.message : "Unable to load more leads."); }
    finally { setLoadingMore(false); }
  }

  function closeLead() {
    selectedLead.current = null; detailRequest.current += 1; detailSelection.current += 1;
    setDetail(null); setDetailLoading(false);
  }

  async function openLead(leadId: string) {
    detailSelection.current += 1;
    const request = ++detailRequest.current;
    selectedLead.current = leadId;
    setDetail(null); setDetailLoading(true); setError(null);
    try {
      const payload = await api(`/leads/${leadId}`) as LeadDetail;
      if (alive.current && request === detailRequest.current && selectedLead.current === leadId) setDetail(payload);
    } catch (reason) {
      if (alive.current && request === detailRequest.current && selectedLead.current === leadId) setError(reason instanceof Error ? reason.message : "Unable to load lead details.");
    } finally {
      if (alive.current && request === detailRequest.current && selectedLead.current === leadId) setDetailLoading(false);
    }
  }

  const activeStatuses = meta?.statuses.filter((item) => item.is_active) ?? [];
  const activeSources = meta?.sources.filter((item) => item.is_active) ?? [];
  const employeeOptions = meta?.employees.map((item) => ({ value: item.id, label: `${item.full_name} · ${item.employee_code}` })) ?? [];

  return <RelationshipPage className="relationships-page crm-page"><div className="crm-page-content">
    <RelationshipHeader eyebrow="RELATIONSHIPS / PIPELINE" title="CRM & Leads" description="Capture the opportunity. Keep the conversation moving." actions={canManage ? <button type="button" disabled={saving} onClick={() => { if (!mutationPending.current) setNewLeadOpen(true); }} className="relationship-primary"><Plus className="size-4" aria-hidden="true" />New lead</button> : undefined} />

    <section className="crm-summary-composition" aria-label="Pipeline overview">
      <div className="crm-summary-rail"><SummaryCard label="Total leads" value={summary?.total_leads ?? null} icon={Target} /><SummaryCard label="Open pipeline" value={summary?.open_leads ?? null} icon={Filter} /><SummaryCard label="Won" value={summary?.won_leads ?? null} icon={CheckCircle2} /><SummaryCard label="Converted" value={summary?.converted_leads ?? null} icon={ArrowRight} /></div>
      <FollowUpPriority value={summary?.due_followups ?? null} />
    </section>

    <nav className="crm-view-switcher" aria-label="CRM views"><button onClick={() => setTab("leads")} aria-current={tab === "leads" ? "page" : undefined} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${tab === "leads" ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>Leads</button>{canManage ? <button onClick={() => setTab("settings")} aria-current={tab === "settings" ? "page" : undefined} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${tab === "settings" ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>Pipeline Settings</button> : null}</nav>
    {message ? <RelationshipNotice tone="success">{message}</RelationshipNotice> : null}{error ? <RelationshipNotice tone="error">{error} <button type="button" className="underline" onClick={() => { setError(null); void Promise.all([loadMeta(), loadSummary(), loadLeads(), reloadDetail()]).catch((reason) => { if (alive.current) setError(reason instanceof Error ? reason.message : "Unable to refresh CRM."); }); }}>Refresh view</button></RelationshipNotice> : null}

    {tab === "leads" ? <section className="crm-register"><header className="crm-register-heading"><div><h2>Lead register</h2><p>From first contact to a lasting client relationship.</p></div><span>Current pipeline</span></header><div className="crm-filter-bar"><div className="crm-filter-grid">
      <form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }} className="relative"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input aria-label="Search leads" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search code, name, email, phone..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-neutral-500" /></form>
      <select aria-label="Filter by lead status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="">All statuses</option>{activeStatuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="Filter by lead source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="">All sources</option>{activeSources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <SearchableSelect value={assigneeFilter} onChange={setAssigneeFilter} options={employeeOptions} placeholder="All assignees" searchPlaceholder="Search employee..." clearable />
      <button type="button" onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter(""); setSourceFilter(""); setAssigneeFilter(""); }} className="h-11 rounded-xl border px-4 text-sm font-medium hover:bg-neutral-50">Reset</button>
    </div></div>
    {loading ? <div className="crm-loading" role="status"><Loader2 className="size-5 animate-spin" aria-hidden="true" /><span>Loading leads…</span></div> : leads.length === 0 ? <div className="crm-empty"><Target className="mx-auto size-8 text-neutral-300" /><h2 className="mt-4 font-semibold">No leads found</h2><p className="mt-1 text-sm text-neutral-500">Create your first lead or adjust the current filters.</p></div> : <><div className="crm-register-scroll" tabIndex={0} role="region" aria-label="Lead register; scroll horizontally for all columns"><table className="crm-register-table"><caption className="sr-only">Lead pipeline including status, source, value, assigned owner, next follow-up and actions</caption><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th scope="col" className="px-6 py-3 font-medium">Lead</th><th scope="col" className="px-4 py-3 font-medium">Status</th><th scope="col" className="px-4 py-3 font-medium">Source</th><th scope="col" className="px-4 py-3 font-medium">Value</th><th scope="col" className="px-4 py-3 font-medium">Assigned</th><th scope="col" className="px-4 py-3 font-medium">Follow-up</th><th scope="col" className="px-6 py-3 text-right font-medium">Action</th></tr></thead><tbody className="divide-y">{leads.map((lead) => <tr key={lead.id} className="crm-lead-row"><td data-label="Lead" className="px-6 py-4"><p className="flex items-center gap-2 font-medium"><span>{lead.company_name || lead.contact_name}</span>{lead.converted_client_id ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Client</span> : null}</p><p className="mt-1 text-xs text-neutral-400">{lead.lead_code} · {lead.contact_name}{lead.email ? ` · ${lead.email}` : ""}</p></td><td data-label="Status" className="px-4 py-4"><StatusBadge name={lead.status_name} color={lead.status_color} /></td><td data-label="Source" className="px-4 py-4 text-neutral-600">{lead.source_name ?? "—"}</td><td data-label="Value" className="px-4 py-4"><p className="font-medium">{money(lead.estimated_value, lead.currency)}</p><p className="mt-1 text-xs text-neutral-400">{lead.probability_percent}% probability</p></td><td data-label="Assigned" className="px-4 py-4 text-neutral-600">{lead.assigned_employee_name ?? "Unassigned"}</td><td data-label="Follow-up" className="px-4 py-4 text-neutral-600">{when(lead.next_follow_up_at)}</td><td data-label="Action" className="px-6 py-4 text-right"><button aria-label={`Open lead ${lead.company_name || lead.contact_name}`} onClick={() => void openLead(lead.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-white">Open</button></td></tr>)}</tbody></table></div>{nextCursor ? <div className="crm-register-pagination"><button disabled={loadingMore} onClick={() => void loadMore()} className="rounded-xl border px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{loadingMore ? "Loading..." : "Load more"}</button></div> : null}</>}
    </section> : null}

    {tab === "settings" && canManage && meta ? <div className="crm-settings-grid"><PipelineStatuses statuses={meta.statuses} saving={saving} run={run} api={api} /><PipelineSources sources={meta.sources} saving={saving} run={run} api={api} /></div> : null}
  </div>

  {newLeadOpen && canManage && meta ? <Modal title="Create lead" busy={saving} onClose={() => { if (!mutationPending.current) setNewLeadOpen(false); }}><form onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => { await api("/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_type: text(form, "lead_type") ?? "company", company_name: text(form, "company_name"), contact_name: text(form, "contact_name"), email: text(form, "email"), phone: text(form, "phone"), whatsapp: text(form, "whatsapp"), website: text(form, "website"), country_code: text(form, "country_code"), state_region: text(form, "state_region"), city: text(form, "city"), address_line1: text(form, "address_line1"), source_id: text(form, "source_id"), status_id: text(form, "status_id"), assigned_employee_id: text(form, "assigned_employee_id"), estimated_value: text(form, "estimated_value"), currency: text(form, "currency"), probability_percent: Number(form.get("probability_percent") || 0), next_follow_up_at: text(form, "next_follow_up_at") ? new Date(String(form.get("next_follow_up_at"))).toISOString() : null, notes: text(form, "notes") }) }); if (alive.current) { formElement.reset(); setNewLeadOpen(false); } }, "Lead created", "summary-list"); }} className="space-y-5"><fieldset disabled={saving} className="min-w-0 space-y-5"><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Lead type" name="lead_type" options={[["company", "Company"], ["individual", "Individual"]]} defaultValue="company" /><Field label="Company name" name="company_name" maxLength={220} /><Field label="Contact person" name="contact_name" maxLength={180} required /><Field label="Email" name="email" type="email" /><Field label="Phone" name="phone" maxLength={64} /><Field label="WhatsApp" name="whatsapp" maxLength={64} /><Field label="Website" name="website" maxLength={500} type="url" /><SearchableSelect disabled={saving} label="Country" name="country_code" defaultValue={meta.default_country_code} options={COUNTRY_OPTIONS} searchPlaceholder="Search country..." /><Field label="State / Province / Region" name="state_region" maxLength={120} /><Field label="City" name="city" maxLength={120} /><Field label="Address" name="address_line1" maxLength={250} /><SelectField label="Source" name="source_id" options={activeSources.map((item) => [item.id, item.name])} empty="No source" /><SelectField label="Status" name="status_id" options={activeStatuses.map((item) => [item.id, item.name])} defaultValue={activeStatuses.find((item) => item.is_default)?.id ?? ""} /><SearchableSelect disabled={saving} label="Assigned to" name="assigned_employee_id" options={employeeOptions} placeholder="Unassigned" searchPlaceholder="Search employee..." clearable /><Field label="Estimated value" name="estimated_value" min={0} type="number" step="0.01" /><SearchableSelect disabled={saving} label="Currency" name="currency" defaultValue={meta.default_currency} options={CURRENCY_OPTIONS} searchPlaceholder="Search currency..." /><Field label="Probability %" name="probability_percent" min={0} max={100} step="1" type="number" defaultValue="0" /><Field label="Next follow-up" name="next_follow_up_at" type="datetime-local" /><p className="text-xs text-neutral-500">Times use your browser timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p></div><label className="block text-sm font-medium">Notes<textarea name="notes" className={textareaClass} /></label><div className="flex justify-end gap-2 border-t pt-5"><button type="button" onClick={() => { if (!mutationPending.current) setNewLeadOpen(false); }} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white">{saving ? "Creating..." : "Create lead"}</button></div></fieldset></form></Modal> : null}

  {(detailLoading || detail) ? <LeadDrawer canPrepareQuotation={canPrepareQuotation} canManage={canManage} key={detail?.lead.id ?? "loading"} detail={detail} loading={detailLoading} meta={meta} saving={saving} onClose={closeLead} api={api} run={run} reloadDetail={reloadDetail} /> : null}
  </RelationshipPage>;
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: number | null; icon: typeof Target }) { return <article className="crm-summary-metric"><div><p>{label}</p><Icon size={16} strokeWidth={1.6} aria-hidden="true" /></div><p>{value ?? "—"}</p></article>; }

function FollowUpPriority({ value }: { value: number | null }) {
  return <div className="crm-followup-priority"><span className="crm-followup-icon"><CalendarClock size={20} strokeWidth={1.6} aria-hidden="true" /></span><div><p>Due follow-ups</p><strong>{value ?? "—"}</strong></div><span className="crm-followup-caption">Scheduled follow-ups<br />ready for your attention.</span></div>;
}

function LeadDrawer({ detail, loading, meta, saving, onClose, api, run, reloadDetail, canManage = false, canPrepareQuotation = false }: { canManage?: boolean; canPrepareQuotation?: boolean; detail: LeadDetail | null; loading: boolean; meta: Meta | null; saving: boolean; onClose: () => void; api: (path: string, init?: RequestInit) => Promise<unknown>; run: (work: () => Promise<void>, success: string, policy?: RefreshPolicy, leadId?: string) => Promise<void>; reloadDetail: (leadId?: string) => Promise<void> }) {
  const [wonNoticeOpen, setWonNoticeOpen] = useState(false); const [convertOpen, setConvertOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const editPending = useRef(false);
  const convertPending = useRef(false);
  const activeStatuses = meta?.statuses.filter((item) => item.is_active) ?? []; const isWon = detail?.lead.status_category === "won"; const isConverted = Boolean(detail?.lead.converted_client_id); const employeeOptions = meta?.employees.map((item) => ({ value: item.id, label: `${item.full_name} · ${item.employee_code}` })) ?? [];
  return <><CrmDialog label="Lead detail" labelledBy="crm-lead-title" onClose={onClose} className="crm-drawer-overlay fixed inset-0 z-50 bg-black/30" panelClassName="crm-lead-drawer"><div className="crm-drawer-heading"><div><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Lead detail</p><h2 id="crm-lead-title" className="mt-1 text-xl font-semibold">{detail?.lead.company_name || detail?.lead.contact_name || "Loading..."}</h2></div><button aria-label="Close lead detail" onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{loading || !detail ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : <div className="crm-drawer-body">
    <div className={`crm-stage-card rounded-2xl border p-5 ${isWon ? "border-emerald-200 bg-emerald-50/40" : "bg-white"}`}><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Pipeline status</p><p className="mt-1 text-sm text-neutral-500">Status can only be changed from this lead detail.</p></div>{!canManage || isWon || isConverted ? <StatusBadge name={detail.lead.status_name} color={detail.lead.status_color} locked /> : <StatusSelect value={detail.lead.status_id} statuses={activeStatuses} disabled={saving} onChange={(statusId) => { const target = activeStatuses.find((item) => item.id === statusId); void run(async () => { await api(`/leads/${detail.lead.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status_id: statusId }) }); if (target?.category === "won") setWonNoticeOpen(true); }, `Lead status changed to ${target?.name ?? "selected status"}`, "detail-summary-list", detail.lead.id); }} />}</div>{canManage && isWon && !isConverted ? <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-emerald-700" /><div><p className="text-sm font-semibold text-emerald-800">Won status is locked</p><p className="mt-1 text-xs leading-5 text-emerald-700">This opportunity cannot move back to another pipeline status.</p></div></div><button type="button" onClick={() => setConvertOpen(true)} className="h-10 shrink-0 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white">Convert to Client</button></div> : null}{isConverted ? <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-white p-4 text-sm text-emerald-700"><span>This won lead has been converted and permanently linked to a client.</span><a href="/dashboard/clients" className="font-semibold underline">View Clients</a></div> : null}</div>
    {canManage ? <button type="button" disabled={saving} onClick={() => setEditOpen(true)} className="relationship-secondary">Edit lead details</button> : null}
    <div className="crm-lead-signals" aria-label="Lead ownership, value and next follow-up"><Info label="Assigned" value={detail.lead.assigned_employee_name ?? "Unassigned"} /><Info label="Potential" value={money(detail.lead.estimated_value, detail.lead.currency)} /><Info label="Follow-up" value={when(detail.lead.next_follow_up_at)} /></div>
    <div className="crm-drawer-columns"><div className="crm-drawer-primary">
    <div className="crm-lead-requirements"><LeadRequirementsCard canPrepareQuotation={canPrepareQuotation} canManage={canManage} key={detail.lead.id} leadId={detail.lead.id} currency={detail.lead.currency ?? meta?.default_currency ?? "BDT"} convertedClientId={detail.lead.converted_client_id} onSaved={() => reloadDetail(detail.lead.id)} /></div>
    {detail.notes ? <div className="crm-lead-notes"><p className="text-xs uppercase tracking-wide text-neutral-400">Notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{detail.notes}</p></div> : null}

    <section className="crm-timeline"><h3>Relationship timeline</h3><div className="crm-timeline-list">{detail.interactions.map((item) => <div key={item.id} className="crm-timeline-item"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold capitalize">{item.interaction_type.replace("_", " ")}{item.subject ? ` · ${item.subject}` : ""}</p><span className="text-xs text-neutral-400">{when(item.created_at)}</span></div>{item.body ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{item.body}</p> : null}{item.scheduled_at ? <p className="mt-2 text-xs text-neutral-400">Scheduled: {when(item.scheduled_at)}</p> : null}</div>)}{detail.interactions.length === 0 ? <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-neutral-400">No CRM activities yet.</p> : null}</div></section>
    </div><div className="crm-drawer-secondary">    <section className="crm-contact-section"><h3>Contact & origin</h3><div className="crm-contact-grid"><Info label="Lead code" value={detail.lead.lead_code} /><Info label="Contact" value={detail.lead.contact_name} /><Info label="Email" value={detail.lead.email ?? "—"} /><Info label="Phone" value={detail.lead.phone ?? "—"} /><Info label="Source" value={detail.lead.source_name ?? "—"} /><Info label="Country" value={detail.country_code ?? "—"} /><Info label="WhatsApp" value={detail.whatsapp ?? "—"} /><Info label="Website" value={detail.website ?? "—"} /><Info label="Region" value={detail.state_region ?? "—"} /><Info label="City" value={detail.city ?? "—"} /><Info label="Address" value={detail.address_line1 ?? "—"} /></div></section>    {canManage ? <section className="crm-activity-composer"><div className="flex items-center gap-2"><MessageSquarePlus className="size-4" /><h3 className="font-semibold">Add CRM activity</h3></div><form onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const interactionType = text(form, "interaction_type") ?? "note"; void run(async () => { const scheduled = text(form, "scheduled_at"); await api(`/leads/${detail.lead.id}/interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interaction_type: interactionType, subject: text(form, "subject"), body: text(form, "body"), scheduled_at: scheduled ? new Date(scheduled).toISOString() : null }) }); formElement.reset(); }, "CRM activity added", interactionType === "follow_up" ? "detail-summary-list" : "detail", detail.lead.id); }} className="mt-4 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Type" name="interaction_type" options={[["note", "Note"], ["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["follow_up", "Follow-up"]]} defaultValue="note" /><Field label="Subject" name="subject" /></div><label className="block text-sm font-medium">Details<textarea name="body" className={textareaClass} /></label><Field label="Schedule / follow-up time" name="scheduled_at" type="datetime-local" /><p className="text-xs text-neutral-500">Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p><button disabled={saving} className="h-10 rounded-xl border px-4 text-sm font-semibold">Add activity</button></form></section> : null}</div></div>
  </div>}</CrmDialog>
  {canManage && editOpen && detail && meta ? <Modal title="Edit lead details" busy={saving} onClose={() => { if (!editPending.current) setEditOpen(false); }}><LeadEditForm detail={detail} meta={meta} saving={saving} onCancel={() => { if (!editPending.current) setEditOpen(false); }} onSave={(form) => { if (editPending.current || !canManage) return; editPending.current = true; void run(async () => { await api(`/leads/${detail.lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(leadEditPayload(form, detail)) }); setEditOpen(false); }, "Lead details updated", "detail-summary-list", detail.lead.id).finally(() => { editPending.current = false; }); }} /></Modal> : null}
  {canManage && wonNoticeOpen && detail && !detail.lead.converted_client_id ? <DecisionModal title="Opportunity marked as Won" onClose={() => setWonNoticeOpen(false)}><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-semibold text-emerald-900">Won is now a final status.</p><p className="mt-1 text-sm text-emerald-800">This lead can no longer move back to another pipeline status.</p></div><div className="mt-5 flex justify-end gap-2"><button onClick={() => setWonNoticeOpen(false)} className="h-10 rounded-xl border px-4 text-sm font-semibold">Close</button><button onClick={() => { setWonNoticeOpen(false); setConvertOpen(true); }} className="h-10 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white">Convert to Client</button></div></DecisionModal> : null}
  {canManage && convertOpen && detail && meta && isWon && !isConverted ? <Modal title="Create client from won lead" busy={saving} onClose={() => { if (!convertPending.current) setConvertOpen(false); }}><form onSubmit={(event) => { event.preventDefault(); if (convertPending.current || !canManage) return; convertPending.current = true; const form = new FormData(event.currentTarget); void run(async () => { await api(`/leads/${detail.lead.id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_type: text(form, "client_type") ?? detail.lead.lead_type, display_name: text(form, "display_name"), legal_name: text(form, "legal_name"), contact_name: text(form, "contact_name"), email: text(form, "email"), billing_email: text(form, "billing_email"), phone: text(form, "phone"), whatsapp: text(form, "whatsapp"), website: text(form, "website"), country_code: text(form, "country_code"), state_region: text(form, "state_region"), city: text(form, "city"), postal_code: text(form, "postal_code"), address_line1: text(form, "address_line1"), address_line2: text(form, "address_line2"), tax_identifier: text(form, "tax_identifier"), currency: text(form, "currency"), assigned_employee_id: text(form, "assigned_employee_id"), notes: text(form, "notes") }) }); setConvertOpen(false); }, "Lead converted to client", "detail-summary-list", detail.lead.id).finally(() => { convertPending.current = false; }); }} className="space-y-5"><fieldset disabled={saving} className="min-w-0 space-y-5"><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Client type" name="client_type" options={[["company", "Company"], ["individual", "Individual"]]} defaultValue={detail.lead.lead_type} /><Field label="Display name" name="display_name" required defaultValue={detail.lead.company_name || detail.lead.contact_name} /><Field label="Legal company name" name="legal_name" defaultValue={detail.lead.company_name} /><Field label="Contact person" name="contact_name" defaultValue={detail.lead.contact_name} /><Field label="Email" name="email" type="email" defaultValue={detail.lead.email} /><Field label="Billing email" name="billing_email" type="email" defaultValue={detail.lead.email} /><Field label="Phone" name="phone" defaultValue={detail.lead.phone} /><Field label="WhatsApp" name="whatsapp" defaultValue={detail.whatsapp} /><Field label="Website" name="website" type="url" defaultValue={detail.website} /><SearchableSelect disabled={saving} label="Country" name="country_code" defaultValue={detail.country_code ?? meta.default_country_code} options={COUNTRY_OPTIONS} searchPlaceholder="Search country..." /><Field label="State / Province / Region" name="state_region" defaultValue={detail.state_region} /><Field label="City" name="city" defaultValue={detail.city} /><Field label="Postal / ZIP code" name="postal_code" /><Field label="Address line 1" name="address_line1" defaultValue={detail.address_line1} /><Field label="Address line 2" name="address_line2" /><Field label="Tax / VAT identifier" name="tax_identifier" /><SearchableSelect disabled={saving} label="Currency" name="currency" defaultValue={detail.lead.currency ?? meta.default_currency} options={CURRENCY_OPTIONS} searchPlaceholder="Search currency..." /><SearchableSelect disabled={saving} label="Assigned to" name="assigned_employee_id" defaultValue={detail.lead.assigned_employee_id ?? ""} options={employeeOptions} placeholder="Unassigned" searchPlaceholder="Search employee..." clearable /></div><label className="block text-sm font-medium">Client notes<textarea name="notes" defaultValue={detail.notes ?? ""} className={textareaClass} /></label><div className="flex justify-end gap-2 border-t pt-5"><button type="button" onClick={() => { if (!convertPending.current) setConvertOpen(false); }} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white">{saving ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />} Create Client</button></div></fieldset></form></Modal> : null}</>;
}

function StatusBadge({ name, color, locked = false }: { name: string; color: string | null; locked?: boolean }) { return <span className="crm-status-badge"><span className="size-2 rounded-full" style={{ backgroundColor: color ?? "#a3a3a3" }} />{name}{locked ? <LockKeyhole className="size-3 text-neutral-400" /> : null}</span>; }
function StatusSelect({ value, statuses, disabled, onChange }: { value: string; statuses: LeadStatus[]; disabled?: boolean; onChange: (statusId: string) => void }) { const current = statuses.find((item) => item.id === value); return <label className="relative inline-flex min-w-[150px] items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm font-medium"><span className="size-2 rounded-full" style={{ backgroundColor: current?.color ?? "#a3a3a3" }} /><select aria-label="Lead status" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 appearance-none border-0 bg-transparent pr-5 text-sm outline-none">{statuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="pointer-events-none absolute right-3 text-[9px] text-neutral-400">▼</span></label>; }

function ColorPickerField({ label, name, defaultValue = "#64748b" }: { label: string; name: string; defaultValue?: string | null }) {
  const value = defaultValue && /^#[0-9A-Fa-f]{6}$/.test(defaultValue) ? defaultValue : "#64748b";
  return <label className="block text-sm font-medium">{label}<input aria-label={label} name={name} type="color" defaultValue={value} className="mt-2 h-11 w-full cursor-pointer rounded-xl border border-neutral-200 bg-white p-1.5" /></label>;
}

function PipelineStatuses({ statuses, saving, run, api }: { statuses: LeadStatus[]; saving: boolean; run: (work: () => Promise<void>, success: string, policy?: RefreshPolicy) => Promise<void>; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteItem = statuses.find((item) => item.id === deleteId) ?? null;
  const categories: Array<[string, string]> = [["open", "Open"], ["qualified", "Qualified"], ["won", "Won"], ["lost", "Lost"]];

  return <section className="crm-settings-panel">
    <div className="flex items-center gap-2"><Settings2 className="size-4" /><h2 className="font-semibold">Lead statuses</h2></div>
    <p className="mt-1 text-sm text-neutral-500">Create, rename and organize the stages used in your company pipeline.</p>
    <form onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => { await api("/settings/statuses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name"), category: text(form, "category") ?? "open", color: text(form, "color"), sort_order: 100 }) }); formElement.reset(); }, "Lead status created", "meta"); }} className="mt-5 grid gap-3 sm:grid-cols-[1fr_150px_120px_auto]">
      <Field label="Name" name="name" required />
      <SelectField label="Category" name="category" options={categories} defaultValue="open" />
      <ColorPickerField label="Color" name="color" defaultValue="#64748b" />
      <button disabled={saving} className="mt-7 h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Add</button>
    </form>

    <div className="mt-5 divide-y rounded-xl border">
      {statuses.map((item) => editingId === item.id ? <form key={item.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await api(`/settings/statuses/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name"), category: text(form, "category"), color: text(form, "color") }) }); setEditingId(null); }, "Lead status updated", "meta"); }} className="grid gap-3 p-4 md:grid-cols-[minmax(180px,1fr)_150px_110px_auto] md:items-end">
        <Field label="Name" name="name" required defaultValue={item.name} />
        <SelectField label="Category" name="category" options={categories} defaultValue={item.category} />
        <ColorPickerField label="Color" name="color" defaultValue={item.color} />
        <div className="flex gap-2 pb-0.5"><button disabled={saving} className="h-10 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-50">Save</button><button type="button" disabled={saving} onClick={() => setEditingId(null)} className="h-10 rounded-lg border px-3 text-xs font-semibold">Cancel</button></div>
      </form> : <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="size-2.5 rounded-full" style={{ backgroundColor: item.color ?? "#a3a3a3" }} />{item.name}{item.is_default ? <span className="rounded-full border bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Default</span> : null}{!item.is_active ? <span className="rounded-full border bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Disabled</span> : null}</p><p className="mt-1 text-xs capitalize text-neutral-400">{item.category}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => setEditingId(item.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">Edit</button><button type="button" disabled={saving || item.is_default} title={item.is_default ? "The default lead status must remain active" : undefined} onClick={() => void run(() => api(`/settings/statuses/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) }).then(() => undefined), item.is_active ? "Lead status disabled" : "Lead status enabled", "meta")} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">{item.is_active ? "Disable" : "Enable"}</button><button type="button" disabled={saving || item.is_default} title={item.is_default ? "Default lead status cannot be deleted" : undefined} onClick={() => setDeleteId(item.id)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 disabled:opacity-40">Delete</button></div>
      </div>)}
    </div>

    {deleteItem ? <DecisionModal busy={saving} title="Delete lead status" onClose={() => !saving && setDeleteId(null)}><p className="text-sm leading-6 text-neutral-600">Delete <span className="font-semibold text-neutral-900">{deleteItem.name}</span>? This is only allowed when no existing lead uses this status. If it is already in use, disable it instead so historical leads keep their pipeline stage.</p><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setDeleteId(null)} className="h-10 rounded-lg border px-4 text-sm font-semibold">Cancel</button><button type="button" disabled={saving} onClick={() => void run(async () => { await api(`/settings/statuses/${deleteItem.id}`, { method: "DELETE" }); setDeleteId(null); }, "Lead status deleted", "meta")} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Delete status</button></div></DecisionModal> : null}
  </section>;
}

function PipelineSources({ sources, saving, run, api }: { sources: LeadSource[]; saving: boolean; run: (work: () => Promise<void>, success: string, policy?: RefreshPolicy) => Promise<void>; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteItem = sources.find((item) => item.id === deleteId) ?? null;

  return <section className="crm-settings-panel">
    <div className="flex items-center gap-2"><Target className="size-4" /><h2 className="font-semibold">Lead sources</h2></div>
    <p className="mt-1 text-sm text-neutral-500">Manage where opportunities come from, such as your website, referrals or marketplaces.</p>
    <form onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => { await api("/settings/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name"), sort_order: 100 }) }); formElement.reset(); }, "Lead source created", "meta"); }} className="mt-5 flex items-end gap-3"><div className="min-w-0 flex-1"><Field label="Source name" name="name" required /></div><button disabled={saving} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Add</button></form>

    <div className="mt-5 divide-y rounded-xl border">
      {sources.map((item) => editingId === item.id ? <form key={item.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await api(`/settings/sources/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name") }) }); setEditingId(null); }, "Lead source updated", "meta"); }} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><Field label="Source name" name="name" required defaultValue={item.name} /></div><div className="flex gap-2 pb-0.5"><button disabled={saving} className="h-10 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-50">Save</button><button type="button" disabled={saving} onClick={() => setEditingId(null)} className="h-10 rounded-lg border px-3 text-xs font-semibold">Cancel</button></div>
      </form> : <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="flex items-center gap-2 text-sm font-medium">{item.name}{!item.is_active ? <span className="rounded-full border bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Disabled</span> : null}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => setEditingId(item.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">Edit</button><button type="button" disabled={saving} onClick={() => void run(() => api(`/settings/sources/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) }).then(() => undefined), item.is_active ? "Lead source disabled" : "Lead source enabled", "meta")} className="rounded-lg border px-3 py-2 text-xs font-semibold">{item.is_active ? "Disable" : "Enable"}</button><button type="button" disabled={saving} onClick={() => setDeleteId(item.id)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 disabled:opacity-40">Delete</button></div></div>)}
    </div>

    {deleteItem ? <DecisionModal busy={saving} title="Delete lead source" onClose={() => !saving && setDeleteId(null)}><p className="text-sm leading-6 text-neutral-600">Delete <span className="font-semibold text-neutral-900">{deleteItem.name}</span>? If an existing lead already uses this source, Business OS will block deletion and you can disable it instead to preserve lead history.</p><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setDeleteId(null)} className="h-10 rounded-lg border px-4 text-sm font-semibold">Cancel</button><button type="button" disabled={saving} onClick={() => void run(async () => { await api(`/settings/sources/${deleteItem.id}`, { method: "DELETE" }); setDeleteId(null); }, "Lead source deleted", "meta")} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Delete source</button></div></DecisionModal> : null}
  </section>;
}

function Modal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: React.ReactNode; busy?: boolean }) { return <CrmDialog label={title} busy={busy} onClose={onClose} className="crm-modal fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" panelClassName="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><h2 className="text-xl font-semibold">{title}</h2><button disabled={busy} aria-label="Close dialog" onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="p-6">{children}</div></CrmDialog>; }
function DecisionModal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: React.ReactNode; busy?: boolean }) { return <CrmDialog busy={busy} label={title} onClose={onClose} closeOnBackdrop={false} className="crm-decision-modal fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" panelClassName="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button aria-label="Close dialog" onClick={onClose} className="flex size-9 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="mt-5">{children}</div></CrmDialog>; }

function Field({ label, name, type = "text", required = false, defaultValue, step, min, max, maxLength }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string | null; step?: string; min?: number; max?: number; maxLength?: number }) { return <label className="block text-sm font-medium">{label}<input name={name} type={type} required={required} defaultValue={defaultValue ?? ""} step={step} min={min} max={max} maxLength={maxLength} className={inputClass} /></label>; }
function SelectField({ label, name, options, defaultValue = "", empty }: { label: string; name: string; options: Array<[string, string]>; defaultValue?: string; empty?: string }) { return <label className="block text-sm font-medium">{label}<select name={name} defaultValue={defaultValue} className={inputClass}>{empty !== undefined ? <option value="">{empty}</option> : null}{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="crm-info"><p>{label}</p><p>{value}</p></div>; }
function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

function leadEditPayload(form: FormData, detail: LeadDetail) {
  const scheduled = text(form, "next_follow_up_at");
  return {
    lead_type: text(form, "lead_type") ?? detail.lead.lead_type,
    contact_name: text(form, "contact_name"), company_name: text(form, "company_name"),
    email: text(form, "email"), phone: text(form, "phone"), whatsapp: text(form, "whatsapp"), website: text(form, "website"),
    country_code: text(form, "country_code"), state_region: text(form, "state_region"), city: text(form, "city"), address_line1: text(form, "address_line1"),
    ...(text(form, "source_id") === detail.lead.source_id ? {} : { source_id: text(form, "source_id") }),
    ...(text(form, "assigned_employee_id") === (detail.lead.assigned_employee_id ?? null) ? {} : { assigned_employee_id: text(form, "assigned_employee_id") }),
    estimated_value: text(form, "estimated_value"), probability_percent: Number(form.get("probability_percent") || 0),
    next_follow_up_at: scheduled === localDateTime(detail.lead.next_follow_up_at) ? detail.lead.next_follow_up_at : scheduled ? new Date(scheduled).toISOString() : null,
    notes: text(form, "notes"),
    // Status has its dedicated guarded endpoint; currency is deliberately not reinterpreted by contact editing.
  };
}

function LeadEditForm({ detail, meta, saving, onSave, onCancel }: { detail: LeadDetail; meta: Meta; saving: boolean; onSave: (form: FormData) => void; onCancel: () => void }) {
  const lead = detail.lead;
  const sources = meta.sources.filter(source => source.is_active || source.id === lead.source_id);
  const employees = meta.employees.map(employee => ({ value: employee.id, label: `${employee.full_name} · ${employee.employee_code}` }));
  if (lead.assigned_employee_id && !employees.some(employee => employee.value === lead.assigned_employee_id)) employees.push({ value: lead.assigned_employee_id, label: `${lead.assigned_employee_name ?? "Current assignee"} (current)` });
  return <form onSubmit={(event) => { event.preventDefault(); if (!saving) onSave(new FormData(event.currentTarget)); }} className="space-y-5"><fieldset disabled={saving} className="min-w-0 space-y-5">
    <p className="text-sm text-neutral-500">Update this lead’s existing details. Status is changed separately; currency remains {lead.currency ?? meta.default_currency ?? "unchanged"}.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField label="Lead type" name="lead_type" defaultValue={lead.lead_type} options={[["company", "Company"], ["individual", "Individual"]]} />
      <Field label="Company name" name="company_name" maxLength={220} defaultValue={lead.company_name} />
      <Field label="Contact person" name="contact_name" maxLength={180} defaultValue={lead.contact_name} required />
      <Field label="Email" name="email" type="email" defaultValue={lead.email} />
      <Field label="Phone" name="phone" maxLength={64} defaultValue={lead.phone} />
      <Field label="WhatsApp" name="whatsapp" maxLength={64} defaultValue={detail.whatsapp} />
      <Field label="Website" name="website" maxLength={500} type="url" defaultValue={detail.website} />
      <SearchableSelect disabled={saving} label="Country" name="country_code" defaultValue={detail.country_code} options={COUNTRY_OPTIONS} />
      <Field label="State / Province / Region" name="state_region" maxLength={120} defaultValue={detail.state_region} />
      <Field label="City" name="city" maxLength={120} defaultValue={detail.city} />
      <Field label="Address" name="address_line1" maxLength={250} defaultValue={detail.address_line1} />
      <SelectField label="Source" name="source_id" defaultValue={lead.source_id ?? ""} empty="No source" options={sources.map(source => [source.id, source.name])} />
      <SearchableSelect disabled={saving} label="Assigned employee" name="assigned_employee_id" defaultValue={lead.assigned_employee_id} options={employees} />
      <Field label="Estimated value" name="estimated_value" min={0} type="number" step="0.01" defaultValue={lead.estimated_value == null ? "" : String(lead.estimated_value)} />
      <Field label="Probability %" name="probability_percent" min={0} max={100} step="1" type="number" defaultValue={String(lead.probability_percent)} />
      <Field label="Next follow-up" name="next_follow_up_at" type="datetime-local" defaultValue={localDateTime(lead.next_follow_up_at)} />
    </div>
    <p className="text-xs text-neutral-500">Follow-up uses your browser timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. An unchanged value preserves its original instant.</p>
    <label className="block text-sm font-medium">Notes<textarea name="notes" defaultValue={detail.notes ?? ""} className={textareaClass} /></label>
    <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={onCancel} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white">{saving ? "Saving..." : "Save lead details"}</button></div>
  </fieldset></form>;
}
