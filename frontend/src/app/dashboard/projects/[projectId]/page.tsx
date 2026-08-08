"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileText, KeyRound, Loader2, Plus, ShieldCheck, UsersRound, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

type ProjectMember = { id: string; employee_id: string; employee_code: string; full_name: string; role_label: string | null };
type ProjectDetail = { id: string; project_number: string; order_number: string; quotation_number: string; client_name: string; name: string; status: string; priority: string; planned_start_date: string | null; due_date: string | null; currency: string; contract_value: string | number; project_manager_name: string | null; description: string | null; notes: string | null; members: ProjectMember[] };
type Summary = { progress_percent: number; milestone_count: number; task_count: number; open_task_count: number; overdue_task_count: number; blocked_task_count: number; document_count: number; credential_count: number };
type MilestoneRow = { id: string; title: string; description: string | null; status: string; sort_order: number; progress_percent: number; due_date: string | null };
type TaskRow = { id: string; task_code: string; milestone_id: string | null; milestone_title: string | null; title: string; description: string | null; status: string; priority: string; progress_percent: number; assignee_employee_id: string | null; assignee_name: string | null; planned_start_date: string | null; due_date: string | null; estimated_minutes: number | null };
type WorkLog = { id: string; task_id: string; task_code: string; task_title: string; employee_name: string; note: string; progress_percent: number; time_spent_minutes: number | null; created_at: string };
type DocumentRow = { id: string; title: string; document_type: string; original_filename: string; content_type: string | null; size_bytes: number; notes: string | null; created_at: string };
type CredentialRow = { id: string; name: string; credential_type: string; environment: string; username: string | null; url: string | null; notes: string | null; access_level: string; created_at: string };
type Workspace = { summary: Summary; milestones: MilestoneRow[]; tasks: TaskRow[]; recent_work: WorkLog[]; documents: DocumentRow[]; credentials: CredentialRow[] };
type EmployeeOption = { id: string; employee_code: string; full_name: string };
type Meta = { employees: EmployeeOption[] };
type Tab = "overview" | "milestones" | "tasks" | "work" | "documents" | "credentials" | "team";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "milestones", label: "Milestones" }, { id: "tasks", label: "Tasks" },
  { id: "work", label: "Work Log" }, { id: "documents", label: "Documents" }, { id: "credentials", label: "Credentials" }, { id: "team", label: "Team" },
];

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()); }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
function vaultMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Unable to save credential.";
  if (message.toLowerCase().includes("encryption key") || message.toLowerCase().includes("credentials vault")) {
    return "Credentials Vault is temporarily unavailable. Please contact your administrator.";
  }
  return message;
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [meta, setMeta] = useState<Meta>({ employees: [] });
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [modal, setModal] = useState<"milestone" | "task" | "progress" | "document" | "credential" | "team" | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/projects${path}`, init);
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
    if (!response.ok) throw new Error(payload?.detail ?? "Project request failed.");
    return payload;
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [projectPayload, workspacePayload, metaPayload] = await Promise.all([
        api(`/${projectId}`), api(`/${projectId}/workspace`), api("/meta"),
      ]);
      setProject(projectPayload as ProjectDetail); setWorkspace(workspacePayload as Workspace); setMeta(metaPayload as Meta);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load project workspace."); }
    finally { setLoading(false); }
  }, [api, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function changeProjectStatus(status: string) {
    setSaving(true); setError(null);
    try { await api(`/${projectId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); setMessage(`Project marked ${pretty(status)}.`); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update project."); }
    finally { setSaving(false); }
  }

  async function createMilestone(values: { title: string; description: string; due_date: string }) {
    setSaving(true); setError(null);
    try { await api(`/${projectId}/milestones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: values.title, description: values.description || null, due_date: values.due_date || null }) }); setModal(null); setMessage("Milestone created."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create milestone."); }
    finally { setSaving(false); }
  }

  async function createTask(values: { title: string; description: string; milestone_id: string; priority: string; assignee_employee_id: string; planned_start_date: string; due_date: string; estimated_hours: string }) {
    setSaving(true); setError(null);
    try {
      await api(`/${projectId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        title: values.title, description: values.description || null, milestone_id: values.milestone_id || null, priority: values.priority,
        assignee_employee_id: values.assignee_employee_id || null, planned_start_date: values.planned_start_date || null, due_date: values.due_date || null,
        estimated_minutes: values.estimated_hours ? Math.round(Number(values.estimated_hours) * 60) : null,
      }) });
      setModal(null); setMessage("Task created."); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create task."); }
    finally { setSaving(false); }
  }

  async function updateProgress(values: { progress: number; note: string; status: string; time_hours: string }) {
    if (!selectedTask) return;
    setSaving(true); setError(null);
    try {
      await api(`/${projectId}/tasks/${selectedTask.id}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        progress_percent: values.progress, note: values.note, status: values.status || null,
        time_spent_minutes: values.time_hours ? Math.round(Number(values.time_hours) * 60) : null,
      }) });
      setModal(null); setSelectedTask(null); setMessage(`Work update saved for ${selectedTask.task_code}.`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save work update."); }
    finally { setSaving(false); }
  }

  async function uploadDocument(values: { title: string; document_type: string; notes: string; file: File | null }) {
    if (!values.file) { setError("Select a file first."); return; }
    const form = new FormData(); form.append("file", values.file); form.append("title", values.title); form.append("document_type", values.document_type); if (values.notes) form.append("notes", values.notes);
    setSaving(true); setError(null);
    try { await api(`/${projectId}/documents/upload`, { method: "POST", body: form }); setModal(null); setMessage("Project document uploaded."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to upload document."); }
    finally { setSaving(false); }
  }

  async function createCredential(values: { name: string; credential_type: string; environment: string; username: string; secret: string; url: string; notes: string; access_level: string }) {
    setSaving(true); setCredentialError(null); setError(null);
    try {
      await api(`/${projectId}/credentials`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      setModal(null); setCredentialError(null); setMessage("Credential encrypted and saved."); await refresh();
    } catch (reason) {
      setCredentialError(vaultMessage(reason));
    } finally { setSaving(false); }
  }

  async function revealCredential(id: string) {
    setError(null);
    try {
      const payload = await api(`/${projectId}/credentials/${id}/reveal`, { method: "POST" }) as { secret: string };
      setRevealed((current) => ({ ...current, [id]: payload.secret }));
      window.setTimeout(() => setRevealed((current) => { const next = { ...current }; delete next[id]; return next; }), 30000);
    } catch (reason) { setError(vaultMessage(reason)); }
  }

  async function saveTeam(managerId: string, memberIds: string[]) {
    setSaving(true); setError(null);
    try { await api(`/${projectId}/team`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_manager_employee_id: managerId || null, member_employee_ids: memberIds }) }); setModal(null); setMessage("Project team updated."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update team."); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  if (!project || !workspace) return <main className="p-10"><p className="text-red-600">{error || "Project not available."}</p></main>;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-7 lg:p-9"><div className="mx-auto max-w-[1500px]">
    <button onClick={() => router.push("/dashboard/projects")} className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Projects</button>
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-neutral-500">{project.project_number}</span><Badge value={project.status} /><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize text-neutral-600">{project.priority}</span></div><h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1><p className="mt-2 text-sm text-neutral-500">{project.client_name} · {project.order_number} · {project.quotation_number}</p></div><div className="flex flex-wrap gap-2">{project.status === "planned" ? <Action disabled={saving} onClick={() => void changeProjectStatus("active")} label="Start Project" primary /> : null}{project.status === "active" ? <><Action disabled={saving} onClick={() => void changeProjectStatus("on_hold")} label="Put on Hold" /><Action disabled={saving} onClick={() => void changeProjectStatus("completed")} label="Complete" primary /></> : null}{project.status === "on_hold" ? <Action disabled={saving} onClick={() => void changeProjectStatus("active")} label="Resume" primary /> : null}</div></div>
      <div className="mt-6"><div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">Overall progress</span><span className="font-semibold">{workspace.summary.progress_percent}%</span></div><Progress value={workspace.summary.progress_percent} /></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Open tasks" value={workspace.summary.open_task_count} /><Metric label="Overdue" value={workspace.summary.overdue_task_count} danger={workspace.summary.overdue_task_count > 0} /><Metric label="Blocked" value={workspace.summary.blocked_task_count} danger={workspace.summary.blocked_task_count > 0} /><Metric label="Milestones" value={workspace.summary.milestone_count} /><Metric label="Documents" value={workspace.summary.document_count} /><Metric label="Credentials" value={workspace.summary.credential_count} /></div>
    </section>

    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <div className="mt-5 overflow-x-auto rounded-2xl border bg-white p-2 shadow-sm"><div className="flex min-w-max gap-1">{tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${tab === item.id ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>{item.label}</button>)}</div></div>

    <section className="mt-5">
      {tab === "overview" ? <Overview project={project} workspace={workspace} /> : null}
      {tab === "milestones" ? <Milestones rows={workspace.milestones} onAdd={() => setModal("milestone")} /> : null}
      {tab === "tasks" ? <Tasks rows={workspace.tasks} onAdd={() => setModal("task")} onProgress={(task) => { setSelectedTask(task); setModal("progress"); }} /> : null}
      {tab === "work" ? <WorkLogs rows={workspace.recent_work} /> : null}
      {tab === "documents" ? <Documents projectId={projectId} rows={workspace.documents} onAdd={() => setModal("document")} /> : null}
      {tab === "credentials" ? <Credentials rows={workspace.credentials} revealed={revealed} onAdd={() => { setCredentialError(null); setModal("credential"); }} onReveal={(id) => void revealCredential(id)} /> : null}
      {tab === "team" ? <Team project={project} onManage={() => setModal("team")} /> : null}
    </section>
  </div>

  {modal === "milestone" ? <MilestoneModal saving={saving} onClose={() => setModal(null)} onSave={createMilestone} /> : null}
  {modal === "task" ? <TaskModal saving={saving} milestones={workspace.milestones} members={project.members} onClose={() => setModal(null)} onSave={createTask} /> : null}
  {modal === "progress" && selectedTask ? <ProgressModal saving={saving} task={selectedTask} onClose={() => { setModal(null); setSelectedTask(null); }} onSave={updateProgress} /> : null}
  {modal === "document" ? <DocumentModal saving={saving} onClose={() => setModal(null)} onSave={uploadDocument} /> : null}
  {modal === "credential" ? <CredentialModal error={credentialError} saving={saving} onClose={() => { setCredentialError(null); setModal(null); }} onSave={createCredential} /> : null}
  {modal === "team" ? <TeamModal saving={saving} project={project} employees={meta.employees} onClose={() => setModal(null)} onSave={saveTeam} /> : null}
  </main>;
}

function Overview({ project, workspace }: { project: ProjectDetail; workspace: Workspace }) {
  return <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]"><div className="space-y-5"><Card title="Project information"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Info label="Manager" value={project.project_manager_name || "Unassigned"} /><Info label="Planned start" value={project.planned_start_date || "—"} /><Info label="Due date" value={project.due_date || "—"} /><Info label="Contract" value={money(project.contract_value, project.currency)} /><Info label="Team" value={`${project.members.length} members`} /><Info label="Progress" value={`${workspace.summary.progress_percent}%`} /></div>{project.description ? <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{project.description}</p> : null}</Card><Card title="Milestone health">{workspace.milestones.length ? <div className="space-y-4">{workspace.milestones.slice(0,5).map((item) => <div key={item.id}><div className="flex justify-between gap-4 text-sm"><span className="font-medium">{item.title}</span><span>{item.progress_percent}%</span></div><Progress value={item.progress_percent} /></div>)}</div> : <Empty text="No milestones yet." />}</Card></div><Card title="Recent work">{workspace.recent_work.length ? <div className="space-y-4">{workspace.recent_work.slice(0,8).map((log) => <div key={log.id} className="border-b pb-4 last:border-0"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{log.employee_name} · {log.task_code}</p><span className="text-xs text-neutral-400">{log.progress_percent}%</span></div><p className="mt-1 text-sm text-neutral-600">{log.note}</p><p className="mt-1 text-xs text-neutral-400">{new Date(log.created_at).toLocaleString()}</p></div>)}</div> : <Empty text="No work updates yet." />}</Card></div>;
}

function Milestones({ rows, onAdd }: { rows: MilestoneRow[]; onAdd: () => void }) { return <Card title="Milestones" action={<AddButton label="Add milestone" onClick={onAdd} />}><div className="space-y-3">{rows.length ? rows.map((item) => <div key={item.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-neutral-400">Due {item.due_date || "not set"}</p></div><Badge value={item.status} /></div><div className="mt-4"><div className="mb-1 text-right text-xs font-medium">{item.progress_percent}%</div><Progress value={item.progress_percent} /></div>{item.description ? <p className="mt-3 text-sm text-neutral-600">{item.description}</p> : null}</div>) : <Empty text="Create milestones to group delivery work." />}</div></Card>; }

function Tasks({ rows, onAdd, onProgress }: { rows: TaskRow[]; onAdd: () => void; onProgress: (task: TaskRow) => void }) { return <Card title="Tasks" action={<AddButton label="Add task" onClick={onAdd} />}><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="text-xs uppercase text-neutral-400"><tr><th className="pb-3">Task</th><th className="pb-3">Milestone</th><th className="pb-3">Assignee</th><th className="pb-3">Status</th><th className="pb-3">Due</th><th className="pb-3">Progress</th><th className="pb-3 text-right">Action</th></tr></thead><tbody className="divide-y">{rows.map((task) => <tr key={task.id}><td className="py-4 pr-4"><p className="font-medium">{task.task_code} · {task.title}</p><p className="mt-1 text-xs capitalize text-neutral-400">{task.priority} priority</p></td><td className="py-4 pr-4">{task.milestone_title || "—"}</td><td className="py-4 pr-4">{task.assignee_name || "Unassigned"}</td><td className="py-4 pr-4"><Badge value={task.status} /></td><td className="py-4 pr-4">{task.due_date || "—"}</td><td className="py-4 pr-4"><div className="w-32"><Progress value={task.progress_percent} /></div><span className="mt-1 block text-xs text-neutral-400">{task.progress_percent}%</span></td><td className="py-4 text-right"><button disabled={task.status === "cancelled"} onClick={() => onProgress(task)} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">Update Work</button></td></tr>)}</tbody></table>{!rows.length ? <Empty text="No tasks yet." /> : null}</div></Card>; }

function WorkLogs({ rows }: { rows: WorkLog[] }) { return <Card title="Work Log"><div className="space-y-3">{rows.length ? rows.map((log) => <article key={log.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{log.employee_name} · {log.task_code}</p><div className="flex gap-2 text-xs text-neutral-400"><span>{log.progress_percent}%</span>{log.time_spent_minutes ? <span>· {(log.time_spent_minutes/60).toFixed(1)}h</span> : null}<span>· {new Date(log.created_at).toLocaleString()}</span></div></div><p className="mt-2 text-sm leading-6 text-neutral-600">{log.note}</p><p className="mt-1 text-xs text-neutral-400">{log.task_title}</p></article>) : <Empty text="Team updates will appear here." />}</div></Card>; }

function Documents({ projectId, rows, onAdd }: { projectId: string; rows: DocumentRow[]; onAdd: () => void }) { return <Card title="Project documents" action={<AddButton label="Upload document" onClick={onAdd} />}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map((item) => <article key={item.id} className="rounded-xl border p-4"><div className="flex items-start gap-3"><FileText className="mt-1 size-5 text-neutral-400" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{item.title}</p><p className="mt-1 truncate text-xs text-neutral-400">{item.original_filename} · {formatBytes(item.size_bytes)}</p><p className="mt-1 text-xs capitalize text-neutral-400">{pretty(item.document_type)}</p></div></div><button onClick={() => window.open(`/api/projects/${projectId}/documents/${item.id}/file`, "_blank")} className="mt-4 w-full rounded-lg border py-2 text-xs font-semibold">Download</button></article>)}{!rows.length ? <div className="sm:col-span-2 xl:col-span-3"><Empty text="No project documents uploaded." /></div> : null}</div></Card>; }

function Credentials({ rows, revealed, onAdd, onReveal }: { rows: CredentialRow[]; revealed: Record<string,string>; onAdd: () => void; onReveal: (id: string) => void }) { return <Card title="Credentials Vault" action={<AddButton label="Add credential" onClick={onAdd} />}><div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><div className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><p>Secrets are encrypted at rest. Reveals are audited and automatically hidden from this screen after 30 seconds.</p></div></div><div className="grid gap-3 lg:grid-cols-2">{rows.map((item) => <article key={item.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs capitalize text-neutral-400">{pretty(item.credential_type)} · {pretty(item.environment)} · {pretty(item.access_level)}</p></div><KeyRound className="size-5 text-neutral-400" /></div>{item.username ? <p className="mt-3 text-sm"><span className="text-neutral-400">Username:</span> {item.username}</p> : null}{item.url ? <p className="mt-1 truncate text-sm"><span className="text-neutral-400">URL:</span> {item.url}</p> : null}<div className="mt-3 rounded-lg bg-neutral-950 p-3 font-mono text-xs text-white">{revealed[item.id] ? revealed[item.id] : "••••••••••••••••"}</div><div className="mt-3 flex gap-2"><button onClick={() => onReveal(item.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Reveal</button>{revealed[item.id] ? <button onClick={() => navigator.clipboard.writeText(revealed[item.id])} className="rounded-lg border px-3 py-2 text-xs font-semibold">Copy</button> : null}</div></article>)}{!rows.length ? <div className="lg:col-span-2"><Empty text="No credentials available for your access level." /></div> : null}</div></Card>; }

function Team({ project, onManage }: { project: ProjectDetail; onManage: () => void }) { return <Card title="Project team" action={<button onClick={onManage} className="rounded-lg border px-3 py-2 text-xs font-semibold">Manage team</button>}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{project.members.map((member) => <div key={member.id} className="rounded-xl border p-4"><UsersRound className="size-5 text-neutral-400" /><p className="mt-3 font-medium">{member.full_name}</p><p className="mt-1 text-xs text-neutral-400">{member.employee_code}</p><span className="mt-3 inline-flex rounded-full bg-neutral-100 px-2.5 py-1 text-xs">{member.role_label || "Team Member"}</span></div>)}</div></Card>; }

function MilestoneModal({ saving, onClose, onSave }: { saving:boolean; onClose:()=>void; onSave:(v:{title:string;description:string;due_date:string})=>Promise<void> }) { const [title,setTitle]=useState(""); const [description,setDescription]=useState(""); const [due,setDue]=useState(""); return <Modal title="Add milestone" onClose={onClose}><Field label="Title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field><Field label="Due date"><input type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="control" /></Field><Field label="Description"><textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="textarea" /></Field><ModalActions saving={saving} disabled={!title.trim()} onClose={onClose} onSave={() => void onSave({title:title.trim(),description,due_date:due})} /></Modal>; }

function TaskModal({ saving, milestones, members, onClose, onSave }: { saving:boolean; milestones:MilestoneRow[]; members:ProjectMember[]; onClose:()=>void; onSave:(v:{title:string;description:string;milestone_id:string;priority:string;assignee_employee_id:string;planned_start_date:string;due_date:string;estimated_hours:string})=>Promise<void> }) { const [title,setTitle]=useState(""); const [description,setDescription]=useState(""); const [milestone,setMilestone]=useState(""); const [priority,setPriority]=useState("normal"); const [assignee,setAssignee]=useState(""); const [start,setStart]=useState(""); const [due,setDue]=useState(""); const [hours,setHours]=useState(""); return <Modal title="Add task" onClose={onClose}><div className="grid gap-4 sm:grid-cols-2"><Field label="Task title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field><Field label="Milestone"><select value={milestone} onChange={(e)=>setMilestone(e.target.value)} className="control"><option value="">No milestone</option>{milestones.map((m)=><option key={m.id} value={m.id}>{m.title}</option>)}</select></Field><Field label="Assignee"><select value={assignee} onChange={(e)=>setAssignee(e.target.value)} className="control"><option value="">Unassigned</option>{members.map((m)=><option key={m.employee_id} value={m.employee_id}>{m.full_name}</option>)}</select></Field><Field label="Priority"><select value={priority} onChange={(e)=>setPriority(e.target.value)} className="control"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field><Field label="Planned start"><input type="date" value={start} onChange={(e)=>setStart(e.target.value)} className="control" /></Field><Field label="Due date"><input type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="control" /></Field><Field label="Estimated hours"><input type="number" min="0" step="0.25" value={hours} onChange={(e)=>setHours(e.target.value)} className="control" /></Field><label className="sm:col-span-2 text-sm font-medium">Description<textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="textarea" /></label></div><ModalActions saving={saving} disabled={!title.trim()} onClose={onClose} onSave={() => void onSave({title:title.trim(),description,milestone_id:milestone,priority,assignee_employee_id:assignee,planned_start_date:start,due_date:due,estimated_hours:hours})} /></Modal>; }

function ProgressModal({ saving, task, onClose, onSave }: { saving:boolean; task:TaskRow; onClose:()=>void; onSave:(v:{progress:number;note:string;status:string;time_hours:string})=>Promise<void> }) { const [progress,setProgress]=useState(task.progress_percent); const [note,setNote]=useState(""); const [status,setStatus]=useState(task.status === "completed" ? "completed" : ""); const [hours,setHours]=useState(""); return <Modal title={`Update work · ${task.task_code}`} onClose={onClose}><div className="rounded-xl border bg-neutral-50 p-4"><p className="font-medium">{task.title}</p><p className="mt-1 text-sm text-neutral-500">Current progress: {task.progress_percent}%</p></div><Field label={`Progress · ${progress}%`}><input type="range" min="0" max="100" step="5" value={progress} onChange={(e)=>setProgress(Number(e.target.value))} className="mt-3 w-full" /></Field><Field label="Work status"><select value={status} onChange={(e)=>setStatus(e.target.value)} className="control"><option value="">Keep / automatic</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">Ready for review</option></select></Field><Field label="Time spent (hours)"><input type="number" min="0" step="0.25" value={hours} onChange={(e)=>setHours(e.target.value)} className="control" /></Field><Field label="What did you work on?"><textarea value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Describe what changed, what is done, blockers, or what comes next..." className="textarea" /></Field><ModalActions saving={saving} disabled={note.trim().length < 2} onClose={onClose} onSave={() => void onSave({progress,note:note.trim(),status,time_hours:hours})} /></Modal>; }

function DocumentModal({ saving, onClose, onSave }: { saving:boolean; onClose:()=>void; onSave:(v:{title:string;document_type:string;notes:string;file:File|null})=>Promise<void> }) { const [title,setTitle]=useState(""); const [type,setType]=useState("other"); const [notes,setNotes]=useState(""); const [file,setFile]=useState<File|null>(null); return <Modal title="Upload project document" onClose={onClose}><Field label="Title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field><Field label="Document type"><select value={type} onChange={(e)=>setType(e.target.value)} className="control"><option value="requirement">Requirement</option><option value="contract">Contract</option><option value="design">Design</option><option value="technical">Technical</option><option value="delivery">Delivery</option><option value="other">Other</option></select></Field><Field label="File"><input type="file" onChange={(e)=>setFile(e.target.files?.[0] || null)} className="control py-2" /></Field><Field label="Notes"><textarea value={notes} onChange={(e)=>setNotes(e.target.value)} className="textarea" /></Field><ModalActions saving={saving} disabled={!title.trim() || !file} onClose={onClose} onSave={() => void onSave({title:title.trim(),document_type:type,notes,file})} /></Modal>; }

function CredentialModal({ error, saving, onClose, onSave }: { error:string|null; saving:boolean; onClose:()=>void; onSave:(v:{name:string;credential_type:string;environment:string;username:string;secret:string;url:string;notes:string;access_level:string})=>Promise<void> }) { const [name,setName]=useState(""); const [type,setType]=useState("login"); const [env,setEnv]=useState("production"); const [username,setUsername]=useState(""); const [secret,setSecret]=useState(""); const [url,setUrl]=useState(""); const [notes,setNotes]=useState(""); const [access,setAccess]=useState("manager_only"); return <Modal title="Add encrypted credential" onClose={onClose}>{error ? <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p className="font-semibold">Credential could not be saved</p><p className="mt-1 leading-5">{error}</p></div> : null}<div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><input value={name} onChange={(e)=>setName(e.target.value)} className="control" /></Field><Field label="Type"><select value={type} onChange={(e)=>setType(e.target.value)} className="control"><option value="login">Login</option><option value="api_key">API Key</option><option value="database">Database</option><option value="ssh">SSH / Server</option><option value="hosting">Hosting</option><option value="domain">Domain</option><option value="other">Other</option></select></Field><Field label="Environment"><select value={env} onChange={(e)=>setEnv(e.target.value)} className="control"><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option><option value="other">Other</option></select></Field><Field label="Access"><select value={access} onChange={(e)=>setAccess(e.target.value)} className="control"><option value="manager_only">Project manager only</option><option value="team">Project team</option></select></Field><Field label="Username / Email"><input value={username} onChange={(e)=>setUsername(e.target.value)} className="control" /></Field><Field label="Secret / Password / Key"><input type="password" autoComplete="new-password" value={secret} onChange={(e)=>setSecret(e.target.value)} className="control" /></Field><label className="sm:col-span-2 text-sm font-medium">URL<input value={url} onChange={(e)=>setUrl(e.target.value)} className="control" /></label><label className="sm:col-span-2 text-sm font-medium">Notes<textarea value={notes} onChange={(e)=>setNotes(e.target.value)} className="textarea" /></label></div><ModalActions saving={saving} disabled={!name.trim() || !secret} onClose={onClose} onSave={() => void onSave({name:name.trim(),credential_type:type,environment:env,username,secret,url,notes,access_level:access})} /></Modal>; }

function TeamModal({ saving, project, employees, onClose, onSave }: { saving:boolean; project:ProjectDetail; employees:EmployeeOption[]; onClose:()=>void; onSave:(manager:string,members:string[])=>Promise<void> }) { const [manager,setManager]=useState(project.members.find((m)=>m.role_label==="Project Manager")?.employee_id || ""); const [selected,setSelected]=useState(project.members.map((m)=>m.employee_id)); return <Modal title="Manage project team" onClose={onClose}><Field label="Project manager"><select value={manager} onChange={(e)=>{const id=e.target.value;setManager(id);if(id&&!selected.includes(id))setSelected([...selected,id]);}} className="control"><option value="">Unassigned</option>{employees.map((e)=><option key={e.id} value={e.id}>{e.full_name} · {e.employee_code}</option>)}</select></Field><div className="mt-4 max-h-64 overflow-y-auto rounded-xl border">{employees.map((e)=><label key={e.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-0"><input type="checkbox" checked={selected.includes(e.id)||manager===e.id} disabled={manager===e.id} onChange={(event)=>setSelected(event.target.checked?[...new Set([...selected,e.id])]:selected.filter((id)=>id!==e.id))}/><span className="flex-1 text-sm">{e.full_name}</span><span className="text-xs text-neutral-400">{e.employee_code}</span></label>)}</div><ModalActions saving={saving} disabled={false} onClose={onClose} onSave={() => void onSave(manager,selected)} /></Modal>; }

function Card({ title, action, children }: { title:string; action?:React.ReactNode; children:React.ReactNode }) { return <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="font-semibold">{title}</h2>{action}</div>{children}</section>; }
function Metric({ label, value, danger=false }: { label:string; value:number; danger?:boolean }) { return <div className={`rounded-xl border p-3 ${danger ? "border-red-200 bg-red-50" : "bg-neutral-50"}`}><p className="text-xs text-neutral-500">{label}</p><p className={`mt-1 text-xl font-semibold ${danger ? "text-red-700" : ""}`}>{value}</p></div>; }
function Info({ label, value }: { label:string; value:string }) { return <div className="rounded-xl bg-neutral-50 p-3"><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>; }
function Progress({ value }: { value:number }) { return <div className="h-2.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-neutral-950 transition-all" style={{width:`${Math.max(0,Math.min(100,value))}%`}} /></div>; }
function Badge({ value }: { value:string }) { const map:Record<string,string>={active:"border-emerald-200 bg-emerald-50 text-emerald-700",in_progress:"border-blue-200 bg-blue-50 text-blue-700",review:"border-violet-200 bg-violet-50 text-violet-700",blocked:"border-red-200 bg-red-50 text-red-700",on_hold:"border-amber-200 bg-amber-50 text-amber-700",completed:"border-emerald-200 bg-emerald-50 text-emerald-700",cancelled:"bg-neutral-100 text-neutral-500"}; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${map[value]||"bg-neutral-50 text-neutral-600"}`}>{pretty(value)}</span>; }
function Empty({ text }: { text:string }) { return <div className="py-10 text-center text-sm text-neutral-400">{text}</div>; }
function AddButton({ label, onClick }: { label:string; onClick:()=>void }) { return <button onClick={onClick} className="inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white"><Plus className="size-3.5" />{label}</button>; }
function Action({ label,onClick,disabled,primary=false }: { label:string;onClick:()=>void;disabled:boolean;primary?:boolean }) { return <button disabled={disabled} onClick={onClick} className={`h-10 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${primary?"bg-neutral-950 text-white":"border bg-white"}`}>{label}</button>; }
function Field({ label, children }: { label:string; children:React.ReactNode }) { return <label className="mt-4 block text-sm font-medium">{label}{children}</label>; }
function ModalActions({ saving, disabled, onClose, onSave }: { saving:boolean;disabled:boolean;onClose:()=>void;onSave:()=>void }) { return <div className="mt-6 flex justify-end gap-2 border-t pt-5"><button onClick={onClose} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving||disabled} onClick={onSave} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving...":"Save"}</button></div>; }
function Modal({ title,onClose,children }: { title:string;onClose:()=>void;children:React.ReactNode }) { return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}><div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="p-6">{children}</div></div><style jsx global>{`.control{margin-top:.5rem;height:2.75rem;width:100%;border:1px solid #e5e5e5;border-radius:.75rem;padding:0 .75rem;font-size:.875rem;background:white}.textarea{margin-top:.5rem;min-height:6rem;width:100%;border:1px solid #e5e5e5;border-radius:.75rem;padding:.75rem;font-size:.875rem}`}</style></div>; }
