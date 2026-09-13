"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Clock3, Loader2, RefreshCw } from "lucide-react";

type Item = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  href: string;
  due_date: string | null;
};

type Filter = "all" | "overdue" | "due";

export default function NotificationsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  async function load(showLoading = true) {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/notifications", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load notifications.");
      setItems(payload?.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load notifications.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const overdueCount = useMemo(() => items.filter((item) => item.kind === "task_overdue").length, [items]);
  const dueCount = items.length - overdueCount;
  const visibleItems = useMemo(() => items.filter((item) => filter === "all" || (filter === "overdue" ? item.kind === "task_overdue" : item.kind === "task_due")), [filter, items]);

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-5xl">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm text-neutral-500">Work that needs your attention</p><h1 className="mt-1 text-3xl font-semibold">Notifications</h1><p className="mt-2 max-w-2xl text-sm text-neutral-500">Deadline alerts come directly from your assigned tasks. Open an alert to review the task and update your progress.</p></div><button type="button" onClick={() => void load(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium hover:bg-neutral-50"><RefreshCw className="size-4" />Refresh</button></header>

    <section className="mt-6 grid gap-3 sm:grid-cols-3"><Metric icon={Bell} label="Needs attention" value={items.length} /><Metric icon={AlertTriangle} label="Overdue" value={overdueCount} critical={overdueCount > 0} /><Metric icon={Clock3} label="Due soon" value={dueCount} /></section>

    <div className="mt-5 flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">{([['all','All'],['overdue','Overdue'],['due','Due soon']] as [Filter,string][]).map(([value,label])=><button key={value} type="button" onClick={()=>setFilter(value)} className={`rounded-xl px-4 py-2 text-sm font-medium ${filter===value?'bg-neutral-950 text-white':'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950'}`}>{label}</button>)}</div>

    {loading ? <div className="mt-10 flex justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : error ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : <div className="mt-5 space-y-3">{visibleItems.map((item) => <Link key={item.id} href={item.href} className="flex gap-4 rounded-2xl border bg-white p-5 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50">{item.severity === "critical" ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" /> : <Bell className="mt-0.5 size-5 shrink-0 text-amber-500" />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.title}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.severity === "critical" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{item.kind === "task_overdue" ? "Overdue" : "Due soon"}</span></div><p className="mt-1 text-sm text-neutral-500">{item.message}</p><p className="mt-2 text-xs font-medium text-neutral-400">Open task in My Work</p></div></Link>)}{!visibleItems.length ? <div className="rounded-2xl border bg-white p-10 text-center"><CheckCircle2 className="mx-auto size-8 text-emerald-500" /><p className="mt-3 font-semibold">You are all caught up</p><p className="mt-1 text-sm text-neutral-500">No task deadlines match this view.</p></div> : null}</div>}
  </div></main>;
}

function Metric({ icon: Icon, label, value, critical = false }: { icon: typeof Bell; label: string; value: number; critical?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-4 shadow-sm ${critical ? "border-red-200" : ""}`}><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className={`size-4 ${critical ? "text-red-500" : "text-neutral-300"}`} /></div><p className={`mt-3 text-2xl font-semibold ${critical ? "text-red-700" : ""}`}>{value}</p></div>;
}
