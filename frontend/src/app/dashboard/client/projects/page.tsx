"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, FolderKanban, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, ClientPortalPageHeader, ClientPortalStatusBadge, formatPortalDate, formatPortalMoney } from "@/components/client-portal-ui";
import type { ClientPortalProject } from "@/lib/client-portal-types";

export default function ClientProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ClientPortalProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/client-portal/projects", { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load projects");
        if (active) setProjects(Array.isArray(payload) ? payload : []);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load projects");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter((project) => `${project.project_number} ${project.name} ${project.status}`.toLowerCase().includes(term));
  }, [projects, search]);

  if (loading) return <ClientPortalLoading />;
  if (error) return <ClientPortalError message={error} />;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1300px]">
    <ClientPortalPageHeader title="Projects" description="Track the projects linked to your client account, including delivery progress and key dates." />

    <div className="mt-7 grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">Total projects</p><p className="mt-2 text-3xl font-semibold">{projects.length}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">In progress</p><p className="mt-2 text-3xl font-semibold">{projects.filter((project) => project.status === "in_progress").length}</p></div>
      <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">Completed</p><p className="mt-2 text-3xl font-semibold">{projects.filter((project) => project.status === "completed").length}</p></div>
    </div>

    <div className="mt-5 rounded-2xl border bg-white p-4 sm:p-5">
      <label className="relative block max-w-md"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects" className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400" /></label>
    </div>

    <div className="mt-5 space-y-4">
      {filtered.length ? filtered.map((project) => <Link key={project.id} href={`/dashboard/client/projects/${project.id}`} className="block rounded-2xl border bg-white p-5 transition hover:border-neutral-300 hover:shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><FolderKanban className="size-4 text-neutral-400" /><span className="text-xs font-medium text-neutral-400">{project.project_number}</span><ClientPortalStatusBadge status={project.status} /></div><h2 className="mt-2 text-lg font-semibold">{project.name}</h2>{project.description ? <p className="mt-2 line-clamp-2 max-w-3xl text-sm text-neutral-500">{project.description}</p> : null}</div>
          <ArrowRight className="size-5 shrink-0 text-neutral-300" />
        </div>
        <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-4">
          <div><p className="text-xs text-neutral-400">Progress</p><p className="mt-1 text-sm font-semibold">{project.progress_percent}%</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, project.progress_percent))}%` }} /></div></div>
          <div><p className="text-xs text-neutral-400">Start</p><p className="mt-1 flex items-center gap-1.5 text-sm font-medium"><CalendarDays className="size-3.5 text-neutral-400" />{formatPortalDate(project.planned_start_date)}</p></div>
          <div><p className="text-xs text-neutral-400">Due</p><p className="mt-1 text-sm font-medium">{formatPortalDate(project.due_date)}</p></div>
          <div><p className="text-xs text-neutral-400">Contract value</p><p className="mt-1 text-sm font-semibold">{formatPortalMoney(project.contract_value, project.currency)}</p></div>
        </div>
      </Link>) : <div className="rounded-2xl border border-dashed bg-white px-5 py-14 text-center text-sm text-neutral-400">{projects.length ? "No projects match your search." : "No projects are linked to your client account yet."}</div>}
    </div>
  </div></main>;
}
