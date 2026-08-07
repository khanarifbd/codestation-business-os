"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Filter,
  Loader2,
  MessageSquarePlus,
  Plus,
  Search,
  Settings2,
  Target,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { SearchableSelect } from "@/components/searchable-select";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from "@/lib/company-options";

type LeadStatus = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  category: string;
  sort_order: number;
  is_default: boolean;
  is_active: boolean;
};
type LeadSource = { id: string; name: string; slug: string; sort_order: number; is_active: boolean };
type EmployeeOption = { id: string; employee_code: string; full_name: string };
type Meta = {
  statuses: LeadStatus[];
  sources: LeadSource[];
  employees: EmployeeOption[];
  default_country_code: string | null;
  default_currency: string | null;
};
type Summary = {
  total_leads: number;
  open_leads: number;
  won_leads: number;
  lost_leads: number;
  due_followups: number;
  converted_leads: number;
};
type Lead = {
  id: string;
  lead_code: string;
  lead_type: string;
  company_name: string | null;
  contact_name: string;
  email: string | null;
  phone: string | null;
  status_id: string;
  status_name: string;
  status_color: string | null;
  status_category: string;
  source_id: string | null;
  source_name: string | null;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  estimated_value: string | number | null;
  currency: string | null;
  probability_percent: number;
  next_follow_up_at: string | null;
  converted_client_id: string | null;
  created_at: string;
  updated_at: string;
};
type Interaction = {
  id: string;
  interaction_type: string;
  subject: string | null;
  body: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_by_user_id: string;
  created_at: string;
};
type LeadDetail = {
  lead: Lead;
  website: string | null;
  whatsapp: string | null;
  country_code: string | null;
  state_region: string | null;
  city: string | null;
  address_line1: string | null;
  notes: string | null;
  interactions: Interaction[];
};

type Tab = "leads" | "settings";

const inputClass = "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500";
const textareaClass = "mt-2 min-h-24 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-neutral-500";

function text(form: FormData, key: string) {
  const value = String(form.get(key) ?? "").trim();
  return value || null;
}

function money(value: string | number | null, currency: string | null) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return `${currency ?? ""} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim();
}

function when(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function CrmPage() {
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
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/crm${path}`, init);
    if (response.status === 401) {
      router.replace("/login");
      throw new Error("Authentication required");
    }
    if (response.status === 403) {
      throw new Error("Your company role does not have permission for this CRM action.");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "CRM request failed.");
    return payload;
  }, [router]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "30");
    params.set("converted", "false");
    if (search) params.set("search", search);
    if (statusFilter) params.set("status_id", statusFilter);
    if (sourceFilter) params.set("source_id", sourceFilter);
    if (assigneeFilter) params.set("assigned_employee_id", assigneeFilter);
    return params.toString();
  }, [search, statusFilter, sourceFilter, assigneeFilter]);

  const loadFoundation = useCallback(async () => {
    try {
      const [metaPayload, summaryPayload] = await Promise.all([
        api("/meta"),
        api("/summary"),
      ]);
      setMeta(metaPayload as Meta);
      setSummary(summaryPayload as Summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load CRM.");
    }
  }, [api]);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api(`/leads?${queryString}`) as { items: Lead[]; next_cursor: string | null };
      setLeads(payload.items);
      setNextCursor(payload.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load leads.");
    } finally {
      setLoading(false);
    }
  }, [api, queryString]);

  useEffect(() => { void loadFoundation(); }, [loadFoundation]);
  useEffect(() => { void loadLeads(); }, [loadLeads]);

  async function refreshAll() {
    await Promise.all([loadFoundation(), loadLeads()]);
  }

  async function run(work: () => Promise<void>, success: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      await refreshAll();
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(queryString);
      params.set("cursor", nextCursor);
      const payload = await api(`/leads?${params.toString()}`) as { items: Lead[]; next_cursor: string | null };
      setLeads((current) => [...current, ...payload.items]);
      setNextCursor(payload.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load more leads.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openLead(leadId: string) {
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await api(`/leads/${leadId}`) as LeadDetail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load lead details.");
    } finally {
      setDetailLoading(false);
    }
  }

  const activeStatuses = meta?.statuses.filter((item) => item.is_active) ?? [];
  const activeSources = meta?.sources.filter((item) => item.is_active) ?? [];

  return (
    <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Customer relationship management</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">CRM & Leads</h1>
            <p className="mt-2 text-sm text-neutral-500">Capture, qualify, follow up and convert opportunities into clients.</p>
          </div>
          <button
            type="button"
            onClick={() => setNewLeadOpen(true)}
            className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"
          >
            <Plus className="size-4" /> New lead
          </button>
        </header>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Total leads" value={summary?.total_leads ?? 0} icon={Target} />
          <SummaryCard label="Open pipeline" value={summary?.open_leads ?? 0} icon={Filter} />
          <SummaryCard label="Won" value={summary?.won_leads ?? 0} icon={CheckCircle2} />
          <SummaryCard label="Due follow-ups" value={summary?.due_followups ?? 0} icon={CalendarClock} />
          <SummaryCard label="Converted" value={summary?.converted_leads ?? 0} icon={ArrowRight} />
        </div>

        <div className="mt-5 flex flex-wrap gap-1 rounded-2xl border bg-white p-2 shadow-sm">
          <button onClick={() => setTab("leads")} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${tab === "leads" ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>Leads</button>
          <button onClick={() => setTab("settings")} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${tab === "settings" ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>Pipeline Settings</button>
        </div>

        {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        {tab === "leads" ? (
          <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b p-4 sm:p-5">
              <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_220px_220px_auto]">
                <form
                  onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}
                  className="relative"
                >
                  <Search className="absolute left-3 top-3.5 size-4 text-neutral-400" />
                  <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search code, name, email, phone..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-neutral-500" />
                </form>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm">
                  <option value="">All statuses</option>
                  {activeStatuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm">
                  <option value="">All sources</option>
                  {activeSources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm">
                  <option value="">All assignees</option>
                  {meta?.employees.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
                </select>
                <button type="button" onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter(""); setSourceFilter(""); setAssigneeFilter(""); }} className="h-11 rounded-xl border px-4 text-sm font-medium hover:bg-neutral-50">Reset</button>
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div>
            ) : leads.length === 0 ? (
              <div className="px-6 py-20 text-center">
                <Target className="mx-auto size-8 text-neutral-300" />
                <h2 className="mt-4 font-semibold">No leads found</h2>
                <p className="mt-1 text-sm text-neutral-500">Create your first lead or adjust the current filters.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-left text-sm">
                    <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
                      <tr><th className="px-6 py-3 font-medium">Lead</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Source</th><th className="px-4 py-3 font-medium">Value</th><th className="px-4 py-3 font-medium">Assigned</th><th className="px-4 py-3 font-medium">Follow-up</th><th className="px-6 py-3 text-right font-medium">Action</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {leads.map((lead) => (
                        <tr key={lead.id} className="hover:bg-neutral-50/70">
                          <td className="px-6 py-4"><p className="font-medium">{lead.company_name || lead.contact_name}</p><p className="mt-1 text-xs text-neutral-400">{lead.lead_code} · {lead.contact_name}{lead.email ? ` · ${lead.email}` : ""}</p></td>
                          <td className="px-4 py-4"><span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium"><span className="size-2 rounded-full" style={{ backgroundColor: lead.status_color ?? "#a3a3a3" }} />{lead.status_name}</span></td>
                          <td className="px-4 py-4 text-neutral-600">{lead.source_name ?? "—"}</td>
                          <td className="px-4 py-4"><p className="font-medium">{money(lead.estimated_value, lead.currency)}</p><p className="mt-1 text-xs text-neutral-400">{lead.probability_percent}% probability</p></td>
                          <td className="px-4 py-4 text-neutral-600">{lead.assigned_employee_name ?? "Unassigned"}</td>
                          <td className="px-4 py-4 text-neutral-600">{when(lead.next_follow_up_at)}</td>
                          <td className="px-6 py-4 text-right"><button onClick={() => void openLead(lead.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-white">Open</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {nextCursor ? <div className="border-t p-4 text-center"><button disabled={loadingMore} onClick={() => void loadMore()} className="rounded-xl border px-5 py-2.5 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50">{loadingMore ? "Loading..." : "Load more"}</button></div> : null}
              </>
            )}
          </section>
        ) : null}

        {tab === "settings" && meta ? (
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <PipelineStatuses statuses={meta.statuses} saving={saving} run={run} api={api} />
            <PipelineSources sources={meta.sources} saving={saving} run={run} api={api} />
          </div>
        ) : null}
      </div>

      {newLeadOpen && meta ? (
        <Modal title="Create lead" onClose={() => setNewLeadOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formElement = event.currentTarget;
              const form = new FormData(formElement);
              void run(async () => {
                await api("/leads", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    lead_type: text(form, "lead_type") ?? "company",
                    company_name: text(form, "company_name"),
                    contact_name: text(form, "contact_name"),
                    email: text(form, "email"),
                    phone: text(form, "phone"),
                    whatsapp: text(form, "whatsapp"),
                    website: text(form, "website"),
                    country_code: text(form, "country_code"),
                    state_region: text(form, "state_region"),
                    city: text(form, "city"),
                    source_id: text(form, "source_id"),
                    status_id: text(form, "status_id"),
                    assigned_employee_id: text(form, "assigned_employee_id"),
                    estimated_value: text(form, "estimated_value") ? Number(form.get("estimated_value")) : null,
                    currency: text(form, "currency"),
                    probability_percent: Number(form.get("probability_percent") || 0),
                    next_follow_up_at: text(form, "next_follow_up_at") ? new Date(String(form.get("next_follow_up_at"))).toISOString() : null,
                    notes: text(form, "notes"),
                  }),
                });
                formElement.reset();
                setNewLeadOpen(false);
              }, "Lead created");
            }}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Lead type" name="lead_type" options={[["company", "Company"], ["individual", "Individual"]]} defaultValue="company" />
              <Field label="Company name" name="company_name" />
              <Field label="Contact person" name="contact_name" required />
              <Field label="Email" name="email" type="email" />
              <Field label="Phone" name="phone" />
              <Field label="WhatsApp" name="whatsapp" />
              <Field label="Website" name="website" type="url" />
              <SearchableSelect label="Country" name="country_code" defaultValue={meta.default_country_code} options={COUNTRY_OPTIONS} searchPlaceholder="Search country..." />
              <Field label="State / Province / Region" name="state_region" />
              <Field label="City" name="city" />
              <SelectField label="Source" name="source_id" options={activeSources.map((item) => [item.id, item.name])} empty="No source" />
              <SelectField label="Status" name="status_id" options={activeStatuses.map((item) => [item.id, item.name])} defaultValue={activeStatuses.find((item) => item.is_default)?.id ?? ""} />
              <SelectField label="Assigned to" name="assigned_employee_id" options={meta.employees.map((item) => [item.id, item.full_name])} empty="Unassigned" />
              <Field label="Estimated value" name="estimated_value" type="number" step="0.01" />
              <SearchableSelect label="Currency" name="currency" defaultValue={meta.default_currency} options={CURRENCY_OPTIONS} searchPlaceholder="Search currency..." />
              <Field label="Probability %" name="probability_percent" type="number" defaultValue="0" />
              <Field label="Next follow-up" name="next_follow_up_at" type="datetime-local" />
            </div>
            <label className="block text-sm font-medium">Notes<textarea name="notes" className={textareaClass} /></label>
            <div className="flex justify-end gap-2 border-t pt-5"><button type="button" onClick={() => setNewLeadOpen(false)} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white">{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create lead</button></div>
          </form>
        </Modal>
      ) : null}

      {(detailLoading || detail) ? (
        <LeadDrawer
          detail={detail}
          loading={detailLoading}
          meta={meta}
          saving={saving}
          onClose={() => setDetail(null)}
          api={api}
          run={run}
          reloadDetail={async () => { if (detail) setDetail(await api(`/leads/${detail.lead.id}`) as LeadDetail); }}
        />
      ) : null}
    </main>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Target }) {
  return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-3xl font-semibold">{value}</p></article>;
}

function LeadDrawer({ detail, loading, meta, saving, onClose, api, run, reloadDetail }: {
  detail: LeadDetail | null;
  loading: boolean;
  meta: Meta | null;
  saving: boolean;
  onClose: () => void;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  run: (work: () => Promise<void>, success: string) => Promise<void>;
  reloadDetail: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="ml-auto h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><div><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Lead detail</p><h2 className="mt-1 text-xl font-semibold">{detail?.lead.company_name || detail?.lead.contact_name || "Loading..."}</h2></div><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>
        {loading || !detail ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : (
          <div className="space-y-6 p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Lead code" value={detail.lead.lead_code} />
              <Info label="Contact" value={detail.lead.contact_name} />
              <Info label="Email" value={detail.lead.email ?? "—"} />
              <Info label="Phone" value={detail.lead.phone ?? "—"} />
              <Info label="Status" value={detail.lead.status_name} />
              <Info label="Source" value={detail.lead.source_name ?? "—"} />
              <Info label="Assigned" value={detail.lead.assigned_employee_name ?? "Unassigned"} />
              <Info label="Potential" value={money(detail.lead.estimated_value, detail.lead.currency)} />
              <Info label="Follow-up" value={when(detail.lead.next_follow_up_at)} />
              <Info label="Country" value={detail.country_code ?? "—"} />
            </div>

            {detail.notes ? <div className="rounded-2xl border bg-neutral-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{detail.notes}</p></div> : null}

            {!detail.lead.converted_client_id ? (
              <div className="rounded-2xl border p-5">
                <div className="flex items-center gap-2"><Building2 className="size-4" /><h3 className="font-semibold">Convert to client</h3></div>
                <p className="mt-1 text-sm text-neutral-500">Creates the client and links this lead permanently.</p>
                <form onSubmit={(event) => {
                  event.preventDefault(); const form = new FormData(event.currentTarget);
                  void run(async () => {
                    await api(`/leads/${detail.lead.id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: text(form, "display_name"), billing_email: text(form, "billing_email"), tax_identifier: text(form, "tax_identifier") }) });
                    await reloadDetail();
                  }, "Lead converted to client");
                }} className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Client display name" name="display_name" defaultValue={detail.lead.company_name || detail.lead.contact_name} />
                  <Field label="Billing email" name="billing_email" type="email" defaultValue={detail.lead.email} />
                  <Field label="Tax identifier" name="tax_identifier" />
                  <div className="flex items-end"><button disabled={saving} className="h-11 w-full rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white">Convert to client</button></div>
                </form>
              </div>
            ) : <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">This lead is already converted to a client.</div>}

            <div className="rounded-2xl border p-5">
              <div className="flex items-center gap-2"><MessageSquarePlus className="size-4" /><h3 className="font-semibold">Add CRM activity</h3></div>
              <form onSubmit={(event) => {
                event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
                void run(async () => {
                  const scheduled = text(form, "scheduled_at");
                  await api(`/leads/${detail.lead.id}/interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interaction_type: text(form, "interaction_type") ?? "note", subject: text(form, "subject"), body: text(form, "body"), scheduled_at: scheduled ? new Date(scheduled).toISOString() : null }) });
                  formElement.reset(); await reloadDetail();
                }, "CRM activity added");
              }} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2"><SelectField label="Type" name="interaction_type" options={[["note", "Note"], ["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["follow_up", "Follow-up"]]} defaultValue="note" /><Field label="Subject" name="subject" /></div>
                <label className="block text-sm font-medium">Details<textarea name="body" className={textareaClass} /></label>
                <Field label="Schedule / follow-up time" name="scheduled_at" type="datetime-local" />
                <button disabled={saving} className="h-10 rounded-xl border px-4 text-sm font-semibold hover:bg-neutral-50">Add activity</button>
              </form>
            </div>

            <div>
              <h3 className="font-semibold">Timeline</h3>
              <div className="mt-3 space-y-3">
                {detail.interactions.map((item) => <div key={item.id} className="rounded-2xl border p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold capitalize">{item.interaction_type.replace("_", " ")}{item.subject ? ` · ${item.subject}` : ""}</p><span className="text-xs text-neutral-400">{when(item.created_at)}</span></div>{item.body ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{item.body}</p> : null}{item.scheduled_at ? <p className="mt-2 text-xs text-neutral-400">Scheduled: {when(item.scheduled_at)}</p> : null}</div>)}
                {detail.interactions.length === 0 ? <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-neutral-400">No CRM activities yet.</p> : null}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function PipelineStatuses({ statuses, saving, run, api }: { statuses: LeadStatus[]; saving: boolean; run: (work: () => Promise<void>, success: string) => Promise<void>; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  return <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><Settings2 className="size-4" /><h2 className="font-semibold">Lead statuses</h2></div><p className="mt-1 text-sm text-neutral-500">Customize your company pipeline without a database migration.</p><form onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => { await api("/settings/statuses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name"), category: text(form, "category") ?? "open", color: text(form, "color"), sort_order: 100 }) }); formElement.reset(); }, "Lead status created"); }} className="mt-5 grid gap-3 sm:grid-cols-[1fr_150px_120px_auto]"><Field label="Name" name="name" required /><SelectField label="Category" name="category" options={[["open", "Open"], ["qualified", "Qualified"], ["won", "Won"], ["lost", "Lost"]]} defaultValue="open" /><Field label="Color" name="color" defaultValue="#64748b" /><button disabled={saving} className="mt-7 h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white">Add</button></form><div className="mt-5 divide-y rounded-xl border">{statuses.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-4"><div><p className="flex items-center gap-2 text-sm font-medium"><span className="size-2.5 rounded-full" style={{ backgroundColor: item.color ?? "#a3a3a3" }} />{item.name}{item.is_default ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase text-neutral-500">Default</span> : null}</p><p className="mt-1 text-xs capitalize text-neutral-400">{item.category} · order {item.sort_order}</p></div><button disabled={saving || item.is_default} onClick={() => void run(() => api(`/settings/statuses/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) }).then(() => undefined), item.is_active ? "Lead status disabled" : "Lead status enabled")} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">{item.is_active ? "Disable" : "Enable"}</button></div>)}</div></section>;
}

function PipelineSources({ sources, saving, run, api }: { sources: LeadSource[]; saving: boolean; run: (work: () => Promise<void>, success: string) => Promise<void>; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  return <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><Target className="size-4" /><h2 className="font-semibold">Lead sources</h2></div><p className="mt-1 text-sm text-neutral-500">Track where business opportunities originate.</p><form onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => { await api("/settings/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name"), sort_order: 100 }) }); formElement.reset(); }, "Lead source created"); }} className="mt-5 flex items-end gap-3"><div className="min-w-0 flex-1"><Field label="Source name" name="name" required /></div><button disabled={saving} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white">Add</button></form><div className="mt-5 divide-y rounded-xl border">{sources.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium">{item.name}</p><p className="mt-1 text-xs text-neutral-400">{item.slug}</p></div><button disabled={saving} onClick={() => void run(() => api(`/settings/sources/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) }).then(() => undefined), item.is_active ? "Lead source disabled" : "Lead source enabled")} className="rounded-lg border px-3 py-2 text-xs font-semibold">{item.is_active ? "Disable" : "Enable"}</button></div>)}</div></section>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="p-6">{children}</div></div></div>;
}

function Field({ label, name, type = "text", required = false, defaultValue, step }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string | null; step?: string }) {
  return <label className="block text-sm font-medium">{label}<input name={name} type={type} required={required} defaultValue={defaultValue ?? ""} step={step} className={inputClass} /></label>;
}

function SelectField({ label, name, options, defaultValue = "", empty }: { label: string; name: string; options: Array<[string, string]>; defaultValue?: string; empty?: string }) {
  return <label className="block text-sm font-medium">{label}<select name={name} defaultValue={defaultValue} className={inputClass}>{empty !== undefined ? <option value="">{empty}</option> : null}{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-neutral-50 p-3"><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}
