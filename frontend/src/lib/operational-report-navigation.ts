import { reportDate, reportId } from "@/components/operational-reports/report-model";
import { reportSections } from "@/components/operational-reports/report-types";
import type { ReportBrowse, ReportFilters, ReportSection } from "@/components/operational-reports/report-types";
export const REPORT_ROOT = "/dashboard/reports";
export const reportFilterKeys = ["date_from", "date_to", "currency", "client_id", "project_id"] as const;

export function reportDefaults(timezone?: string, now = new Date()): ReportFilters {
  let today: string;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    today = `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  return { date_from: `${today.slice(0, 7)}-01`, date_to: today, currency: "", client_id: "", project_id: "" };
}
export function parseReportBrowse(query: URLSearchParams, defaults: ReportFilters): ReportBrowse {
  const section = query.get("section") || "performance";
  return {
    ...Object.fromEntries(reportFilterKeys.map(key => [key, query.has(key) ? (query.get(key) || "").slice(0, 200) : defaults[key]])) as ReportFilters,
    section: reportSections.includes(section as ReportSection) ? section as ReportSection : "performance",
  };
}
export function reportFilterError(filters: ReportFilters) {
  if (!reportDate(filters.date_from) || !reportDate(filters.date_to)) return "Choose valid start and end dates.";
  if (filters.date_from > filters.date_to) return "The end date cannot be before the start date.";
  if (filters.currency && !/^[A-Z]{3}$/.test(filters.currency)) return "Use a three-letter uppercase currency code.";
  if ([filters.client_id, filters.project_id].some(id => id && !reportId(id))) return "The selected client or project identifier is invalid.";
  return null;
}
export function reportQuery(filters: ReportFilters) {
  const query = new URLSearchParams();
  for (const key of reportFilterKeys) if (filters[key]) query.set(key, filters[key]);
  return query.toString();
}
export function reportHref(browse: ReportBrowse) {
  const query = new URLSearchParams(reportQuery(browse));
  if (browse.section !== "performance") query.set("section", browse.section);
  return `${REPORT_ROOT}?${query.toString()}`;
}
