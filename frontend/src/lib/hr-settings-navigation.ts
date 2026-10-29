export const HR_SETTINGS = "/dashboard/hr/settings";
export const HR_ASSIGNMENT_CREATE = `${HR_SETTINGS}/assignments/new`;
export const SETTINGS_VIEWS = ["assignments", "shifts", "leave", "holidays"] as const;
export type SettingsView = typeof SETTINGS_VIEWS[number];
export function settingsBrowse(raw: string | URLSearchParams) {
  const q = new URLSearchParams(raw), one = (key: string) => q.getAll(key).length <= 1 ? q.get(key) ?? "" : "";
  return { view: (SETTINGS_VIEWS as readonly string[]).includes(one("view")) ? one("view") as SettingsView : "assignments" as SettingsView, search: one("search").slice(0, 300) };
}
export function settingsHref(value: { view?: SettingsView; search?: string } = {}) { const q = new URLSearchParams(); if (value.view && value.view !== "assignments") q.set("view", value.view); if (value.search) q.set("search", value.search.slice(0, 300)); return HR_SETTINGS + (q.size ? `?${q}` : ""); }
export function safeSettingsReturn(raw: string | null) { return raw && (raw === HR_SETTINGS || raw.startsWith(HR_SETTINGS + "?")) && !raw.includes("#") ? settingsHref(settingsBrowse(raw.split("?")[1] ?? "")) : HR_SETTINGS; }
export function assignmentCreateHref(back: string) { return `${HR_ASSIGNMENT_CREATE}?${new URLSearchParams({returnTo:safeSettingsReturn(back)})}`; }
