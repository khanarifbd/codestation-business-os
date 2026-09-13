"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Clock3, Loader2, Plus, Search, UserCheck, X } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import type { HRAccess } from "@/components/hr-module-nav";

type Employee = { id: string; employee_code: string; name: string };
type Meta = { employees: Employee[] };
type Summary = { today: string; timezone: string; metrics: { present_today: number; absent_today: number; on_leave_today: number }; attention: { pending_leave: number } };
type Attendance = { id: string; employee_id: string; employee_name: string | null; attendance_date: string; status: string; work_minutes: number; overtime_minutes: number; notes?: string | null };
type Leave = { id: string; employee_id: string; employee_name: string | null; leave_type_name: string | null; start_date: string; end_date: string; days: string; reason?: string | null; status: string; review_notes?: string | null };
type View = "attendance" | "leave";

const input = "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";

export default function HRTimePage() {
  const [access, setAccess] = useState<HRAccess | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [view, setView] = useState<View>("attendance");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api/hr${path}`, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "HR request failed.");
    return payload as T;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextAccess, nextMeta, nextSummary, nextAttendance, nextLeaves] = await Promise.all([
        api<HRAccess>("/access"), api<Meta>("/meta"), api<Summary>("/workspace-summary"), api<Attendance[]>("/attendance"), api<Leave[]>("/leave-requests"),
      ]);
      setAccess(nextAccess); setMeta(nextMeta); setSummary(nextSummary); setAttendance(nextAttendance); setLeaves(nextLeaves);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load time and leave."); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const attendanceRows = useMemo(() => filterBySearch(attendance, search, row => `${row.employee_name ?? ""} ${row.attendance_date} ${row.status}`), [attendance, search]);
  const leaveRows = useMemo(() => filterBySearch(leaves, search, row => `${row.employee_name ?? ""} ${row.leave_type_name ?? ""} ${row.status} ${row.start_date}`), [leaves, search]);
  const employeeOptions = (meta?.employees ?? []).map(e => ({ value: e.id, label: `${e.name} · ${e.employee_code}` }));

  async function addAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const hours = Math.max(0, Number(form.get("hours") || 0));
    const overtimeHours = Math.max(0, Number(form.get("overtime_hours") || 0));
    setSaving(true); setError(null); setMessage(null);
    try {
      await api("/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        employee_id: String(form.get("employee_id") || ""), attendance_date: String(form.get("attendance_date") || ""), status: String(form.get("status") || "present"), work_minutes: Math.round(hours * 60), overtime_minutes: Math.round(overtimeHours * 60), notes: String(form.get("notes") || "").trim() || null,
      }) });
      setMessage("Attendance recorded"); setFormOpen(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to record attendance."); }
    finally { setSaving(false); }
  }

  async function reviewLeave(id: string, status: "approved" | "rejected") {
    setSaving(true); setError(null); setMessage(null);
    try {
      await api(`/leave-requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      setLeaves(current => current.map(item => item.id === id ? { ...item, status } : item));
      setMessage(`Leave request ${status}`);
      const nextSummary = await api<Summary>("/workspace-summary"); setSummary(nextSummary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to review leave."); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-neutral-500">Everyday people operations</p><h1 className="mt-1 text-3xl font-semibold">Time & Leave</h1><p className="mt-2 max-w-2xl text-sm text-neutral-500">See who is working, handle exceptions and approve leave. Employees can check in and request their own leave from My HR.</p></div><div className="flex gap-2">{access?.can_self ? <Link href="/dashboard/hr/me" className="flex h-11 items-center rounded-xl border bg-white px-4 text-sm font-semibold">Open My HR</Link> : null}{access?.can_manage ? <button onClick={() => setFormOpen(true)} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Plus className="size-4" />Record attendance</button> : null}</div></header>

    {summary ? <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Working today" value={summary.metrics.present_today} icon={UserCheck} /><Metric label="Recorded absent" value={summary.metrics.absent_today} icon={X} /><Metric label="On approved leave" value={summary.metrics.on_leave_today} icon={CalendarClock} /><Metric label="Leave to review" value={summary.attention.pending_leave} icon={Clock3} /></div> : null}
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}{error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex gap-1 rounded-xl bg-neutral-100 p-1"><button onClick={() => setView("attendance")} className={`rounded-lg px-4 py-2 text-sm font-medium ${view === "attendance" ? "bg-white shadow-sm" : "text-neutral-500"}`}>Attendance</button><button onClick={() => setView("leave")} className={`rounded-lg px-4 py-2 text-sm font-medium ${view === "leave" ? "bg-white shadow-sm" : "text-neutral-500"}`}>Leave</button></div><div className="relative w-full sm:w-80"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people, date or status..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm" /></div></div>
      {view === "attendance" ? <AttendanceTable rows={attendanceRows} /> : <LeaveTable rows={leaveRows} canManage={Boolean(access?.can_manage)} saving={saving} onReview={reviewLeave} />}
    </section>
  </div>

  {formOpen ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setFormOpen(false); }}><form onSubmit={addAttendance} className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">Record attendance</h2><p className="mt-1 text-sm text-neutral-500">Use this only when attendance needs a manual record or correction.</p></div><button type="button" onClick={() => setFormOpen(false)} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="mt-6 space-y-4"><SearchableSelect label="Employee" name="employee_id" required clearable={false} options={employeeOptions} searchPlaceholder="Search employee..." /><label className="block text-sm font-medium">Date<input name="attendance_date" type="date" required defaultValue={summary?.today} className={`mt-2 ${input}`} /></label><label className="block text-sm font-medium">Status<select name="status" defaultValue="present" className={`mt-2 ${input}`}><option value="present">Present</option><option value="late">Late</option><option value="remote">Remote</option><option value="absent">Absent</option></select></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Worked hours<input name="hours" type="number" min="0" step="0.25" defaultValue="8" className={`mt-2 ${input}`} /></label><label className="block text-sm font-medium">Overtime hours<input name="overtime_hours" type="number" min="0" step="0.25" defaultValue="0" className={`mt-2 ${input}`} /></label></div><label className="block text-sm font-medium">Note<textarea name="notes" className="mt-2 min-h-20 w-full rounded-xl border p-3 text-sm" placeholder="Optional context" /></label></div><div className="mt-6 flex justify-end gap-2 border-t pt-5"><button type="button" onClick={() => setFormOpen(false)} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save attendance"}</button></div></form></div> : null}
  </main>;
}

function AttendanceTable({ rows }: { rows: Attendance[] }) { if (!rows.length) return <Empty text="No attendance records found." />; return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-400"><tr><th className="px-5 py-3">Employee</th><th>Date</th><th>Status</th><th>Worked</th><th>Overtime</th><th className="pr-5">Note</th></tr></thead><tbody className="divide-y">{rows.map(row => <tr key={row.id}><td className="px-5 py-4 font-medium">{row.employee_name ?? "Employee"}</td><td>{row.attendance_date}</td><td><Status value={row.status} /></td><td>{minutes(row.work_minutes)}</td><td>{minutes(row.overtime_minutes)}</td><td className="pr-5 text-neutral-500">{row.notes || "—"}</td></tr>)}</tbody></table></div>; }
function LeaveTable({ rows, canManage, saving, onReview }: { rows: Leave[]; canManage: boolean; saving: boolean; onReview: (id: string, status: "approved" | "rejected") => void }) { if (!rows.length) return <Empty text="No leave requests found." />; return <div className="divide-y">{rows.map(row => <div key={row.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{row.employee_name ?? "Employee"}</p><Status value={row.status} /></div><p className="mt-1 text-sm text-neutral-500">{row.leave_type_name ?? "Leave"} · {row.start_date} → {row.end_date} · {Number(row.days)} day(s)</p>{row.reason ? <p className="mt-2 text-sm text-neutral-600">{row.reason}</p> : null}</div>{canManage && row.status === "pending" ? <div className="flex gap-2"><button disabled={saving} onClick={() => onReview(row.id, "rejected")} className="h-10 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50">Reject</button><button disabled={saving} onClick={() => onReview(row.id, "approved")} className="flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Check className="size-4" />Approve</button></div> : null}</div>)}</div>; }
function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof UserCheck }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-3xl font-semibold">{value}</p></article>; }
function Status({ value }: { value: string }) { const cls = value === "approved" || value === "present" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : value === "rejected" || value === "absent" ? "border-red-200 bg-red-50 text-red-700" : value === "pending" || value === "late" ? "border-amber-200 bg-amber-50 text-amber-700" : "bg-neutral-50 text-neutral-600"; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${cls}`}>{value.replaceAll("_", " ")}</span>; }
function Empty({ text }: { text: string }) { return <div className="px-6 py-16 text-center text-sm text-neutral-400">{text}</div>; }
function minutes(value: number) { const h = Math.floor((value || 0) / 60); const m = (value || 0) % 60; return `${h}h ${m}m`; }
function filterBySearch<T>(rows: T[], search: string, text: (row: T) => string) { const needle = search.trim().toLowerCase(); return needle ? rows.filter(row => text(row).toLowerCase().includes(needle)) : rows; }
