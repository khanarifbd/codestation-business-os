"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export type WorkspaceContext = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    country_code: string;
    timezone: string;
    currency: string;
  };
  membership_id: string;
  role_id: string;
  role: string;
  role_name: string;
  role_slug: string;
  status: string;
  is_owner: boolean;
  relationships: string[];
  primary_relationship: string;
};

type WorkspaceMembership = {
  organization: WorkspaceContext["organization"];
  membership_id: string;
  role_id: string;
  role: string;
  role_name: string;
  role_slug: string;
  status: string;
  is_owner: boolean;
  relationships: string[];
  primary_relationship: string;
};

function relationshipLabel(value: string) {
  if (value === "owner") return "Owner";
  if (value === "employee") return "Employee";
  if (value === "client") return "Client";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function WorkspaceSwitcher({
  onContextChange,
}: {
  onContextChange?: (context: WorkspaceContext | null) => void;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [current, setCurrent] = useState<WorkspaceContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [organizationsResponse, tenantResponse] = await Promise.all([
        fetch("/api/organizations", { cache: "no-store" }),
        fetch("/api/tenant", { cache: "no-store" }),
      ]);
      if (organizationsResponse.status === 401 || tenantResponse.status === 401) {
        router.replace("/login");
        return;
      }
      const organizationsPayload = await organizationsResponse.json().catch(() => []);
      if (!organizationsResponse.ok) throw new Error("Unable to load workspaces");
      setWorkspaces(Array.isArray(organizationsPayload) ? organizationsPayload : []);

      if (tenantResponse.ok) {
        const tenantPayload = (await tenantResponse.json()) as WorkspaceContext;
        setCurrent(tenantPayload);
        onContextChange?.(tenantPayload);
      } else {
        setCurrent(null);
        onContextChange?.(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load workspaces");
    } finally {
      setLoading(false);
    }
  }, [onContextChange, router]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function switchWorkspace(workspace: WorkspaceMembership) {
    if (workspace.organization.id === current?.organization.id) {
      setOpen(false);
      return;
    }
    setSwitchingId(workspace.organization.id);
    setError(null);
    try {
      const response = await fetch("/api/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: workspace.organization.id }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to switch workspace");
      const next = payload as WorkspaceContext;
      setCurrent(next);
      onContextChange?.(next);
      setOpen(false);
      router.push(next.primary_relationship === "client" ? "/dashboard/client-portal" : "/dashboard");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to switch workspace");
    } finally {
      setSwitchingId(null);
    }
  }

  return <div ref={rootRef} className="relative">
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      disabled={loading}
      className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left transition hover:bg-neutral-50 disabled:opacity-60"
      aria-expanded={open}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-white"><Building2 className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{loading ? "Loading workspace..." : current?.organization.name ?? "Choose workspace"}</span>
        <span className="mt-0.5 block truncate text-xs text-neutral-400">{current ? current.relationships.map(relationshipLabel).join(" · ") : "No workspace selected"}</span>
      </span>
      {loading ? <Loader2 className="size-4 animate-spin text-neutral-400" /> : <ChevronDown className="size-4 text-neutral-400" />}
    </button>

    {open ? <div className="absolute left-0 right-0 z-[70] mt-2 min-w-[290px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
      <div className="border-b px-4 py-3"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Switch workspace</p><p className="mt-1 text-xs text-neutral-500">One account, multiple companies and relationships.</p></div>
      <div className="max-h-80 overflow-y-auto p-2">
        {workspaces.map((workspace) => {
          const active = workspace.organization.id === current?.organization.id;
          const switching = switchingId === workspace.organization.id;
          return <button
            key={workspace.organization.id}
            type="button"
            disabled={switchingId !== null}
            onClick={() => void switchWorkspace(workspace)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-neutral-50 disabled:opacity-60"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100"><Building2 className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{workspace.organization.name}</span>
              <span className="mt-1 flex flex-wrap gap-1">{workspace.relationships.map((relationship) => <span key={relationship} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">{relationshipLabel(relationship)}</span>)}</span>
            </span>
            {switching ? <Loader2 className="size-4 animate-spin" /> : active ? <Check className="size-4" /> : null}
          </button>;
        })}
        {!workspaces.length ? <p className="px-3 py-6 text-center text-sm text-neutral-400">No active workspaces</p> : null}
      </div>
      {error ? <div className="border-t bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div> : null}
    </div> : null}
  </div>;
}
