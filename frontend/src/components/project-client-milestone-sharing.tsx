"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, Share2, X } from "lucide-react";
import { usePathname } from "next/navigation";

type ProjectAccess = {
  can_manage_project: boolean;
  is_project_manager: boolean;
};

type ProjectDetail = {
  id: string;
  project_number: string;
  name: string;
  access: ProjectAccess;
};

type MilestoneRow = {
  id: string;
  title: string;
  status: string;
  progress_percent: number;
  due_date: string | null;
  client_visible: boolean;
};

type ProjectWorkspace = {
  milestones: MilestoneRow[];
};

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function projectIdFromPath(pathname: string) {
  const match = pathname.match(/^\/dashboard\/projects\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function ProjectClientMilestoneSharing() {
  const pathname = usePathname();
  const projectId = useMemo(() => projectIdFromPath(pathname), [pathname]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setProject(null);
    setMilestones([]);
    setWorkspaceLoaded(false);
    setError(null);
    setMessage(null);
    if (!projectId) return;

    let active = true;
    void (async () => {
      setLoadingProject(true);
      try {
        // Keep the lightweight access check so non-managers do not see the
        // sharing control, but defer the heavy project workspace request until
        // the user actually opens the panel.
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json().catch(() => null) as ProjectDetail | null;
        if (!payload) return;
        const canManage = Boolean(payload.access?.can_manage_project || payload.access?.is_project_manager);
        if (active && canManage) setProject(payload);
      } finally {
        if (active) setLoadingProject(false);
      }
    })();

    return () => { active = false; };
  }, [projectId]);

  async function loadWorkspace() {
    if (!projectId || workspaceLoaded || loadingWorkspace) return;
    setLoadingWorkspace(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (ProjectWorkspace & { detail?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.detail ?? "Unable to load project milestones.");
      setMilestones(payload.milestones ?? []);
      setWorkspaceLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load project milestones.");
    } finally {
      setLoadingWorkspace(false);
    }
  }

  async function openSharing() {
    setOpen(true);
    setError(null);
    setMessage(null);
    await loadWorkspace();
  }

  async function toggleVisibility(milestone: MilestoneRow) {
    if (!projectId || savingId) return;
    const nextVisible = !milestone.client_visible;
    if (nextVisible && !window.confirm(`Share milestone “${milestone.title}” with the client?`)) return;

    setSavingId(milestone.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestone.id)}/client-visibility`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_visible: nextVisible }),
        },
      );
      const payload = await response.json().catch(() => null) as { client_visible?: boolean; detail?: string } | null;
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to update client visibility.");

      const visible = Boolean(payload?.client_visible);
      setMilestones((current) => current.map((item) => item.id === milestone.id ? { ...item, client_visible: visible } : item));
      setMessage(visible ? `Shared “${milestone.title}” with the client.` : `Hidden “${milestone.title}” from the client.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update client visibility.");
    } finally {
      setSavingId(null);
    }
  }

  if (!projectId || loadingProject || !project) return null;

  const sharedCount = milestones.filter((item) => item.client_visible).length;

  return <>
    <button
      type="button"
      onClick={() => void openSharing()}
      className="fixed bottom-20 right-4 z-30 inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-neutral-700 shadow-lg transition hover:border-neutral-300 hover:text-neutral-950 lg:bottom-6 lg:right-6"
    >
      <Share2 className="size-4" />
      Client milestones
      {workspaceLoaded ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">{sharedCount}/{milestones.length}</span> : null}
    </button>

    {open ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingId) setOpen(false); }}>
      <section className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">{project.project_number}</p>
            <h2 className="mt-1 text-lg font-semibold">Client milestone sharing</h2>
            <p className="mt-1 text-sm text-neutral-500">New milestones stay private by default. Only milestones explicitly shared here appear in the Client Portal.</p>
          </div>
          <button type="button" disabled={Boolean(savingId)} onClick={() => setOpen(false)} className="flex size-9 shrink-0 items-center justify-center rounded-xl border disabled:opacity-40" aria-label="Close client milestone sharing"><X className="size-4" /></button>
        </header>

        <div className="max-h-[68vh] overflow-y-auto p-5 sm:p-6">
          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          {message ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

          {loadingWorkspace ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-400"><Loader2 className="size-4 animate-spin" />Loading project milestones…</div> : milestones.length ? <div className="space-y-3">{milestones.map((milestone) => <article key={milestone.id} className="rounded-xl border p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{milestone.title}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${milestone.client_visible ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-neutral-50 text-neutral-500"}`}>{milestone.client_visible ? "Shared with client" : "Internal only"}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-400">{pretty(milestone.status)} · {milestone.progress_percent}% · Due {milestone.due_date || "not set"}</p>
              </div>
              <button
                type="button"
                disabled={Boolean(savingId)}
                onClick={() => void toggleVisibility(milestone)}
                className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold disabled:opacity-50 ${milestone.client_visible ? "border-neutral-200 bg-white text-neutral-700" : "border-neutral-950 bg-neutral-950 text-white"}`}
              >
                {savingId === milestone.id ? <Loader2 className="size-3.5 animate-spin" /> : milestone.client_visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {milestone.client_visible ? "Hide from client" : "Share with client"}
              </button>
            </div>
          </article>)}</div> : workspaceLoaded ? <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-neutral-400">No project milestones exist yet. Create milestones in the Project workspace first.</div> : null}
        </div>
      </section>
    </div> : null}
  </>;
}
