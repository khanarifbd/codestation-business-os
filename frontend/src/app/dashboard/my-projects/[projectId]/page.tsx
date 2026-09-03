"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ListChecks,
  Loader2,
  RefreshCw,
  Target,
  Timer,
  UserRound,
  UsersRound,
  X,
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

type Task = {
  id: string;
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

type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  progress_percent: number;
  due_date: string | null;
  completed_at: string | null;
};

type ProjectActivity = {
  id: string;
  task_id: string;
  task_code: string;
  task_title: string;
  employee_name: string;
  note: string;
  progress_percent: number;
  time_spent_minutes: number | null;
  created_at: string;
};

type ExecutionData = {
  today: string;
  project_locked: boolean;
  summary: { assigned_tasks: number; open_tasks: number; completed_tasks: number; overdue_tasks: number };
  tasks: Task[];
  milestones: Milestone[];
  recent_activity: ProjectActivity[];
};

type TaskActivity = {
  id: string;
  employee_name: string;
  note: string;
  progress_percent: number;
  time_spent_minutes: number | null;
  created_at: string;
};

type TaskDetail = {
  task: Task & { project_id: string; project_number: string; project_name: string };
  project_status: string;
  activity: TaskActivity[];
};

type Tab = "overview" | "tasks" | "milestones" | "activity" | "team";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "My Tasks" },
  { id: "milestones", label: "Milestones" },
  { id: "activity", label: "Activity" },
  { id: "team", label: "Team" },
];
const editableStatuses = ["todo", "in_progress", "blocked", "review"];
const closedTaskStatuses = new Set(["completed", "cancelled"]);

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusClass(status: string) {
  if (status === "active" || status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "in_progress" || status === "review") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "on_hold" || status === "blocked") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function priorityClass(priority: string) {
  if (priority === "urgent") return "border-red-200 bg-red-50 text-red-700";
  if (priority === "high") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-500";
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatMinutes(value: number | null) {
  if (!value) return "—";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function dueClass(dueDate: string | null, today: string) {
  if (!dueDate) return "text-neutral-400";
  if (dueDate < today) return "text-red-600";
  if (dueDate === today) return "text-amber-700";
  return "text-neutral-500";
}

export default function MyProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [execution, setExecution] = useState<ExecutionData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("0");
  const [nextStatus, setNextStatus] = useState("todo");
  const [note, setNote] = useState("");
  const [timeSpent, setTimeSpent] = useState("");

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [projectResponse, executionResponse] = await Promise.all([
        fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}/execution`, { cache: "no-store" }),
      ]);
      if (projectResponse.status === 401 || executionResponse.status === 401) {
        router.replace("/login");
        return;
      }
      const projectPayload = await projectResponse.json().catch(() => null);
      const executionPayload = await executionResponse.json().catch(() => null);
      if (!projectResponse.ok) throw new Error(projectPayload?.detail ?? "Unable to load this project.");
      if (!executionResponse.ok) throw new Error(executionPayload?.detail ?? "Unable to load project execution.");
      setProject(projectPayload as ProjectDetail);
      setExecution(executionPayload as ExecutionData);
    } catch (reason) {
      setProject(null);
      setExecution(null);
      setError(reason instanceof Error ? reason.message : "Unable to load this project.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [projectId, router]);

  const openTask = useCallback(async (taskId: string) => {
    setSelectedTaskId(taskId);
    setTaskLoading(true);
    setTaskError(null);
    try {
      const response = await fetch(`/api/workspace/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load task details.");
      const detail = payload as TaskDetail;
      setTaskDetail(detail);
      setProgress(String(detail.task.progress_percent));
      setNextStatus(detail.task.status);
      setNote("");
      setTimeSpent("");
    } catch (reason) {
      setTaskDetail(null);
      setTaskError(reason instanceof Error ? reason.message : "Unable to load task details.");
    } finally {
      setTaskLoading(false);
    }
  }, []);

  const closeTask = useCallback(() => {
    setSelectedTaskId(null);
    setTaskDetail(null);
    setTaskError(null);
    setNote("");
    setTimeSpent("");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTasks = useMemo(
    () => execution?.tasks.filter((task) => !closedTaskStatuses.has(task.status)) ?? [],
    [execution],
  );

  async function saveProgress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskDetail || !execution) return;
    const numericProgress = Number(progress);
    const workNote = note.trim();
    const minutes = timeSpent.trim() ? Number(timeSpent) : null;
    if (!Number.isFinite(numericProgress) || numericProgress < 0 || numericProgress > 100) {
      setTaskError("Progress must be between 0 and 100.");
      return;
    }
    if (workNote.length < 2) {
      setTaskError("Add a short work note before saving progress.");
      return;
    }
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) {
      setTaskError("Time spent must be zero or more minutes.");
      return;
    }

    let status = nextStatus;
    if (numericProgress === 100) status = "completed";
    else if (status === "completed") status = "in_progress";
    else if (numericProgress > 0 && status === "todo") status = "in_progress";

    setSaving(true);
    setTaskError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskDetail.task.id)}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          progress_percent: numericProgress,
          status,
          note: workNote,
          time_spent_minutes: minutes,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to update task progress.");
      setMessage(payload?.status === "completed" ? `${taskDetail.task.task_code} completed.` : `${taskDetail.task.task_code} progress updated.`);
      await load(false);
      if (payload?.status === "completed") closeTask();
      else await openTask(taskDetail.task.id);
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : "Unable to update task progress.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !project) {
    return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  }

  if (!project || !execution) {
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
      <div className="mx-auto max-w-[1450px]">
        <Link href="/dashboard/my-projects" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" /> Back to My Projects</Link>

        <header className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={project.status} />
              <PriorityBadge priority={project.priority} />
              <span className="text-xs text-neutral-400">{project.my_role || "Project member"}</span>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">{project.project_number}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-2 text-sm text-neutral-500">Client: {project.client_name}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/my-work" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium hover:bg-neutral-50"><BriefcaseBusiness className="size-4" /> My Work</Link>
            <button type="button" onClick={() => void load(false)} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white disabled:opacity-60">
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </header>

        {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {message ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {execution.project_locked ? <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">This project is {pretty(project.status)}. Execution history remains visible, but task updates are locked.</div> : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={CheckCircle2} label="Project progress" value={`${project.progress_percent}%`} />
          <SummaryCard icon={ListChecks} label="My open tasks" value={String(execution.summary.open_tasks)} />
          <SummaryCard icon={AlertTriangle} label="My overdue tasks" value={String(execution.summary.overdue_tasks)} emphasis={execution.summary.overdue_tasks > 0} />
          <SummaryCard icon={CalendarDays} label="Due date" value={project.due_date ?? "Not set"} />
        </section>

        <nav className="mt-5 flex gap-1 overflow-x-auto rounded-2xl border bg-white p-1.5 shadow-sm">
          {tabs.map((item) => (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition ${tab === item.id ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-950"}`}>{item.label}</button>
          ))}
        </nav>

        {tab === "overview" ? <Overview project={project} execution={execution} openTasks={openTasks} onOpenTask={openTask} /> : null}
        {tab === "tasks" ? <TasksTab execution={execution} onOpenTask={openTask} /> : null}
        {tab === "milestones" ? <MilestonesTab milestones={execution.milestones} /> : null}
        {tab === "activity" ? <ActivityTab items={execution.recent_activity} /> : null}
        {tab === "team" ? <TeamTab project={project} /> : null}
      </div>

      {selectedTaskId ? (
        <TaskDrawer
          detail={taskDetail}
          loading={taskLoading}
          error={taskError}
          saving={saving}
          projectLocked={execution.project_locked}
          progress={progress}
          nextStatus={nextStatus}
          note={note}
          timeSpent={timeSpent}
          onClose={closeTask}
          onProgressChange={(value) => {
            setProgress(value);
            if (Number(value) === 100) setNextStatus("completed");
            else if (nextStatus === "completed") setNextStatus("in_progress");
          }}
          onStatusChange={(value) => {
            setNextStatus(value);
            if (value === "completed") setProgress("100");
          }}
          onNoteChange={setNote}
          onTimeSpentChange={setTimeSpent}
          onSubmit={saveProgress}
        />
      ) : null}
    </main>
  );
}

function Overview({ project, execution, openTasks, onOpenTask }: { project: ProjectDetail; execution: ExecutionData; openTasks: Task[]; onOpenTask: (id: string) => void }) {
  return <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
    <div className="space-y-5">
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Execution</p><h2 className="mt-1 text-lg font-semibold">Project progress</h2></div><span className="text-sm font-semibold">{project.progress_percent}%</span></div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, project.progress_percent))}%` }} /></div>
        <p className="mt-4 text-sm leading-6 text-neutral-600">{project.description?.trim() || "No project description has been added."}</p>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ListChecks className="size-4 text-neutral-400" /><h2 className="font-semibold">My open tasks</h2></div><span className="text-xs text-neutral-400">{execution.summary.open_tasks} open</span></div>
        <div className="mt-3 divide-y">
          {openTasks.slice(0, 6).map((task) => <TaskRow key={task.id} task={task} today={execution.today} onOpen={onOpenTask} />)}
          {!openTasks.length ? <Empty label="You have no open tasks in this project." /> : null}
        </div>
      </section>
    </div>

    <div className="space-y-5">
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2"><Clock3 className="size-4 text-neutral-400" /><h2 className="font-semibold">Schedule</h2></div>
        <div className="mt-4 space-y-3">
          <ScheduleRow label="Planned start" value={project.planned_start_date ?? "Not set"} />
          <ScheduleRow label="Due date" value={project.due_date ?? "Not set"} />
          <ScheduleRow label="Started at" value={formatDateTime(project.actual_started_at)} />
          <ScheduleRow label="Completed at" value={formatDateTime(project.completed_at)} />
        </div>
      </section>
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2"><UserRound className="size-4 text-neutral-400" /><h2 className="font-semibold">Project manager</h2></div>
        <p className="mt-4 text-lg font-semibold">{project.project_manager_name ?? "Not assigned"}</p>
        <p className="mt-1 text-xs text-neutral-400">Your role: {project.my_role || "Project member"}</p>
      </section>
    </div>
  </div>;
}

function TasksTab({ execution, onOpenTask }: { execution: ExecutionData; onOpenTask: (id: string) => void }) {
  return <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><ListChecks className="size-4 text-neutral-400" /><h2 className="font-semibold">My assigned tasks</h2></div><p className="mt-1 text-xs text-neutral-400">Only tasks assigned to you are shown. Open a task to update progress and add a work note.</p></div><p className="text-xs text-neutral-400">{execution.summary.assigned_tasks} total · {execution.summary.completed_tasks} completed</p></div>
    <div className="mt-4 divide-y">
      {execution.tasks.map((task) => <TaskRow key={task.id} task={task} today={execution.today} onOpen={onOpenTask} />)}
      {!execution.tasks.length ? <Empty label="No tasks are assigned to you in this project." /> : null}
    </div>
  </section>;
}

function MilestonesTab({ milestones }: { milestones: Milestone[] }) {
  return <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
    <div className="flex items-center gap-2"><Target className="size-4 text-neutral-400" /><h2 className="font-semibold">Project milestones</h2></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {milestones.map((item) => <div key={item.id} className="rounded-xl border bg-neutral-50 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-neutral-400">Due {item.due_date ?? "—"}</p></div><StatusBadge status={item.status} /></div><div className="mt-4 flex items-center justify-between text-xs"><span className="text-neutral-400">Progress</span><span className="font-semibold">{item.progress_percent}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, item.progress_percent))}%` }} /></div>{item.description ? <p className="mt-3 text-xs leading-5 text-neutral-500">{item.description}</p> : null}</div>)}
    </div>
    {!milestones.length ? <Empty label="No milestones have been added to this project." /> : null}
  </section>;
}

function ActivityTab({ items }: { items: ProjectActivity[] }) {
  return <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
    <div className="flex items-center gap-2"><Activity className="size-4 text-neutral-400" /><h2 className="font-semibold">My task activity</h2></div>
    <p className="mt-1 text-xs text-neutral-400">Work-log history is limited to tasks assigned to you in this project.</p>
    <div className="mt-4 divide-y">
      {items.map((item) => <div key={item.id} className="py-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-semibold">{item.task_code} · {item.task_title}</p><p className="mt-1 text-sm text-neutral-600">{item.note}</p><p className="mt-2 text-xs text-neutral-400">{item.employee_name} · {formatDateTime(item.created_at)}</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold">{item.progress_percent}%</p><p className="mt-1 text-xs text-neutral-400">{item.time_spent_minutes ? formatMinutes(item.time_spent_minutes) : "No time logged"}</p></div></div></div>)}
      {!items.length ? <Empty label="No task activity has been recorded yet." /> : null}
    </div>
  </section>;
}

function TeamTab({ project }: { project: ProjectDetail }) {
  return <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
    <div className="flex items-center gap-2"><UsersRound className="size-4 text-neutral-400" /><h2 className="font-semibold">Project team</h2></div>
    <p className="mt-1 text-xs text-neutral-400">Only active project members are shown.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {project.team.map((member) => <div key={member.employee_id} className="flex items-center gap-3 rounded-xl border bg-neutral-50 p-4"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-semibold text-neutral-600">{member.full_name.trim().slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{member.full_name}</p>{member.is_me ? <span className="rounded-full bg-neutral-950 px-2 py-0.5 text-[10px] font-semibold text-white">You</span> : null}{member.is_manager ? <span className="rounded-full border bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500">Manager</span> : null}</div><p className="mt-1 text-xs text-neutral-400">{member.employee_code} · {member.role_label || "Project member"}</p></div></div>)}
    </div>
    {!project.team.length ? <Empty label="No active team members." /> : null}
  </section>;
}

function TaskRow({ task, today, onOpen }: { task: Task; today: string; onOpen: (id: string) => void }) {
  return <button type="button" onClick={() => onOpen(task.id)} className="flex w-full items-center gap-4 py-4 text-left transition hover:bg-neutral-50">
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{task.task_code} · {task.title}</p><StatusBadge status={task.status} /><PriorityBadge priority={task.priority} /></div><p className="mt-1 truncate text-xs text-neutral-400">{task.milestone_title || "No milestone"}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span className={closedTaskStatuses.has(task.status) ? "text-neutral-400" : dueClass(task.due_date, today)}><CalendarDays className="mr-1 inline size-3.5" />Due {task.due_date ?? "—"}</span>{task.estimated_minutes ? <span className="text-neutral-400"><Timer className="mr-1 inline size-3.5" />Est. {formatMinutes(task.estimated_minutes)}</span> : null}</div></div>
    <div className="w-20 shrink-0 text-right"><p className="text-sm font-semibold">{task.progress_percent}%</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, task.progress_percent))}%` }} /></div></div>
  </button>;
}

function TaskDrawer({ detail, loading, error, saving, projectLocked, progress, nextStatus, note, timeSpent, onClose, onProgressChange, onStatusChange, onNoteChange, onTimeSpentChange, onSubmit }: {
  detail: TaskDetail | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  projectLocked: boolean;
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
  const locked = projectLocked || !detail || closedTaskStatuses.has(detail.task.status) || ["completed", "cancelled"].includes(detail.project_status);
  return <div className="fixed inset-0 z-[70] flex justify-end"><button type="button" aria-label="Close task details" onClick={onClose} className="absolute inset-0 bg-black/25" /><aside className="relative z-10 h-full w-full max-w-xl overflow-y-auto border-l bg-white shadow-2xl">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-5 py-4 backdrop-blur"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Task execution</p><p className="mt-1 font-semibold">{detail?.task.task_code ?? "Loading…"}</p></div><button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-xl border hover:bg-neutral-50"><X className="size-4" /></button></div>
    <div className="p-5 sm:p-6">
      {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {detail ? <div className="space-y-6">
        <section><div className="flex flex-wrap items-center gap-2"><StatusBadge status={detail.task.status} /><PriorityBadge priority={detail.task.priority} /></div><h2 className="mt-3 text-2xl font-semibold tracking-tight">{detail.task.title}</h2><p className="mt-2 text-sm text-neutral-500">{detail.task.milestone_title || "No milestone"} · Due {detail.task.due_date ?? "—"}</p>{detail.task.description ? <p className="mt-4 text-sm leading-6 text-neutral-600">{detail.task.description}</p> : null}</section>

        {locked ? <div className="rounded-xl border bg-neutral-50 p-4 text-sm text-neutral-600">This task is read-only because the task or project is already closed.</div> : <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border bg-neutral-50 p-4">
          <div><h3 className="font-semibold">Update my work</h3><p className="mt-1 text-xs text-neutral-400">Progress updates create a work log and audit activity.</p></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-neutral-500">Progress %<input type="number" min="0" max="100" value={progress} onChange={(event) => onProgressChange(event.target.value)} className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm" /></label><label className="text-xs font-medium text-neutral-500">Status<select value={nextStatus === "completed" ? "completed" : nextStatus} onChange={(event) => onStatusChange(event.target.value)} className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm"><option value="completed">Completed</option>{editableStatuses.map((status) => <option key={status} value={status}>{pretty(status)}</option>)}</select></label></div>
          <label className="block text-xs font-medium text-neutral-500">Work note<textarea value={note} onChange={(event) => onNoteChange(event.target.value)} rows={4} placeholder="What did you complete or change?" className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-neutral-500">Time spent (minutes)<input type="number" min="0" value={timeSpent} onChange={(event) => onTimeSpentChange(event.target.value)} placeholder="Optional" className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm" /></label>
          <button type="submit" disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white disabled:opacity-60">{saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Save progress</button>
        </form>}

        <section><div className="flex items-center gap-2"><Activity className="size-4 text-neutral-400" /><h3 className="font-semibold">Task activity</h3></div><div className="mt-3 divide-y">{detail.activity.map((item) => <div key={item.id} className="py-3"><p className="text-sm text-neutral-700">{item.note}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400"><span>{item.employee_name}</span><span>{item.progress_percent}%</span><span>{item.time_spent_minutes ? formatMinutes(item.time_spent_minutes) : "No time logged"}</span><span>{formatDateTime(item.created_at)}</span></div></div>)}{!detail.activity.length ? <Empty label="No work-log activity yet." /> : null}</div></section>
      </div> : null}
    </div>
  </aside></div>;
}

function SummaryCard({ icon: Icon, label, value, emphasis = false }: { icon: typeof CheckCircle2; label: string; value: string; emphasis?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-5 shadow-sm ${emphasis ? "border-red-200" : ""}`}><div className="flex items-center justify-between gap-3"><p className="text-sm text-neutral-500">{label}</p><Icon className={`size-4 shrink-0 ${emphasis ? "text-red-500" : "text-neutral-300"}`} /></div><p className={`mt-4 truncate text-xl font-semibold ${emphasis ? "text-red-700" : ""}`}>{value}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(status)}`}>{pretty(status)}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${priorityClass(priority)}`}>{pretty(priority)}</span>;
}

function ScheduleRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 rounded-xl border bg-neutral-50 px-4 py-3"><span className="text-xs text-neutral-400">{label}</span><span className="text-right text-sm font-medium text-neutral-700">{value}</span></div>;
}

function Empty({ label }: { label: string }) {
  return <div className="py-10 text-center text-sm text-neutral-400">{label}</div>;
}
