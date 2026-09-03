"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FolderKanban,
  Loader2,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";

type ProjectItem = {
  id: string;
  project_number: string;
  name: string;
  client_name: string;
  status: string;
  priority: string;
  progress_percent: number;
  planned_start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  my_role: string | null;
  my_open_tasks: number;
  my_overdue_tasks: number;
};

type ProjectResponse = {
  items: ProjectItem[];
  summary: {
    total: number;
    active: number;
    planned: number;
    on_hold: number;
    completed: number;
  };
};

const STATUS_OPTIONS = ["all", "planned", "active", "on_hold", "completed", "cancelled"] as const;

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

function priorityClass(priority: string) {
  if (priority === "urgent") return "text-red-700";
  if (priority === "high") return "text-amber-700";
  return "text-neutral-500";
}

export default function MyProjectsPage() {
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (appliedQuery.trim()) params.set("search", appliedQuery.trim());
      if (status !== "all") params.set("status", status);
      const suffix = params.size ? `?${params.toString()}` : "";
      const response = await fetch(`/api/workspace/projects${suffix}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load your projects.");
      setData(payload as ProjectResponse);
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Unable to load your projects.");
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, status]);

  useEffect(() => {
    void load();
  }, [load]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedQuery(query);
  }

  const summary = data?.summary ?? { total: 0, active: 0, planned: 0, on_hold: 0, completed: 0 };

  return (
    <main className="min-h-screen bg-neutral-100 p-4 sm:p-7 lg:p-10">
      <div className="mx-auto max-w-[1450px]">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-neutral-500">Employee project workspace</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">My Projects</h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-500">Projects where you are an active team member. Business, finance and credential controls stay in the management workspace.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard/my-work" className="inline-flex h-10 items-center justify-center rounded-xl border bg-white px-4 text-sm font-medium hover:bg-neutral-50">Open My Work</Link>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white disabled:opacity-60">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
            </button>
          </div>
        </header>

        {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard icon={FolderKanban} label="Visible projects" value={summary.total} />
          <SummaryCard icon={RefreshCw} label="Active" value={summary.active} />
          <SummaryCard icon={CalendarDays} label="Planned" value={summary.planned} />
          <SummaryCard icon={AlertTriangle} label="On hold" value={summary.on_hold} emphasis={summary.on_hold > 0} />
          <SummaryCard icon={CheckCircle2} label="Completed" value={summary.completed} />
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
          <form onSubmit={applySearch} className="grid gap-3 md:grid-cols-[minmax(260px,1fr)_190px_auto]">
            <label className="relative block">
              <Search className="absolute left-3 top-3 size-4 text-neutral-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project number, name or client" className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-neutral-500" />
            </label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm">
              {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option === "all" ? "All statuses" : pretty(option)}</option>)}
            </select>
            <button type="submit" className="h-10 rounded-xl border bg-neutral-50 px-5 text-sm font-medium hover:bg-neutral-100">Search</button>
          </form>
        </section>

        <section className="mt-5">
          {loading && !data ? <div className="flex min-h-64 items-center justify-center rounded-2xl border bg-white"><Loader2 className="size-7 animate-spin text-neutral-400" /></div> : null}

          {!loading && data && !data.items.length ? (
            <div className="rounded-2xl border border-dashed bg-white px-6 py-16 text-center shadow-sm">
              <FolderKanban className="mx-auto size-9 text-neutral-300" />
              <h2 className="mt-4 font-semibold">No projects found</h2>
              <p className="mt-1 text-sm text-neutral-500">Only projects where you are an active project member appear here.</p>
            </div>
          ) : null}

          {data?.items.length ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {data.items.map((project) => <ProjectCard key={project.id} project={project} />)}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({ icon: Icon, label, value, emphasis = false }: { icon: typeof FolderKanban; label: string; value: number; emphasis?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-5 shadow-sm ${emphasis ? "border-amber-200" : ""}`}><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className={`size-4 ${emphasis ? "text-amber-600" : "text-neutral-300"}`} /></div><p className={`mt-4 text-3xl font-semibold ${emphasis ? "text-amber-800" : ""}`}>{value}</p></div>;
}

function ProjectCard({ project }: { project: ProjectItem }) {
  return (
    <Link href={`/dashboard/my-projects/${project.id}`} className="group rounded-2xl border bg-white p-5 shadow-sm transition hover:border-neutral-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(project.status)}`}>{pretty(project.status)}</span>
            <span className={`text-xs font-semibold ${priorityClass(project.priority)}`}>{pretty(project.priority)} priority</span>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{project.project_number}</p>
          <h2 className="mt-1 truncate text-lg font-semibold">{project.name}</h2>
          <p className="mt-1 truncate text-sm text-neutral-500">{project.client_name}</p>
        </div>
        <ChevronRight className="mt-1 size-5 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-600" />
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-neutral-500">
        <span>{project.my_role || "Project member"}</span>
        <span className="font-semibold text-neutral-800">{project.progress_percent}% complete</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, project.progress_percent))}%` }} /></div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Meta icon={CalendarDays} label="Due date" value={project.due_date ?? "Not set"} />
        <Meta icon={UsersRound} label="My open tasks" value={String(project.my_open_tasks)} />
        <Meta icon={AlertTriangle} label="My overdue" value={String(project.my_overdue_tasks)} alert={project.my_overdue_tasks > 0} />
      </div>
    </Link>
  );
}

function Meta({ icon: Icon, label, value, alert = false }: { icon: typeof CalendarDays; label: string; value: string; alert?: boolean }) {
  return <div className={`rounded-xl border bg-neutral-50 p-3 ${alert ? "border-red-200 bg-red-50" : ""}`}><div className="flex items-center gap-1.5"><Icon className={`size-3.5 ${alert ? "text-red-500" : "text-neutral-300"}`} /><span className="text-[11px] text-neutral-400">{label}</span></div><p className={`mt-2 truncate text-sm font-semibold ${alert ? "text-red-700" : "text-neutral-700"}`}>{value}</p></div>;
}
