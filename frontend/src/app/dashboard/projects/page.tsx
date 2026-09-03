"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CirclePause, FolderKanban, Loader2, PlayCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/searchable-select";

type EmployeeOption = { id: string; employee_code: string; full_name: string };
type Meta = { employees: EmployeeOption[]; can_manage_projects: boolean };
type Summary = { total: number; planned: number; active: number; on_hold: number; completed: number; cancelled: number };
type ProjectRow = { id: string; project_number: string; order_id: string; order_number: string; client_id: string; client_name: string; name: string; status: string; priority: string; planned_start_date: string | null; due_date: string | null; currency: string; contract_value: string | number; project_manager_employee_id: string | null; project_manager_name: string | null; member_count: number };
type OrderDetail = { id: string; order_number: string; client_name_snapshot: string; status: string; subject: string | null; currency: string; total: string | number; assigned_employee_id: string | null };
type ProjectLink = { project_id: string; project_number: string; status: string };

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function today() { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }

export default function ProjectsPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta>({ employees: [], can_manage_projects: false });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
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

  useEffect(() => { setOrderId(new URLSearchParams(window.location.search).get("order_id")); }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/projects${path}`, init);
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Project request failed.");
    return payload;
  }, [router]);

  const salesApi = useCallback(async (path: string) => {
    const response = await fetch(`/api/sales${path}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Order request failed.");
    return payload;
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "30" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    return params.toString();
  }, [search, statusFilter]);

  const loadList = useCallback(async (first = false) => {
    if (first) setLoading(true);
    setError(null);
    try {
      const listPayload = await api(`?${query}`) as { items: ProjectRow[]; next_cursor: string | null };
      setRows(listPayload.items); setNextCursor(listPayload.next_cursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load projects."); }
    finally { if (first) setLoading(false); }
  }, [api, query]);

  useEffect(() => { void (async () => {
    try {
      const [metaPayload, summaryPayload, listPayload] = await Promise.all([api("/meta"), api("/summary"), api(`?${query}`)]);
      setMeta(metaPayload as Meta); setSummary(summaryPayload as Summary);
      const typed = listPayload as { items: ProjectRow[]; next_cursor: string | null };
      setRows(typed.items); setNextCursor(typed.next_cursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load projects."); }
    finally { setLoading(false); }
  })();
  // initial metadata and summary are intentionally loaded once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    if (loading) return;
    void loadList();
  }, [query, loadList, loading]);

  useEffect(() => {
    if (!orderId || !meta.can_manage_projects) { setOrder(null); setOrderProjectLink(null); return; }
    let active = true;
    void Promise.all([salesApi(`/orders/${encodeURIComponent(orderId)}`), api(`/order/${encodeURIComponent(orderId)}/link`)]).then(([orderPayload, linkPayload]) => {
      if (!active) return;
      const typed = orderPayload as OrderDetail;
      setOrder(typed); setOrderProjectLink(linkPayload as ProjectLink | null);
      setName(typed.subject || `${typed.client_name_snapshot} · ${typed.order_number}`);
      setManagerId(typed.assigned_employee_id || ""); setMemberIds(typed.assigned_employee_id ? [typed.assigned_employee_id] : []);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load order handoff."); });
    return () => { active = false; };
  }, [orderId, meta.can_manage_projects, api, salesApi]);

  async function createProject() {
    if (!meta.can_manage_projects || !orderId || !order || !name.trim()) return;
    setSaving(true); setError(null);
    try {
      const created = await api(`/from-order/${encodeURIComponent(orderId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), priority, project_manager_employee_id: managerId || null, member_employee_ids: memberIds, planned_start_date: plannedStartDate || null, due_date: dueDate || null, description: description.trim() || null }),
      }) as { id: string };
      setCreateOpen(false); router.push(`/dashboard/projects/${created.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create project."); }
    finally { setSaving(false); }
  }

  async function loadMore() {
    if (!nextCursor) return; setLoadingMore(true);
    try { const params = new URLSearchParams(query); params.set("cursor", nextCursor); const payload = await api(`?${params}`) as { items: ProjectRow[]; next_cursor: string | null }; setRows((current) => [...current, ...payload.items]); setNextCursor(payload.next_cursor); }
    finally { setLoadingMore(false); }
  }

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header><p className="text-sm font-medium text-neutral-500">Delivery workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Projects</h1><p className="mt-2 text-sm text-neutral-500">{meta.can_manage_projects ? "Milestones, tasks, work logs, documents and credentials live inside each project workspace." : "Only projects assigned to you are shown. Your Project tabs are controlled by the project administrator."}</p></header>

    {meta.can_manage_projects && order ? <section className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-950"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Order handoff</p><h2 className="mt-1 font-semibold">{order.order_number} · {order.client_name_snapshot}</h2><p className="mt-1 text-sm text-indigo-700">{money(order.total, order.currency)} · {order.status.replace("_", " ")}</p></div>{orderProjectLink ? <button onClick={() => router.push(`/dashboard/projects/${orderProjectLink.project_id}`)} className="h-11 rounded-xl bg-white px-4 text-sm font-semibold shadow-sm">Open {orderProjectLink.project_number}</button> : <button disabled={saving || !["confirmed", "in_progress"].includes(order.status)} onClick={() => setCreateOpen(true)} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Create Project</button>}</div></section> : null}

    <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Stat label="Total" value={summary?.total ?? 0} icon={FolderKanban} /><Stat label="Planned" value={summary?.planned ?? 0} icon={FolderKanban} /><Stat label="Active" value={summary?.active ?? 0} icon={PlayCircle} /><Stat label="On hold" value={summary?.on_hold ?? 0} icon={CirclePause} /><Stat label="Completed" value={summary?.completed ?? 0} icon={CheckCircle2} /></div>
    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="grid gap-3 border-b p-4 sm:grid-cols-[minmax(260px,1fr)_220px_auto] sm:p-5"><form onSubmit={(e) => { e.preventDefault(); setSearch(searchDraft.trim()); }} className="relative"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search project, order or client..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm" /></form><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="">All statuses</option><option value="planned">Planned</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><button onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter(""); }} className="h-11 rounded-xl border px-4 text-sm font-semibold">Reset</button></div>
      {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : rows.length === 0 ? <div className="px-6 py-20 text-center text-sm text-neutral-500">No projects found.</div> : <><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-6 py-3">Project</th><th className="px-4 py-3">Client</th>{meta.can_manage_projects ? <th className="px-4 py-3">Order</th> : null}<th className="px-4 py-3">Status</th><th className="px-4 py-3">Manager / Team</th><th className="px-4 py-3">Due</th>{meta.can_manage_projects ? <th className="px-4 py-3">Value</th> : null}<th className="px-6 py-3 text-right">Action</th></tr></thead><tbody className="divide-y">{rows.map((item) => <tr key={item.id} className="hover:bg-neutral-50"><td className="px-6 py-4"><p className="font-medium">{item.project_number}</p><p className="mt-1 text-xs text-neutral-400">{item.name}</p></td><td className="px-4 py-4">{item.client_name}</td>{meta.can_manage_projects ? <td className="px-4 py-4">{item.order_number}</td> : null}<td className="px-4 py-4"><Badge value={item.status} /></td><td className="px-4 py-4"><p>{item.project_manager_name || "Unassigned"}</p><p className="mt-1 text-xs text-neutral-400">{item.member_count} members</p></td><td className="px-4 py-4">{item.due_date || "—"}</td>{meta.can_manage_projects ? <td className="px-4 py-4 font-medium">{money(item.contract_value, item.currency)}</td> : null}<td className="px-6 py-4 text-right"><button onClick={() => router.push(`/dashboard/projects/${item.id}`)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Open Workspace</button></td></tr>)}</tbody></table></div>{nextCursor ? <div className="border-t p-4 text-center"><button disabled={loadingMore} onClick={() => void loadMore()} className="rounded-xl border px-5 py-2.5 text-sm font-semibold">{loadingMore ? "Loading..." : "Load more"}</button></div> : null}</>}
    </section>
  </div>

  {meta.can_manage_projects && createOpen && order ? <Modal title="Create project from order" onClose={() => setCreateOpen(false)}><div className="grid gap-4 sm:grid-cols-2"><Field label="Project name"><input value={name} onChange={(e) => setName(e.target.value)} className="control" /></Field><Field label="Priority"><select value={priority} onChange={(e) => setPriority(e.target.value)} className="control"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field><SearchableSelect label="Project manager" name="project_manager_employee_id" value={managerId} onValueChange={(id) => { setManagerId(id); if (id && !memberIds.includes(id)) setMemberIds((current) => [...new Set([...current, id])]); }} placeholder="Unassigned" searchPlaceholder="Search employees..." options={meta.employees.map((employee) => ({ value: employee.id, label: employee.full_name, keywords: employee.employee_code }))}/><Field label="Planned start"><input type="date" value={plannedStartDate} onChange={(e) => setPlannedStartDate(e.target.value)} className="control" /></Field><Field label="Due date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="control" /></Field><label className="sm:col-span-2 text-sm font-medium">Team<div className="mt-2 max-h-48 overflow-y-auto rounded-xl border">{meta.employees.map((employee) => <label key={employee.id} className="flex items-center gap-3 border-b px-3 py-2 last:border-0"><input type="checkbox" checked={memberIds.includes(employee.id) || managerId === employee.id} disabled={managerId === employee.id} onChange={(e) => setMemberIds(e.target.checked ? [...new Set([...memberIds, employee.id])] : memberIds.filter((id) => id !== employee.id))} /><span>{employee.full_name}</span></label>)}</div></label><label className="sm:col-span-2 text-sm font-medium">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border p-3 text-sm" /></label></div><div className="mt-6 flex justify-end gap-2"><button onClick={() => setCreateOpen(false)} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving || !name.trim()} onClick={() => void createProject()} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating..." : "Create project"}</button></div></Modal> : null}
  <style jsx global>{`.control{margin-top:.5rem;height:2.75rem;width:100%;border:1px solid #e5e5e5;border-radius:.75rem;padding:0 .75rem;font-size:.875rem;background:white}`}</style>
  </main>;
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof FolderKanban }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-2xl font-semibold">{value}</p></article>; }
function Badge({ value }: { value: string }) { const map: Record<string,string> = { active:"border-emerald-200 bg-emerald-50 text-emerald-700", on_hold:"border-amber-200 bg-amber-50 text-amber-700", completed:"border-blue-200 bg-blue-50 text-blue-700", cancelled:"border-red-200 bg-red-50 text-red-700" }; return <span className={`rounded-full border px-2.5 py-1 text-xs capitalize ${map[value] || "bg-neutral-50"}`}>{value.replace("_", " ")}</span>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm font-medium">{label}{children}</label>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-5"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="p-6">{children}</div></div></div>; }
