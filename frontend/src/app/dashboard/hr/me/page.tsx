"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Megaphone,
  ReceiptText,
  RefreshCw,
  Star,
  UserRound,
  XCircle,
} from "lucide-react";

import { SearchableSelect } from "@/components/searchable-select";

type SelfData = {
  employee: {
    id: string;
    employee_code: string;
    employment_status: string;
    join_date?: string | null;
    work_location?: string | null;
  };
  leave_requests: { id: string; leave_type?: string; start_date: string; end_date: string; days: string; status: string }[];
  attendance: { date: string; status: string; check_in_at?: string | null; check_out_at?: string | null; work_minutes: number }[];
  documents: { id: string; title: string; document_type: string; expires_on?: string | null; file_url?: string | null }[];
  performance: { id: string; period_start: string; period_end: string; status: string; rating?: string | null; self_review?: string | null; manager_review?: string | null }[];
  announcements: { id: string; title: string; body: string; is_policy: boolean; published_at?: string | null }[];
  payslips: { run_id: string; entry_id: string; run_number: string; period_name: string; currency: string; gross_pay: string; net_pay: string; status: string }[];
};

type Meta = { leave_types: { id: string; name: string; code: string; annual_allowance_days: string; is_paid: boolean }[] };
type PolicyAck = Record<string, string>;
type LeaveBalance = {
  year: number;
  items: {
    leave_type_id: string;
    name: string;
    code: string;
    is_paid: boolean;
    allowance_days: string;
    approved_days: string;
    pending_days: string;
    remaining_days: string;
  }[];
};
type MonthlyAttendance = {
  month: string;
  summary: {
    present: number;
    late: number;
    absent: number;
    leave: number;
    holiday: number;
    off: number;
    missing: number;
    work_minutes: number;
    overtime_minutes: number;
  };
  days: {
    date: string;
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    work_minutes: number;
    overtime_minutes: number;
    holiday_name: string | null;
  }[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: init?.cache ?? "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || "Request failed");
  return body as T;
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function dateTime(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function weekdayMonday(dateValue: string) {
  const [rawYear, month, day] = dateValue.split("-").map(Number);
  let year = rawYear;
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  if (month < 3) year -= 1;
  const sundayIndex = (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + offsets[month - 1] + day) % 7;
  return (sundayIndex + 6) % 7;
}

function dayNumber(value: string) {
  return String(Number(value.slice(-2)));
}

function attendanceTone(status: string) {
  if (status === "present") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "late") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "absent") return "border-red-200 bg-red-50 text-red-700";
  if (status === "leave") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "holiday" || status === "off") return "border-violet-100 bg-violet-50 text-violet-700";
  if (status === "missing") return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-neutral-100 bg-neutral-50 text-neutral-400";
}

export default function MyHRPage() {
  const [data, setData] = useState<SelfData | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [acks, setAcks] = useState<PolicyAck>({});
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance | null>(null);
  const [monthlyAttendance, setMonthlyAttendance] = useState<MonthlyAttendance | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const monthQuery = selectedMonth ? `?month=${encodeURIComponent(selectedMonth)}` : "";
      const [self, selfMeta, acknowledgements, balances, attendance] = await Promise.all([
        api<SelfData>("/api/hr/self"),
        api<Meta>("/api/hr/self-meta"),
        api<PolicyAck>("/api/hr/self/policy-acknowledgements"),
        api<LeaveBalance>("/api/hr/self/leave-balance"),
        api<MonthlyAttendance>(`/api/hr/self/attendance/monthly${monthQuery}`),
      ]);
      setData(self);
      setMeta(selfMeta);
      setAcks(acknowledgements);
      setLeaveBalance(balances);
      setMonthlyAttendance(attendance);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load My HR & Pay");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  async function attendanceAction(path: string, message: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/api/hr/${path}`, { method: "POST" });
      setSuccess(message);
      await load(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Attendance action failed");
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(id: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api<{ announcement_id: string; acknowledged_at: string }>(`/api/hr/self/announcements/${id}/acknowledge`, { method: "POST" });
      setAcks((current) => ({ ...current, [id]: result.acknowledged_at }));
      setSuccess("Policy acknowledged.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to acknowledge policy");
    } finally {
      setBusy(false);
    }
  }

  async function requestLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api("/api/hr/leave-requests", {
        method: "POST",
        body: JSON.stringify({
          leave_type_id: values.get("leave_type_id"),
          start_date: values.get("start_date"),
          end_date: values.get("end_date"),
          reason: values.get("reason") || null,
        }),
      });
      form.reset();
      setSuccess("Leave request submitted.");
      await load(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to request leave");
    } finally {
      setBusy(false);
    }
  }

  async function cancelLeave(id: string) {
    if (!window.confirm("Cancel this pending leave request? This action will be recorded in the audit trail.")) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/api/hr/self/leave-requests/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      setSuccess("Leave request cancelled.");
      await load(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to cancel leave request");
    } finally {
      setBusy(false);
    }
  }

  async function saveSelfReview(id: string, text: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/api/hr/self/performance/${id}`, { method: "PATCH", body: JSON.stringify({ self_review: text }) });
      setSuccess("Self review saved.");
      await load(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save self review");
    } finally {
      setBusy(false);
    }
  }

  const leaveOptions = useMemo(
    () => (meta?.leave_types ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.annual_allowance_days} days${item.is_paid ? " · paid" : ""}` })),
    [meta],
  );
  const recentAttendance = data?.attendance?.[0] ?? null;
  const latestPayslip = data?.payslips?.[0] ?? null;
  const pendingLeave = data?.leave_requests.filter((item) => item.status === "pending").length ?? 0;
  const unacknowledgedPolicies = data?.announcements.filter((item) => item.is_policy && !acks[item.id]).length ?? 0;

  if (loading && !data) {
    return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  }

  if (!data) {
    return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8"><div className="mx-auto max-w-5xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ?? "Unable to load My HR & Pay."}</div></main>;
  }

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1400px]">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-sm text-neutral-500">Employee self-service</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">My HR & Pay</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">Manage your workday, leave, HR records, performance reviews, policies and approved payslips from one private workspace.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void load(false)} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium disabled:opacity-40"><RefreshCw className="size-4" />Refresh</button><button type="button" disabled={busy} onClick={() => void attendanceAction("self/check-in", "Checked in successfully.")} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium disabled:opacity-40"><LogIn className="size-4" />Check in</button><button type="button" disabled={busy} onClick={() => void attendanceAction("self/check-out", "Checked out successfully.")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-40"><LogOut className="size-4" />Check out</button></div>
    </header>

    {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {success ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <MetricCard icon={UserRound} label="Employee" value={data.employee.employee_code} />
      <MetricCard icon={CalendarDays} label="Employment" value={data.employee.employment_status.replaceAll("_", " ")} />
      <MetricCard icon={Clock3} label="Today / latest" value={recentAttendance?.status?.replaceAll("_", " ") || "No record"} />
      <MetricCard icon={CalendarDays} label="Pending leave" value={String(pendingLeave)} emphasis={pendingLeave > 0} />
      <MetricCard icon={Banknote} label="Latest net pay" value={latestPayslip ? money(latestPayslip.net_pay, latestPayslip.currency) : "No payslip"} />
      <MetricCard icon={Megaphone} label="Policies to read" value={String(unacknowledgedPolicies)} emphasis={unacknowledgedPolicies > 0} />
    </section>

    <section className="mt-5 grid gap-4 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-3">
      <Info icon={CalendarDays} label="Join date" value={data.employee.join_date || "Not recorded"} />
      <Info icon={MapPin} label="Work location" value={data.employee.work_location || "Not recorded"} />
      <Info icon={Clock3} label="Latest work time" value={recentAttendance ? duration(recentAttendance.work_minutes) : "No attendance yet"} />
    </section>

    <Section title={`Leave balance · ${leaveBalance?.year ?? ""}`} subtitle="Remaining balance includes both approved leave and currently pending requests." extraClass="mt-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{leaveBalance?.items.length ? leaveBalance.items.map((item) => <LeaveBalanceCard key={item.leave_type_id} item={item} />) : <Empty />}</div>
    </Section>

    <div className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={requestLeave} className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Request leave</h2><p className="mt-1 text-xs leading-5 text-neutral-500">Choose the leave policy and dates. Approval status will appear in your history automatically.</p>
        <div className="mt-4 space-y-4"><SearchableSelect label="Leave type" name="leave_type_id" required options={leaveOptions} /><Field name="start_date" label="Start date" type="date" /><Field name="end_date" label="End date" type="date" /><label className="block text-sm font-medium">Reason <span className="font-normal text-neutral-400">(optional)</span><textarea name="reason" className="mt-2 min-h-24 w-full rounded-xl border p-3 font-normal" /></label><button disabled={busy} className="h-11 w-full rounded-xl bg-neutral-950 text-sm font-semibold text-white disabled:opacity-50">Submit leave request</button></div>
      </form>
      <Section title="Leave history" subtitle="Pending requests can be cancelled by you. Approved or rejected records remain locked for HR history."><LeaveHistory rows={data.leave_requests} busy={busy} onCancel={cancelLeave} /></Section>
    </div>

    <Section title="Monthly attendance" subtitle="Missing records are shown separately and are never silently counted as absence." extraClass="mt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap gap-2"><AttendanceMetric label="Present" value={monthlyAttendance?.summary.present ?? 0} /><AttendanceMetric label="Late" value={monthlyAttendance?.summary.late ?? 0} /><AttendanceMetric label="Absent" value={monthlyAttendance?.summary.absent ?? 0} critical={(monthlyAttendance?.summary.absent ?? 0) > 0} /><AttendanceMetric label="Leave" value={monthlyAttendance?.summary.leave ?? 0} /><AttendanceMetric label="Missing" value={monthlyAttendance?.summary.missing ?? 0} warning={(monthlyAttendance?.summary.missing ?? 0) > 0} /><AttendanceMetric label="Work" value={duration(monthlyAttendance?.summary.work_minutes ?? 0)} /><AttendanceMetric label="Overtime" value={duration(monthlyAttendance?.summary.overtime_minutes ?? 0)} /></div><input type="month" value={selectedMonth ?? monthlyAttendance?.month ?? ""} onChange={(event) => setSelectedMonth(event.target.value || null)} className="h-10 rounded-xl border bg-white px-3 text-sm" /></div>
      <AttendanceCalendar data={monthlyAttendance} />
    </Section>

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Section title="My documents" subtitle="Employee documents shared with your HR profile."><div className="space-y-3">{data.documents.length ? data.documents.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl border p-4"><div className="min-w-0"><p className="truncate font-medium">{item.title}</p><p className="mt-1 text-xs capitalize text-neutral-500">{item.document_type.replaceAll("_", " ")} · Expiry {item.expires_on || "N/A"}</p></div>{item.file_url ? <a href={`/api/hr-documents/self/${item.id}/file`} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-medium underline">Open</a> : null}</div>) : <Empty />}</div></Section>
      <Section title="Performance" subtitle="Complete your self-review and see manager feedback when available."><div className="space-y-3">{data.performance.length ? data.performance.map((item) => <PerformanceItem key={item.id} row={item} busy={busy} onSave={saveSelfReview} />) : <Empty />}</div></Section>
    </div>

    <Section title="Payslips" subtitle="Only your approved or paid payroll records are shown here." extraClass="mt-5"><div className="grid gap-3 md:grid-cols-2">{data.payslips.length ? data.payslips.map((item) => <Link key={item.entry_id} href={`/dashboard/hr/me/payslips/${item.entry_id}`} className="flex items-center justify-between gap-4 rounded-xl border p-4 transition hover:border-neutral-300 hover:bg-neutral-50"><div className="min-w-0"><div className="flex items-center gap-2"><ReceiptText className="size-4 text-neutral-400" /><p className="truncate font-medium">{item.period_name}</p></div><p className="mt-1 text-xs text-neutral-500">{item.run_number} · <span className="capitalize">{item.status}</span> · Gross {money(item.gross_pay, item.currency)}</p></div><div className="shrink-0 text-right"><p className="font-semibold">{money(item.net_pay, item.currency)}</p><p className="mt-1 text-xs text-neutral-400">View private payslip</p></div></Link>) : <Empty />}</div></Section>

    <Section title="Policies & announcements" subtitle="Acknowledge required company policies so HR has a reliable audit trail." extraClass="mt-5"><div className="grid gap-3 md:grid-cols-2">{data.announcements.length ? data.announcements.map((item) => <div key={item.id} className="rounded-xl border p-4"><div className="flex items-center gap-2"><Megaphone className="size-4" /><p className="font-medium">{item.title}</p>{item.is_policy ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">POLICY</span> : null}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{item.body}</p>{item.is_policy ? <div className="mt-4">{acks[item.id] ? <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" />Acknowledged</div> : <button type="button" disabled={busy} onClick={() => void acknowledge(item.id)} className="rounded-lg bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Acknowledge policy</button>}</div> : null}</div>) : <Empty />}</div></Section>
  </div></main>;
}

function LeaveBalanceCard({ item }: { item: LeaveBalance["items"][number] }) {
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between gap-2"><div><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs text-neutral-400">{item.code} · {item.is_paid ? "Paid" : "Unpaid"}</p></div><p className={`text-xl font-semibold ${Number(item.remaining_days) < 0 ? "text-red-700" : ""}`}>{item.remaining_days}</p></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><MiniStat label="Allowance" value={item.allowance_days} /><MiniStat label="Used" value={item.approved_days} /><MiniStat label="Pending" value={item.pending_days} /></div></div>;
}

function LeaveHistory({ rows, busy, onCancel }: { rows: SelfData["leave_requests"]; busy: boolean; onCancel: (id: string) => Promise<void> }) {
  if (!rows.length) return <Empty />;
  return <div className="overflow-x-auto rounded-xl border"><table className="min-w-full text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-4 py-3">Type</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Days</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="whitespace-nowrap px-4 py-3">{row.leave_type || "—"}</td><td className="whitespace-nowrap px-4 py-3">{row.start_date} — {row.end_date}</td><td className="px-4 py-3">{row.days}</td><td className="px-4 py-3 capitalize">{row.status.replaceAll("_", " ")}</td><td className="px-4 py-3 text-right">{row.status === "pending" ? <button type="button" disabled={busy} onClick={() => void onCancel(row.id)} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"><XCircle className="size-3.5" />Cancel</button> : <span className="text-xs text-neutral-300">Locked</span>}</td></tr>)}</tbody></table></div>;
}

function AttendanceCalendar({ data }: { data: MonthlyAttendance | null }) {
  if (!data?.days.length) return <div className="mt-4"><Empty /></div>;
  const blankDays = weekdayMonday(data.days[0].date);
  return <div className="mt-5"><div className="hidden grid-cols-7 gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 md:grid">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="px-2 py-1">{day}</div>)}</div><div className="hidden grid-cols-7 gap-2 md:grid">{Array.from({ length: blankDays }).map((_, index) => <div key={`blank-${index}`} />)}{data.days.map((day) => <div key={day.date} className={`min-h-24 rounded-xl border p-3 ${attendanceTone(day.status)}`}><div className="flex items-start justify-between gap-2"><p className="font-semibold">{dayNumber(day.date)}</p><span className="text-[10px] font-semibold uppercase">{day.status.replaceAll("_", " ")}</span></div>{day.holiday_name ? <p className="mt-2 text-[11px] leading-4">{day.holiday_name}</p> : null}{day.check_in_at ? <p className="mt-2 text-[11px]">In {dateTime(day.check_in_at)}</p> : null}{day.work_minutes ? <p className="mt-1 text-[11px]">Work {duration(day.work_minutes)}</p> : null}</div>)}</div><div className="space-y-2 md:hidden">{data.days.filter((day) => !["future", "not_employed"].includes(day.status)).map((day) => <div key={day.date} className={`flex items-center justify-between gap-4 rounded-xl border p-3 ${attendanceTone(day.status)}`}><div><p className="text-sm font-semibold">{day.date}</p><p className="mt-1 text-xs capitalize">{day.status.replaceAll("_", " ")}{day.holiday_name ? ` · ${day.holiday_name}` : ""}</p></div><div className="text-right text-xs"><p>{day.check_in_at ? `In ${dateTime(day.check_in_at)}` : ""}</p>{day.work_minutes ? <p className="mt-1">{duration(day.work_minutes)}</p> : null}</div></div>)}</div><div className="mt-4 flex flex-wrap gap-2 text-[11px] text-neutral-500"><span className="rounded-full bg-emerald-50 px-2 py-1">Present</span><span className="rounded-full bg-amber-50 px-2 py-1">Late</span><span className="rounded-full bg-red-50 px-2 py-1">Absent</span><span className="rounded-full bg-blue-50 px-2 py-1">Leave</span><span className="rounded-full bg-orange-50 px-2 py-1">Missing record</span><span className="rounded-full bg-violet-50 px-2 py-1">Holiday / Off</span></div></div>;
}

function PerformanceItem({ row, busy, onSave }: { row: SelfData["performance"][number]; busy: boolean; onSave: (id: string, text: string) => Promise<void> }) {
  const [text, setText] = useState(row.self_review || "");
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{row.period_start} — {row.period_end}</p><p className="mt-1 text-xs capitalize text-neutral-500">{row.status.replaceAll("_", " ")}</p></div><div className="flex items-center gap-1 font-semibold"><Star className="size-4" />{row.rating || "—"}</div></div>{row.status !== "completed" ? <><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Write your self review…" className="mt-3 min-h-24 w-full rounded-lg border p-3 text-sm" /><button type="button" disabled={busy || !text.trim()} onClick={() => void onSave(row.id, text)} className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40">Save self review</button></> : row.self_review ? <p className="mt-3 text-sm text-neutral-600">{row.self_review}</p> : null}{row.manager_review ? <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600"><strong>Manager:</strong> {row.manager_review}</div> : null}</div>;
}

function MetricCard({ icon: Icon, label, value, emphasis = false }: { icon: typeof UserRound; label: string; value: string; emphasis?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-4 shadow-sm ${emphasis ? "border-amber-200" : ""}`}><div className="flex items-center justify-between gap-2 text-xs text-neutral-500"><span>{label}</span><Icon className={`size-4 ${emphasis ? "text-amber-500" : "text-neutral-300"}`} /></div><p className={`mt-3 truncate text-lg font-semibold capitalize ${emphasis ? "text-amber-800" : ""}`}>{value}</p></div>;
}
function AttendanceMetric({ label, value, critical = false, warning = false }: { label: string; value: string | number; critical?: boolean; warning?: boolean }) { return <div className={`rounded-xl border px-3 py-2 ${critical ? "border-red-200 bg-red-50" : warning ? "border-orange-200 bg-orange-50" : "bg-neutral-50"}`}><p className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</p><p className={`mt-1 text-sm font-semibold ${critical ? "text-red-700" : warning ? "text-orange-700" : ""}`}>{value}</p></div>; }
function MiniStat({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-neutral-50 px-2 py-2"><p className="text-[10px] text-neutral-400">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>; }
function Info({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) { return <div className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><Icon className="size-4 text-neutral-500" /></div><div><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div></div>; }
function Field({ name, label, type }: { name: string; label: string; type: string }) { return <label className="block text-sm font-medium">{label}<input name={name} type={type} required className="mt-2 h-11 w-full rounded-xl border px-3 font-normal" /></label>; }
function Section({ title, subtitle, children, extraClass = "" }: { title: string; subtitle?: string; children: React.ReactNode; extraClass?: string }) { return <section className={`${extraClass} rounded-2xl border bg-white p-5 shadow-sm`}><h2 className="font-semibold">{title}</h2>{subtitle ? <p className="mt-1 text-xs leading-5 text-neutral-500">{subtitle}</p> : null}<div className="mt-4">{children}</div></section>; }
function Empty() { return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-neutral-400"><FileText className="mx-auto mb-2 size-5" />No records yet.</div>; }
