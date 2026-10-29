"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { getApiErrorMessage } from "@/lib/api-error";
import { isPortalContext } from "@/components/client-portal/portal-model";
import type { PortalContext } from "@/components/client-portal/portal-types";

export function usePortalScope() {
  const session = useDashboardSession(), tenant = session.tenant;
  const key = JSON.stringify([tenant?.organization.id, tenant?.organization.status, tenant?.membership_id, tenant?.role_id, tenant?.status, tenant?.permissions, tenant?.primary_relationship, tenant?.relationships]);
  // Portal access is linked-client authorization on the server, not a finance/role permission.
  return { key, tenant, loading: session.loading, ready: Boolean(tenant) && !session.loading };
}
export type PortalRead<T> = {
  value: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  version: number;
  isCurrent: () => boolean;
  refresh: () => Promise<{ current: boolean; value: T | null; status: number | null }>;
};
export function usePortalResource<T>(url: string, enabled: boolean, validate: (value: unknown) => value is T, dependencyIdentity = ""): PortalRead<T> {
  const scope = usePortalScope(), router = useRouter();
  const key = `${scope.key}:${url}:${dependencyIdentity}`, active = enabled && scope.ready;
  const alive = useRef(true), epoch = useRef({ value: 0 }), identity = useRef({ key, active });
  const verified = useRef<{ key: string; version: number; valid: boolean }>({ key: "", version: 0, valid: false });
  const [state, setState] = useState<{ key: string; value: T | null; loading: boolean; error: string | null; status: number | null; version: number }>({ key: "", value: null, loading: false, error: null, status: null, version: 0 });
  useLayoutEffect(() => { identity.current = { key, active }; }, [key, active]);
  useLayoutEffect(() => { const lifetime = epoch.current; alive.current = true; return () => { alive.current = false; lifetime.value++; }; }, []);
  const refresh = useCallback(async () => {
    const stale = { current: false, value: null, status: null };
    if (!active || !alive.current || identity.current.key !== key || !identity.current.active) return stale;
    const request = ++epoch.current.value;
    verified.current = { key, version: request, valid: false };
    const current = () => alive.current && request === epoch.current.value && identity.current.key === key && identity.current.active;
    setState({ key, value: null, loading: true, error: null, status: null, version: request });
    let status: number | null = null;
    try {
      const response = await fetch(url, { cache: "no-store" }); status = response.status;
      const payload: unknown = await response.json().catch(() => null);
      if (!current()) return stale;
      if (status === 401) router.replace("/login");
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "This client portal information is unavailable."));
      if (!validate(payload)) throw new Error("The portal response could not be verified for this workspace and record. No previous information is shown.");
      verified.current = { key, version: request, valid: true };
      setState({ key, value: payload, loading: false, error: null, status, version: request });
      return { current: true, value: payload, status };
    } catch (reason) {
      if (!current()) return stale;
      setState({ key, value: null, loading: false, error: reason instanceof Error ? reason.message : "The portal read did not complete.", status, version: request });
      return { current: true, value: null, status };
    }
  }, [active, key, router, url, validate]);
  useEffect(() => {
    let mounted = true;
    const lifetime = epoch.current;
    queueMicrotask(() => { if (mounted) void refresh(); });
    return () => { mounted = false; lifetime.value++; };
  }, [refresh]);
  return { value: active && state.key === key ? state.value : null, loading: active && (state.key !== key || state.loading), error: active && state.key === key ? state.error : null, status: active && state.key === key ? state.status : null, version: active && state.key === key ? state.version : 0, isCurrent: () => Boolean(alive.current && active && identity.current.key === key && identity.current.active && verified.current.key === key && verified.current.version === state.version && verified.current.valid && state.value && !state.loading), refresh };
}
export function usePortalContext() {
  const scope = usePortalScope();
  const organizationId = scope.tenant?.organization.id, membershipId = scope.tenant?.membership_id;
  const validate = useCallback((value: unknown): value is PortalContext => isPortalContext(value) && value.organization_id === organizationId && value.membership_id === membershipId, [organizationId, membershipId]);
  return usePortalResource("/api/client-portal", scope.ready, validate);
}
