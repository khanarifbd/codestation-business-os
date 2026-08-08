"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CirclePause, FolderKanban, Loader2, PlayCircle, Search, UsersRound, X, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

type EmployeeOption = { id: string; employee_code: string; full_name: string };
type Meta = { employees: EmployeeOption[] };
type Summary = { total: number; planned: number; active: number; on_hold: number; completed: number; cancelled: number };
type ProjectRow = { id: string; project_number: string; order_id: string; order_number: string; client_id: string; client_name: string; name: string; status: string; priority: string; planned_start_date: string | null; due_date: string | null; currency: string; contract_value: string | number; project_manager_employee_id: string | null; project_manager_name: string | null; member_count: number; created_at: string; updated_at: string };
type ProjectMember = { id: string; employee_id: string; employee_code: string; full_name: string; role_label: string | null; is_active: boolean; added_at: string };
type ProjectDetail = ProjectRow & { quotation_id: string; quotation_number: string; source_lead_id: string | null; description: string | null; notes: string | null; actual_started_at: string | null; completed_at: string | null; cancelled_at: string | null; members: ProjectMember[] };
type OrderDetail = { id: string; order_number: string; quotation_id: string; quotation_number: string; client_id: string; client_name_snapshot: string; status: string; subject: string | null; order_date: string; currency: string; total: string | number; assigned_employee_id: string | null; assigned_employee_name: string | null };
type ProjectLink = { project_id: string; project_number: string; status: string };

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function today() { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }

export default function ProjectsPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta>({ employees: [] });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);

  const [orderId, setOrderId] = useState<string | null>(null);
  const [requestedProjectId, setRequestedProjectId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [orderProjectLink, setOrderProjectLink] = useState<ProjectLink | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("normal");
  const [managerId, setManagerId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [plannedStartDate, setPlannedStartDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrderId(params.get("order_id"));
    setRequestedProjectId(params.get("project_id"));
  }, []);

  const projectApi = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/projects${path}`, init);
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    if (response.status === 403) throw new Error("Your company role does not have permission for projects.");
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Project request failed.");
    return payload;
  }, [router]);

  const salesApi = useCallback(async (path: string) => {
    const response = await fetch(`/api/sales${path}`);
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Order request failed.");
    return payload;
  }, [router]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "30" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    return params.toString();
  }, [search, statusFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [metaPayload, summaryPayload, listPayload] = await Promise.all([
        projectApi("/meta"), projectApi("/summary"), projectApi(`?${query}`),
      ]);
      setMeta(metaPayload as Meta);
      setSummary(summaryPayload as Summary);
      const typed = listPayload as { items: ProjectRow[]; next_cursor: string | null };
      setRows(typed.items);
      setNextCursor(typed.next_cursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load projects."); }
    finally { setLoading(false); }
  }, [projectApi, query]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orderId) { setOrder(null); setOrderProjectLink(null); return; }
    let active = true;
    void Promise.all([salesApi(`/orders/${encodeURIComponent(orderId)}`), projectApi(`/order/${encodeURIComponent(orderId)}/link`)]).then(([orderPayload, linkPayload]) => {
      if (!active) return;
      const typedOrder = orderPayload as OrderDetail;
      setOrder(typedOrder);
      setOrderProjectLink(linkPayload as ProjectLink | null);
      setName(typedOrder.subject || `${typedOrder.client_name_snapshot} · ${typedOrder.order_number}`);
      setManagerId(typedOrder.assigned_employee_id || "");
      setMemberIds(typedOrder.assigned_employee_id ? [typedOrder.assigned_employee_id] : []);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load order handoff."); });
    return () => { active = false; };
  }, [orderId, projectApi, salesApi]);

  useEffect(() => { if (requestedProjectId) void openDetail(requestedProjectId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [requestedProjectId]);

  async function openDetail(id: string) {
    setDetailLoading(true); setError(null);
    try { setDetail(await projectApi(`/${id}`) as ProjectDetail); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load project."); }
    finally { setDetailLoading(false); }
  }

  function openCreate() {
    if (!order) return;
    setName(order.subject || `${order.client_name_snapshot} · ${order.order_number}`);
    setPriority("normal"); setManagerId(order.assigned_employee_id || ""); setMemberIds(order.assigned_employee_id ? [order.assigned_employee_id] : []);
    setPlannedStartDate(today()); setDueDate(""); setDescription(""); setNotes(""); setCreateOpen(true);
  }

  async function createProject() {
    if (!orderId || !order) return;
    if (!name.trim()) { setError("Project name is required."); return; }
    if (dueDate && plannedStartDate && dueDate < plannedStartDate) { setError("Due date cannot be before planned start date."); return; }
    setSaving(true); setError(null);
    try {
      const created = await projectApi(`/from-order/${encodeURIComponent(orderId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), priority, project_manager_employee_id: managerId || null, member_employee_ids: memberIds, planned_start_date: plannedStartDate || null, due_date: dueDate || null, description: description.trim() || null, notes: notes.trim() || null }),
      }) as ProjectDetail;
      setCreateOpen(false); setOrderProjectLink({ project_id: created.id, project_number: created.project_number, status: created.status }); setDetail(created);
      setMessage(`Project ${created.project_number} created from ${created.order_number}`);
      router.replace(`/dashboard/projects?project_id=${encodeURIComponent(created.id)}`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create project."); }
    finally { setSaving(false); }
  }

  async function changeStatus(next: "active" | "on_hold" | "completed" | "cancelled") {
    if (!detail) return;
    setSaving(true); setError(null);
    try {
      const updated = await projectApi(`/${detail.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) }) as ProjectDetail;
      setDetail(updated); setMessage(`Project ${updated.project_number} marked ${updated.status.replace("_", " ")}`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update project status."); }
    finally { setSaving(false); }
  }

  async function saveTeam(nextManagerId: string, nextMemberIds: string[]) {
    if (!detail) return;
    setSaving(true); setError(null);
    try {
      const updated = await projectApi(`/${detail.id}/team`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_manager_employee_id: nextManagerId || null, member_employee_ids: nextMemberIds }) }) as ProjectDetail;
      setDetail(updated); setTeamOpen(false); setMessage(`Team updated for ${updated.project_number}`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update project team."); }
    finally { setSaving(false); }
  }

  async function loadMore() {
    if (!nextCursor) return; setLoadingMore(true);
    try { const params = new URLSearchParams(query); params.set("cursor", nextCursor); const payload = await projectApi(`?${params}`) as { items: ProjectRow[]; next_cursor: string | null }; setRows((current) => [...current, ...payload.items]); setNextCursor(payload.next_cursor); }
    finally { setLoadingMore(false); }
  }

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header><p className="text-sm font-medium text-neutral-500">Delivery workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Projects</h1><p className="mt-2 text-sm text-neutral-500">Turn commercial orders into accountable delivery work with ownership, teams and deadlines.</p></header>

    {order ? <section className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-950"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Order handoff</p><h2 className="mt-1 font-semibold">{order.order_number} · {order.client_name_snapshot}</h2><p className="mt-1 text-sm text-indigo-700">{money(order.total, order.currency)} · Status: {order.status.replace("_", " ")}</p></div>{orderProjectLink ? <button onClick={() => void openDetail(orderProjectLink.project_id)} className="h-11 rounded-xl bg-white px-4 text-sm font-semibold shadow-sm">Open {orderProjectLink.project_number}</button> : <button disabled={saving || !["confirmed", "in_progress"].includes(order.status)} onClick={openCreate} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Create Project</button>}</div></section> : null}

    <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Stat label="Total" value={summary?.total ?? 0} icon={FolderKanban} /><Stat label="Planned" value={summary?.planned ?? 0} icon={FolderKanban} /><Stat label="Active" value={summary?.active ?? 0} icon={PlayCircle} /><Stat label="On hold" value={summary?.on_hold ?? 0} icon={CirclePause} /><Stat label="Completed" value={summary?.completed ?? 0} icon={CheckCircle2} /></div>
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}{error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="grid gap-3 border-b p-4 sm:grid-cols-[minmax(260px,1fr)_220px_auto] sm:p-5"><form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }} className="relative"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search project, order or client..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-neutral-500" /></form><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="">All statuses</option><option value="planned">Planned</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><button onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter(""); }} className="h-11 rounded-xl border px-4 text-sm font-semibold">Reset</button></div>
      {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : rows.length === 0 ? <div className="px-6 py-20 text-center"><FolderKanban className="mx-auto size-8 text-neutral-300" /><h2 className="mt-4 font-semibold">No projects found</h2><p className="mt-1 text-sm text-neutral-500">Open a confirmed Order and create its delivery project.</p></div> : <><div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-6 py-3 font-medium">Project</th><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Order</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Manager / Team</th><th className="px-4 py-3 font-medium">Due</th><th className="px-4 py-3 font-medium">Value</th><th className="px-6 py-3 text-right font-medium">Action</th></tr></thead><tbody className="divide-y">{rows.map((item) => <tr key={item.id} className="hover:bg-neutral-50/70"><td className="px-6 py-4"><p className="font-medium">{item.project_number}</p><p className="mt-1 text-xs text-neutral-400">{item.name}</p></td><td className="px-4 py-4">{item.client_name}</td><td className="px-4 py-4">{item.order_number}</td><td className="px-4 py-4"><StatusBadge status={item.status} /></td><td className="px-4 py-4"><p>{item.project_manager_name || "Unassigned"}</p><p className="mt-1 text-xs text-neutral-400">{item.member_count} member{item.member_count === 1 ? "" : "s"}</p></td><td className="px-4 py-4 text-neutral-600">{item.due_date || "—"}</td><td className="px-4 py-4 font-medium">{money(item.contract_value, item.currency)}</td><td className="px-6 py-4 text-right"><button onClick={() => void openDetail(item.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Open</button></td></tr>)}</tbody></table></div>{nextCursor ? <div className="border-t p-4 text-center"><button disabled={loadingMore} onClick={() => void loadMore()} className="rounded-xl border px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{loadingMore ? "Loading..." : "Load more"}</button></div> : null}</>}
    </section>
  </div>

  {createOpen && order ? <ProjectCreateModal order={order} employees={meta.employees} saving={saving} name={name} setName={setName} priority={priority} setPriority={setPriority} managerId={managerId} setManagerId={setManagerId} memberIds={memberIds} setMemberIds={setMemberIds} plannedStartDate={plannedStartDate} setPlannedStartDate={setPlannedStartDate} dueDate={dueDate} setDueDate={setDueDate} description={description} setDescription={setDescription} notes={notes} setNotes={setNotes} onClose={() => setCreateOpen(false)} onCreate={() => void createProject()} /> : null}
  {(detailLoading || detail) ? <ProjectDrawer detail={detail} loading={detailLoading} saving={saving} onClose={() => { setDetail(null); if (requestedProjectId) router.replace("/dashboard/projects"); }} onStatus={changeStatus} onManageTeam={() => setTeamOpen(true)} /> : null}
  {teamOpen && detail ? <TeamModal project={detail} employees={meta.employees} saving={saving} onClose={() => setTeamOpen(false)} onSave={saveTeam} /> : null}
  </main>;
}

function ProjectCreateModal(props: { order: OrderDetail; employees: EmployeeOption[]; saving: boolean; name: string; setName: (value: string) => void; priority: string; setPriority: (value: string) => void; managerId: string; setManagerId: (value: string) => void; memberIds: string[]; setMemberIds: (value: string[]) => void; plannedStartDate: string; setPlannedStartDate: (value: string) => void; dueDate: string; setDueDate: (value: string) => void; description: string; setDescription: (value: string) => void; notes: string; setNotes: (value: string) => void; onClose: () => void; onCreate: () => void }) {
  const input = "mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-neutral-500";
  return <Modal title="Create project from order" onClose={props.onClose}><div className="rounded-xl border bg-neutral-50 p-4 text-sm"><strong>{props.order.order_number}</strong> · {props.order.client_name_snapshot}<span className="float-right font-semibold">{money(props.order.total, props.order.currency)}</span></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">Project name<input value={props.name} onChange={(e) => props.setName(e.target.value)} className={input} /></label><label className="text-sm font-medium">Priority<select value={props.priority} onChange={(e) => props.setPriority(e.target.value)} className={input}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="text-sm font-medium">Project manager<select value={props.managerId} onChange={(e) => { props.setManagerId(e.target.value); if (e.target.value && !props.memberIds.includes(e.target.value)) props.setMemberIds([...props.memberIds, e.target.value]); }} className={input}><option value="">Unassigned</option>{props.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.employee_code}</option>)}</select></label><label className="text-sm font-medium">Planned start<input type="date" value={props.plannedStartDate} onChange={(e) => props.setPlannedStartDate(e.target.value)} className={input} /></label><label className="text-sm font-medium">Due date<input type="date" value={props.dueDate} onChange={(e) => props.setDueDate(e.target.value)} className={input} /></label></div><div className="mt-5"><p className="text-sm font-medium">Project team</p><EmployeeChecklist employees={props.employees} selected={props.memberIds} managerId={props.managerId} onChange={props.setMemberIds} /></div><label className="mt-5 block text-sm font-medium">Description<textarea value={props.description} onChange={(e) => props.setDescription(e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border p-3 text-sm" /></label><label className="mt-4 block text-sm font-medium">Internal notes<textarea value={props.notes} onChange={(e) => props.setNotes(e.target.value)} className="mt-2 min-h-20 w-full rounded-xl border p-3 text-sm" /></label><div className="mt-6 flex justify-end gap-2 border-t pt-5"><button onClick={props.onClose} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={props.saving} onClick={props.onCreate} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{props.saving ? "Creating..." : "Create project"}</button></div></Modal>;
}

function ProjectDrawer({ detail, loading, saving, onClose, onStatus, onManageTeam }: { detail: ProjectDetail | null; loading: boolean; saving: boolean; onClose: () => void; onStatus: (status: "active" | "on_hold" | "completed" | "cancelled") => Promise<void>; onManageTeam: () => void }) {
  return <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="ml-auto h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><div><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Project</p><h2 className="mt-1 text-xl font-semibold">{detail?.project_number || "Loading..."}</h2></div><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{loading || !detail ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : <div className="space-y-6 p-6"><div className="rounded-2xl border p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs uppercase tracking-wide text-neutral-400">Project status</p><div className="mt-2"><StatusBadge status={detail.status} /></div></div><div className="flex flex-wrap gap-2">{detail.status === "planned" ? <><Action primary label="Start project" disabled={saving} onClick={() => void onStatus("active")} /><Action label="Cancel" disabled={saving} onClick={() => void onStatus("cancelled")} /></> : null}{detail.status === "active" ? <><Action label="Put on hold" disabled={saving} onClick={() => void onStatus("on_hold")} /><Action primary label="Complete" disabled={saving} onClick={() => void onStatus("completed")} /><Action label="Cancel" disabled={saving} onClick={() => void onStatus("cancelled")} /></> : null}{detail.status === "on_hold" ? <><Action primary label="Resume" disabled={saving} onClick={() => void onStatus("active")} /><Action label="Cancel" disabled={saving} onClick={() => void onStatus("cancelled")} /></> : null}</div></div>{["completed", "cancelled"].includes(detail.status) ? <p className="mt-4 rounded-xl bg-neutral-50 p-3 text-sm text-neutral-500">This project is closed and locked for operational changes.</p> : null}</div>
    <div><h3 className="text-2xl font-semibold">{detail.name}</h3><p className="mt-1 text-sm text-neutral-500">{detail.client_name} · {detail.order_number} · {detail.quotation_number}</p></div><div className="grid gap-4 sm:grid-cols-2"><Info label="Priority" value={detail.priority} /><Info label="Contract value" value={money(detail.contract_value, detail.currency)} /><Info label="Planned start" value={detail.planned_start_date || "—"} /><Info label="Due date" value={detail.due_date || "—"} /><Info label="Project manager" value={detail.project_manager_name || "Unassigned"} /><Info label="Started" value={detail.actual_started_at ? new Date(detail.actual_started_at).toLocaleString() : "—"} /></div>
    <section className="rounded-2xl border"><div className="flex items-center justify-between border-b px-5 py-4"><div><h3 className="font-semibold">Project team</h3><p className="mt-1 text-xs text-neutral-400">{detail.members.length} active member{detail.members.length === 1 ? "" : "s"}</p></div>{!["completed", "cancelled"].includes(detail.status) ? <button onClick={onManageTeam} className="rounded-xl border px-3 py-2 text-xs font-semibold">Manage team</button> : null}</div>{detail.members.length ? <div className="divide-y">{detail.members.map((member) => <div key={member.id} className="flex items-center justify-between px-5 py-3"><div><p className="text-sm font-medium">{member.full_name}</p><p className="mt-1 text-xs text-neutral-400">{member.employee_code}</p></div><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">{member.role_label || "Team Member"}</span></div>)}</div> : <p className="p-5 text-sm text-neutral-400">No team members assigned.</p>}</section>{detail.description ? <TextBlock label="Description" value={detail.description} /> : null}{detail.notes ? <TextBlock label="Internal notes" value={detail.notes} /> : null}</div>}</aside></div>;
}

function TeamModal({ project, employees, saving, onClose, onSave }: { project: ProjectDetail; employees: EmployeeOption[]; saving: boolean; onClose: () => void; onSave: (managerId: string, memberIds: string[]) => Promise<void> }) {
  const [manager, setManager] = useState(project.project_manager_employee_id || ""); const [selected, setSelected] = useState(project.members.map((member) => member.employee_id));
  return <Modal title={`Manage team · ${project.project_number}`} onClose={onClose}><label className="text-sm font-medium">Project manager<select value={manager} onChange={(e) => { const value = e.target.value; setManager(value); if (value && !selected.includes(value)) setSelected([...selected, value]); }} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm"><option value="">Unassigned</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.employee_code}</option>)}</select></label><div className="mt-5"><p className="text-sm font-medium">Team members</p><EmployeeChecklist employees={employees} selected={selected} managerId={manager} onChange={setSelected} /></div><div className="mt-6 flex justify-end gap-2 border-t pt-5"><button onClick={onClose} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} onClick={() => void onSave(manager, selected)} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save team"}</button></div></Modal>;
}

function EmployeeChecklist({ employees, selected, managerId, onChange }: { employees: EmployeeOption[]; selected: string[]; managerId: string; onChange: (value: string[]) => void }) { return <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border bg-white">{employees.length ? employees.map((employee) => { const checked = selected.includes(employee.id); const locked = employee.id === managerId; return <label key={employee.id} className="flex cursor-pointer items-center gap-3 border-b px-4 py-3 last:border-b-0"><input type="checkbox" checked={checked || locked} disabled={locked} onChange={(e) => onChange(e.target.checked ? [...new Set([...selected, employee.id])] : selected.filter((id) => id !== employee.id))} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{employee.full_name}</span><span className="text-xs text-neutral-400">{employee.employee_code}</span></span>{locked ? <span className="text-xs font-medium text-neutral-400">Manager</span> : null}</label>; }) : <p className="p-4 text-sm text-neutral-400">No active employees available.</p>}</div>; }
function StatusBadge({ status }: { status: string }) { const styles: Record<string, string> = { planned: "bg-neutral-50 text-neutral-600", active: "border-emerald-200 bg-emerald-50 text-emerald-700", on_hold: "border-amber-200 bg-amber-50 text-amber-700", completed: "border-blue-200 bg-blue-50 text-blue-700", cancelled: "border-red-200 bg-red-50 text-red-700" }; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${styles[status] || "bg-neutral-50"}`}>{status.replace("_", " ")}</span>; }
function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof FolderKanban }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-2xl font-semibold">{value}</p></article>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-neutral-50 p-3"><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 text-sm font-medium capitalize">{value.replace("_", " ")}</p></div>; }
function TextBlock({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border p-4"><p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{value}</p></div>; }
function Action({ label, onClick, disabled, primary = false }: { label: string; onClick: () => void; disabled: boolean; primary?: boolean }) { return <button disabled={disabled} onClick={onClick} className={`h-10 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${primary ? "bg-neutral-950 text-white" : "border bg-white"}`}>{label}</button>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="p-6">{children}</div></div></div>; }
