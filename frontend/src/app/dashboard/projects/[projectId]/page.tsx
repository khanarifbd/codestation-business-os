"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Download, Eye, EyeOff, FileText, KeyRound, Loader2, LockKeyhole, Pencil, Plus, ShieldCheck, Trash2, UsersRound, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { ProjectReviewTips } from "@/components/project-review-tips";

type Tab = "overview" | "milestones" | "tasks" | "work" | "documents" | "credentials" | "team" | "review_tips";
type ProjectMember = { id: string; employee_id: string; employee_code: string; full_name: string; role_label: string | null; tab_permissions: Tab[] };
type ProjectAccess = { allowed_tabs: Tab[]; can_manage_project: boolean; is_project_manager: boolean; current_employee_id: string | null };
type ProjectDetail = { id: string; project_number: string; order_number: string; quotation_number: string; client_name: string; name: string; status: string; priority: string; planned_start_date: string | null; due_date: string | null; currency: string; contract_value: string | number; project_manager_name: string | null; description: string | null; notes: string | null; members: ProjectMember[]; access: ProjectAccess };
type Summary = { progress_percent: number; milestone_count: number; task_count: number; open_task_count: number; overdue_task_count: number; blocked_task_count: number; document_count: number; credential_count: number };
type MilestoneRow = { id: string; title: string; description: string | null; status: string; sort_order: number; progress_percent: number; due_date: string | null };
type TaskRow = { id: string; task_code: string; milestone_id: string | null; milestone_title: string | null; title: string; description: string | null; status: string; priority: string; progress_percent: number; assignee_employee_id: string | null; assignee_name: string | null; planned_start_date: string | null; due_date: string | null; estimated_minutes: number | null };
type WorkLog = { id: string; task_id: string; task_code: string; task_title: string; employee_name: string; note: string; progress_percent: number; time_spent_minutes: number | null; created_at: string };
type DocumentRow = { id: string; title: string; document_type: string; original_filename: string; content_type: string | null; size_bytes: number; notes: string | null; created_at: string };
type CredentialRow = { id: string; name: string; credential_type: string; environment: string; username: string | null; url: string | null; notes: string | null; access_level: string; last_revealed_by: string | null; last_revealed_at: string | null; created_at: string; updated_at: string };
type Workspace = { summary: Summary; milestones: MilestoneRow[]; tasks: TaskRow[]; recent_work: WorkLog[]; documents: DocumentRow[]; credentials: CredentialRow[]; can_manage_credentials: boolean };
type EmployeeOption = { id: string; employee_code: string; full_name: string };
type Meta = { employees: EmployeeOption[]; can_manage_projects: boolean };
type CredentialValues = { name: string; credential_type: string; environment: string; username: string; secret: string; url: string; notes: string; access_level: string };

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "milestones", label: "Milestones" }, { id: "tasks", label: "Tasks" },
  { id: "work", label: "Work Log" }, { id: "documents", label: "Documents" }, { id: "credentials", label: "Credentials" }, { id: "team", label: "Team" },
  { id: "review_tips", label: "Review & Tips" },
];
const allTabIds = tabs.map((item) => item.id);
const defaultMemberTabs: Tab[] = ["overview", "milestones", "tasks", "work", "documents", "team"];
const previewTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "text/plain"]);

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()); }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
function vaultMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Unable to save credential.";
  if (message.toLowerCase().includes("encryption key") || message.toLowerCase().includes("credentials vault")) return "Credentials Vault is temporarily unavailable. Please contact your administrator.";
  return message;
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [meta, setMeta] = useState<Meta>({ employees: [], can_manage_projects: false });
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [modal, setModal] = useState<"milestone" | "task" | "progress" | "document" | "credential" | "credential_edit" | "team" | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [selectedCredential, setSelectedCredential] = useState<CredentialRow | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
      const [projectPayload, workspacePayload, metaPayload] = await Promise.all([api(`/${projectId}`), api(`/${projectId}/workspace`), api("/meta")]);
      setProject(projectPayload as ProjectDetail); setWorkspace(workspacePayload as Workspace); setMeta(metaPayload as Meta);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load project workspace."); }
    finally { setLoading(false); }
  }, [api, projectId]);

  const refreshWorkspace = useCallback(async () => {
    try { setWorkspace(await api(`/${projectId}/workspace`) as Workspace); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to refresh project workspace."); }
  }, [api, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!project) return;
    if (!project.access.allowed_tabs.includes(tab)) {
      const first = tabs.find((item) => project.access.allowed_tabs.includes(item.id));
      if (first) setTab(first.id);
    }
  }, [project, tab]);

  const visibleTabs = useMemo(() => tabs.filter((item) => project?.access.allowed_tabs.includes(item.id)), [project]);
  const canManageExecution = Boolean(project?.access.can_manage_project || project?.access.is_project_manager);
  const canManageTeam = Boolean(project?.access.can_manage_project && meta.can_manage_projects);

  async function changeProjectStatus(status: string) {
    setSaving(true); setError(null);
    try {
      await api(`/${projectId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      setMessage(status === "completed" ? "Project completed. Client review or tip can be added now or anytime later." : `Project marked ${pretty(status)}.`);
      await refresh();
      if (status === "completed") setTab("review_tips");
    }
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
      await api(`/${projectId}/tasks/${selectedTask.id}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ progress_percent: values.progress, note: values.note, status: values.status || null, time_spent_minutes: values.time_hours ? Math.round(Number(values.time_hours) * 60) : null }) });
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

  async function createCredential(values: CredentialValues) {
    setSaving(true); setCredentialError(null); setError(null);
    try {
      await api(`/${projectId}/credentials`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      setModal(null); setCredentialError(null); setMessage("Credential encrypted and saved."); await refresh();
    } catch (reason) { setCredentialError(vaultMessage(reason)); }
    finally { setSaving(false); }
  }

  async function updateCredential(values: CredentialValues) {
    if (!selectedCredential) return;
    setSaving(true); setCredentialError(null); setError(null);
    try {
      const { secret, ...rest } = values;
      await api(`/${projectId}/credentials/${selectedCredential.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(secret ? values : rest) });
      setModal(null); setSelectedCredential(null); setCredentialError(null); setMessage("Credential updated securely."); await refreshWorkspace();
    } catch (reason) { setCredentialError(vaultMessage(reason)); }
    finally { setSaving(false); }
  }

  async function accessCredentialSecret(id: string) {
    if (revealed[id]) return revealed[id];
    const payload = await api(`/${projectId}/credentials/${id}/reveal`, { method: "POST" }) as { secret: string };
    setRevealed((current) => ({ ...current, [id]: payload.secret }));
    window.setTimeout(() => setRevealed((current) => { const next = { ...current }; delete next[id]; return next; }), 30000);
    await refreshWorkspace();
    return payload.secret;
  }

  async function revealCredential(id: string) {
    setError(null);
    try { await accessCredentialSecret(id); }
    catch (reason) { setError(vaultMessage(reason)); }
  }

  function hideCredential(id: string) {
    setRevealed((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  async function copyValue(value: string, key: string, label: string) {
    try {
      await navigator.clipboard.writeText(value); setCopiedKey(key); setMessage(`${label} copied to clipboard.`);
      window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 1800);
    } catch { setError(`Unable to copy ${label.toLowerCase()}.`); }
  }

  async function copySecret(item: CredentialRow) {
    setError(null);
    try { const secret = await accessCredentialSecret(item.id); await copyValue(secret, `secret:${item.id}`, "Secret"); }
    catch (reason) { setError(vaultMessage(reason)); }
  }

  async function deleteCredential(item: CredentialRow) {
    if (!window.confirm(`Delete credential “${item.name}”? This cannot be undone.`)) return;
    setSaving(true); setError(null);
    try {
      await api(`/${projectId}/credentials/${item.id}`, { method: "DELETE" });
      hideCredential(item.id); setMessage("Credential deleted."); await refreshWorkspace();
    } catch (reason) { setError(vaultMessage(reason)); }
    finally { setSaving(false); }
  }

  async function saveTeam(managerId: string, memberIds: string[], memberTabPermissions: Record<string, Tab[]>) {
    setSaving(true); setError(null);
    try {
      await api(`/${projectId}/team`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_manager_employee_id: managerId || null, member_employee_ids: memberIds, member_tab_permissions: memberTabPermissions }),
      });
      setModal(null); setMessage("Project team access updated."); await refresh();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update team."); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  if (!project || !workspace) return <main className="p-10"><p className="text-red-600">{error || "Project not available."}</p></main>;

  const canSeeOverview = project.access.allowed_tabs.includes("overview");
  const canSeeTasks = project.access.allowed_tabs.includes("tasks") || canSeeOverview;
  const canSeeMilestones = project.access.allowed_tabs.includes("milestones") || canSeeOverview;

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-7 lg:p-9"><div className="mx-auto max-w-[1500px]">
    <button onClick={() => router.push("/dashboard/projects")} className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950"><ArrowLeft className="size-4" />Projects</button>
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-neutral-500">{project.project_number}</span><Badge value={project.status} /><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize text-neutral-600">{project.priority}</span></div><h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1><p className="mt-2 text-sm text-neutral-500">{project.client_name}{project.access.can_manage_project ? ` · ${project.order_number} · ${project.quotation_number}` : ""}</p></div>{project.access.can_manage_project ? <div className="flex flex-wrap gap-2">{project.status === "planned" ? <Action disabled={saving} onClick={() => void changeProjectStatus("active")} label="Start Project" primary /> : null}{project.status === "active" ? <><Action disabled={saving} onClick={() => void changeProjectStatus("on_hold")} label="Put on Hold" /><Action disabled={saving} onClick={() => void changeProjectStatus("completed")} label="Complete" primary /></> : null}{project.status === "on_hold" ? <Action disabled={saving} onClick={() => void changeProjectStatus("active")} label="Resume" primary /></div> : null}</div>
      <div className="mt-6"><div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">Overall progress</span><span className="font-semibold">{workspace.summary.progress_percent}%</span></div><Progress value={workspace.summary.progress_percent} /></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{canSeeTasks ? <><Metric label="Open tasks" value={workspace.summary.open_task_count} /><Metric label="Overdue" value={workspace.summary.overdue_task_count} danger={workspace.summary.overdue_task_count > 0} /><Metric label="Blocked" value={workspace.summary.blocked_task_count} danger={workspace.summary.blocked_task_count > 0} /></> : null}{canSeeMilestones ? <Metric label="Milestones" value={workspace.summary.milestone_count} /> : null}{project.access.allowed_tabs.includes("documents") ? <Metric label="Documents" value={workspace.summary.document_count} /> : null}{project.access.allowed_tabs.includes("credentials") ? <Metric label="Credentials" value={workspace.summary.credential_count} /> : null}</div>
    </section>

    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <div className="mt-5 overflow-x-auto rounded-2xl border bg-white p-2 shadow-sm"><div className="flex min-w-max gap-1">{visibleTabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${tab === item.id ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>{item.label}</button>)}</div></div>

    <section className="mt-5">
      {tab === "overview" && project.access.allowed_tabs.includes("overview") ? <Overview project={project} workspace={workspace} canManageProject={project.access.can_manage_project} /> : null}
      {tab === "milestones" && project.access.allowed_tabs.includes("milestones") ? <Milestones rows={workspace.milestones} onAdd={canManageExecution ? () => setModal("milestone") : undefined} /> : null}
      {tab === "tasks" && project.access.allowed_tabs.includes("tasks") ? <Tasks rows={workspace.tasks} currentEmployeeId={project.access.current_employee_id} canManage={canManageExecution} onAdd={canManageExecution ? () => setModal("task") : undefined} onProgress={(task) => { setSelectedTask(task); setModal("progress"); }} /> : null}
      {tab === "work" && project.access.allowed_tabs.includes("work") ? <WorkLogs rows={workspace.recent_work} /> : null}
      {tab === "documents" && project.access.allowed_tabs.includes("documents") ? <Documents projectId={projectId} rows={workspace.documents} canManage={canManageExecution} onAdd={() => setModal("document")} onChanged={() => void refreshWorkspace()} /> : null}
      {tab === "credentials" && project.access.allowed_tabs.includes("credentials") ? <Credentials rows={workspace.credentials} revealed={revealed} canManage={workspace.can_manage_credentials} copiedKey={copiedKey} onAdd={() => { setSelectedCredential(null); setCredentialError(null); setModal("credential"); }} onReveal={(id) => void revealCredential(id)} onHide={hideCredential} onCopySecret={(item) => void copySecret(item)} onCopy={(value,key,label) => void copyValue(value,key,label)} onEdit={(item) => { setSelectedCredential(item); setCredentialError(null); setModal("credential_edit"); }} onDelete={(item) => void deleteCredential(item)} /> : null}
      {tab === "team" && project.access.allowed_tabs.includes("team") ? <Team project={project} canManage={canManageTeam} onManage={() => setModal("team")} /> : null}
      {tab === "review_tips" && project.access.allowed_tabs.includes("review_tips") ? <ProjectReviewTips projectId={projectId} projectNumber={project.project_number} projectStatus={project.status} projectCurrency={project.currency} /> : null}
    </section>
  </div>

  {modal === "milestone" && canManageExecution ? <MilestoneModal saving={saving} onClose={() => setModal(null)} onSave={createMilestone} /> : null}
  {modal === "task" && canManageExecution ? <TaskModal saving={saving} milestones={workspace.milestones} members={project.members} onClose={() => setModal(null)} onSave={createTask} /> : null}
  {modal === "progress" && selectedTask ? <ProgressModal saving={saving} task={selectedTask} onClose={() => { setModal(null); setSelectedTask(null); }} onSave={updateProgress} /> : null}
  {modal === "document" && canManageExecution ? <DocumentModal saving={saving} onClose={() => setModal(null)} onSave={uploadDocument} /> : null}
  {modal === "credential" && workspace.can_manage_credentials ? <CredentialModal error={credentialError} saving={saving} credential={null} onClose={() => { setCredentialError(null); setModal(null); }} onSave={createCredential} /> : null}
  {modal === "credential_edit" && selectedCredential && workspace.can_manage_credentials ? <CredentialModal error={credentialError} saving={saving} credential={selectedCredential} onClose={() => { setCredentialError(null); setSelectedCredential(null); setModal(null); }} onSave={updateCredential} /> : null}
  {modal === "team" && canManageTeam ? <TeamModal saving={saving} project={project} employees={meta.employees} onClose={() => setModal(null)} onSave={saveTeam} /> : null}
  </main>;
}

function Overview({ project, workspace, canManageProject }: { project: ProjectDetail; workspace: Workspace; canManageProject: boolean }) {
  return <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]"><div className="space-y-5"><Card title="Project information"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Info label="Manager" value={project.project_manager_name || "Unassigned"} /><Info label="Planned start" value={project.planned_start_date || "—"} /><Info label="Due date" value={project.due_date || "—"} />{canManageProject ? <Info label="Contract" value={money(project.contract_value, project.currency)} /> : null}<Info label="Team" value={`${project.members.length} members`} /><Info label="Progress" value={`${workspace.summary.progress_percent}%`} /></div>{project.description ? <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{project.description}</p> : null}</Card><Card title="Milestone health">{workspace.milestones.length ? <div className="space-y-4">{workspace.milestones.slice(0,5).map((item) => <div key={item.id}><div className="flex justify-between gap-4 text-sm"><span className="font-medium">{item.title}</span><span>{item.progress_percent}%</span></div><Progress value={item.progress_percent} /></div>)}</div> : <Empty text="No milestones yet or milestone access is not enabled." />}</Card></div><Card title="Recent work">{workspace.recent_work.length ? <div className="space-y-4">{workspace.recent_work.slice(0,8).map((log) => <div key={log.id} className="border-b pb-4 last:border-0"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{log.employee_name} · {log.task_code}</p><span className="text-xs text-neutral-400">{log.progress_percent}%</span></div><p className="mt-1 text-sm text-neutral-600">{log.note}</p><p className="mt-1 text-xs text-neutral-400">{new Date(log.created_at).toLocaleString()}</p></div>)}</div> : <Empty text="No recent work or Work Log access is not enabled." />}</Card></div>;
}

function Milestones({ rows, onAdd }: { rows: MilestoneRow[]; onAdd?: () => void }) { return <Card title="Milestones" action={onAdd ? <AddButton label="Add milestone" onClick={onAdd} /> : undefined}><div className="space-y-3">{rows.length ? rows.map((item) => <div key={item.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-neutral-400">Due {item.due_date || "not set"}</p></div><Badge value={item.status} /></div><div className="mt-4"><div className="mb-1 text-right text-xs font-medium">{item.progress_percent}%</div><Progress value={item.progress_percent} /></div>{item.description ? <p className="mt-3 text-sm text-neutral-600">{item.description}</p> : null}</div>) : <Empty text="No milestones yet." />}</div></Card>; }

function Tasks({ rows, currentEmployeeId, canManage, onAdd, onProgress }: { rows: TaskRow[]; currentEmployeeId: string | null; canManage: boolean; onAdd?: () => void; onProgress: (task: TaskRow) => void }) { return <Card title="Tasks" action={onAdd ? <AddButton label="Add task" onClick={onAdd} /> : undefined}><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="text-xs uppercase text-neutral-400"><tr><th className="pb-3">Task</th><th className="pb-3">Milestone</th><th className="pb-3">Assignee</th><th className="pb-3">Status</th><th className="pb-3">Due</th><th className="pb-3">Progress</th><th className="pb-3 text-right">Action</th></tr></thead><tbody className="divide-y">{rows.map((task) => { const canUpdate = canManage || Boolean(currentEmployeeId && task.assignee_employee_id === currentEmployeeId); return <tr key={task.id}><td className="py-4 pr-4"><p className="font-medium">{task.task_code} · {task.title}</p><p className="mt-1 text-xs capitalize text-neutral-400">{task.priority} priority</p></td><td className="py-4 pr-4">{task.milestone_title || "—"}</td><td className="py-4 pr-4">{task.assignee_name || "Unassigned"}</td><td className="py-4 pr-4"><Badge value={task.status} /></td><td className="py-4 pr-4">{task.due_date || "—"}</td><td className="py-4 pr-4"><div className="w-32"><Progress value={task.progress_percent} /></div><span className="mt-1 block text-xs text-neutral-400">{task.progress_percent}%</span></td><td className="py-4 text-right">{canUpdate ? <button disabled={task.status === "cancelled"} onClick={() => onProgress(task)} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">Update Work</button> : <span className="text-xs text-neutral-400">View only</span>}</td></tr>; })}</tbody></table>{!rows.length ? <Empty text="No tasks yet." /> : null}</div></Card>; }

function WorkLogs({ rows }: { rows: WorkLog[] }) { return <Card title="Work Log"><div className="space-y-3">{rows.length ? rows.map((log) => <article key={log.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{log.employee_name} · {log.task_code}</p><div className="flex gap-2 text-xs text-neutral-400"><span>{log.progress_percent}%</span>{log.time_spent_minutes ? <span>· {(log.time_spent_minutes/60).toFixed(1)}h</span> : null}<span>· {new Date(log.created_at).toLocaleString()}</span></div></div><p className="mt-2 text-sm leading-6 text-neutral-600">{log.note}</p><p className="mt-1 text-xs text-neutral-400">{log.task_title}</p></article>) : <Empty text="Team updates will appear here." />}</div></Card>; }

function Documents({ projectId, rows, canManage, onAdd, onChanged }: { projectId: string; rows: DocumentRow[]; canManage: boolean; onAdd: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("other");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEdit(item: DocumentRow) {
    setEditing(item); setTitle(item.title); setDocumentType(item.document_type); setNotes(item.notes || ""); setError(null);
  }

  async function saveEdit() {
    if (!editing || !title.trim() || !documentType.trim()) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/documents/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), document_type: documentType.trim(), notes: notes.trim() || null }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to update project document.");
      setEditing(null); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update project document."); }
    finally { setSaving(false); }
  }

  async function remove(item: DocumentRow) {
    if (!window.confirm(`Delete document “${item.title}”? This permanently removes the uploaded file.`)) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/documents/${item.id}`, { method: "DELETE" });
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to delete project document.");
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete project document."); }
    finally { setSaving(false); }
  }

  return <><Card title="Project documents" action={canManage ? <AddButton label="Upload document" onClick={onAdd} /> : undefined}>{error && !editing ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map((item) => {
    const canPreview = Boolean(item.content_type && previewTypes.has(item.content_type));
    return <article key={item.id} className="rounded-xl border p-4"><div className="flex items-start gap-3"><FileText className="mt-1 size-5 text-neutral-400" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{item.title}</p><p className="mt-1 truncate text-xs text-neutral-400">{item.original_filename} · {formatBytes(item.size_bytes)}</p><p className="mt-1 text-xs capitalize text-neutral-400">{pretty(item.document_type)}</p>{item.notes ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500">{item.notes}</p> : null}</div></div><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={!canPreview} title={canPreview ? "Open secure preview" : "Preview is not available for this file type"} onClick={() => window.open(`/api/projects/${projectId}/documents/${item.id}/preview`, "_blank", "noopener,noreferrer")} className="inline-flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"><Eye className="size-3.5" />View</button><button onClick={() => window.open(`/api/projects/${projectId}/documents/${item.id}/file`, "_blank")} className="inline-flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold"><Download className="size-3.5" />Download</button>{canManage ? <><button disabled={saving} onClick={() => openEdit(item)} className="inline-flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold disabled:opacity-50"><Pencil className="size-3.5" />Edit</button><button disabled={saving} onClick={() => void remove(item)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 py-2 text-xs font-semibold text-red-600 disabled:opacity-50"><Trash2 className="size-3.5" />Delete</button></> : null}</div></article>;
  })}{!rows.length ? <div className="sm:col-span-2 xl:col-span-3"><Empty text="No project documents uploaded." /></div> : null}</div></Card>{canManage && editing ? <Modal title="Edit project document" onClose={() => { if (!saving) setEditing(null); }}><div className="rounded-xl border bg-neutral-50 p-4"><p className="text-xs uppercase tracking-wide text-neutral-400">Uploaded file</p><p className="mt-1 break-all text-sm font-medium">{editing.original_filename}</p><p className="mt-1 text-xs text-neutral-400">The uploaded file stays unchanged. Edit the document metadata below.</p></div>{error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}<Field label="Title"><input value={title} maxLength={180} onChange={(e) => setTitle(e.target.value)} className="control" /></Field><Field label="Document type"><input value={documentType} maxLength={64} onChange={(e) => setDocumentType(e.target.value)} className="control" placeholder="technical, delivery, certificate..." /></Field><Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="textarea" /></Field><ModalActions saving={saving} disabled={!title.trim() || !documentType.trim()} onClose={() => setEditing(null)} onSave={() => void saveEdit()} /></Modal> : null}</>;
}

function Credentials({ rows, revealed, canManage, copiedKey, onAdd, onReveal, onHide, onCopySecret, onCopy, onEdit, onDelete }: { rows: CredentialRow[]; revealed: Record<string,string>; canManage:boolean; copiedKey:string|null; onAdd:()=>void; onReveal:(id:string)=>void; onHide:(id:string)=>void; onCopySecret:(item:CredentialRow)=>void; onCopy:(value:string,key:string,label:string)=>void; onEdit:(item:CredentialRow)=>void; onDelete:(item:CredentialRow)=>void }) {
  return <Card title="Credentials Vault" action={canManage ? <AddButton label="Add credential" onClick={onAdd} /> : undefined}><div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><div className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><p>Secrets are encrypted at rest. Reveals are audited and automatically hidden from this screen after 30 seconds.</p></div></div><div className="grid gap-3 lg:grid-cols-2">{rows.map((item) => {
    const isRevealed = Boolean(revealed[item.id]);
    return <article key={item.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.name}</p>{item.access_level === "manager_only" ? <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><LockKeyhole className="size-3" />Manager Only</span> : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">Project Team</span>}</div><p className="mt-1 text-xs capitalize text-neutral-400">{pretty(item.credential_type)} · {pretty(item.environment)}</p></div><KeyRound className="size-5 shrink-0 text-neutral-400" /></div>
      {item.username ? <div className="mt-4 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2"><div className="min-w-0 flex-1"><p className="text-[11px] uppercase tracking-wide text-neutral-400">Username / Email</p><p className="truncate text-sm font-medium">{item.username}</p></div><MiniCopy copied={copiedKey === `username:${item.id}`} label="Copy Username" onClick={() => onCopy(item.username || "", `username:${item.id}`, "Username")} /></div> : null}
      {item.url ? <div className="mt-2 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2"><div className="min-w-0 flex-1"><p className="text-[11px] uppercase tracking-wide text-neutral-400">URL</p><p className="truncate text-sm font-medium">{item.url}</p></div><MiniCopy copied={copiedKey === `url:${item.id}`} label="Copy URL" onClick={() => onCopy(item.url || "", `url:${item.id}`, "URL")} /></div> : null}
      <div className="mt-3 rounded-lg bg-neutral-950 p-3 font-mono text-xs text-white">{isRevealed ? revealed[item.id] : "••••••••••••••••"}</div>
      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => isRevealed ? onHide(item.id) : onReveal(item.id)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold">{isRevealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{isRevealed ? "Hide" : "View"}</button><button onClick={() => onCopySecret(item)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold">{copiedKey === `secret:${item.id}` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copiedKey === `secret:${item.id}` ? "Copied" : "Copy Secret"}</button>{canManage ? <><button onClick={() => onEdit(item)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"><Pencil className="size-3.5" />Edit</button><button onClick={() => onDelete(item)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600"><Trash2 className="size-3.5" />Delete</button></> : null}</div>
      <div className="mt-4 border-t pt-3 text-xs text-neutral-400">{item.last_revealed_at ? <>Last revealed by <span className="font-medium text-neutral-600">{item.last_revealed_by || "Unknown user"}</span> · {new Date(item.last_revealed_at).toLocaleString()}</> : "Never revealed"}</div>
      {item.notes ? <p className="mt-3 text-xs leading-5 text-neutral-500">{item.notes}</p> : null}
    </article>;
  })}{!rows.length ? <div className="lg:col-span-2"><Empty text="No credentials available for your access level." /></div> : null}</div></Card>;
}

function MiniCopy({ copied, label, onClick }: { copied:boolean; label:string; onClick:()=>void }) { return <button title={label} onClick={onClick} className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-white">{copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5 text-neutral-500" />}</button>; }
function Team({ project, canManage, onManage }: { project: ProjectDetail; canManage: boolean; onManage: () => void }) { return <Card title="Project team" action={canManage ? <button onClick={onManage} className="rounded-lg border px-3 py-2 text-xs font-semibold">Manage team & access</button> : undefined}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{project.members.map((member) => <div key={member.id} className="rounded-xl border p-4"><UsersRound className="size-5 text-neutral-400" /><p className="mt-3 font-medium">{member.full_name}</p><p className="mt-1 text-xs text-neutral-400">{member.employee_code}</p><span className="mt-3 inline-flex rounded-full bg-neutral-100 px-2.5 py-1 text-xs">{member.role_label || "Team Member"}</span>{canManage ? <div className="mt-3 flex flex-wrap gap-1">{member.tab_permissions.map((permission) => <span key={permission} className="rounded-full border bg-neutral-50 px-2 py-0.5 text-[10px] text-neutral-500">{tabs.find((item) => item.id === permission)?.label ?? pretty(permission)}</span>)}</div> : null}</div>)}</div></Card>; }

function MilestoneModal({ saving, onClose, onSave }: { saving:boolean; onClose:()=>void; onSave:(v:{title:string;description:string;due_date:string})=>Promise<void> }) { const [title,setTitle]=useState(""); const [description,setDescription]=useState(""); const [due,setDue]=useState(""); return <Modal title="Add milestone" onClose={onClose}><Field label="Title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field><Field label="Due date"><input type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="control" /></Field><Field label="Description"><textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="textarea" /></Field><ModalActions saving={saving} disabled={!title.trim()} onClose={onClose} onSave={() => void onSave({title:title.trim(),description,due_date:due})} /></Modal>; }
function TaskModal({ saving, milestones, members, onClose, onSave }: { saving:boolean; milestones:MilestoneRow[]; members:ProjectMember[]; onClose:()=>void; onSave:(v:{title:string;description:string;milestone_id:string;priority:string;assignee_employee_id:string;planned_start_date:string;due_date:string;estimated_hours:string})=>Promise<void> }) { const [title,setTitle]=useState(""); const [description,setDescription]=useState(""); const [milestone,setMilestone]=useState(""); const [priority,setPriority]=useState("normal"); const [assignee,setAssignee]=useState(""); const [start,setStart]=useState(""); const [due,setDue]=useState(""); const [hours,setHours]=useState(""); return <Modal title="Add task" onClose={onClose}><div className="grid gap-4 sm:grid-cols-2"><Field label="Task title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field><Field label="Milestone"><select value={milestone} onChange={(e)=>setMilestone(e.target.value)} className="control"><option value="">No milestone</option>{milestones.map((m)=><option key={m.id} value={m.id}>{m.title}</option>)}</select></Field><Field label="Assignee"><select value={assignee} onChange={(e)=>setAssignee(e.target.value)} className="control"><option value="">Unassigned</option>{members.map((m)=><option key={m.employee_id} value={m.employee_id}>{m.full_name}</option>)}</select></Field><Field label="Priority"><select value={priority} onChange={(e)=>setPriority(e.target.value)} className="control"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field><Field label="Planned start"><input type="date" value={start} onChange={(e)=>setStart(e.target.value)} className="control" /></Field><Field label="Due date"><input type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="control" /></Field><Field label="Estimated hours"><input type="number" min="0" step="0.25" value={hours} onChange={(e)=>setHours(e.target.value)} className="control" /></Field><label className="sm:col-span-2 text-sm font-medium">Description<textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="textarea" /></label></div><ModalActions saving={saving} disabled={!title.trim()} onClose={onClose} onSave={() => void onSave({title:title.trim(),description,milestone_id:milestone,priority,assignee_employee_id:assignee,planned_start_date:start,due_date:due,estimated_hours:hours})} /></Modal>; }
function ProgressModal({ saving, task, onClose, onSave }: { saving:boolean; task:TaskRow; onClose:()=>void; onSave:(v:{progress:number;note:string;status:string;time_hours:string})=>Promise<void> }) { const [progress,setProgress]=useState(task.progress_percent); const [note,setNote]=useState(""); const [status,setStatus]=useState(task.status === "completed" ? "completed" : ""); const [hours,setHours]=useState(""); return <Modal title={`Update work · ${task.task_code}`} onClose={onClose}><div className="rounded-xl border bg-neutral-50 p-4"><p className="font-medium">{task.title}</p><p className="mt-1 text-sm text-neutral-500">Current progress: {task.progress_percent}%</p></div><Field label={`Progress · ${progress}%`}><input type="range" min="0" max="100" step="5" value={progress} onChange={(e)=>setProgress(Number(e.target.value))} className="mt-3 w-full" /></Field><Field label="Work status"><select value={status} onChange={(e)=>setStatus(e.target.value)} className="control"><option value="">Keep / automatic</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">Ready for review</option></select></Field><Field label="Time spent (hours)"><input type="number" min="0" step="0.25" value={hours} onChange={(e)=>setHours(e.target.value)} className="control" /></Field><Field label="What did you work on?"><textarea value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Describe what changed, what is done, blockers, or what comes next..." className="textarea" /></Field><ModalActions saving={saving} disabled={note.trim().length < 2} onClose={onClose} onSave={() => void onSave({progress,note:note.trim(),status,time_hours:hours})} /></Modal>; }
function DocumentModal({ saving, onClose, onSave }: { saving:boolean; onClose:()=>void; onSave:(v:{title:string;document_type:string;notes:string;file:File|null})=>Promise<void> }) { const [title,setTitle]=useState(""); const [type,setType]=useState("other"); const [notes,setNotes]=useState(""); const [file,setFile]=useState<File|null>(null); return <Modal title="Upload project document" onClose={onClose}><Field label="Title"><input value={title} onChange={(e)=>setTitle(e.target.value)} className="control" /></Field><Field label="Document type"><select value={type} onChange={(e)=>setType(e.target.value)} className="control"><option value="requirement">Requirement</option><option value="contract">Contract</option><option value="design">Design</option><option value="technical">Technical</option><option value="delivery">Delivery</option><option value="other">Other</option></select></Field><Field label="File"><input type="file" onChange={(e)=>setFile(e.target.files?.[0] || null)} className="control py-2" /></Field><Field label="Notes"><textarea value={notes} onChange={(e)=>setNotes(e.target.value)} className="textarea" /></Field><ModalActions saving={saving} disabled={!title.trim() || !file} onClose={onClose} onSave={() => void onSave({title:title.trim(),document_type:type,notes,file})} /></Modal>; }

function CredentialModal({ error, saving, credential, onClose, onSave }: { error:string|null; saving:boolean; credential:CredentialRow|null; onClose:()=>void; onSave:(v:CredentialValues)=>Promise<void> }) {
  const [name,setName]=useState(credential?.name || ""); const [type,setType]=useState(credential?.credential_type || "login"); const [env,setEnv]=useState(credential?.environment || "production"); const [username,setUsername]=useState(credential?.username || ""); const [secret,setSecret]=useState(""); const [url,setUrl]=useState(credential?.url || ""); const [notes,setNotes]=useState(credential?.notes || ""); const [access,setAccess]=useState(credential?.access_level || "manager_only");
  return <Modal title={credential ? "Edit encrypted credential" : "Add encrypted credential"} onClose={onClose}>{error ? <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p className="font-semibold">Credential could not be saved</p><p className="mt-1 leading-5">{error}</p></div> : null}<div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><input value={name} onChange={(e)=>setName(e.target.value)} className="control" /></Field><Field label="Type"><select value={type} onChange={(e)=>setType(e.target.value)} className="control"><option value="login">Login</option><option value="api_key">API Key</option><option value="database">Database</option><option value="ssh">SSH / Server</option><option value="hosting">Hosting</option><option value="domain">Domain</option><option value="other">Other</option></select></Field><Field label="Environment"><select value={env} onChange={(e)=>setEnv(e.target.value)} className="control"><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option><option value="other">Other</option></select></Field><Field label="Access"><select value={access} onChange={(e)=>setAccess(e.target.value)} className="control"><option value="manager_only">Project manager only</option><option value="team">Project team</option></select></Field><Field label="Username / Email"><input value={username} onChange={(e)=>setUsername(e.target.value)} className="control" /></Field><Field label={credential ? "New Secret / Password / Key (optional)" : "Secret / Password / Key"}><input type="password" autoComplete="new-password" value={secret} onChange={(e)=>setSecret(e.target.value)} placeholder={credential ? "Leave blank to keep current secret" : ""} className="control" /></Field><label className="sm:col-span-2 text-sm font-medium">URL<input value={url} onChange={(e)=>setUrl(e.target.value)} className="control" /></label><label className="sm:col-span-2 text-sm font-medium">Notes<textarea value={notes} onChange={(e)=>setNotes(e.target.value)} className="textarea" /></label></div><ModalActions saving={saving} disabled={!name.trim() || (!credential && !secret)} onClose={onClose} onSave={() => void onSave({name:name.trim(),credential_type:type,environment:env,username,secret,url,notes,access_level:access})} /></Modal>;
}

function TeamModal({ saving, project, employees, onClose, onSave }: { saving:boolean; project:ProjectDetail; employees:EmployeeOption[]; onClose:()=>void; onSave:(manager:string,members:string[],permissions:Record<string,Tab[]>)=>Promise<void> }) {
  const [manager,setManager]=useState(project.project_manager_employee_id || project.members.find((m)=>m.role_label==="Project Manager")?.employee_id || "");
  const [selected,setSelected]=useState(project.members.map((m)=>m.employee_id));
  const [permissions,setPermissions]=useState<Record<string,Tab[]>>(() => Object.fromEntries(project.members.map((member) => [member.employee_id, member.tab_permissions.length ? member.tab_permissions : [...defaultMemberTabs]])));

  function selectEmployee(employeeId: string, checked: boolean) {
    if (checked) {
      setSelected((current) => [...new Set([...current, employeeId])]);
      setPermissions((current) => current[employeeId] ? current : { ...current, [employeeId]: [...defaultMemberTabs] });
    } else if (employeeId !== manager) {
      setSelected((current) => current.filter((id) => id !== employeeId));
    }
  }

  function togglePermission(employeeId: string, permission: Tab, checked: boolean) {
    setPermissions((current) => {
      const existing = current[employeeId] ?? [...defaultMemberTabs];
      if (checked) return { ...current, [employeeId]: [...new Set([...existing, permission])] };
      if (existing.length <= 1) return current;
      return { ...current, [employeeId]: existing.filter((item) => item !== permission) };
    });
  }

  function save() {
    const memberPermissions: Record<string, Tab[]> = {};
    selected.forEach((employeeId) => {
      memberPermissions[employeeId] = employeeId === manager ? [...allTabIds] : permissions[employeeId] ?? [...defaultMemberTabs];
    });
    void onSave(manager, selected, memberPermissions);
  }

  return <Modal title="Manage project team & access" onClose={onClose}>
    <Field label="Project manager"><select value={manager} onChange={(e)=>{const id=e.target.value;setManager(id);if(id){setSelected((current)=>[...new Set([...current,id])]);setPermissions((current)=>({...current,[id]:[...allTabIds]}));}}} className="control"><option value="">Unassigned</option>{employees.map((e)=><option key={e.id} value={e.id}>{e.full_name} · {e.employee_code}</option>)}</select></Field>
    <div className="mt-5 rounded-xl border">
      <div className="border-b bg-neutral-50 px-4 py-3"><p className="text-sm font-semibold">Team members & tab access</p><p className="mt-1 text-xs text-neutral-500">Select a member, then choose which Project tabs they can open. The project manager always has full Project access.</p></div>
      <div className="max-h-[55vh] overflow-y-auto">{employees.map((employee)=>{
        const isManager=manager===employee.id; const isSelected=selected.includes(employee.id)||isManager; const employeePermissions=isManager?allTabIds:(permissions[employee.id]??defaultMemberTabs);
        return <div key={employee.id} className="border-b p-4 last:border-0"><label className="flex items-center gap-3"><input type="checkbox" checked={isSelected} disabled={isManager} onChange={(event)=>selectEmployee(employee.id,event.target.checked)}/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{employee.full_name}</span><span className="text-xs text-neutral-400">{employee.employee_code}</span></span>{isManager?<span className="rounded-full bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-white">Full access</span>:null}</label>{isSelected?<div className="mt-3 grid gap-2 pl-7 sm:grid-cols-2">{tabs.map((item)=><label key={item.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${isManager?"bg-neutral-50 text-neutral-400":"bg-white"}`}><input type="checkbox" checked={employeePermissions.includes(item.id)} disabled={isManager} onChange={(event)=>togglePermission(employee.id,item.id,event.target.checked)}/><span>{item.label}</span></label>)}</div>:null}</div>;
      })}</div>
    </div>
    <ModalActions saving={saving} disabled={false} onClose={onClose} onSave={save} />
  </Modal>;
}
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
