"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock3, Loader2, Plus, Settings2, UsersRound, X } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";

type Employee = { id: string; employee_code: string; name: string };
type LeaveType = { id: string; name: string; code: string; annual_allowance_days: string; is_paid: boolean };
type Shift = { id: string; name: string; start_time: string; end_time: string };
type Meta = { employees: Employee[]; departments: { id: string; name: string }[]; leave_types: LeaveType[]; shifts: Shift[] };
type Holiday = { id: string; name: string; holiday_date: string; is_paid: boolean; notes?: string | null };
type Assignment = { id: string; employee_id: string; employee_code: string; employee_name: string; shift_id: string; shift_name: string; effective_from: string; effective_to?: string | null };
type Modal = "leave" | "shift" | "assignment" | "holiday" | null;

const input = "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function HRSettingsPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api/hr${path}`, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "HR settings request failed.");
    return payload as T;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [m, h, a] = await Promise.all([api<Meta>("/meta"), api<Holiday[]>("/holidays"), api<Assignment[]>("/shift-assignments")]); setMeta(m); setHolidays(h); setAssignments(a); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load HR settings."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function mutate(action: () => Promise<void>, success: string) { setSaving(true); setError(null); setMessage(null); try { await action(); setMessage(success); setModal(null); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save HR settings."); } finally { setSaving(false); } }
  async function addLeave(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const f = new FormData(event.currentTarget); await mutate(async () => { await api("/leave-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(f.get("name") || "").trim(), code: String(f.get("code") || "").trim().toUpperCase(), annual_allowance_days: Number(f.get("allowance") || 0), is_paid: f.get("is_paid") === "on", requires_approval: f.get("requires_approval") === "on" }) }); }, "Leave policy added"); }
  async function addShift(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const f = new FormData(event.currentTarget); await mutate(async () => { await api("/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(f.get("name") || "").trim(), start_time: String(f.get("start_time") || ""), end_time: String(f.get("end_time") || ""), break_minutes: Number(f.get("break_minutes") || 0), grace_minutes: Number(f.get("grace_minutes") || 0), weekly_off_days: f.getAll("weekly_off_days").map(Number) }) }); }, "Work schedule created"); }
  async function assignShift(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const f = new FormData(event.currentTarget); await mutate(async () => { await api("/shift-assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: String(f.get("employee_id") || ""), shift_id: String(f.get("shift_id") || ""), effective_from: String(f.get("effective_from") || "") }) }); }, "Work schedule assigned"); }
  async function addHoliday(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const f = new FormData(event.currentTarget); await mutate(async () => { await api("/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(f.get("name") || "").trim(), holiday_date: String(f.get("holiday_date") || ""), is_paid: f.get("is_paid") === "on", notes: String(f.get("notes") || "").trim() || null }) }); }, "Holiday added"); }

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  const employeeOptions = (meta?.employees ?? []).map(e => ({ value: e.id, label: `${e.name} · ${e.employee_code}` }));
  const shiftOptions = (meta?.shifts ?? []).map(s => ({ value: s.id, label: `${s.name} · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` }));

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1400px]">
    <header><p className="text-sm font-medium text-neutral-500">Set once, reuse every day</p><h1 className="mt-1 text-3xl font-semibold">HR Settings</h1><p className="mt-2 max-w-2xl text-sm text-neutral-500">Keep setup practical: leave types, work schedules and holidays. Departments, designations and roles stay with your People directory.</p></header>
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}{error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <div className="mt-7 grid gap-6 lg:grid-cols-2">
      <Panel icon={CalendarDays} title="Leave policy" text="Create only the leave types your company uses." action="Add leave type" onAction={() => setModal("leave")}><div className="space-y-2">{meta?.leave_types.length ? meta.leave_types.map(item => <Row key={item.id} title={item.name} text={`${item.code} · ${Number(item.annual_allowance_days)} day(s) / year · ${item.is_paid ? "Paid" : "Unpaid"}`} />) : <Empty text="No leave types yet." />}</div></Panel>
      <Panel icon={Clock3} title="Work schedules" text="Working hours, grace time and weekly days off drive self attendance." action="Add schedule" onAction={() => setModal("shift")}><div className="space-y-2">{meta?.shifts.length ? meta.shifts.map(item => <Row key={item.id} title={item.name} text={`${item.start_time.slice(0, 5)} → ${item.end_time.slice(0, 5)}`} />) : <Empty text="No work schedules yet." />}</div></Panel>
      <Panel icon={UsersRound} title="Schedule assignments" text="Assign a schedule when an employee has fixed working hours." action="Assign schedule" onAction={() => setModal("assignment")}><div className="space-y-2">{assignments.length ? assignments.slice(0, 12).map(item => <Row key={item.id} title={item.employee_name} text={`${item.shift_name} · from ${item.effective_from}`} />) : <Empty text="No schedule assignments yet." />}</div></Panel>
      <Panel icon={CalendarDays} title="Holiday calendar" text="Add public or company holidays for a clear people calendar." action="Add holiday" onAction={() => setModal("holiday")}><div className="space-y-2">{holidays.length ? holidays.slice(0, 12).map(item => <Row key={item.id} title={item.name} text={`${item.holiday_date} · ${item.is_paid ? "Paid" : "Unpaid"}`} />) : <Empty text="No holidays added yet." />}</div></Panel>
    </div>
    <section className="mt-6 flex flex-col gap-4 rounded-2xl border bg-white p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Departments, designations and access roles</h2><p className="mt-1 text-sm text-neutral-500">Manage team structure next to the employee directory instead of duplicating it in HR setup.</p></div><Link href="/dashboard/hr/people" className="h-10 shrink-0 rounded-xl border px-4 py-2.5 text-sm font-semibold">Open People</Link></section>
  </div>

  {modal === "leave" ? <Modal title="Add leave type" onClose={() => setModal(null)}><form onSubmit={addLeave} className="space-y-4"><Field label="Name" name="name" required placeholder="Annual leave" /><Field label="Short code" name="code" required placeholder="AL" /><Field label="Annual allowance (days)" name="allowance" type="number" defaultValue="0" required /><Toggle name="is_paid" title="Paid leave" text="Leave days are treated as paid time." defaultChecked /><Toggle name="requires_approval" title="Requires approval" text="A manager must approve employee requests." defaultChecked /><Submit saving={saving} label="Add leave type" /></form></Modal> : null}
  {modal === "shift" ? <Modal title="Add work schedule" onClose={() => setModal(null)}><form onSubmit={addShift} className="space-y-4"><Field label="Schedule name" name="name" required placeholder="Standard office hours" /><div className="grid gap-4 sm:grid-cols-2"><Field label="Starts" name="start_time" type="time" required /><Field label="Ends" name="end_time" type="time" required /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Break (minutes)" name="break_minutes" type="number" defaultValue="60" /><Field label="Grace time (minutes)" name="grace_minutes" type="number" defaultValue="10" /></div><div><p className="text-sm font-medium">Weekly days off</p><p className="mt-1 text-xs text-neutral-500">Select your company&apos;s actual weekly days off; no country-specific weekend is assumed.</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{days.map((day, index) => <label key={day} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"><input type="checkbox" name="weekly_off_days" value={index} />{day}</label>)}</div></div><p className="rounded-xl bg-neutral-50 p-3 text-xs leading-5 text-neutral-500">Overnight schedules are supported. Attendance overtime uses the assigned schedule; without one, the system keeps the existing 8-hour fallback.</p><Submit saving={saving} label="Create schedule" /></form></Modal> : null}
  {modal === "assignment" ? <Modal title="Assign work schedule" onClose={() => setModal(null)}><form onSubmit={assignShift} className="space-y-4"><SearchableSelect label="Employee" name="employee_id" required clearable={false} options={employeeOptions} searchPlaceholder="Search employee..." /><SearchableSelect label="Schedule" name="shift_id" required clearable={false} options={shiftOptions} searchPlaceholder="Search schedule..." /><Field label="Effective from" name="effective_from" type="date" required /><Submit saving={saving} label="Assign schedule" /></form></Modal> : null}
  {modal === "holiday" ? <Modal title="Add holiday" onClose={() => setModal(null)}><form onSubmit={addHoliday} className="space-y-4"><Field label="Holiday name" name="name" required placeholder="National holiday" /><Field label="Date" name="holiday_date" type="date" required /><Toggle name="is_paid" title="Paid holiday" text="This is a paid company holiday." defaultChecked /><label className="block text-sm font-medium">Notes<textarea name="notes" className="mt-2 min-h-20 w-full rounded-xl border p-3 text-sm" /></label><Submit saving={saving} label="Add holiday" /></form></Modal> : null}
  </main>;
}

function Panel({ icon: Icon, title, text, action, onAction, children }: { icon: typeof Settings2; title: string; text: string; action: string; onAction: () => void; children: React.ReactNode }) { return <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><Icon className="size-4" /></span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-neutral-500">{text}</p></div></div><button onClick={onAction} className="shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold"><Plus className="mr-1 inline size-3" />{action}</button></div><div className="mt-5 border-t pt-4">{children}</div></section>; }
function Row({ title, text }: { title: string; text: string }) { return <div className="rounded-xl border px-4 py-3"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-neutral-500">{text}</p></div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-neutral-400">{text}</p>; }
function Field({ label, name, type = "text", required = false, placeholder, defaultValue }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string }) { return <label className="block text-sm font-medium">{label}<input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.5" : undefined} className={`mt-2 ${input}`} /></label>; }
function Toggle({ name, title, text, defaultChecked = false }: { name: string; title: string; text: string; defaultChecked?: boolean }) { return <label className="flex items-center gap-3 rounded-xl border p-4 text-sm"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" /><span><span className="block font-medium">{title}</span><span className="mt-0.5 block text-xs text-neutral-500">{text}</span></span></label>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{children}</div></div>; }
function Submit({ saving, label }: { saving: boolean; label: string }) { return <div className="flex justify-end border-t pt-5"><button disabled={saving} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : label}</button></div>; }
