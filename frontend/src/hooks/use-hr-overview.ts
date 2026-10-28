"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useHRAccess } from "@/components/hr-access-context";
import { isHRTimeSummary, validHRAccess } from "@/components/hr-time/hr-time-model";
import { hrTimeScope } from "./use-hr-time-workspace";
import { useHRTimeLifetime, useHRTimeResource } from "./use-hr-time-resource";
export function useHROverview() {
  const { tenant } = useDashboardSession(), state = useHRAccess(), router = useRouter();
  const access = validHRAccess(state.access) ? state.access : null, scope = hrTimeScope(tenant);
  const { current } = useHRTimeLifetime(JSON.stringify([scope, access]));
  const summary = useHRTimeResource(scope, "/api/hr/workspace-summary", access?.can_view === true, isHRTimeSummary);
  const destination = access && !access.can_view ? access.can_view_people ? "/dashboard/hr/people" : access.can_self ? "/dashboard/hr/me" : null : null;
  useEffect(() => {
    if (!state.loading && destination && current())
      router.replace(destination);
  }, [state.loading, destination, current, router]);
  return { access, accessLoading: state.loading, accessError: state.error, summary, redirecting: Boolean(destination) };
}
