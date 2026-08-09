"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, History, Loader2, Search, X } from "lucide-react";

type ActivityItem = {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  outcome: string;
  message: string | null;
  created_at: string;
};

type ActivityDetail = ActivityItem & {
  organization_id: string | null;
  scope: string;
  request_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  http_method: string | null;
  request_path: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
};

type ActivityPage = { items: ActivityItem[]; next_cursor: string | null };
type Filters = { action: string; entityType: string; outcome: string; dateFrom: string; dateTo: string };

const emptyFilters: Filters = { action: "", entityType: "", outcome: "", dateFrom: "", dateTo: "" };
const inputClass = "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";

export default function TenantActivityLogsPage() {
  const router = useRouter();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<ActivityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(cursor?: string, append = false, activeFilters = filters) {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    if (activeFilters.action) query.set("action", activeFilters.action);
    if (activeFilters.entityType) query.set("entity_type", activeFilters.entityType);
    if (activeFilters.outcome) query.set("outcome", activeFilters.outcome);
    if (activeFilters.dateFrom) query.set("date_from", activeFilters.dateFrom);
    if (activeFilters.dateTo) query.set("date_to", activeFilters.dateTo);
    const response = await fetch(`/api/tenant/activity-logs?${query.toString()}`, { cache: "no-store" });
    if (response.status === 401) { router.replace("/login"); return; }
    if (response.status === 403) { router.replace("/dashboard"); return; }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.detail ?? "Unable to load activity logs.");
      setLoading(false); setLoadingMore(false); return;
    }
    const page = (await response.json()) as ActivityPage;
    setItems((current) => (append ? [...current, ...page.items] : page.items));
    setNextCursor(page.next_cursor);
    setError(null); setLoading(false); setLoadingMore(false);
  }

  useEffect(() => { void load(undefined, false, emptyFilters); }, []);

  async function openDetail(id: string) {
    setDetailLoading(true); setError(null);
    const response = await fetch(`/api/tenant/activity-logs/${id}`, { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.detail ?? "Unable to load activity detail.");
      setDetailLoading(false); return;
    }
    setSelected((await response.json()) as ActivityDetail);
    setDetailLoading(false);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setFilters(draft); setLoading(true); setSelected(null);
    void load(undefined, false, draft);
  }

  function resetFilters() {
    setDraft(emptyFilters); setFilters(emptyFilters); setLoading(true); setSelected(null);
    void load(undefined, false, emptyFilters);
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1400px]">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div><Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" /> Company dashboard</Link><h1 className="mt-3 text-3xl font-semibold tracking-tight">Company Activity Logs</h1><p className="mt-2 text-sm text-neutral-500">Admin-only audit history for the currently selected company workspace.</p></div>
          <div className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm text-neutral-600"><History className="size-4" /> Tenant scoped</div>
        </header>

        <form onSubmit={applyFilters} className="mt-6 grid gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_180px_170px_170px_auto]">
          <input className={inputClass} value={draft.action} onChange={(e) => setDraft((v) => ({ ...v, action: e.target.value }))} placeholder="Action contains…" />
          <input className={inputClass} value={draft.entityType} onChange={(e) => setDraft((v) => ({ ...v, entityType: e.target.value }))} placeholder="Entity type" />
          <select className={inputClass} value={draft.outcome} onChange={(e) => setDraft((v) => ({ ...v, outcome: e.target.value }))}><option value="">All outcomes</option><option value="success">Success</option><option value="failure">Failure</option></select>
          <input type="date" className={inputClass} value={draft.dateFrom} onChange={(e) => setDraft((v) => ({ ...v, dateFrom: e.target.value }))} />
          <input type="date" className={inputClass} value={draft.dateTo} onChange={(e) => setDraft((v) => ({ ...v, dateTo: e.target.value }))} />
          <div className="flex gap-2"><button className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Search className="size-4" /> Apply</button><button type="button" onClick={resetFilters} className="h-11 rounded-xl border px-4 text-sm font-semibold">Reset</button></div>
        </form>

        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
          {loading ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : null}
          {!loading ? <>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-6 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Entity</th><th className="px-4 py-3 font-medium">Actor</th><th className="px-4 py-3 font-medium">Outcome</th><th className="px-6 py-3 font-medium">Message</th></tr></thead><tbody className="divide-y">{items.map((item) => <tr key={item.id} onClick={() => void openDetail(item.id)} className="cursor-pointer align-top hover:bg-neutral-50"><td className="whitespace-nowrap px-6 py-4 text-xs text-neutral-500">{new Date(item.created_at).toLocaleString()}</td><td className="px-4 py-4 font-medium">{item.action}</td><td className="px-4 py-4 text-neutral-600">{item.entity_type ?? "—"}{item.entity_id ? <p className="mt-1 max-w-44 truncate text-xs text-neutral-400">{item.entity_id}</p> : null}</td><td className="px-4 py-4 text-neutral-600">{item.actor_type}{item.actor_user_id ? <p className="mt-1 max-w-44 truncate text-xs text-neutral-400">{item.actor_user_id}</p> : null}</td><td className="px-4 py-4"><span className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize">{item.outcome}</span></td><td className="max-w-sm px-6 py-4 text-neutral-600">{item.message ?? "—"}</td></tr>)}</tbody></table></div>
            <div className="divide-y md:hidden">{items.map((item) => <button key={item.id} type="button" onClick={() => void openDetail(item.id)} className="block w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.action}</p><p className="mt-1 text-xs text-neutral-400">{new Date(item.created_at).toLocaleString()}</p></div><span className="rounded-full border px-2 py-1 text-xs capitalize">{item.outcome}</span></div><p className="mt-3 text-sm text-neutral-600">{item.message ?? item.entity_type ?? "Activity"}</p></button>)}</div>
            {items.length === 0 ? <div className="px-6 py-12 text-center text-neutral-400">No activity logs match the current filters.</div> : null}
          </> : null}
          {nextCursor ? <div className="flex justify-center border-t px-6 py-4"><button type="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); void load(nextCursor, true); }} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"><ChevronDown className="size-4" />{loadingMore ? "Loading…" : "Load older activity"}</button></div> : null}
        </section>
      </div>

      {(selected || detailLoading) ? <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => !detailLoading && setSelected(null)}><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>{detailLoading ? <div className="flex h-full items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : selected ? <><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-neutral-500">Audit detail</p><h2 className="mt-1 text-xl font-semibold">{selected.action}</h2></div><button onClick={() => setSelected(null)} className="flex size-9 items-center justify-center rounded-lg border"><X className="size-4" /></button></div><div className="mt-6 grid gap-4 text-sm sm:grid-cols-2"><Detail label="Time" value={new Date(selected.created_at).toLocaleString()} /><Detail label="Outcome" value={selected.outcome} /><Detail label="Actor" value={`${selected.actor_type}${selected.actor_user_id ? ` · ${selected.actor_user_id}` : ""}`} /><Detail label="Entity" value={`${selected.entity_type ?? "—"}${selected.entity_id ? ` · ${selected.entity_id}` : ""}`} /><Detail label="Request" value={`${selected.http_method ?? "—"} ${selected.request_path ?? ""}`} /><Detail label="IP address" value={selected.ip_address ?? "—"} /></div>{selected.message ? <section className="mt-6 rounded-xl bg-neutral-50 p-4 text-sm">{selected.message}</section> : null}<JsonBlock title="Before" value={selected.before_data} /><JsonBlock title="After" value={selected.after_data} /><JsonBlock title="Metadata" value={selected.metadata_json} /></> : null}</aside></div> : null}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-1 break-all text-neutral-700">{value}</p></div>; }
function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> | null }) { if (!value) return null; return <section className="mt-6"><h3 className="text-sm font-semibold">{title}</h3><pre className="mt-2 overflow-x-auto rounded-xl bg-neutral-950 p-4 text-xs leading-5 text-neutral-100">{JSON.stringify(value, null, 2)}</pre></section>; }
