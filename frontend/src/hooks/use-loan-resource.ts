"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { getApiErrorMessage } from "@/lib/api-error";
export function useLoanPermissions() {
  const { tenant } = useDashboardSession();
  return { canView: Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view")), canManage: Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage")) };
}
export function useLoanResource<T>(url: string, enabled: boolean, validate: (payload: unknown) => payload is T) {
  const { tenant } = useDashboardSession();
  const key = `${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${url}`;
  const router = useRouter(), alive = useRef(true), epoch = useRef(0);
  const [state, setState] = useState<{ key: string; value: T | null; loading: boolean; error: string | null; status: number | null }>({ key: "", value: null, loading: false, error: null, status: null });
  const refresh = useCallback(async () => {
    const stale = { current: false, value: null, status: null };
    if (!enabled || !alive.current) return stale;
    const current = ++epoch.current;
    setState({ key, value: null, loading: true, error: null, status: null });
    let status: number | null = null;
    try {
      const response = await fetch(url, { cache: "no-store" }); status = response.status;
      const payload: unknown = await response.json().catch(() => null);
      if (!alive.current || current !== epoch.current) return stale;
      if (status === 401) router.replace("/login");
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Loan information is unavailable."));
      if (!validate(payload)) throw new Error("The loan response could not be verified. It is not an empty or valid loan result.");
      setState({ key, value: payload, loading: false, error: null, status });
      return { current: true, value: payload, status };
    } catch (reason) {
      if (!alive.current || current !== epoch.current) return stale;
      setState({ key, value: null, loading: false, error: reason instanceof Error ? reason.message : "Loan information is unavailable.", status });
      return { current: true, value: null, status };
    }
  }, [enabled, router, url, key, validate]);
  const invalidate = useCallback(() => { epoch.current += 1; }, []);
  useEffect(() => { let active = true; alive.current = true; queueMicrotask(() => { if (active) void refresh(); }); return () => { active = false; alive.current = false; invalidate(); }; }, [refresh, invalidate]);
  return { value: enabled && state.key === key ? state.value : null, error: enabled && state.key === key ? state.error : null, status: enabled && state.key === key ? state.status : null, loading: enabled && (state.key !== key || state.loading), refresh };
}
