"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Loader2,
  RefreshCw,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";

type ProjectTeamMember = {
  employee_id: string;
  employee_code: string;
  full_name: string;
  role_label: string | null;
  is_manager: boolean;
  is_me: boolean;
};

type ProjectDetail = {
  id: string;
  project_number: string;
  name: string;
  client_name: string;
  status: string;
  priority: string;
  progress_percent: number;
  planned_start_date: string | null;
  due_date: string | null;
  actual_started_at: string | null;
  completed_at: string | null;
  description: string | null;
  my_role: string | null;
  my_open_tasks: number;
  project_manager_name: string | null;
  team: ProjectTeamMember[];
};

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusClass(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "completed") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "on_hold") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function MyProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load this project.");
      setProject(payload as ProjectDetail);
    } catch (reason) {
      setProject(null);
      setError(reason instanceof Error ? reason.message : "Unable to load this project.");
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !project) {
    return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  }

  if (!project) {
    return (
      <main className="min-h-screen bg-neutral-100 p-4 sm:p-7 lg:p-10">
        <div className="mx-auto max-w-5xl">
          <Link href="/dashboard/my-projects" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" /> Back to My Projects</Link>
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ?? "Project not found."}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-4 sm:p-7 lg:p-10">
      <div className="mx-auto max-w-[1300px]">
        <Link href="/dashboard/my-projects" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" /> Back to My Projects</Link>

        <header className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(project.status)}`}>{pretty(project.status)}</span>
              <span className="text-xs font-semibold text-neutral-500">{pretty(project.priority)} priority</span>
              <span className="text-xs text-neutral-400">{project.my_role || "Project member"}</span>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">{project.project_number}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-2 text-sm text-neutral-500">Client: {project.client_name}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard/my-work" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium hover:bg-neutral-50"><BriefcaseBusiness className="size-4" /> My Work</Link>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white disabled:opacity-60">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
            </button>
          </div>
        </header>

        {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={CheckCircle2} label="Project progress" value={`${project.progress_percent}%`} />
          <SummaryCard icon={BriefcaseBusiness} label="My open tasks" value={String(project.my_open_tasks)} />
          <SummaryCard icon={CalendarDays} label="Due date" value={project.due_date ?? "Not set"} />
          <SummaryCard icon={UserRound} label="Project manager" value={project.project_manager_name ?? "Not assigned"} />
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Execution</p><h2 className="mt-1 text-lg font-semibold">Progress</h2></div>
            <span className="text-sm font-semibold">{project.progress_percent}%</span>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, project.progress_percent))}%` }} /></div>
          <p className="mt-4 text-sm leading-6 text-neutral-600">{project.description?.trim() || "No project description has been added."}</p>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2"><UsersRound className="size-4 text-neutral-400" /><h2 className="font-semibold">Project team</h2></div>
            <p className="mt-1 text-xs text-neutral-400">Only active project members are shown.</p>
            <div className="mt-4 divide-y">
              {project.team.map((member) => (
                <div key={member.employee_id} className="flex items-center gap-3 py-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-sm font-semibold text-neutral-600">{member.full_name.trim().slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{member.full_name}</p>{member.is_me ? <span className="rounded-full bg-neutral-950 px-2 py-0.5 text-[10px] font-semibold text-white">You</span> : null}{member.is_manager ? <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold text-neutral-500">Manager</span> : null}</div>
                    <p className="mt-1 text-xs text-neutral-400">{member.employee_code} · {member.role_label || "Project member"}</p>
                  </div>
                </div>
              ))}
              {!project.team.length ? <div className="py-10 text-center text-sm text-neutral-400">No active team members.</div> : null}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2"><Clock3 className="size-4 text-neutral-400" /><h2 className="font-semibold">Schedule</h2></div>
            <div className="mt-4 space-y-3">
              <ScheduleRow label="Planned start" value={project.planned_start_date ?? "Not set"} />
              <ScheduleRow label="Due date" value={project.due_date ?? "Not set"} />
              <ScheduleRow label="Started at" value={formatDateTime(project.actual_started_at)} />
              <ScheduleRow label="Completed at" value={formatDateTime(project.completed_at)} />
            </div>
            <div className="mt-5 rounded-xl border bg-neutral-50 p-4">
              <div className="flex items-center gap-2"><FolderKanban className="size-4 text-neutral-400" /><p className="text-sm font-semibold">Employee-safe view</p></div>
              <p className="mt-2 text-xs leading-5 text-neutral-500">Order, quotation, contract value, finance details and project credentials are intentionally excluded from this workspace.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof CheckCircle2; label: string; value: string }) {
  return <div className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 shrink-0 text-neutral-300" /></div><p className="mt-4 truncate text-xl font-semibold">{value}</p></div>;
}

function ScheduleRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 rounded-xl border bg-neutral-50 px-4 py-3"><span className="text-xs text-neutral-400">{label}</span><span className="text-right text-sm font-medium text-neutral-700">{value}</span></div>;
}
