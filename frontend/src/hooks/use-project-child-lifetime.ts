"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useDashboardSession } from "@/components/dashboard-session-context";

/** A committed owner, not merely a matching project ID, may start or finish a child request. */
export function useProjectChildLifetime(projectId: string) {
  const { tenant } = useDashboardSession();
  const identity = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions, projectId]);
  const scope = useMemo(() => ({ identity, enabled: Boolean(tenant?.organization.id) }), [identity, tenant?.organization.id]);
  const active = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    active.current = scope;
    return () => { if (active.current === scope) active.current = null; };
  }, [scope]);
  return useCallback(() => scope.enabled && active.current === scope, [scope]);
}
