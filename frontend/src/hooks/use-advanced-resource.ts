"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { getApiErrorMessage } from "@/lib/api-error";
export function useAdvancedPermissions() {
  const { tenant } = useDashboardSession();
  return { canView: Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view")), canManage: Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage")) };
}
export function useAdvancedResource<T>(url: string, enabled: boolean, validate: (payload: unknown) => payload is T) {
  const { tenant } = useDashboardSession();
  const key = `${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${url}`;
  const router = useRouter(), epoch = useRef(0);
  // A committed lifetime owns its responses. A -> B -> A must not revive
  // callbacks retained from the first A, even when its URL is identical.
  const scope = useMemo(() => ({ key, enabled, validate }), [key, enabled, validate]);
  const activeScope = useRef<typeof scope | null>(null);
  const [state, setState] = useState<{ scope: typeof scope | null; value: T | null; loading: boolean; error: string | null; status: number | null }>({ scope: null, value: null, loading: false, error: null, status: null });
  useLayoutEffect(() => {
    activeScope.current = scope;
    epoch.current += 1;
    return () => { if (activeScope.current === scope) { activeScope.current = null; epoch.current += 1; } };
  }, [scope]);
  const refresh = useCallback(async () => {
    const stale = { current: false, value: null, status: null };
    if (!scope.enabled || activeScope.current !== scope) return stale;
    const request = ++epoch.current;
    const current = () => activeScope.current === scope && request === epoch.current;
    setState({ scope, value: null, loading: true, error: null, status: null });
    let status: number | null = null;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!current()) return stale;
      status = response.status;
      const payload: unknown = await response.json().catch(() => null);
      if (!current()) return stale;
      if (status === 401) router.replace("/login");
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Accounting information is unavailable."));
      if (!scope.validate(payload)) throw new Error("The accounting response could not be verified. It is not an empty or balanced result.");
      setState({ scope, value: payload, loading: false, error: null, status });
      return { current: true, value: payload, status };
    } catch (reason) {
      if (!current()) return stale;
      setState({ scope, value: null, loading: false, error: reason instanceof Error ? reason.message : "Accounting information is unavailable.", status });
      return { current: true, value: null, status };
    }
  }, [scope, router, url]);
  useEffect(() => { let scheduled = true; queueMicrotask(() => { if (scheduled) void refresh(); }); return () => { scheduled = false; }; }, [refresh]);
  return { value: enabled && state.scope === scope ? state.value : null, error: enabled && state.scope === scope ? state.error : null, status: enabled && state.scope === scope ? state.status : null, loading: enabled && (state.scope !== scope || state.loading), refresh };
}
