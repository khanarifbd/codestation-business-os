"use client";

import { ProjectDialogFocus } from "@/components/projects/project-dialog";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { getApiErrorMessage } from "@/lib/api-error";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Building2, FileText, Loader2, Plus, Search, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { RelationshipHeader, RelationshipMetric, RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import "@/components/relationships/clients-directory.css";

import { SearchableSelect } from "@/components/searchable-select";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from "@/lib/company-options";

type Client = {
  id: string; client_code: string; client_type: string; display_name: string; contact_name: string | null;
  email: string | null; phone: string | null; country_code: string | null; currency: string | null; status: string;
  assigned_employee_id: string | null; assigned_employee_name: string | null; created_at: string; updated_at: string;
};
type ClientDetail = Client & {
  legal_name: string | null; billing_email: string | null; whatsapp: string | null; website: string | null;
  state_region: string | null; city: string | null; postal_code: string | null; address_line1: string | null;
  address_line2: string | null; tax_identifier: string | null; notes: string | null;
  acquisition_source_id: string | null; acquisition_source_name: string | null;
  source_lead_id: string | null; source_lead_code: string | null; source_lead_status: string | null;
};
type EmployeeOption = { id: string; employee_code: string; full_name: string };
type SourceOption = { id: string; name: string; slug: string; is_active: boolean };
type Meta = { sources: SourceOption[]; employees: EmployeeOption[]; default_country_code: string | null; default_currency: string | null };
type Summary = { total: number; active: number; inactive: number };
type PortalAccessStatus = { client_id: string; enabled: boolean; active_access_count: number; pending_invitation_count: number; has_email: boolean };
type PortalAccessStatusResponse = { can_manage: boolean; items: PortalAccessStatus[] };

const inputClass = "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500";
const textareaClass = "mt-2 min-h-24 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-neutral-500";

function text(form: FormData, key: string) { const value = String(form.get(key) ?? "").trim(); return value || null; }

export default function ClientsPage() {
  const router = useRouter();
  const { tenant } = useDashboardSession();
  const canManageClients = Boolean(tenant?.is_owner || tenant?.permissions.includes("*") || tenant?.permissions.includes("clients.manage"));
  const [clients, setClients] = useState<Client[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailTarget = useRef<string | null>(null);
  const savingRef = useRef(false);
  const directoryRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);
  const [statusFilter, setStatusFilter] = useState("");
  const [portalAccess, setPortalAccess] = useState<Record<string, PortalAccessStatus>>({});
  const [canManagePortalAccess, setCanManagePortalAccess] = useState(false);
  const [portalWorkingId, setPortalWorkingId] = useState<string | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit, isCurrent: () => boolean = () => true) => {
    const response = await fetch(`/api/crm${path}`, init);
    if (!isCurrent()) return null;
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    if (response.status === 403) throw new Error("Your company role does not have permission for clients.");
    const payload = await response.json().catch(() => null);
    if (!isCurrent()) return null;
    if (!response.ok) throw new Error(getApiErrorMessage(payload, "Client request failed."));
    return payload;
  }, [router]);

  const loadPortalStatuses = useCallback(async (clientIds: string[]) => {
    if (!clientIds.length) return;
    try {
      const response = await fetch(`/api/client-access?client_ids=${encodeURIComponent(clientIds.join(","))}`, { cache: "no-store" });
      if (response.status === 401) { router.replace("/login"); return; }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load client portal access.");
      const statusPayload = payload as PortalAccessStatusResponse;
      setCanManagePortalAccess(statusPayload.can_manage);
      setPortalAccess((current) => {
        const next = { ...current };
        for (const item of statusPayload.items) next[item.client_id] = item;
        return next;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load client portal access.");
    }
  }, [router]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: "30" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    return params.toString();
  }, [search, statusFilter]);

  const loadList = useCallback(async (background = false) => {
    const request = ++listRequest.current;
    if (background) setFiltering(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await api(`/clients?${queryString}`, undefined, () => request === listRequest.current) as { items: Client[]; next_cursor: string | null };
      if (request !== listRequest.current) return;
      setClients(page.items); setNextCursor(page.next_cursor);
      void loadPortalStatuses(page.items.map((item) => item.id));
    } catch (reason) { if (request === listRequest.current) setError(reason instanceof Error ? reason.message : "Unable to load clients."); }
    finally { if (request === listRequest.current) { setLoading(false); setFiltering(false); } }
  }, [api, loadPortalStatuses, queryString]);

  const loadSummary = useCallback(async () => {
    setSummary(await api("/clients/summary") as Summary);
  }, [api]);

  useEffect(() => {
    let active = true;
    void Promise.all([api("/clients/summary", undefined, () => active), canManageClients ? api("/meta", undefined, () => active) : Promise.resolve(null)]).then(([totals, crmMeta]) => {
      if (!active) return;
      setSummary(totals as Summary); setMeta(crmMeta as Meta | null);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load clients."); });
    return () => { active = false; };
  }, [api, canManageClients]);

  useEffect(() => { void loadList(true); return () => { listRequest.current += 1; }; }, [loadList]);

  useEffect(() => {
    const requestedEditId = new URLSearchParams(window.location.search).get("edit");
    if (requestedEditId) void openClient(requestedEditId);
    // Open-on-arrival only. Subsequent drawer state is local to this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAfterMutation() {
    await Promise.all([loadList(true), loadSummary()]);
  }

  async function refreshDetail(clientId: string) {
    const request = detailRequest.current;
    const payload = await api(`/clients/${clientId}/detail`, undefined, () => request === detailRequest.current && detailTarget.current === clientId) as ClientDetail;
    if (request !== detailRequest.current || detailTarget.current !== clientId) return;
    if (payload.id !== clientId) throw new Error("The returned client does not match the selected record.");
    setDetail(payload);
  }

  function closeClient() {
    if (savingRef.current) return;
    detailRequest.current += 1;
    detailTarget.current = null;
    setDetail(null);
    setDetailLoading(false);
  }

  useEffect(() => () => { detailRequest.current += 1; detailTarget.current = null; }, []);

  async function loadMore() {
    const request = listRequest.current;
    if (!nextCursor) return; setLoadingMore(true);
    try { const params = new URLSearchParams(queryString); params.set("cursor", nextCursor); const payload = await api(`/clients?${params}`, undefined, () => request === listRequest.current) as { items: Client[]; next_cursor: string | null }; if (request !== listRequest.current) return; setClients((current) => [...current, ...payload.items]); setNextCursor(payload.next_cursor); void loadPortalStatuses(payload.items.map((item) => item.id)); }
    catch (reason) { if (request === listRequest.current) setError(reason instanceof Error ? reason.message : "Unable to load more clients."); }
    finally { setLoadingMore(false); }
  }

  async function openClient(id: string) {
    if (!canManageClients || savingRef.current) return;
    setCreateOpen(false);
    const request = ++detailRequest.current;
    detailTarget.current = id;
    setDetail(null); setDetailLoading(true); setError(null);
    try { await refreshDetail(id); }
    catch (reason) { if (request === detailRequest.current) setError(reason instanceof Error ? reason.message : "Unable to load client."); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManageClients || savingRef.current) return; const formElement = event.currentTarget; const form = new FormData(formElement);
    savingRef.current = true; setSaving(true); setError(null); setMessage(null);
    try {
      await api("/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clientPayload(form)) });
      formElement.reset(); setCreateOpen(false); setMessage("Client created"); await refreshAfterMutation();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create client."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function updateClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManageClients || savingRef.current || !detail) return; const clientId = detail.id; const form = new FormData(event.currentTarget);
    savingRef.current = true; setSaving(true); setError(null); setMessage(null);
    try {
      await api(`/clients/${clientId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...clientPayload(form), status: detail.status }) });
      await Promise.all([refreshDetail(clientId), refreshAfterMutation()]); setMessage("Client updated");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update client."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function changeStatus() {
    if (!canManageClients || savingRef.current || !detail) return; const clientId = detail.id; const next = detail.status === "active" ? "inactive" : "active";
    savingRef.current = true; setSaving(true); setError(null);
    try {
      await api(`/clients/${clientId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
      await Promise.all([refreshDetail(clientId), refreshAfterMutation()]); setMessage(next === "active" ? "Client reactivated" : "Client marked inactive");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update client status."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function togglePortalAccess(client: Client) {
    const current = portalAccess[client.id];
    if (!current || !canManagePortalAccess || portalWorkingId !== null) return;
    if (!current.enabled && !current.has_email) {
      setError("Add an email or billing email to this client before enabling portal access.");
      return;
    }

    setPortalWorkingId(client.id); setError(null); setMessage(null);
    try {
      const response = current.enabled
        ? await fetch(`/api/client-access?client_id=${encodeURIComponent(client.id)}`, { method: "DELETE" })
        : await fetch("/api/client-access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: client.id, is_primary_contact: true }),
          });
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (response.status === 401) { router.replace("/login"); return; }
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to update client portal access.");
      setMessage(current.enabled ? `Portal access disabled for ${client.display_name}` : `Portal access enabled for ${client.display_name}`);
      await loadPortalStatuses([client.id]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update client portal access.");
    } finally {
      setPortalWorkingId(null);
    }
  }

  function clientPayload(form: FormData) {
    return {
      client_type: text(form, "client_type") ?? "company", display_name: text(form, "display_name"), legal_name: text(form, "legal_name"),
      contact_name: text(form, "contact_name"), email: text(form, "email"), billing_email: text(form, "billing_email"), phone: text(form, "phone"),
      whatsapp: text(form, "whatsapp"), website: text(form, "website"), country_code: text(form, "country_code"), state_region: text(form, "state_region"),
      city: text(form, "city"), postal_code: text(form, "postal_code"), address_line1: text(form, "address_line1"), address_line2: text(form, "address_line2"),
      tax_identifier: text(form, "tax_identifier"), currency: text(form, "currency"), acquisition_source_id: text(form, "acquisition_source_id"), assigned_employee_id: text(form, "assigned_employee_id"), notes: text(form, "notes"),
    };
  }

  return <RelationshipPage className="clients-directory-workspace">
    <RelationshipHeader eyebrow="Business relationships" title="Clients" description="One client record. Every conversation, project and financial relationship in context." actions={canManageClients ? <button onClick={() => { if (savingRef.current) return; closeClient(); setError(null); setCreateOpen(true); }} className="relationship-primary"><Plus aria-hidden="true" /> Add client</button> : null} />
    <dl className="relationship-metrics clients-summary" aria-label="Client summary">
      <RelationshipMetric label="Total clients" value={summary?.total ?? 0} note="Across your directory" />
      <RelationshipMetric label="Active" value={summary?.active ?? 0} note="Current relationships" />
      <RelationshipMetric label="Inactive" value={summary?.inactive ?? 0} note="Retained client records" />
    </dl>
    {!canManageClients ? <RelationshipNotice tone="info">Read-only client directory. Your role can view records but cannot create or edit them.</RelationshipNotice> : null}
    {message ? <RelationshipNotice tone="success">{message}</RelationshipNotice> : null}
    {error ? <RelationshipNotice tone="error">{error}</RelationshipNotice> : null}
    <section ref={directoryRef} tabIndex={-1} className="clients-directory-surface" aria-label="Client directory">
      <div className="clients-directory-title"><div><h2>Client directory</h2><p>Find a relationship, review its workspace or update the master record.</p></div><span>Portal access is managed in the client profile</span></div>
      <div className="clients-directory-filters">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(searchDraft.trim()); }} className="clients-search"><Search aria-hidden="true" /><input aria-label="Search clients" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search clients..." /></form>
        <select aria-label="Client status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <button onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter(""); }} className="relationship-secondary">Reset</button>
      </div>
      {filtering ? <div className="clients-filtering" role="status" aria-label="Updating client results"><span /></div> : null}
      {loading ? <div className="clients-directory-empty" role="status"><Loader2 className="animate-spin" aria-hidden="true" /><p>Loading clients...</p></div> : clients.length === 0 ? <div className="clients-directory-empty"><Building2 aria-hidden="true" /><h2>No clients found</h2><p>Convert a CRM lead or create a client directly.</p></div> : <>
        <ClientDirectory canEdit={canManageClients} clients={clients} portalAccess={portalAccess} canManage={canManagePortalAccess} workingId={portalWorkingId} onToggle={togglePortalAccess} onView={(client) => router.push(`/dashboard/clients/${encodeURIComponent(client.id)}`)} onEdit={(client) => void openClient(client.id)} />
        <div className="clients-directory-footer"><p>{clients.length} client records loaded</p>{nextCursor ? <button disabled={loadingMore} onClick={() => void loadMore()} className="relationship-secondary">{loadingMore ? "Loading..." : "Load more"}</button> : null}</div>
      </>}
    </section>

  {canManageClients && createOpen && meta ? <Modal returnFocusRef={directoryRef} title="Add client" busy={saving} onClose={() => { if (!savingRef.current) setCreateOpen(false); }}><ClientForm meta={meta} saving={saving} error={error} onSubmit={createClient} onCancel={() => { if (!savingRef.current) setCreateOpen(false); }} /></Modal> : null}
  {canManageClients && (detailLoading || detail) ? <ClientDrawer returnFocusRef={directoryRef} detail={detail} loading={detailLoading} meta={meta} saving={saving} onClose={closeClient} error={error} onSave={updateClient} onStatus={() => void changeStatus()} onQuotation={() => { if (!savingRef.current && detail) router.push(`/dashboard/quotations?client_id=${encodeURIComponent(detail.id)}`); }} /> : null}
  </RelationshipPage>;
}

function ClientForm({ meta, detail, saving, error, onSubmit, onCancel }: { meta: Meta; detail?: ClientDetail | null; saving: boolean; error?: string | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel?: () => void }) {
  const employeeOptions = [{ value: "", label: "Unassigned" }, ...meta.employees.map((item) => ({ value: item.id, label: `${item.full_name} · ${item.employee_code}` }))];
  const sourceOptions = [{ value: "", label: "No source / Unknown" }, ...meta.sources.filter((item) => item.is_active || item.id === detail?.acquisition_source_id).map((item) => ({ value: item.id, label: item.is_active ? item.name : `${item.name} (Inactive)` }))];
  return <form key={detail?.id ?? "new"} onSubmit={onSubmit} className="client-record-form space-y-5">{error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}<div className="grid gap-4 sm:grid-cols-2"><Select label="Client type" name="client_type" options={[["company", "Company"], ["individual", "Individual"]]} defaultValue={detail?.client_type ?? "company"} /><Field label="Display name" name="display_name" required defaultValue={detail?.display_name} /><Field label="Legal name" name="legal_name" defaultValue={detail?.legal_name} /><Field label="Contact person" name="contact_name" defaultValue={detail?.contact_name} /><Field label="Email" name="email" type="email" defaultValue={detail?.email} /><Field label="Billing email" name="billing_email" type="email" defaultValue={detail?.billing_email} /><Field label="Phone" name="phone" type="tel" placeholder="+44 20 7946 0958" defaultValue={detail?.phone} /><Field label="WhatsApp" name="whatsapp" type="tel" placeholder="+880 1712 345678" defaultValue={detail?.whatsapp} /><Field label="Website" name="website" type="url" defaultValue={detail?.website} /><SearchableSelect label="Client source" name="acquisition_source_id" defaultValue={detail?.acquisition_source_id ?? ""} options={sourceOptions} searchPlaceholder="Search Fiverr, Upwork, referral..." /><SearchableSelect label="Country" name="country_code" defaultValue={detail ? detail.country_code ?? "" : meta.default_country_code} options={COUNTRY_OPTIONS} searchPlaceholder="Search country..." /><SearchableSelect label="Currency" name="currency" defaultValue={detail ? detail.currency ?? "" : meta.default_currency} options={CURRENCY_OPTIONS} searchPlaceholder="Search currency..." /><Field label="Tax / VAT identifier" name="tax_identifier" defaultValue={detail?.tax_identifier} /><Field label="State / Province / Region" name="state_region" defaultValue={detail?.state_region} /><Field label="City" name="city" defaultValue={detail?.city} /><Field label="Postal / ZIP code" name="postal_code" defaultValue={detail?.postal_code} /><SearchableSelect label="Assigned to" name="assigned_employee_id" defaultValue={detail?.assigned_employee_id ?? ""} options={employeeOptions} searchPlaceholder="Search employee..." /><div className="sm:col-span-2"><Field label="Address line 1" name="address_line1" defaultValue={detail?.address_line1} /></div><div className="sm:col-span-2"><Field label="Address line 2" name="address_line2" defaultValue={detail?.address_line2} /></div></div><label className="block text-sm font-medium">Notes<textarea name="notes" defaultValue={detail?.notes ?? ""} className={textareaClass} /></label><div className="grid grid-cols-2 gap-2 border-t pt-5 sm:flex sm:justify-end">{onCancel ? <button type="button" disabled={saving} onClick={onCancel} className="h-11 w-full rounded-xl border px-4 text-sm font-semibold sm:w-auto">Cancel</button> : null}<button disabled={saving} className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto ${onCancel ? "" : "col-span-2"}`}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{detail ? "Save changes" : "Create client"}</button></div></form>;
}

function ClientDrawer({ returnFocusRef, detail, loading, meta, saving, error, onClose, onSave, onStatus, onQuotation }: { returnFocusRef?: React.RefObject<HTMLElement | null>; detail: ClientDetail | null; loading: boolean; meta: Meta | null; saving: boolean; error?: string | null; onClose: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void; onStatus: () => void; onQuotation: () => void }) {
  return <div className="client-editor-backdrop fixed inset-0 z-50 bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><ProjectDialogFocus returnFocusRef={returnFocusRef} busy={saving} onClose={onClose}><aside role="dialog" aria-modal="true" aria-label="Edit client record" className="client-editor ml-auto h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white px-4 py-4 sm:px-6 sm:py-5"><div className="min-w-0"><p className="text-xs uppercase tracking-wide text-neutral-400">Client master</p><h2 className="mt-1 break-words text-lg font-semibold sm:text-xl">{detail?.display_name ?? "Loading..."}</h2></div><button aria-label="Close client editor" disabled={saving} onClick={onClose} className="flex size-10 shrink-0 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{loading || !detail || !meta ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : <div className="space-y-5 p-4 sm:space-y-6 sm:p-6"><div className="flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="min-w-0"><p className="text-xs uppercase tracking-wide text-neutral-400">{detail.client_code}</p><div className="mt-2"><Status status={detail.status} /></div>{detail.source_lead_code ? <p className="mt-2 break-words text-xs text-neutral-500">Originated from CRM · {detail.source_lead_code} · {detail.source_lead_status}</p> : <p className="mt-2 break-words text-xs text-neutral-400">Direct client record{detail.acquisition_source_name ? ` · ${detail.acquisition_source_name}` : ""}</p>}</div><div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"><button disabled={saving || detail.status !== "active"} onClick={onQuotation} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-30 sm:px-4 sm:text-sm"><FileText className="size-4 shrink-0" /> <span className="truncate">Quotation</span></button><button disabled={saving} onClick={onStatus} className="h-10 rounded-xl border px-3 text-xs font-semibold sm:px-4 sm:text-sm">{detail.status === "active" ? "Deactivate" : "Activate"}</button></div></div><ClientForm meta={meta} detail={detail} saving={saving} error={error} onSubmit={onSave} /></div>}</aside></ProjectDialogFocus></div>;
}

function PortalAccessToggle(props: { status?: PortalAccessStatus; canManage: boolean; working: boolean; onToggle: () => void }) {
  const { status } = props;
  if (!status) return <span className="text-xs text-neutral-400">Loading...</span>;
  const pending = !status.enabled && status.pending_invitation_count > 0;
  const label = status.enabled ? "Enabled" : pending ? "Invitation pending" : !status.has_email ? "No email" : "Disabled";
  const className = status.enabled
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : pending
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-neutral-200 bg-neutral-50 text-neutral-500";
  const detail = status.enabled
    ? `${status.active_access_count} active portal user${status.active_access_count === 1 ? "" : "s"}`
    : pending
      ? `${status.pending_invitation_count} pending invitation${status.pending_invitation_count === 1 ? "" : "s"}`
      : "Manage from client profile";
  return <div title={`${detail}. Open View → Client Access to manage.`}><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>{label}</span><p className="mt-1 text-[11px] text-neutral-400">{detail}</p></div>;
}

function Status({ status }: { status: string }) { return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs capitalize ${status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-neutral-50 text-neutral-500"}`}>{status}</span>; }
const clientFieldLimits: Record<string, number> = { display_name: 220, legal_name: 220, contact_name: 180, phone: 64, whatsapp: 64, website: 500, state_region: 120, city: 120, postal_code: 32, address_line1: 250, address_line2: 250, tax_identifier: 180 };
function Field({ label, name, type = "text", required = false, defaultValue, placeholder }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string | null; placeholder?: string }) { return <label className="block text-sm font-medium">{label}<input data-project-dialog-initial={name === "display_name" ? true : undefined} aria-label={label} aria-describedby={type === "tel" ? `client-${name}-hint` : undefined} name={name} type={type} required={required} defaultValue={defaultValue ?? ""} maxLength={clientFieldLimits[name]} placeholder={placeholder} className={inputClass} />{type === "tel" ? <span id={`client-${name}-hint`} className="mt-1 block text-xs font-normal text-neutral-500">Include country code; spaces and extensions are supported.</span> : null}</label>; }
function Select({ label, name, options, defaultValue = "" }: { label: string; name: string; options: Array<[string, string]>; defaultValue?: string }) { return <label className="block text-sm font-medium">{label}<select name={name} defaultValue={defaultValue} className={inputClass}>{options.map(([value, label]) => <option key={`${value}-${label}`} value={value}>{label}</option>)}</select></label>; }
function Modal({ returnFocusRef, title, busy = false, onClose, children }: { returnFocusRef?: React.RefObject<HTMLElement | null>; title: string; busy?: boolean; onClose: () => void; children: React.ReactNode }) { return <div className="client-create-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><ProjectDialogFocus returnFocusRef={returnFocusRef} busy={busy} onClose={onClose}><div role="dialog" aria-modal="true" aria-label={title} className="client-create-dialog h-[100dvh] max-h-none w-full max-w-4xl overflow-y-auto bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-4 sm:px-6 sm:py-5"><h2 className="text-lg font-semibold sm:text-xl">{title}</h2><button aria-label="Close client form" disabled={busy} onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="p-4 sm:p-6">{children}</div></div></ProjectDialogFocus></div>; }

function ClientDirectory({ canEdit, clients, portalAccess, canManage, workingId, onToggle, onView, onEdit }: { canEdit: boolean; clients: Client[]; portalAccess: Record<string, PortalAccessStatus>; canManage: boolean; workingId: string | null; onToggle: (client: Client) => Promise<void>; onView: (client: Client) => void; onEdit: (client: Client) => void }) {
  return <div className="clients-register"><table><caption className="sr-only">Client records, contact details, ownership and portal access</caption><thead><tr><th scope="col">Client relationship</th><th scope="col">Contact</th><th scope="col">Assigned / region</th><th scope="col">Portal access</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{clients.map((client) => <tr key={client.id}>
    <td className="clients-register-identity" data-label="Client"><div className="client-identity"><span className="client-type-icon" aria-hidden="true">{client.client_type === "company" ? <Building2 /> : <UserRound />}</span><div><button className="client-name-link" onClick={() => onView(client)}>{client.display_name}</button><p>{client.client_code} <span>· {client.client_type}</span></p></div></div><Status status={client.status} /></td>
    <td data-label="Contact"><p>{client.contact_name ?? "—"}</p><p className="client-secondary">{client.email ?? client.phone ?? "No contact"}</p></td>
    <td data-label="Assigned / region"><p>{client.assigned_employee_name ?? "Unassigned"}</p><p className="client-secondary">{client.country_code ?? "—"}{client.currency ? ` · ${client.currency}` : ""}</p></td>
    <td data-label="Portal access"><PortalAccessToggle status={portalAccess[client.id]} canManage={canManage} working={workingId === client.id} onToggle={() => void onToggle(client)} /></td>
    <td className="clients-register-actions"><button className="client-view" onClick={() => onView(client)} aria-label={`View ${client.display_name}`}>View <ArrowUpRight aria-hidden="true" /></button>{canEdit ? <button onClick={() => onEdit(client)} aria-label={`Edit ${client.display_name}`}>Edit</button> : null}</td>
  </tr>)}</tbody></table></div>;
}
