"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
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

type Meta = { leave_types: { id: string; name: string; annual_allowance_days: string; is_paid: boolean }[] };
type PolicyAck = Record<string, string>;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
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

export default function MyHRPage() {
  const [data, setData] = useState<SelfData | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [acks, setAcks] = useState<PolicyAck>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [self, selfMeta, acknowledgements] = await Promise.all([
        api<SelfData>("/api/hr/self"),
        api<Meta>("/api/hr/self-meta"),
        api<PolicyAck>("/api/hr/self/policy-acknowledgements"),
      ]);
      setData(self);
      setMeta(selfMeta);
      setAcks(acknowledgements);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load My HR & Pay");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

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
      setData(await api<SelfData>("/api/hr/self"));
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
      setData(await api<SelfData>("/api/hr/self"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to request leave");
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
      setData(await api<SelfData>("/api/hr/self"));
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

    <div className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={requestLeave} className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Request leave</h2><p className="mt-1 text-xs leading-5 text-neutral-500">Choose the leave policy and dates. Approval status will appear in your history automatically.</p>
        <div className="mt-4 space-y-4"><SearchableSelect label="Leave type" name="leave_type_id" required options={leaveOptions} /><Field name="start_date" label="Start date" type="date" /><Field name="end_date" label="End date" type="date" /><label className="block text-sm font-medium">Reason <span className="font-normal text-neutral-400">(optional)</span><textarea name="reason" className="mt-2 min-h-24 w-full rounded-xl border p-3 font-normal" /></label><button disabled={busy} className="h-11 w-full rounded-xl bg-neutral-950 text-sm font-semibold text-white disabled:opacity-50">Submit leave request</button></div>
      </form>
      <Section title="Leave history" subtitle="Your latest leave requests and their review status."><SimpleTable headers={["Type", "Dates", "Days", "Status"]} rows={data.leave_requests.map((item) => [item.leave_type || "—", `${item.start_date} — ${item.end_date}`, item.days, item.status])} /></Section>
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Section title="Recent attendance" subtitle="Check-in, check-out and recorded work duration."><SimpleTable headers={["Date", "Status", "Check in", "Check out", "Work"]} rows={data.attendance.slice(0, 20).map((item) => [item.date, item.status, dateTime(item.check_in_at), dateTime(item.check_out_at), duration(item.work_minutes)])} /></Section>
      <Section title="My documents" subtitle="Employee documents shared with your HR profile."><div className="space-y-3">{data.documents.length ? data.documents.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl border p-4"><div className="min-w-0"><p className="truncate font-medium">{item.title}</p><p className="mt-1 text-xs capitalize text-neutral-500">{item.document_type.replaceAll("_", " ")} · Expiry {item.expires_on || "N/A"}</p></div>{item.file_url ? <a href={`/api/hr-documents/self/${item.id}/file`} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-medium underline">Open</a> : null}</div>) : <Empty />}</div></Section>
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Section title="Performance" subtitle="Complete your self-review and see manager feedback when available."><div className="space-y-3">{data.performance.length ? data.performance.map((item) => <PerformanceItem key={item.id} row={item} busy={busy} onSave={saveSelfReview} />) : <Empty />}</div></Section>
      <Section title="Payslips" subtitle="Only approved or paid payroll records are shown here."><div className="space-y-3">{data.payslips.length ? data.payslips.map((item) => <Link key={item.entry_id} href={`/dashboard/hr/me/payslips/${item.entry_id}`} className="flex items-center justify-between gap-4 rounded-xl border p-4 transition hover:border-neutral-300 hover:bg-neutral-50"><div className="min-w-0"><div className="flex items-center gap-2"><ReceiptText className="size-4 text-neutral-400" /><p className="truncate font-medium">{item.period_name}</p></div><p className="mt-1 text-xs text-neutral-500">{item.run_number} · <span className="capitalize">{item.status}</span> · Gross {money(item.gross_pay, item.currency)}</p></div><div className="shrink-0 text-right"><p className="font-semibold">{money(item.net_pay, item.currency)}</p><p className="mt-1 text-xs text-neutral-400">View private payslip</p></div></Link>) : <Empty />}</div></Section>
    </div>

    <Section title="Policies & announcements" subtitle="Acknowledge required company policies so HR has a reliable audit trail." extraClass="mt-5"><div className="grid gap-3 md:grid-cols-2">{data.announcements.length ? data.announcements.map((item) => <div key={item.id} className="rounded-xl border p-4"><div className="flex items-center gap-2"><Megaphone className="size-4" /><p className="font-medium">{item.title}</p>{item.is_policy ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">POLICY</span> : null}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{item.body}</p>{item.is_policy ? <div className="mt-4">{acks[item.id] ? <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" />Acknowledged</div> : <button type="button" disabled={busy} onClick={() => void acknowledge(item.id)} className="rounded-lg bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Acknowledge policy</button>}</div> : null}</div>) : <Empty />}</div></Section>
  </div></main>;
}

function PerformanceItem({ row, busy, onSave }: { row: SelfData["performance"][number]; busy: boolean; onSave: (id: string, text: string) => Promise<void> }) {
  const [text, setText] = useState(row.self_review || "");
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{row.period_start} — {row.period_end}</p><p className="mt-1 text-xs capitalize text-neutral-500">{row.status.replaceAll("_", " ")}</p></div><div className="flex items-center gap-1 font-semibold"><Star className="size-4" />{row.rating || "—"}</div></div>{row.status !== "completed" ? <><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Write your self review…" className="mt-3 min-h-24 w-full rounded-lg border p-3 text-sm" /><button type="button" disabled={busy || !text.trim()} onClick={() => void onSave(row.id, text)} className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40">Save self review</button></> : row.self_review ? <p className="mt-3 text-sm text-neutral-600">{row.self_review}</p> : null}{row.manager_review ? <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600"><strong>Manager:</strong> {row.manager_review}</div> : null}</div>;
}

function MetricCard({ icon: Icon, label, value, emphasis = false }: { icon: typeof UserRound; label: string; value: string; emphasis?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-4 shadow-sm ${emphasis ? "border-amber-200" : ""}`}><div className="flex items-center justify-between gap-2 text-xs text-neutral-500"><span>{label}</span><Icon className={`size-4 ${emphasis ? "text-amber-500" : "text-neutral-300"}`} /></div><p className={`mt-3 truncate text-lg font-semibold capitalize ${emphasis ? "text-amber-800" : ""}`}>{value}</p></div>;
}
function Info({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) { return <div className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><Icon className="size-4 text-neutral-500" /></div><div><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div></div>; }
function Field({ name, label, type }: { name: string; label: string; type: string }) { return <label className="block text-sm font-medium">{label}<input name={name} type={type} required className="mt-2 h-11 w-full rounded-xl border px-3 font-normal" /></label>; }
function Section({ title, subtitle, children, extraClass = "" }: { title: string; subtitle?: string; children: React.ReactNode; extraClass?: string }) { return <section className={`${extraClass} rounded-2xl border bg-white p-5 shadow-sm`}><h2 className="font-semibold">{title}</h2>{subtitle ? <p className="mt-1 text-xs leading-5 text-neutral-500">{subtitle}</p> : null}<div className="mt-4">{children}</div></section>; }
function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) { if (!rows.length) return <Empty />; return <div className="overflow-x-auto rounded-xl border"><table className="min-w-full text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-400"><tr>{headers.map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr></thead><tbody className="divide-y">{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-4 py-3 capitalize">{cell.replaceAll("_", " ")}</td>)}</tr>)}</tbody></table></div>; }
function Empty() { return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-neutral-400"><FileText className="mx-auto mb-2 size-5" />No records yet.</div>; }
