"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { getApiErrorMessage } from "@/lib/api-error";

export type ReconciliationReadResult<T> = { current: boolean; value: T | null; status: number | null; error: string | null };
export function useReconciliationPermissions() {
  const { tenant } = useDashboardSession();
  return {
    canView: Boolean(tenant?.permissions.some(value => value === "*" || value === "finance.view")),
    canManage: Boolean(tenant?.permissions.some(value => value === "*" || value === "finance.manage")),
  };
}
/** Explicit retry and request identity. HTTP404 is retained for bounded discard recovery. */
export function useReconciliationResource<T>(url: string, enabled: boolean, validate: (value: unknown) => value is T) {
  const router = useRouter(), mounted = useRef(true), epoch = useRef(0);
  const [state, setState] = useState<{ key: string; value: T | null; status: number | null; loading: boolean; error: string | null }>({ key: "", value: null, status: null, loading: false, error: null });
  const refresh = useCallback(async (): Promise<ReconciliationReadResult<T>> => {
    const stale = { current: false, value: null, status: null, error: null };
    if (!enabled || !mounted.current) return stale;
    const request = ++epoch.current;
    setState({ key: url, value: null, status: null, loading: true, error: null });
    let status: number | null = null;
    try {
      const response = await fetch(url, { cache: "no-store" }); status = response.status;
      const payload: unknown = await response.json().catch(() => null);
      if (!mounted.current || request !== epoch.current) return stale;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Reconciliation information is unavailable."));
      if (!validate(payload)) throw new Error("The returned reconciliation information could not be verified. Do not treat it as an empty or balanced statement.");
      setState({ key: url, value: payload, status, loading: false, error: null });
      return { current: true, value: payload, status, error: null };
    } catch (reason) {
      if (!mounted.current || request !== epoch.current) return stale;
      const error = reason instanceof Error ? reason.message : "Reconciliation information is unavailable.";
      setState({ key: url, value: null, status, loading: false, error });
      return { current: true, value: null, status, error };
    }
  }, [enabled, router, url, validate]);
  useEffect(() => {
    let active = true; mounted.current = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; mounted.current = false; epoch.current += 1; };
  }, [refresh]);
  return {
    value: enabled && state.key === url ? state.value : null,
    status: enabled && state.key === url ? state.status : null,
    error: enabled && state.key === url ? state.error : null,
    loading: enabled && (state.key !== url || state.loading), refresh,
  };
}
