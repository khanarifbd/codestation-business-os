"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FolderKanban,
  LogIn,
  LogOut,
  Loader2,
  Megaphone,
  RefreshCw,
  Timer,
} from "lucide-react";

type Task = {
  id: string;
  project_id: string;
  project_number: string;
  project_name: string;
  task_code: string;
  title: string;
  status: string;
  priority: string;
  progress_percent: number;
  due_date: string | null;
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
  today: string;
  timezone: string;
  employee: { id: string; employee_code: string } | null;
  summary: {
    assigned_tasks: number;
    overdue_tasks: number;
    due_today: number;
    active_projects: number;
    due_soon: number;
  };
  tasks: Task[];
  projects: Project[];
};

type HomeData = {
  today: string;
  attendance: {
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    work_minutes: number;
  } | null;
  pending_leave: number;
  annual_leave: {
    allowance_days: string;
    approved_days: string;
    pending_days: string;
    remaining_days: string;
  } | null;
  latest_payslip: {
    entry_id: string;
    period_name: string;
    currency: string;
    net_pay: string;
    status: string;
  } | null;
  policies_to_acknowledge: number;
};

type Announcement = {
  id: string;
  title: string;
  body: string;
  is_policy: boolean;
  published_at: string | null;
};

type HRData = {
  employee: {
    employee_code: string;
    employment_status: string;
    join_date: string | null;
    work_location: string | null;
  };
  announcements: Announcement[];
};

function pretty(value: string) {
  return value.replaceAll("_", " ");
}

function money(value: string, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function time(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dueTone(dueDate: string | null, today: string) {
  if (!dueDate) return "text-neutral-400";
  if (dueDate < today) return "text-red-600";
  if (dueDate === today) return "text-amber-700";
  return "text-neutral-500";
}

export default function EmployeeDashboardPage() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [hr, setHR] = useState<HRData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [workspaceResponse, homeResponse, hrResponse] = await Promise.all([
        fetch("/api/workspace/me", { cache: "no-store" }),
        fetch("/api/hr/self/home", { cache: "no-store" }),
        fetch("/api/hr/self", { cache: "no-store" }),
      ]);
      const workspacePayload = await workspaceResponse.json().catch(() => null);
      const homePayload = await homeResponse.json().catch(() => null);
      const hrPayload = await hrResponse.json().catch(() => null);
      if (!workspaceResponse.ok) throw new Error(workspacePayload?.detail ?? "Unable to load work summary.");
      if (!homeResponse.ok) throw new Error(homePayload?.detail ?? "Unable to load employee summary.");
      if (!hrResponse.ok) throw new Error(hrPayload?.detail ?? "Unable to load HR summary.");
      setWorkspace(workspacePayload as WorkspaceData);
      setHome(homePayload as HomeData);
      setHR(hrPayload as HRData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Employee Dashboard.");
    } finally {
      if (showLoading) setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function attendanceAction(kind: "check-in" | "check-out") {
    setAttendanceBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/hr/self/${kind}`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Attendance action failed.");
      setMessage(kind === "check-in" ? "Checked in successfully." : "Checked out successfully.");
      await load(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Attendance action failed.");
    } finally {
      setAttendanceBusy(false);
    }
  }

  const priorityTasks = useMemo(() => {
    if (!workspace) return [];
    return [...workspace.tasks]
      .filter((task) => task.due_date && task.due_date <= workspace.today)
      .sort((left, right) => (left.due_date ?? "9999-12-31").localeCompare(right.due_date ?? "9999-12-31"))
      .slice(0, 5);
  }, [workspace]);

  const announcements = useMemo(
    () => (hr?.announcements ?? []).filter((item) => !item.is_policy).slice(0, 3),
    [hr],
  );

  if (loading) {
    return <main className="flex min-h-[70vh] items-center justify-center bg-neutral-100"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  }

  if (!workspace || !home || !hr) {
    return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-6xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ?? "Employee Dashboard unavailable."}</div></main>;
  }

  const attendanceOpen = Boolean(home.attendance?.check_in_at && !home.attendance?.check_out_at);
  const attendanceComplete = Boolean(home.attendance?.check_out_at);

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-7 lg:p-10">
    <div className="mx-auto max-w-[1450px]">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-neutral-500">Employee workspace</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">Your workday, priorities, projects, leave, pay and company updates in one place.</p>
        </div>
        <button type="button" disabled={refreshing} onClick={() => void load(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</button>
      </header>

      {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Today · {workspace.today}</p><h2 className="mt-1 text-lg font-semibold">Your day at a glance</h2></div>
          <div className="flex flex-wrap gap-2">
            {!attendanceComplete ? <button type="button" disabled={attendanceBusy} onClick={() => void attendanceAction(attendanceOpen ? "check-out" : "check-in")} className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${attendanceOpen ? "bg-neutral-950 text-white" : "border bg-white"}`}>{attendanceBusy ? <Loader2 className="size-4 animate-spin" /> : attendanceOpen ? <LogOut className="size-4" /> : <LogIn className="size-4" />}{attendanceOpen ? "Check out" : "Check in"}</button> : <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-4" />Workday completed</span>}
            <Link href="/dashboard/hr/me" className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium">My HR & Pay <ArrowRight className="size-4" /></Link>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Snapshot icon={Clock3} label="Attendance" value={home.attendance ? pretty(home.attendance.status) : "Not checked in"} detail={home.attendance ? `${time(home.attendance.check_in_at)} → ${time(home.attendance.check_out_at)}` : "Start your workday"} />
          <Snapshot icon={BriefcaseBusiness} label="Tasks due today" value={String(workspace.summary.due_today)} detail={`${workspace.summary.assigned_tasks} open tasks`} emphasis={workspace.summary.due_today > 0} />
          <Snapshot icon={CalendarDays} label="Pending leave" value={String(home.pending_leave)} detail="Awaiting review" emphasis={home.pending_leave > 0} />
          <Snapshot icon={CalendarDays} label="Annual leave left" value={home.annual_leave ? `${home.annual_leave.remaining_days} days` : "—"} detail={home.annual_leave ? `${home.annual_leave.approved_days} days used` : "No annual policy"} />
          <Snapshot icon={Banknote} label="Latest net pay" value={home.latest_payslip ? money(home.latest_payslip.net_pay, home.latest_payslip.currency) : "No payslip"} detail={home.latest_payslip?.period_name ?? "No payroll published"} />
          <Snapshot icon={FileCheck2} label="Policies to read" value={String(home.policies_to_acknowledge)} detail="Acknowledgement required" emphasis={home.policies_to_acknowledge > 0} />
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={BriefcaseBusiness} label="Assigned tasks" value={workspace.summary.assigned_tasks} href="/dashboard/my-work" />
        <Metric icon={AlertTriangle} label="Overdue" value={workspace.summary.overdue_tasks} href="/dashboard/my-work" critical={workspace.summary.overdue_tasks > 0} />
        <Metric icon={Timer} label="Due in 3 days" value={workspace.summary.due_soon} href="/dashboard/my-work" />
        <Metric icon={FolderKanban} label="Active projects" value={workspace.summary.active_projects} href="/dashboard/projects" />
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickAction icon={BriefcaseBusiness} title="Open My Work" description="Update tasks and work logs" href="/dashboard/my-work" />
        <QuickAction icon={FolderKanban} title="Open Projects" description="View assigned project workspaces" href="/dashboard/projects" />
        <QuickAction icon={CalendarDays} title="Request Leave" description="Leave balance and requests" href="/dashboard/hr/me" />
        <QuickAction icon={Bell} title="Notifications" description="Deadlines needing attention" href="/dashboard/notifications" />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">Today&apos;s priorities</h2><p className="mt-1 text-xs text-neutral-500">Overdue and due-today tasks first.</p></div><Link href="/dashboard/my-work" className="text-xs font-semibold text-neutral-500 hover:text-neutral-950">Open My Work</Link></div>
          <div className="mt-4 divide-y">
            {priorityTasks.map((task) => <Link key={task.id} href={`/dashboard/my-work?task=${task.id}`} className="flex items-center gap-4 py-4 transition hover:bg-neutral-50"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{task.task_code} · {task.title}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${task.priority === "urgent" ? "bg-red-50 text-red-700" : task.priority === "high" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500"}`}>{task.priority}</span></div><p className="mt-1 truncate text-xs text-neutral-400">{task.project_number} · {task.project_name}</p><p className={`mt-2 text-xs ${dueTone(task.due_date, workspace.today)}`}>{task.due_date && task.due_date < workspace.today ? `Overdue · ${task.due_date}` : `Due today · ${task.due_date}`}</p></div><div className="w-16 shrink-0 text-right"><p className="text-sm font-semibold">{task.progress_percent}%</p><ArrowRight className="ml-auto mt-2 size-4 text-neutral-300" /></div></Link>)}
            {!priorityTasks.length ? <div className="py-12 text-center"><CheckCircle2 className="mx-auto size-7 text-emerald-500" /><p className="mt-3 font-semibold">No urgent work today</p><p className="mt-1 text-sm text-neutral-500">Your overdue and due-today queue is clear.</p></div> : null}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">Company updates</h2><p className="mt-1 text-xs text-neutral-500">Latest published announcements.</p></div><Megaphone className="size-4 text-neutral-300" /></div>
          <div className="mt-4 space-y-3">
            {announcements.map((item) => <article key={item.id} className="rounded-xl border p-4"><p className="font-medium">{item.title}</p><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-neutral-500">{item.body}</p>{item.published_at ? <p className="mt-3 text-xs text-neutral-400">{new Date(item.published_at).toLocaleDateString()}</p> : null}</article>)}
            {!announcements.length ? <div className="rounded-xl border border-dashed py-10 text-center text-sm text-neutral-400"><Megaphone className="mx-auto mb-2 size-5" />No announcements yet.</div> : null}
          </div>
          {home.policies_to_acknowledge > 0 ? <Link href="/dashboard/hr/me" className="mt-4 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"><span>{home.policies_to_acknowledge} policy acknowledgement{home.policies_to_acknowledge === 1 ? "" : "s"} pending</span><ArrowRight className="size-4" /></Link> : null}
        </section>
      </div>

      <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">My active projects</h2><p className="mt-1 text-xs text-neutral-500">Projects where you are an active team member.</p></div><Link href="/dashboard/projects" className="text-xs font-semibold text-neutral-500 hover:text-neutral-950">View all projects</Link></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspace.projects.slice(0, 6).map((project) => <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="rounded-xl border p-4 transition hover:border-neutral-300 hover:bg-neutral-50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{project.project_number} · {project.name}</p><p className="mt-1 text-xs capitalize text-neutral-400">{pretty(project.status)} · {project.priority} priority</p><p className="mt-2 text-xs text-neutral-500">Due {project.due_date ?? "—"}</p></div><span className="shrink-0 text-sm font-semibold">{project.progress_percent}%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950" style={{ width: `${Math.max(0, Math.min(100, project.progress_percent))}%` }} /></div></Link>)}
          {!workspace.projects.length ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-neutral-400 md:col-span-2 xl:col-span-3">No active projects assigned.</div> : null}
        </div>
      </section>
    </div>
  </main>;
}

function Snapshot({ icon: Icon, label, value, detail, emphasis = false }: { icon: typeof Clock3; label: string; value: string; detail: string; emphasis?: boolean }) {
  return <div className={`rounded-xl border bg-neutral-50 p-3 ${emphasis ? "border-amber-200 bg-amber-50" : ""}`}><div className="flex items-center justify-between gap-2"><p className="text-xs text-neutral-500">{label}</p><Icon className={`size-3.5 ${emphasis ? "text-amber-600" : "text-neutral-300"}`} /></div><p className={`mt-2 truncate text-sm font-semibold capitalize ${emphasis ? "text-amber-900" : ""}`}>{value}</p><p className="mt-1 truncate text-[11px] text-neutral-400">{detail}</p></div>;
}

function Metric({ icon: Icon, label, value, href, critical = false }: { icon: typeof BriefcaseBusiness; label: string; value: number; href: string; critical?: boolean }) {
  return <Link href={href} className={`rounded-2xl border bg-white p-5 shadow-sm transition hover:border-neutral-300 ${critical ? "border-red-200" : ""}`}><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className={`size-4 ${critical ? "text-red-500" : "text-neutral-300"}`} /></div><div className="mt-4 flex items-end justify-between"><p className={`text-3xl font-semibold ${critical ? "text-red-700" : ""}`}>{value}</p><ArrowRight className="size-4 text-neutral-300" /></div></Link>;
}

function QuickAction({ icon: Icon, title, description, href }: { icon: typeof BriefcaseBusiness; title: string; description: string; href: string }) {
  return <Link href={href} className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block truncate text-xs text-neutral-400">{description}</span></span><ArrowRight className="size-4 shrink-0 text-neutral-300" /></Link>;
}
