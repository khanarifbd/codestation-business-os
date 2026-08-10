"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, FileText, Gauge, Loader2, Megaphone, Plus, RefreshCw, Star, UserRoundCheck, UsersRound } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";

type Employee = { id: string; employee_code: string; name: string };
type Meta = { employees: Employee[]; departments: { id: string; name: string }[]; leave_types: { id: string; name: string; code: string; annual_allowance_days: string; is_paid: boolean }[]; shifts: { id: string; name: string; start_time: string; end_time: string }[] };
type Dashboard = { active_employees: number; present_today: number; on_leave_today: number; pending_leave: number; documents_expiring_30d: number; open_jobs: number };
type Tab = "attendance" | "leave" | "documents" | "shifts" | "lifecycle" | "performance" | "announcements" | "recruitment";

type Attendance = { id: string; employee_id: string; employee_name: string; attendance_date: string; status: string; work_minutes: number; overtime_minutes: number; notes?: string };
type Leave = { id: string; employee_id: string; employee_name: string; leave_type_id: string; leave_type_name: string; start_date: string; end_date: string; days: string; reason?: string; status: string; review_notes?: string };
type DocumentRow = { id: string; employee_id: string; employee_name: string; title: string; document_type: string; reference_number?: string; issued_on?: string; expires_on?: string; file_url?: string; notes?: string };
type Shift = { id: string; name: string; start_time: string; end_time: string; break_minutes: number; grace_minutes: number; weekly_off_days: number[]; is_active: boolean };
type Lifecycle = { id: string; employee_id: string; employee_name: string; event_type: string; effective_date: string; title: string; details: Record<string, unknown>; notes?: string };
type Performance = { id: string; employee_id: string; employee_name: string; reviewer_employee_id?: string; period_start: string; period_end: string; status: string; goals: Record<string, unknown>[]; self_review?: string; manager_review?: string; rating?: string };
type Announcement = { id: string; title: string; body: string; audience: string; is_policy: boolean; published_at?: string };
type Job = { id: string; title: string; department_id?: string; employment_type: string; location?: string; openings: number; status: string; description?: string };
type Candidate = { id: string; job_opening_id: string; job_title: string; full_name: string; email: string; phone?: string; stage: string; rating?: string; resume_url?: string; notes?: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || `${response.status} ${response.statusText}`);
  return body as T;
}

export default function HRPage() {
  const [tab, setTab] = useState<Tab>("attendance");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);
  useEffect(() => { if (!loaded[tab] && !loading) void loadTab(tab); }, [tab, loaded, loading]);

  async function bootstrap() {
    setLoading(true); setError(null);
    try {
      const [m, d] = await Promise.all([api<Meta>("/api/hr/meta"), api<Dashboard>("/api/hr/dashboard")]);
      setMeta(m); setDashboard(d);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load HR"); }
    finally { setLoading(false); }
  }

  async function loadTab(target: Tab, force = false) {
    if (loaded[target] && !force) return;
    setBusy(true); setError(null);
    try {
      if (target === "recruitment") {
        const [jobs, candidates] = await Promise.all([api<Job[]>("/api/hr/jobs"), api<Candidate[]>("/api/hr/candidates")]);
        setData((old) => ({ ...old, jobs, candidates }));
      } else {
        const endpoint: Record<Exclude<Tab, "recruitment">, string> = {
          attendance: "attendance", leave: "leave-requests", documents: "documents", shifts: "shifts",
          lifecycle: "lifecycle", performance: "performance", announcements: "announcements",
        };
        const rows = await api<unknown[]>(`/api/hr/${endpoint[target as Exclude<Tab, "recruitment">]}`);
        setData((old) => ({ ...old, [target]: rows }));
      }
      setLoaded((old) => ({ ...old, [target]: true }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load HR section"); }
    finally { setBusy(false); }
  }

  async function submit(path: string, payload: Record<string, unknown>, message: string) {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await api(`/api/hr/${path}`, { method: "POST", body: JSON.stringify(payload) });
      setSuccess(message); setLoaded((old) => ({ ...old, [tab]: false }));
      await Promise.all([loadTab(tab, true), api<Dashboard>("/api/hr/dashboard").then(setDashboard), api<Meta>("/api/hr/meta").then(setMeta)]);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed"); return false; }
    finally { setBusy(false); }
  }

  async function patch(path: string, payload: Record<string, unknown>, message: string) {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await api(`/api/hr/${path}`, { method: "PATCH", body: JSON.stringify(payload) });
      setSuccess(message); await loadTab(tab, true); setDashboard(await api<Dashboard>("/api/hr/dashboard"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed"); }
    finally { setBusy(false); }
  }

  const employeeOptions = useMemo(() => (meta?.employees ?? []).map((x) => ({ value: x.id, label: `${x.employee_code} · ${x.name}` })), [meta]);
  const leaveTypeOptions = useMemo(() => (meta?.leave_types ?? []).map((x) => ({ value: x.id, label: `${x.name} · ${x.annual_allowance_days} days` })), [meta]);
  const departmentOptions = useMemo(() => (meta?.departments ?? []).map((x) => ({ value: x.id, label: x.name })), [meta]);
  const jobOptions = useMemo(() => ((data.jobs as Job[] | undefined) ?? []).filter((x) => x.status === "open").map((x) => ({ value: x.id, label: x.title })), [data.jobs]);

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;

  const tabs: { id: Tab; label: string }[] = [
    { id: "attendance", label: "Attendance" }, { id: "leave", label: "Leave" }, { id: "documents", label: "Documents" },
    { id: "shifts", label: "Shifts" }, { id: "lifecycle", label: "Lifecycle" }, { id: "performance", label: "Performance" },
    { id: "announcements", label: "Policies & News" }, { id: "recruitment", label: "Recruitment" },
  ];

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1550px]">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm text-neutral-500">People operations</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">HR Management</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Attendance, leave, employee documents, lifecycle, schedules, performance, policies and recruitment in one workspace.</p></div><button onClick={() => void loadTab(tab, true)} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`}/>Refresh</button></header>

    {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {success ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Metric icon={UsersRound} label="Active employees" value={dashboard?.active_employees ?? 0}/><Metric icon={UserRoundCheck} label="Present today" value={dashboard?.present_today ?? 0}/><Metric icon={CalendarDays} label="On leave" value={dashboard?.on_leave_today ?? 0}/><Metric icon={Gauge} label="Pending leave" value={dashboard?.pending_leave ?? 0}/><Metric icon={FileText} label="Docs expiring" value={dashboard?.documents_expiring_30d ?? 0}/><Metric icon={UsersRound} label="Open jobs" value={dashboard?.open_jobs ?? 0}/>
    </div>

    <div className="mt-6 flex gap-2 overflow-x-auto rounded-2xl border bg-white p-2 shadow-sm">{tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium ${tab === item.id ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}>{item.label}</button>)}</div>
    {busy && !loaded[tab] ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400"/></div> : null}

    {tab === "attendance" && loaded.attendance ? <AttendanceTab rows={(data.attendance as Attendance[]) ?? []} employees={employeeOptions} busy={busy} submit={submit}/> : null}
    {tab === "leave" && loaded.leave ? <LeaveTab rows={(data.leave as Leave[]) ?? []} employees={employeeOptions} leaveTypes={leaveTypeOptions} busy={busy} submit={submit} patch={patch}/> : null}
    {tab === "documents" && loaded.documents ? <DocumentsTab rows={(data.documents as DocumentRow[]) ?? []} employees={employeeOptions} busy={busy} submit={submit}/> : null}
    {tab === "shifts" && loaded.shifts ? <ShiftsTab rows={(data.shifts as Shift[]) ?? []} busy={busy} submit={submit}/> : null}
    {tab === "lifecycle" && loaded.lifecycle ? <LifecycleTab rows={(data.lifecycle as Lifecycle[]) ?? []} employees={employeeOptions} busy={busy} submit={submit}/> : null}
    {tab === "performance" && loaded.performance ? <PerformanceTab rows={(data.performance as Performance[]) ?? []} employees={employeeOptions} busy={busy} submit={submit} patch={patch}/> : null}
    {tab === "announcements" && loaded.announcements ? <AnnouncementsTab rows={(data.announcements as Announcement[]) ?? []} busy={busy} submit={submit}/> : null}
    {tab === "recruitment" && loaded.recruitment ? <RecruitmentTab jobs={(data.jobs as Job[]) ?? []} candidates={(data.candidates as Candidate[]) ?? []} departments={departmentOptions} jobOptions={jobOptions} busy={busy} submit={submit} patch={patch}/> : null}
  </div></main>;
}

function AttendanceTab({ rows, employees, busy, submit }: { rows: Attendance[]; employees: { value: string; label: string }[]; busy: boolean; submit: Function }) {
  async function onSubmit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = e.currentTarget; const d = new FormData(f); if (await submit("attendance", { employee_id: d.get("employee_id"), attendance_date: d.get("attendance_date"), status: d.get("status"), work_minutes: Number(d.get("work_minutes") || 0), overtime_minutes: Number(d.get("overtime_minutes") || 0), notes: d.get("notes") || null }, "Attendance saved.")) f.reset(); }
  return <Grid><Form title="Attendance entry" onSubmit={onSubmit} busy={busy}><SearchableSelect label="Employee" name="employee_id" required options={employees} placeholder="Select employee"/><Input name="attendance_date" label="Date" type="date" required/><Select name="status" label="Status" options={["present","late","absent","remote","holiday"]}/><Input name="work_minutes" label="Work minutes" type="number" defaultValue="480"/><Input name="overtime_minutes" label="Overtime minutes" type="number" defaultValue="0"/><Textarea name="notes" label="Notes"/><Submit text="Save attendance"/></Form><List title="Attendance"><Table headers={["Employee","Date","Status","Work","OT"]} rows={rows.map(x => [x.employee_name, x.attendance_date, x.status, `${x.work_minutes}m`, `${x.overtime_minutes}m`])}/></List></Grid>;
}

function LeaveTab({ rows, employees, leaveTypes, busy, submit, patch }: { rows: Leave[]; employees: {value:string;label:string}[]; leaveTypes:{value:string;label:string}[]; busy:boolean; submit:Function; patch:Function }) {
  async function onSubmit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f=e.currentTarget,d=new FormData(f); if(await submit("leave-requests",{employee_id:d.get("employee_id"),leave_type_id:d.get("leave_type_id"),start_date:d.get("start_date"),end_date:d.get("end_date"),reason:d.get("reason")||null},"Leave request created.")) f.reset(); }
  return <Grid><Form title="Leave request" onSubmit={onSubmit} busy={busy}><SearchableSelect label="Employee" name="employee_id" required options={employees}/><SearchableSelect label="Leave type" name="leave_type_id" required options={leaveTypes}/><Input name="start_date" label="Start" type="date" required/><Input name="end_date" label="End" type="date" required/><Textarea name="reason" label="Reason"/><Submit text="Create request"/></Form><List title="Leave requests"><div className="space-y-3">{rows.map(x=><div key={x.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{x.employee_name} · {x.leave_type_name}</p><p className="mt-1 text-xs text-neutral-500">{x.start_date} — {x.end_date} · {x.days} days</p></div><Badge value={x.status}/></div>{x.status==="pending"?<div className="mt-3 flex gap-2"><button onClick={()=>void patch(`leave-requests/${x.id}`,{status:"approved"},"Leave approved.")} className="rounded-lg bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white">Approve</button><button onClick={()=>void patch(`leave-requests/${x.id}`,{status:"rejected"},"Leave rejected.")} className="rounded-lg border px-3 py-1.5 text-xs">Reject</button></div>:null}</div>)}</div></List></Grid>;
}

function DocumentsTab({ rows, employees, busy, submit }: { rows: DocumentRow[]; employees:{value:string;label:string}[];busy:boolean;submit:Function }) {
  async function onSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(await submit("documents",{employee_id:d.get("employee_id"),title:d.get("title"),document_type:d.get("document_type"),reference_number:d.get("reference_number")||null,issued_on:d.get("issued_on")||null,expires_on:d.get("expires_on")||null,file_url:d.get("file_url")||null,notes:d.get("notes")||null},"Document saved."))f.reset();}
  return <Grid><Form title="Employee document" onSubmit={onSubmit} busy={busy}><SearchableSelect label="Employee" name="employee_id" required options={employees}/><Input name="title" label="Title" required/><Select name="document_type" label="Type" options={["contract","nid","passport","certificate","visa","work_permit","other"]}/><Input name="reference_number" label="Reference"/><Input name="issued_on" label="Issued on" type="date"/><Input name="expires_on" label="Expires on" type="date"/><Input name="file_url" label="Document URL"/><Textarea name="notes" label="Notes"/><Submit text="Save document"/></Form><List title="Employee documents"><Table headers={["Employee","Document","Type","Expiry"]} rows={rows.map(x=>[x.employee_name,x.title,x.document_type,x.expires_on||"—"])}/></List></Grid>;
}

function ShiftsTab({ rows, busy, submit }: { rows:Shift[];busy:boolean;submit:Function }) {
  async function onSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(await submit("shifts",{name:d.get("name"),start_time:d.get("start_time"),end_time:d.get("end_time"),break_minutes:Number(d.get("break_minutes")||0),grace_minutes:Number(d.get("grace_minutes")||0),weekly_off_days:[]},"Shift created."))f.reset();}
  return <Grid><Form title="New shift" onSubmit={onSubmit} busy={busy}><Input name="name" label="Shift name" required/><Input name="start_time" label="Start time" type="time" required/><Input name="end_time" label="End time" type="time" required/><Input name="break_minutes" label="Break minutes" type="number" defaultValue="60"/><Input name="grace_minutes" label="Grace minutes" type="number" defaultValue="10"/><Submit text="Create shift"/></Form><List title="Work shifts"><Table headers={["Name","Start","End","Break","Grace"]} rows={rows.map(x=>[x.name,x.start_time,x.end_time,`${x.break_minutes}m`,`${x.grace_minutes}m`])}/></List></Grid>;
}

function LifecycleTab({ rows, employees, busy, submit }: { rows:Lifecycle[];employees:{value:string;label:string}[];busy:boolean;submit:Function }) {
  async function onSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(await submit("lifecycle",{employee_id:d.get("employee_id"),event_type:d.get("event_type"),effective_date:d.get("effective_date"),title:d.get("title"),notes:d.get("notes")||null,details:{}},"Lifecycle event saved."))f.reset();}
  return <Grid><Form title="Employee lifecycle event" onSubmit={onSubmit} busy={busy}><SearchableSelect label="Employee" name="employee_id" required options={employees}/><Select name="event_type" label="Event" options={["probation","confirmation","promotion","transfer","salary_revision","resignation","termination"]}/><Input name="effective_date" label="Effective date" type="date" required/><Input name="title" label="Title" required/><Textarea name="notes" label="Notes"/><Submit text="Save event"/></Form><List title="Lifecycle history"><Table headers={["Employee","Event","Effective","Title"]} rows={rows.map(x=>[x.employee_name,x.event_type,x.effective_date,x.title])}/></List></Grid>;
}

function PerformanceTab({ rows, employees, busy, submit, patch }: { rows:Performance[];employees:{value:string;label:string}[];busy:boolean;submit:Function;patch:Function }) {
  async function onSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(await submit("performance",{employee_id:d.get("employee_id"),reviewer_employee_id:d.get("reviewer_employee_id")||null,period_start:d.get("period_start"),period_end:d.get("period_end"),goals:[]},"Review cycle created."))f.reset();}
  return <Grid><Form title="Performance review" onSubmit={onSubmit} busy={busy}><SearchableSelect label="Employee" name="employee_id" required options={employees}/><SearchableSelect label="Reviewer" name="reviewer_employee_id" options={employees}/><Input name="period_start" label="Period start" type="date" required/><Input name="period_end" label="Period end" type="date" required/><Submit text="Create review"/></Form><List title="Performance reviews"><div className="space-y-3">{rows.map(x=><div key={x.id} className="rounded-xl border p-4"><div className="flex justify-between gap-3"><div><p className="font-medium">{x.employee_name}</p><p className="text-xs text-neutral-500">{x.period_start} — {x.period_end}</p></div><div className="text-right"><Badge value={x.status}/><p className="mt-2 text-sm">{x.rating?`${x.rating}/5`:"Not rated"}</p></div></div>{x.status!=="completed"?<button onClick={()=>void patch(`performance/${x.id}`,{status:"completed",rating:5},"Review completed.")} className="mt-3 rounded-lg border px-3 py-1.5 text-xs">Complete · 5/5</button>:null}</div>)}</div></List></Grid>;
}

function AnnouncementsTab({ rows, busy, submit }: { rows:Announcement[];busy:boolean;submit:Function }) {
  async function onSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(await submit("announcements",{title:d.get("title"),body:d.get("body"),audience:"all",is_policy:d.get("is_policy")==="on",publish_now:true},"Announcement published."))f.reset();}
  return <Grid><Form title="Announcement / policy" onSubmit={onSubmit} busy={busy}><Input name="title" label="Title" required/><Textarea name="body" label="Content" required/><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_policy"/>Company policy</label><Submit text="Publish"/></Form><List title="Policies & announcements"><div className="space-y-3">{rows.map(x=><div key={x.id} className="rounded-xl border p-4"><div className="flex items-center gap-2"><Megaphone className="size-4"/><p className="font-medium">{x.title}</p>{x.is_policy?<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">POLICY</span>:null}</div><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">{x.body}</p></div>)}</div></List></Grid>;
}

function RecruitmentTab({ jobs, candidates, departments, jobOptions, busy, submit, patch }: { jobs:Job[];candidates:Candidate[];departments:{value:string;label:string}[];jobOptions:{value:string;label:string}[];busy:boolean;submit:Function;patch:Function }) {
  async function createJob(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(await submit("jobs",{title:d.get("title"),department_id:d.get("department_id")||null,employment_type:d.get("employment_type"),location:d.get("location")||null,description:d.get("description")||null,openings:Number(d.get("openings")||1)},"Job opening created."))f.reset();}
  async function createCandidate(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(await submit("candidates",{job_opening_id:d.get("job_opening_id"),full_name:d.get("full_name"),email:d.get("email"),phone:d.get("phone")||null,resume_url:d.get("resume_url")||null,notes:d.get("notes")||null},"Candidate added."))f.reset();}
  return <div className="mt-5 space-y-5"><div className="grid gap-5 xl:grid-cols-2"><Form title="Job opening" onSubmit={createJob} busy={busy}><Input name="title" label="Job title" required/><SearchableSelect label="Department" name="department_id" options={departments}/><Select name="employment_type" label="Employment type" options={["full_time","part_time","contract","intern"]}/><Input name="location" label="Location"/><Input name="openings" label="Openings" type="number" defaultValue="1"/><Textarea name="description" label="Description"/><Submit text="Create opening"/></Form><Form title="Add candidate" onSubmit={createCandidate} busy={busy}><SearchableSelect label="Job opening" name="job_opening_id" required options={jobOptions}/><Input name="full_name" label="Full name" required/><Input name="email" label="Email" type="email" required/><Input name="phone" label="Phone"/><Input name="resume_url" label="Resume URL"/><Textarea name="notes" label="Notes"/><Submit text="Add candidate"/></Form></div><div className="grid gap-5 xl:grid-cols-2"><List title="Openings"><Table headers={["Title","Type","Location","Openings","Status"]} rows={jobs.map(x=>[x.title,x.employment_type,x.location||"—",String(x.openings),x.status])}/></List><List title="Candidate pipeline"><div className="space-y-3">{candidates.map(x=><div key={x.id} className="rounded-xl border p-4"><div className="flex justify-between gap-3"><div><p className="font-medium">{x.full_name}</p><p className="text-xs text-neutral-500">{x.job_title} · {x.email}</p></div><Badge value={x.stage}/></div><div className="mt-3 flex flex-wrap gap-2">{["screening","interview","offer","hired","rejected"].map(stage=><button key={stage} onClick={()=>void patch(`candidates/${x.id}`,{stage},`Candidate moved to ${stage}.`)} className="rounded-lg border px-2.5 py-1 text-[11px] capitalize">{stage}</button>)}</div></div>)}</div></List></div></div>;
}

function Grid({children}:{children:React.ReactNode}){return <section className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">{children}</section>}
function Form({title,onSubmit,busy,children}:{title:string;onSubmit:(e:FormEvent<HTMLFormElement>)=>void;busy:boolean;children:React.ReactNode}){return <form onSubmit={onSubmit} className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2><div className="mt-4 space-y-4">{children}<button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 text-sm font-semibold text-white disabled:opacity-50"><Plus className="size-4"/>Save</button></div></form>}
function List({title,children}:{title:string;children:React.ReactNode}){return <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2><div className="mt-4">{children}</div></div>}
function Input(p:{name:string;label:string;type?:string;required?:boolean;defaultValue?:string}){return <label className="block text-sm font-medium">{p.label}<input {...p} type={p.type||"text"} className="mt-2 h-11 w-full rounded-xl border px-3 font-normal"/></label>}
function Textarea(p:{name:string;label:string;required?:boolean}){return <label className="block text-sm font-medium">{p.label}<textarea {...p} className="mt-2 min-h-24 w-full rounded-xl border p-3 font-normal"/></label>}
function Select({name,label,options}:{name:string;label:string;options:string[]}){return <label className="block text-sm font-medium">{label}<select name={name} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-normal">{options.map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></label>}
function Submit({text}:{text:string}){return <span className="sr-only">{text}</span>}
function Metric({icon:Icon,label,value}:{icon:typeof Gauge;label:string;value:number}){return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs text-neutral-500"><Icon className="size-4"/>{label}</div><p className="mt-2 text-2xl font-semibold">{value}</p></div>}
function Badge({value}:{value:string}){return <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize text-neutral-600">{value.replaceAll("_"," ")}</span>}
function Table({headers,rows}:{headers:string[];rows:string[][]}){if(!rows.length)return <div className="rounded-xl border border-dashed py-16 text-center text-sm text-neutral-400">No records yet.</div>;return <div className="overflow-x-auto rounded-xl border"><table className="min-w-full text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-400"><tr>{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} className="px-4 py-3">{c}</td>)}</tr>)}</tbody></table></div>}
