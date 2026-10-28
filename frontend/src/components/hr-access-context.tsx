"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import type { HRAccess } from "@/components/hr-module-nav";

type HRAccessState = { access: HRAccess | null; loading: boolean; error: string | null };
const HRAccessContext = createContext<HRAccessState | null>(null);

export function HRAccessProvider({ children }: { children: React.ReactNode }) {
  const { tenant, profile, loading } = useDashboardSession();
  // A company/membership/role change creates a fresh owner before children render.
  // Never expose the previous company's capability response while the next loads.
  const identity = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.status, tenant?.permissions, profile?.email]);
  return <HRAccessRequest key={identity} enabled={Boolean(tenant) && !loading}>{children}</HRAccessRequest>;
}

function HRAccessRequest({ children, enabled }: { children: React.ReactNode; enabled: boolean }) {
  const router = useRouter();
  const owner = useMemo(() => ({ enabled, router }), [enabled, router]);
  const active = useRef<object | null>(null);
  const [state, setState] = useState<HRAccessState & { owner: object | null }>({ owner: null, access: null, loading: true, error: null });
  // Invalidate before deferred passive cleanup: stale 401s must not navigate.
  useLayoutEffect(() => {
    active.current = enabled ? owner : null;
    return () => { if (active.current === owner) active.current = null; };
  }, [enabled, owner]);
  useEffect(() => {
    if (!enabled || active.current !== owner) return;
    let cancelled = false;
    const controller = new AbortController();
    const current = () => !cancelled && active.current === owner;
    void (async () => {
      try {
        const response = await fetch("/api/hr/access", { cache: "no-store", signal: controller.signal });
        if (!current()) return;
        if (response.status === 401) { router.replace("/login"); if (current()) setState({ owner, access: null, loading: false, error: "Authentication required" }); return; }
        const payload = await response.json().catch(() => null);
        if (!current()) return;
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load HR access.");
        setState({ owner, access: payload as HRAccess, loading: false, error: null });
      } catch (reason) {
        if (current()) setState({ owner, access: null, loading: false, error: reason instanceof Error ? reason.message : "Unable to load HR access." });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [router, enabled, owner]);
  const value: HRAccessState = enabled && state.owner === owner
    ? { access: state.access, loading: state.loading, error: state.error }
    : { access: null, loading: true, error: null };
  return <HRAccessContext.Provider value={value}>{children}</HRAccessContext.Provider>;
}

export function useHRAccess() {
  const value = useContext(HRAccessContext);
  if (!value) throw new Error("useHRAccess must be used within HRAccessProvider");
  return value;
}
