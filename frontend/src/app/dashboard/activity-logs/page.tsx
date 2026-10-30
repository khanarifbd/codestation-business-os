"use client";

import "@/components/company/administration-workspace.css";

import Link from "next/link";
import { useActivityLogRead } from "@/hooks/use-activity-log-read";
import { useAdministrationReadOwner } from "@/hooks/use-administration-read-owner";
import { ActivityReadDrawer } from "@/components/company/activity-read-drawer";
import { ArrowLeft, ChevronDown, History, Loader2, Search } from "lucide-react";

const inputClass = "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";

export default function TenantActivityLogsPage() {
  const owner=useAdministrationReadOwner();
  if(owner.loading||!owner.tenant)return <main role="status">Loading activity workspace…</main>;
  return <ActivityLogsContent key={owner.key}/>;
}
function ActivityLogsContent() {
  const {items,nextCursor,loading,loadingMore,verified,error,draft,setDraft,selected,detailLoading,detailError,detailId,detailVersion,closeDetail,load,loadMore,openDetail,applyFilters,resetFilters}=useActivityLogRead();
  return (
    <main className="administration-workspace activity-log-workspace min-h-screen bg-[var(--app-canvas)] text-neutral-950">
      <div className="administration-content" inert={Boolean(detailId)}>
        <header className="administration-header">
          <div><Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" /> Company dashboard</Link><p className="administration-eyebrow">Workspace governance</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Company Activity Logs</h1><p className="mt-2 text-sm text-neutral-500">Admin-only audit history for the currently selected company workspace.</p></div>
          <div className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm text-neutral-600"><History className="size-4" /> Tenant scoped</div>
        </header>

        <form onSubmit={applyFilters} className="activity-filter-bar">
          <input aria-label="Action contains" className={inputClass} value={draft.action} onChange={(e) => setDraft((v) => ({ ...v, action: e.target.value }))} placeholder="Action contains…" />
          <input aria-label="Entity type" className={inputClass} value={draft.entityType} onChange={(e) => setDraft((v) => ({ ...v, entityType: e.target.value }))} placeholder="Entity type" />
          <select aria-label="Outcome" className={inputClass} value={draft.outcome} onChange={(e) => setDraft((v) => ({ ...v, outcome: e.target.value }))}><option value="">All outcomes</option><option value="success">Success</option><option value="failure">Failure</option></select>
          <input type="date" aria-label="From date" className={inputClass} value={draft.dateFrom} onChange={(e) => setDraft((v) => ({ ...v, dateFrom: e.target.value }))} />
          <input type="date" aria-label="To date" className={inputClass} value={draft.dateTo} onChange={(e) => setDraft((v) => ({ ...v, dateTo: e.target.value }))} />
          <div className="flex gap-2"><button className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Search className="size-4" /> Apply</button><button type="button" onClick={resetFilters} className="h-11 rounded-xl border px-4 text-sm font-semibold">Reset</button></div>
        </form>

        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button type="button" className="ml-3 underline" onClick={()=>void load()}>Retry read</button></div> : null}

        <section className="activity-records" aria-label="Company activity records"><div className="activity-records-heading"><div><h2>Activity history</h2><p>Review actions and changes in this workspace.</p></div><span>{loading?"Loading records…":verified?`${items.length} records loaded`:"Records unavailable"}</span></div>
          {loading ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : null}
          {!loading && verified ? <>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-6 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Entity</th><th className="px-4 py-3 font-medium">Actor</th><th className="px-4 py-3 font-medium">Outcome</th><th className="px-6 py-3 font-medium">Message</th></tr></thead><tbody className="divide-y">{items.map((item) => <tr key={item.id} onClick={() => void openDetail(item.id)} className="cursor-pointer align-top hover:bg-neutral-50"><td className="whitespace-nowrap px-6 py-4 text-xs text-neutral-500">{new Date(item.created_at).toLocaleString()}</td><td className="px-4 py-4 font-medium"><button type="button" onClick={(event)=>{event.stopPropagation();void openDetail(item.id);}} className="activity-record-action" aria-label={`View activity ${item.action}`}>{item.action}</button></td><td className="px-4 py-4 text-neutral-600">{item.entity_type ?? "—"}{item.entity_id ? <p className="mt-1 max-w-44 truncate text-xs text-neutral-400">{item.entity_id}</p> : null}</td><td className="px-4 py-4 text-neutral-600">{item.actor_type}{item.actor_user_id ? <p className="mt-1 max-w-44 truncate text-xs text-neutral-400">{item.actor_user_id}</p> : null}</td><td className="px-4 py-4"><span className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize">{item.outcome}</span></td><td className="max-w-sm px-6 py-4 text-neutral-600">{item.message ?? "—"}</td></tr>)}</tbody></table></div>
            <div className="divide-y md:hidden">{items.map((item) => <button key={item.id} type="button" onClick={() => void openDetail(item.id)} className="block w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.action}</p><p className="mt-1 text-xs text-neutral-400">{new Date(item.created_at).toLocaleString()}</p></div><span className="rounded-full border px-2 py-1 text-xs capitalize">{item.outcome}</span></div><p className="mt-3 text-sm text-neutral-600">{item.message ?? item.entity_type ?? "Activity"}</p></button>)}</div>
            {items.length === 0 ? <div className="px-6 py-12 text-center text-neutral-400">No activity logs match the current filters.</div> : null}
          </> : null}
          {nextCursor && verified ? <div className="flex justify-center border-t px-6 py-4"><button type="button" disabled={loadingMore} onClick={loadMore} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"><ChevronDown className="size-4" />{loadingMore ? "Loading…" : "Load older activity"}</button></div> : null}
        </section>
      </div>

      {detailId ? <ActivityReadDrawer key={detailVersion} onClose={closeDetail}>{detailLoading ? <div className="flex h-full items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : detailError ? <div role="alert">{detailError}<button type="button" className="ml-3 underline" onClick={()=>void openDetail(detailId!)}>Retry detail read</button></div> : selected ? <><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-neutral-500">Audit detail</p><h2 className="mt-1 text-xl font-semibold">{selected.action}</h2></div></div><div className="mt-6 grid gap-4 text-sm sm:grid-cols-2"><Detail label="Time" value={new Date(selected.created_at).toLocaleString()} /><Detail label="Outcome" value={selected.outcome} /><Detail label="Actor" value={`${selected.actor_type}${selected.actor_user_id ? ` · ${selected.actor_user_id}` : ""}`} /><Detail label="Entity" value={`${selected.entity_type ?? "—"}${selected.entity_id ? ` · ${selected.entity_id}` : ""}`} /><Detail label="Request" value={`${selected.http_method ?? "—"} ${selected.request_path ?? ""}`} /><Detail label="IP address" value={selected.ip_address ?? "—"} /></div>{selected.message ? <section className="mt-6 rounded-xl bg-neutral-50 p-4 text-sm">{selected.message}</section> : null}<JsonBlock title="Before" value={selected.before_data} /><JsonBlock title="After" value={selected.after_data} /><JsonBlock title="Metadata" value={selected.metadata_json} /></> : null}</ActivityReadDrawer> : null}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-1 break-all text-neutral-700">{value}</p></div>; }
function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> | null }) { if (!value) return null; return <section className="mt-6"><h3 className="text-sm font-semibold">{title}</h3><pre className="mt-2 overflow-x-auto rounded-xl bg-neutral-950 p-4 text-xs leading-5 text-neutral-100">{JSON.stringify(value, null, 2)}</pre></section>; }
