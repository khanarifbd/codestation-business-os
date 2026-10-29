"use client";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useHRAccess } from "@/components/hr-access-context";
import { validHRAccess } from "@/components/hr-time/hr-time-model";
export function useHRSettingsIdentity() {
  const session = useDashboardSession(), cap = useHRAccess();
  const access = validHRAccess(cap.access) ? cap.access : null;
  const scope = JSON.stringify([session.tenant?.organization.id, session.tenant?.membership_id, session.tenant?.role_id, session.tenant?.status, session.tenant?.permissions, session.profile?.email, session.loading, cap.loading, access]);
  const accessLoading = session.loading || cap.loading;
  const canView = Boolean(session.tenant) && !accessLoading && access?.can_view === true;
  return { scope, canView, canViewPeople: canView && access?.can_view_people === true, canManage: canView && access?.can_manage === true, accessLoading, accessError: cap.error };
}
