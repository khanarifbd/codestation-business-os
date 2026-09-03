"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CircleDollarSign, FolderKanban, Gauge } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { ClientPortalError, ClientPortalLoading, ClientPortalPageHeader, ClientPortalStatusBadge, formatPortalDate, formatPortalMoney } from "@/components/client-portal-ui";
import type { ClientPortalProject } from "@/lib/client-portal-types";

export default function ClientProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ClientPortalProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/client-portal/projects/${encodeURIComponent(params.projectId)}`, { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load project");
        if (active) setProject(payload as ClientPortalProject);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load project");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [params.projectId, router]);

  if (loading) return <ClientPortalLoading />;
  if (!project) return <ClientPortalError message={error ?? "Project not found"} />;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1100px]">
    <ClientPortalPageHeader title={project.name} description="Client-safe project overview. Internal tasks, work logs, credentials and private team data are not exposed here." backHref="/dashboard/client/projects" />

    <div className="mt-6 flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-neutral-400">{project.project_number}</span><ClientPortalStatusBadge status={project.status} /></div>

    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2 text-neutral-400"><Gauge className="size-4" /><p className="text-xs font-medium uppercase tracking-[0.12em]">Progress</p></div><p className="mt-3 text-3xl font-semibold">{project.progress_percent}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, project.progress_percent))}%` }} /></div></div>
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2 text-neutral-400"><CalendarDays className="size-4" /><p className="text-xs font-medium uppercase tracking-[0.12em]">Planned start</p></div><p className="mt-3 text-lg font-semibold">{formatPortalDate(project.planned_start_date)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2 text-neutral-400"><CalendarDays className="size-4" /><p className="text-xs font-medium uppercase tracking-[0.12em]">Due date</p></div><p className="mt-3 text-lg font-semibold">{formatPortalDate(project.due_date)}</p></div>
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2 text-neutral-400"><CircleDollarSign className="size-4" /><p className="text-xs font-medium uppercase tracking-[0.12em]">Contract value</p></div><p className="mt-3 text-lg font-semibold">{formatPortalMoney(project.contract_value, project.currency)}</p></div>
    </div>

    <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2"><FolderKanban className="size-4 text-neutral-400" /><h2 className="font-semibold">Project overview</h2></div>
      {project.description ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{project.description}</p> : <p className="mt-4 text-sm text-neutral-400">No client-facing project description has been added yet.</p>}
      <dl className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2">
        <div><dt className="text-xs text-neutral-400">Actual started</dt><dd className="mt-1 text-sm font-medium">{formatPortalDate(project.actual_started_at)}</dd></div>
        <div><dt className="text-xs text-neutral-400">Completed</dt><dd className="mt-1 text-sm font-medium">{formatPortalDate(project.completed_at)}</dd></div>
      </dl>
    </section>
  </div></main>;
}
