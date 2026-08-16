"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CalendarCheck2,
  CalendarClock,
  FileWarning,
  Loader2,
  MailPlus,
  Settings2,
  Sparkles,
  UserCheck,
  UsersRound,
} from "lucide-react";
import type { HRAccess } from "@/components/hr-module-nav";

type Summary = {
  today: string;
  timezone: string;
  metrics: { active_employees: number; present_today: number; absent_today: number; on_leave_today: number };
  attention: { pending_leave: number; documents_expiring_30d: number; active_candidates: number; pending_invitations: number };
  setup: { departments: number; leave_types: number; shifts: number; holidays: number; employees: number };
  recruitment: { open_jobs: number };
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.detail ?? "Unable to load People & HR.");
  return payload as T;
}

export default function HROverviewPage() {
  const router = useRouter();
  const [access, setAccess] = useState<HRAccess | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextAccess = await readJson<HRAccess>("/api/hr/access");
        if (cancelled) return;
        setAccess(nextAccess);
        if (!nextAccess.can_view) {
          if (nextAccess.can_self) router.replace("/dashboard/hr/me");
          else setError("Your company role does not have access to People & HR.");
          return;
        }
        const nextSummary = await readJson<Summary>("/api/hr/workspace-summary");
        if (!cancelled) setSummary(nextSummary);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load People & HR.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const readiness = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "Add your people", done: summary.setup.employees > 0, href: "/dashboard/hr/people", detail: "Invite employees and keep their work profile in one place." },
      { label: "Set leave policy", done: summary.setup.leave_types > 0, href: "/dashboard/hr/settings", detail: "Create the leave types your company actually uses." },
      { label: "Set work schedule", done: summary.setup.shifts > 0, href: "/dashboard/hr/settings", detail: "Define working hours, grace time and weekly days off." },
      { label: "Add company holidays", done: summary.setup.holidays > 0, href: "/dashboard/hr/settings", detail: "Optional, but useful for a clear company calendar." },
    ];
  }, [summary]);

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  if (!summary) return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1200px] rounded-2xl border bg-white p-8 text-sm text-red-700">{error ?? "People & HR is unavailable."}</div></main>;

  const attention = [
    { label: "Leave requests", value: summary.attention.pending_leave, detail: "Waiting for a decision", href: "/dashboard/hr/time", icon: CalendarClock },
    { label: "Documents expiring", value: summary.attention.documents_expiring_30d, detail: "Within the next 30 days", href: "/dashboard/hr/records", icon: FileWarning },
    { label: "Candidates in progress", value: summary.attention.active_candidates, detail: `${summary.recruitment.open_jobs} open job${summary.recruitment.open_jobs === 1 ? "" : "s"}`, href: "/dashboard/hr/talent", icon: Sparkles },
    ...(access?.can_manage_people ? [{ label: "Pending invitations", value: summary.attention.pending_invitations, detail: "Employee invites not accepted yet", href: "/dashboard/hr/people", icon: MailPlus }] : []),
  ];

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-sm font-medium text-neutral-500">People, attendance and employee experience</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">People & HR</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">Run the everyday people work without needing to learn HR software. Start with what needs attention; advanced setup stays out of the way.</p></div>
      <div className="rounded-xl border bg-white px-4 py-3 text-sm"><p className="font-medium">{summary.today}</p><p className="mt-0.5 text-xs text-neutral-400">Company timezone · {summary.timezone}</p></div>
    </header>

    {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={UsersRound} label="Active people" value={summary.metrics.active_employees} hint="Current employees" />
      <Metric icon={UserCheck} label="Working today" value={summary.metrics.present_today} hint="Present, late or remote" />
      <Metric icon={CalendarCheck2} label="On leave" value={summary.metrics.on_leave_today} hint="Approved leave today" />
      <Metric icon={AlertCircle} label="Recorded absent" value={summary.metrics.absent_today} hint="Attendance marked absent" />
    </section>

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b px-5 py-5 sm:px-6"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">Needs your attention</h2><p className="mt-1 text-sm text-neutral-500">The few things that may need action today.</p></div><BadgeCheck className="size-5 text-neutral-300" /></div></div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">{attention.map(({ label, value, detail, href, icon: Icon }) => <Link key={label} href={href} className="group rounded-xl border p-4 transition hover:border-neutral-300 hover:bg-neutral-50"><div className="flex items-start justify-between gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-neutral-100"><Icon className="size-4" /></span><span className={`text-2xl font-semibold ${value > 0 ? "text-neutral-950" : "text-neutral-300"}`}>{value}</span></div><p className="mt-4 font-medium">{label}</p><p className="mt-1 text-xs text-neutral-500">{detail}</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 group-hover:text-neutral-950">Open <ArrowRight className="size-3" /></span></Link>)}</div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Simple setup</h2><p className="mt-1 text-sm text-neutral-500">Set this once, then the daily flow becomes mostly self-service.</p></div><Settings2 className="size-5 text-neutral-300" /></div>
        <div className="mt-5 space-y-3">{readiness.map((item, index) => <Link key={item.label} href={item.href} className="flex gap-3 rounded-xl border p-3.5 hover:bg-neutral-50"><span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${item.done ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>{item.done ? "✓" : index + 1}</span><span><span className="block text-sm font-medium">{item.label}</span><span className="mt-0.5 block text-xs leading-5 text-neutral-500">{item.detail}</span></span></Link>)}</div>
      </section>
    </div>

    <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm sm:p-6"><div><h2 className="font-semibold">Common actions</h2><p className="mt-1 text-sm text-neutral-500">Go straight to the job you want to do.</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {access?.can_manage_people ? <Quick href="/dashboard/hr/people" title="Invite a person" text="Add a new employee" /> : null}
      <Quick href="/dashboard/hr/time" title="Review leave" text="Approve or reject requests" />
      <Quick href="/dashboard/hr/records" title="Upload a document" text="Contracts and employee records" />
      <Quick href="/dashboard/hr/talent" title="Hire or review" text="Recruitment and performance" />
      <Quick href="/dashboard/payroll" title="Run payroll" text="Continue to payroll" />
    </div></section>
  </div></main>;
}

function Metric({ icon: Icon, label, value, hint }: { icon: typeof UsersRound; label: string; value: number; hint: string }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-neutral-400">{hint}</p></article>; }
function Quick({ href, title, text }: { href: string; title: string; text: string }) { return <Link href={href} className="group rounded-xl border p-4 hover:bg-neutral-50"><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-neutral-500">{text}</p><ArrowRight className="mt-4 size-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-700" /></Link>; }
