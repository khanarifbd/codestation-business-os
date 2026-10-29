"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useHRSettingsIdentity } from "./use-hr-settings-identity";
import { useHRTimeLifetime, useHRTimeResource } from "./use-hr-time-resource";
import { isAssignments, isHolidays, isLeaveTypes, isShifts } from "@/components/hr-settings/settings-model";
import { settingsBrowse, settingsHref, type SettingsView } from "@/lib/hr-settings-navigation";
export function useHRSettingsBrowse() {
  const identity = useHRSettingsIdentity(), query = useSearchParams(), router = useRouter();
  const owner = useHRTimeLifetime(identity.scope), browse = settingsBrowse(query.toString());
  const assignments = useHRTimeResource(identity.scope, "/api/hr/shift-assignments", identity.canView, isAssignments);
  const shifts = useHRTimeResource(identity.scope, "/api/hr/shifts", identity.canView, isShifts);
  const leave = useHRTimeResource(identity.scope, "/api/hr/leave-types", identity.canView, isLeaveTypes);
  const holidays = useHRTimeResource(identity.scope, "/api/hr/holidays", identity.canView, isHolidays);
  return { ...identity, browse, assignments, shifts, leave, holidays, change: (patch: { view?: SettingsView; search?: string }) => { if (owner.current()) router.push(settingsHref({...browse, ...patch})); } };
}
