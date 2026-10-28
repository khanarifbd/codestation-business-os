"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
import { PROJECTS_PATH, projectBrowseHref, projectBrowseState, projectCreateHref, projectDetailHref, safeProjectsReturnHref } from "@/lib/project-navigation";
import { type ProjectCreateValues, type ExistingProjectLink, type ProjectOrder, type ProjectListMeta, type ProjectSummary, type ProjectListRow, projectToday } from "@/components/projects/project-list-model";

function useProjectRequest() {
  const router = useRouter();
  return useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(path, { cache: "no-store", ...init });
    if (response.status === 401) { router.replace("/login"); throw new Error("Authentication required"); }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getApiErrorMessage(payload, "Project request failed."));
    return payload as T;
  }, [router]);
}

type ListCache = { key: string; rows: ProjectListRow[]; nextCursor: string | null; pages: number };
type ListState = ListCache & { loading: boolean; error: string | null };
export function useProjectRegister() {
  const router = useRouter(), params = useSearchParams(), request = useProjectRequest();
  const browse = projectBrowseState(params.toString());
  const query = new URLSearchParams({ limit: "30", ...(browse.search ? { search: browse.search } : {}), ...(browse.status ? { status: browse.status } : {}) }).toString();
  const [meta, setMeta] = useState<ProjectListMeta | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [state, setState] = useState<ListState>({ key: "", rows: [], nextCursor: null, pages: 0, loading: true, error: null });
  const cache = useRef<ListCache>({ key: "", rows: [], nextCursor: null, pages: 0 });
  const listIdentity = useRef(0), metaIdentity = useRef(0), mounted = useRef(true);
  const invalidateList = useCallback(() => { listIdentity.current += 1; }, []);
  const invalidateMeta = useCallback(() => { metaIdentity.current += 1; }, []);
  const [searchInput, setSearchInput] = useState<{ query: string; value: string } | null>(null);
  const searchDraft = searchInput?.query === query ? searchInput.value : browse.search;
  const orderId = params.get("order_id") || "";
  const [handoff, setHandoff] = useState<{ id: string; order: ProjectOrder | null; link: ExistingProjectLink | null; error: string | null; loading: boolean }>({ id: "", order: null, link: null, error: null, loading: false });

  const loadMeta = useCallback(async () => {
    const identity = ++metaIdentity.current;
    setMetaError(null);
    try {
      const [m, s] = await Promise.all([request<ProjectListMeta>("/api/projects/meta"), request<ProjectSummary>("/api/projects/summary")]);
      if (!mounted.current || identity !== metaIdentity.current) return;
      setMeta(m); setSummary(s);
    } catch (reason) { if (mounted.current && identity === metaIdentity.current) { setMeta(null); setSummary(null); setMetaError(reason instanceof Error ? reason.message : "Unable to load project access."); } }
  }, [request]);
  const loadList = useCallback(async (force = false) => {
    const identity = ++listIdentity.current;
    let current: ListCache = !force && cache.current.key === query && cache.current.pages <= browse.pages ? cache.current : { key: query, rows: [], nextCursor: null, pages: 0 };
    setState({ ...current, loading: true, error: null });
    try {
      while (current.pages < browse.pages && (current.pages === 0 || current.nextCursor)) {
        const p = new URLSearchParams(query); if (current.pages && current.nextCursor) p.set("cursor", current.nextCursor);
        const result = await request<{ items: ProjectListRow[]; next_cursor: string | null }>(`/api/projects?${p}`);
        if (!mounted.current || identity !== listIdentity.current) return;
        const seen = new Set(current.rows.map(row => row.id));
        current = { key: query, rows: [...current.rows, ...result.items.filter(row => !seen.has(row.id))], nextCursor: result.next_cursor, pages: current.pages + 1 };
        cache.current = current;
      }
      if (mounted.current && identity === listIdentity.current) setState({ ...current, loading: false, error: null });
    } catch (reason) {
      if (!mounted.current || identity !== listIdentity.current) return;
      // Preserve a successfully loaded prefix only for this exact query, never for new filters.
      setState({ ...current, loading: false, error: reason instanceof Error ? reason.message : "Unable to load projects." });
    }
  }, [request, query, browse.pages]);
  useEffect(() => { mounted.current = true; void loadMeta(); return () => { mounted.current = false; invalidateMeta(); invalidateList(); }; }, [loadMeta, invalidateMeta, invalidateList]);
  useEffect(() => { void loadList(); return invalidateList; }, [loadList, invalidateList]);
  useEffect(() => {
    if (!orderId || !meta?.can_manage_projects) return;
    let active = true;
    void (async () => {
      setHandoff({ id: orderId, order: null, link: null, error: null, loading: true });
      try {
        const [order, link] = await Promise.all([request<ProjectOrder>(`/api/sales/orders/${encodeURIComponent(orderId)}`), request<ExistingProjectLink | null>(`/api/projects/order/${encodeURIComponent(orderId)}/link`)]);
        if (active) setHandoff({ id: orderId, order, link, error: null, loading: false });
      } catch (reason) { if (active) setHandoff({ id: orderId, order: null, link: null, error: reason instanceof Error ? reason.message : "Unable to load order handoff.", loading: false }); }
    })();
    return () => { active = false; };
  }, [orderId, meta?.can_manage_projects, request]);
  const visible = state.key === query ? state : { key: query, rows: [], pages: 0, nextCursor: null, loading: true, error: null };
  useEffect(() => { if (!visible.loading && browse.focus) document.getElementById(`project-row-${browse.focus}`)?.focus(); }, [visible.loading, browse.focus]);
  function navigateFilters(search: string, status: string) { setSearchInput(null); router.push(projectBrowseHref({ search, status }), { scroll: false }); }
  function openProject(id: string) { router.push(projectDetailHref(id, "overview", projectBrowseHref({ ...browse, pages: Math.max(1, visible.pages), focus: id }))); }
  function openCreate() {
    if (handoff.id !== orderId || !handoff.order || handoff.order.id !== orderId || handoff.link || !meta?.can_manage_projects || !["confirmed", "in_progress"].includes(handoff.order.status)) return;
    window.location.assign(projectCreateHref(orderId, projectBrowseHref(browse)));
  }
  return { meta, summary, metaError, searchDraft, setSearchInput: (value: string) => setSearchInput({ query, value }), browse, state: visible, handoff: handoff.id === orderId ? handoff : null, orderId, loadList, loadMeta, navigateFilters, openProject, openCreate,
    loadMore: () => { if (!visible.loading && visible.nextCursor) router.replace(projectBrowseHref({ ...browse, pages: visible.pages + 1 }), { scroll: false }); } };
}

export function useProjectCreate() {
  const params = useSearchParams(), request = useProjectRequest();
  const orderId = params.get("order_id") || "", returnHref = safeProjectsReturnHref(params.get("returnTo"));
  const [meta, setMeta] = useState<ProjectListMeta | null>(null);
  const [order, setOrder] = useState<ProjectOrder | null>(null), [link, setLink] = useState<ExistingProjectLink | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProjectCreateValues | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [startDate] = useState(projectToday);
  const requestId = useRef(0), inFlight = useRef(false), committedId = useRef<string | null>(null), mounted = useRef(true);
  const invalidateCreate = useCallback(() => { requestId.current += 1; }, []);
  const initial: ProjectCreateValues = { name: order?.subject || (order ? `${order.client_name_snapshot} · ${order.order_number}` : ""), priority: "normal", managerId: order?.assigned_employee_id || "", memberIds: order?.assigned_employee_id ? [order.assigned_employee_id] : [], plannedStartDate: startDate, dueDate: "", description: "" };
  const values = draft ?? initial;
  const ready = Boolean(!loading && meta?.can_manage_projects && order?.id === orderId && !link && ["confirmed", "in_progress"].includes(order.status));
  const dirty = !createdId && ready && JSON.stringify(values) !== JSON.stringify(initial);
  const navigation = useDocumentNavigationGuard(dirty, { documentLabel: "project", isBusy: saving });
  const load = useCallback(async () => {
    const identity = ++requestId.current;
    setLoading(true); setError(null); setOrder(null); setLink(null); setMeta(null);
    try {
      if (!orderId) throw new Error("Choose an eligible order before creating a project.");
      const m = await request<ProjectListMeta>("/api/projects/meta");
      if (!mounted.current || identity !== requestId.current) return;
      setMeta(m);
      if (!m.can_manage_projects) return;
      const [o, existing] = await Promise.all([request<ProjectOrder>(`/api/sales/orders/${encodeURIComponent(orderId)}`), request<ExistingProjectLink | null>(`/api/projects/order/${encodeURIComponent(orderId)}/link`)]);
      if (!mounted.current || identity !== requestId.current) return;
      if (o.id !== orderId) throw new Error("Order identity could not be verified. Return to the order before continuing.");
      setOrder(o); setLink(existing);
    } catch (reason) { if (mounted.current && identity === requestId.current) setError(reason instanceof Error ? reason.message : "Unable to load order handoff."); }
    finally { if (mounted.current && identity === requestId.current) setLoading(false); }
  }, [request, orderId]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; invalidateCreate(); }; }, [load, invalidateCreate]);
  async function createProject() {
    if (inFlight.current || committedId.current || !ready || !order || order.id !== orderId || !values.name.trim()) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      const created = await request<{ id: string }>(`/api/projects/from-order/${encodeURIComponent(orderId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.name.trim(), priority: values.priority, project_manager_employee_id: values.managerId || null, member_employee_ids: values.memberIds, planned_start_date: values.plannedStartDate || null, due_date: values.dueDate || null, description: values.description.trim() || null }) });
      committedId.current = created.id;
      if (!mounted.current) return;
      setCreatedId(created.id); navigation.markClean(); navigation.navigate(projectDetailHref(created.id, "overview", returnHref), { discard: true, replace: true });
    } catch (reason) { if (mounted.current) setError(committedId.current ? "The project was created, but navigation failed. Open the saved project below; do not create it again." : reason instanceof Error ? reason.message : "Unable to create project."); }
    finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  return { orderId, meta, order, link, loading, error, saving, values, setDraft, ready, createdId, returnHref, load, createProject, close: () => navigation.navigate(returnHref), openCreated: () => createdId && navigation.navigate(projectDetailHref(createdId, "overview", returnHref), { discard: true, replace: true }), existingHref: link ? projectDetailHref(link.project_id, "overview", returnHref) : PROJECTS_PATH };
}
