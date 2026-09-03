"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Columns3,
  FolderKanban,
  List,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  Timer,
  X,
} from "lucide-react";

type Task = {
  id: string;
  project_id: string;
  project_number: string;
  project_name: string;
  task_code: string;
  milestone_id: string | null;
  milestone_title: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  progress_percent: number;
  planned_start_date: string | null;
  due_date: string | null;
  estimated_minutes: number | null;
  completed_at: string | null;
  updated_at: string;
};

type Project = {
  id: string;
  project_number: string;
  name: string;
  status: string;
  priority: string;
  progress_percent: number;
  due_date: string | null;
};

type WorkspaceData = {
  today?: string;
  timezone?: string;
  employee: { id: string; employee_code: string } | null;
  summary: { assigned_tasks: number; overdue_tasks: number; active_projects: number; due_soon: number };
  tasks: Task[];
  projects: Project[];
};

type TaskActivity = {
  id: string;
  employee_name: string;
  note: string;
  progress_percent: number;
  time_spent_minutes: number | null;
  created_at: string;
};

type TaskDetail = { task: Task; project_status: string; activity: TaskActivity[] };
type ViewMode = "list" | "board";
type SortMode = "due" | "priority" | "recent";

const STATUS_COLUMNS = ["todo", "in_progress", "blocked", "review"] as const;
const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
};
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function pretty(value: string) {
  return STATUS_LABELS[value] ?? value.replaceAll("_", " ");
}

function formatMinutes(value: number | null) {
  if (!value) return "—";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function dueTone(dueDate: string | null, today?: string) {
  if (!dueDate || !today) return "text-neutral-400";
  if (dueDate < today) return "text-red-600";
  if (dueDate === today) return "text-amber-700";
  return "text-neutral-500";
}

function updateTaskQuery(taskId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (taskId) url.searchParams.set("task", taskId);
  else url.searchParams.delete("task");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function MyWorkPage() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("due");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("0");
  const [nextStatus, setNextStatus] = useState("todo");
  const [note, setNote] = useState("");
  const [timeSpent, setTimeSpent] = useState("");
  const deepLinkHandled = useRef(false);

  const openTask = useCallback(async (taskId: string, syncUrl = true) => {
    setSelectedTaskId(taskId);
    setDetailLoading(true);
    setDetailError(null);
    if (syncUrl) updateTaskQuery(taskId);
    try {
      const response = await fetch(`/api/workspace/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load task details.");
      const next = payload as TaskDetail;
      setDetail(next);
      setProgress(String(next.task.progress_percent));
      setNextStatus(next.task.status);
      setNote("");
      setTimeSpent("");
    } catch (reason) {
      setDetail(null);
      setDetailError(reason instanceof Error ? reason.message : "Unable to load task details.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeTask = useCallback(() => {
    setSelectedTaskId(null);
    setDetail(null);
    setDetailError(null);
    setNote("");
    setTimeSpent("");
    updateTaskQuery(null);
  }, []);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/me", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load your work.");
      const next = payload as WorkspaceData;
      setData(next);

      if (!deepLinkHandled.current && typeof window !== "undefined") {
        deepLinkHandled.current = true;
        const requestedTask = new URLSearchParams(window.location.search).get("task");
        if (requestedTask) void openTask(requestedTask, false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load your work.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [openTask]);

  useEffect(() => {
    void load();
  }, [load]);

  const tasks = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLowerCase();
    const filtered = data.tasks.filter((task) => {
      const matchesSearch = !normalized || `${task.task_code} ${task.title} ${task.project_number} ${task.project_name} ${task.milestone_title ?? ""}`.toLowerCase().includes(normalized);
      const matchesStatus = statusFilter === "all" || task.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
      return matchesSearch && matchesStatus && matchesPriority;
    });

    return [...filtered].sort((left, right) => {
      if (sortMode === "priority") {
        const priority = (PRIORITY_ORDER[left.priority] ?? 99) - (PRIORITY_ORDER[right.priority] ?? 99);
        if (priority !== 0) return priority;
      }
      if (sortMode === "recent") return right.updated_at.localeCompare(left.updated_at);
      return (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31");
    });
  }, [data, priorityFilter, query, sortMode, statusFilter]);

  async function saveProgress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const numericProgress = Number(progress);
    const workNote = note.trim();
    if (!Number.isFinite(numericProgress) || numericProgress < 0 || numericProgress > 100) {
      setDetailError("Progress must be between 0 and 100.");
      return;
    }
    if (workNote.length < 2) {
      setDetailError("Add a short work note before saving progress.");
      return;
    }

    let status = nextStatus;
    if (numericProgress === 100) status = "completed";
    else if (status === "completed") status = "in_progress";
    else if (numericProgress > 0 && status === "todo") status = "in_progress";

    setSaving(true);
    setDetailError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(detail.task.project_id)}/tasks/${encodeURIComponent(detail.task.id)}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          progress_percent: numericProgress,
          status,
          note: workNote,
          time_spent_minutes: timeSpent.trim() ? Number(timeSpent) : null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to update task progress.");

      const completed = payload?.status === "completed";
      setMessage(completed ? `${detail.task.task_code} completed.` : `${detail.task.task_code} progress updated.`);
      await load(false);
      if (completed) closeTask();
      else await openTask(detail.task.id, false);
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Unable to update task progress.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  }

  if (!data) {
    return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-6xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ?? "Unable to load your work."}</div></main>;
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-4 sm:p-7 lg:p-10">
      <div className="mx-auto max-w-[1450px]">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-neutral-500">Personal execution workspace</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">My Work</h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-500">Focus on the work assigned to you, update progress and keep a clear activity trail for your project team.</p>
          </div>
          <button type="button" onClick={() => void load(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium hover:bg-neutral-50">
            <RefreshCw className="size-4" /> Refresh
          </button>
        </header>

        {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {message ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={ListChecks} label="Assigned tasks" value={data.summary.assigned_tasks} />
          <SummaryCard icon={AlertTriangle} label="Overdue" value={data.summary.overdue_tasks} emphasis={data.summary.overdue_tasks > 0} />
          <SummaryCard icon={Clock3} label="Due in 3 days" value={data.summary.due_soon} />
          <SummaryCard icon={FolderKanban} label="Active projects" value={data.summary.active_projects} />
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_170px_160px_auto]">
            <label className="relative block">
              <Search className="absolute left-3 top-3 size-4 text-neutral-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks or projects" className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-neutral-500" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm">
              <option value="all">All statuses</option>
              {STATUS_COLUMNS.map((status) => <option key={status} value={status}>{pretty(status)}</option>)}
            </select>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm">
              <option value="all">All priorities</option>
              <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
            </select>
            <label className="relative">
              <ArrowUpDown className="pointer-events-none absolute left-3 top-3 size-4 text-neutral-400" />
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-sm">
                <option value="due">Due date</option><option value="priority">Priority</option><option value="recent">Recently updated</option>
              </select>
            </label>
            <div className="flex rounded-xl border bg-neutral-50 p-1">
              <button type="button" onClick={() => setViewMode("list")} aria-label="List view" className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium ${viewMode === "list" ? "bg-white shadow-sm" : "text-neutral-500"}`}><List className="size-4" /> List</button>
              <button type="button" onClick={() => setViewMode("board")} aria-label="Board view" className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium ${viewMode === "board" ? "bg-white shadow-sm" : "text-neutral-500"}`}><Columns3 className="size-4" /> Board</button>
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between gap-4">
              <div><h2 className="font-semibold">My tasks</h2><p className="mt-1 text-xs text-neutral-400">{tasks.length} visible · click a task to update execution</p></div>
            </div>

            {viewMode === "list" ? (
              <div className="mt-4 divide-y">
                {tasks.map((task) => <TaskRow key={task.id} task={task} today={data.today} onOpen={openTask} />)}
                {!tasks.length ? <Empty label="No tasks match these filters." /> : null}
              </div>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                {STATUS_COLUMNS.map((status) => {
                  const rows = tasks.filter((task) => task.status === status);
                  return <div key={status} className="rounded-xl bg-neutral-50 p-3">
                    <div className="flex items-center justify-between"><p className="text-sm font-semibold">{pretty(status)}</p><span className="rounded-full bg-white px-2 py-0.5 text-xs text-neutral-500">{rows.length}</span></div>
                    <div className="mt-3 space-y-2">{rows.map((task) => <BoardTask key={task.id} task={task} today={data.today} onOpen={openTask} />)}{!rows.length ? <div className="rounded-lg border border-dashed bg-white px-3 py-6 text-center text-xs text-neutral-400">No tasks</div> : null}</div>
                  </div>;
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><FolderKanban className="size-4 text-neutral-400" /><h2 className="font-semibold">My projects</h2></div>
            <div className="mt-3 divide-y">
              {data.projects.map((project) => <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="block py-4 transition hover:bg-neutral-50">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{project.project_number} · {project.name}</p><p className="mt-1 text-xs capitalize text-neutral-400">{pretty(project.status)} · {project.priority} priority</p><p className="mt-1 text-xs text-neutral-400">Due {project.due_date ?? "—"}</p></div><span className="shrink-0 text-sm font-semibold">{project.progress_percent}%</span></div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, project.progress_percent))}%` }} /></div>
              </Link>)}
              {!data.projects.length ? <Empty label="No active projects assigned." /> : null}
            </div>
          </section>
        </div>
      </div>

      {selectedTaskId ? <TaskDrawer detail={detail} loading={detailLoading} error={detailError} saving={saving} progress={progress} nextStatus={nextStatus} note={note} timeSpent={timeSpent} onClose={closeTask} onProgressChange={(value) => { setProgress(value); if (Number(value) === 100) setNextStatus("completed"); else if (nextStatus === "completed") setNextStatus("in_progress"); }} onStatusChange={(value) => { setNextStatus(value); if (value === "completed") setProgress("100"); }} onNoteChange={setNote} onTimeSpentChange={setTimeSpent} onSubmit={saveProgress} /> : null}
    </main>
  );
}

function SummaryCard({ icon: Icon, label, value, emphasis = false }: { icon: typeof ListChecks; label: string; value: number; emphasis?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-5 shadow-sm ${emphasis ? "border-red-200" : ""}`}><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className={`size-4 ${emphasis ? "text-red-500" : "text-neutral-300"}`} /></div><p className={`mt-4 text-3xl font-semibold ${emphasis ? "text-red-700" : ""}`}>{value}</p></div>;
}

function TaskRow({ task, today, onOpen }: { task: Task; today?: string; onOpen: (id: string) => void }) {
  return <button type="button" onClick={() => onOpen(task.id)} className="flex w-full items-center gap-4 py-4 text-left transition hover:bg-neutral-50">
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{task.task_code} · {task.title}</p><StatusBadge status={task.status} /><PriorityBadge priority={task.priority} /></div><p className="mt-1 truncate text-xs text-neutral-400">{task.project_number} · {task.project_name}{task.milestone_title ? ` · ${task.milestone_title}` : ""}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span className={dueTone(task.due_date, today)}><CalendarDays className="mr-1 inline size-3.5" />Due {task.due_date ?? "—"}</span>{task.estimated_minutes ? <span className="text-neutral-400"><Timer className="mr-1 inline size-3.5" />Est. {formatMinutes(task.estimated_minutes)}</span> : null}</div></div>
    <div className="w-20 shrink-0 text-right"><p className="text-sm font-semibold">{task.progress_percent}%</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${task.progress_percent}%` }} /></div></div><ChevronRight className="size-4 shrink-0 text-neutral-300" />
  </button>;
}

function BoardTask({ task, today, onOpen }: { task: Task; today?: string; onOpen: (id: string) => void }) {
  return <button type="button" onClick={() => onOpen(task.id)} className="w-full rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-neutral-300"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-neutral-400">{task.task_code}</span><PriorityBadge priority={task.priority} /></div><p className="mt-2 text-sm font-medium leading-5">{task.title}</p><p className="mt-1 truncate text-[11px] text-neutral-400">{task.project_number} · {task.project_name}</p><div className="mt-3 flex items-center justify-between text-xs"><span className={dueTone(task.due_date, today)}>{task.due_date ?? "No due date"}</span><span className="font-semibold">{task.progress_percent}%</span></div></button>;
}

function TaskDrawer({ detail, loading, error, saving, progress, nextStatus, note, timeSpent, onClose, onProgressChange, onStatusChange, onNoteChange, onTimeSpentChange, onSubmit }: {
  detail: TaskDetail | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  progress: string;
  nextStatus: string;
  note: string;
  timeSpent: string;
  onClose: () => void;
  onProgressChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onTimeSpentChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const locked = !detail || ["completed", "cancelled"].includes(detail.task.status) || ["completed", "cancelled"].includes(detail.project_status);
  return <div className="fixed inset-0 z-[70] flex justify-end"><button type="button" aria-label="Close task details" onClick={onClose} className="absolute inset-0 bg-black/25" /><aside className="relative z-10 h-full w-full max-w-xl overflow-y-auto border-l bg-white shadow-2xl">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-5 py-4 backdrop-blur"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Task detail</p><p className="mt-1 font-semibold">{detail?.task.task_code ?? "Loading…"}</p></div><button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-xl border hover:bg-neutral-50"><X className="size-4" /></button></div>
    <div className="p-5 sm:p-6">
      {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {detail ? <div className="space-y-6">
        <section><div className="flex flex-wrap items-center gap-2"><StatusBadge status={detail.task.status} /><PriorityBadge priority={detail.task.priority} /></div><h2 className="mt-3 text-2xl font-semibold tracking-tight">{detail.task.title}</h2><Link href={`/dashboard/projects/${detail.task.project_id}`} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-950">{detail.task.project_number} · {detail.task.project_name}<ChevronRight className="size-3.5" /></Link>{detail.task.description ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{detail.task.description}</p> : <p className="mt-4 text-sm text-neutral-400">No task description.</p>}</section>
        <section className="grid gap-3 sm:grid-cols-2"><MetaCard icon={CalendarDays} label="Due date" value={detail.task.due_date ?? "No due date"} /><MetaCard icon={Timer} label="Estimate" value={formatMinutes(detail.task.estimated_minutes)} /><MetaCard icon={FolderKanban} label="Milestone" value={detail.task.milestone_title ?? "No milestone"} /><MetaCard icon={CheckCircle2} label="Progress" value={`${detail.task.progress_percent}%`} /></section>
        <section className="rounded-2xl border p-4 sm:p-5"><div><h3 className="font-semibold">Update my work</h3><p className="mt-1 text-xs leading-5 text-neutral-500">Progress updates create an auditable work log. Planning fields such as priority, due date and assignment remain controlled by the project manager.</p></div>{locked ? <div className="mt-4 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-500">This task or project is closed, so execution updates are locked.</div> : <form onSubmit={onSubmit} className="mt-4 space-y-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Status<select value={nextStatus} onChange={(event) => onStatusChange(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-normal"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">In review</option><option value="completed">Completed</option></select></label><label className="text-sm font-medium">Progress %<input type="number" min={0} max={100} value={progress} onChange={(event) => onProgressChange(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 font-normal" /></label></div><label className="block text-sm font-medium">Time spent this update <span className="font-normal text-neutral-400">(minutes, optional)</span><input type="number" min={0} max={100000} value={timeSpent} onChange={(event) => onTimeSpentChange(event.target.value)} placeholder="e.g. 60" className="mt-2 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="block text-sm font-medium">Work note<textarea required minLength={2} maxLength={5000} value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="What did you complete, change or get blocked on?" className="mt-2 min-h-28 w-full rounded-xl border p-3 font-normal" /></label><button disabled={saving} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Save progress</button></form>}</section>
        <section><div className="flex items-center justify-between"><div><h3 className="font-semibold">Activity</h3><p className="mt-1 text-xs text-neutral-500">Recent progress notes for this task.</p></div></div><div className="mt-4 space-y-3">{detail.activity.map((item) => <div key={item.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{item.employee_name}</p><p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600">{item.note}</p></div><span className="shrink-0 text-sm font-semibold">{item.progress_percent}%</span></div><div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-400"><span>{new Date(item.created_at).toLocaleString()}</span>{item.time_spent_minutes ? <span>{formatMinutes(item.time_spent_minutes)} logged</span> : null}</div></div>)}{!detail.activity.length ? <Empty label="No progress activity yet." /> : null}</div></section>
      </div> : null}
    </div>
  </aside></div>;
}

function MetaCard({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="rounded-xl bg-neutral-50 p-4"><div className="flex items-center gap-2 text-xs text-neutral-400"><Icon className="size-3.5" />{label}</div><p className="mt-2 text-sm font-medium">{value}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  const className = status === "blocked" ? "bg-red-50 text-red-700" : status === "review" ? "bg-violet-50 text-violet-700" : status === "in_progress" ? "bg-blue-50 text-blue-700" : status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${className}`}>{pretty(status)}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const className = priority === "urgent" ? "bg-red-50 text-red-700" : priority === "high" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${className}`}>{priority}</span>;
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-neutral-400"><CheckCircle2 className="mx-auto mb-2 size-5" />{label}</div>;
}
