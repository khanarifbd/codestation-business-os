"use client";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useDashboardSession } from "@/components/dashboard-session-context";
export function useAdministrationReadOwner() {
  const { tenant, loading } = useDashboardSession();
  const key = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions, tenant?.status, loading]);
  const owner = useMemo(() => ({ key }), [key]), active = useRef<object | null>(null);
  useLayoutEffect(() => { active.current = owner; return () => { if (active.current === owner) active.current = null; }; }, [owner]);
  const available = !loading && Boolean(tenant);
  const current = useCallback(() => available && active.current === owner, [available, owner]);
  return { key, current, tenant, loading };
}
