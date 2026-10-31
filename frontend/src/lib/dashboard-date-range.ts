import { reportingRange, type ReportingPreset } from "./dashboard-reporting";
export type DashboardDateRange = { from: string; to: string };
export type DashboardDatePreset = ReportingPreset | "today" | "week" | "custom";
export function dashboardDateShortcut(preset: Exclude<DashboardDatePreset,"custom">, timezone?: string, now = new Date()) {
  const month = reportingRange("month", timezone, now);
  if (preset === "today") return { from: month.to, to: month.to, label: "Today" };
  if (preset === "week") {
    const day = new Date(`${month.to}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    return { from: day.toISOString().slice(0,10), to: month.to, label: "This week" };
  }
  return reportingRange(preset, timezone, now);
}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4)) > 0 && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
}
export function validateDashboardDateRange(range: DashboardDateRange, timezone?: string, now = new Date()): string | null {
  if (!validDate(range.from) || !validDate(range.to)) return "Enter valid From and To dates.";
  if (range.from > range.to) return "From must be on or before To.";
  if (range.to > reportingRange("month",timezone,now).to) return "To cannot be after today in the company timezone.";
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`))/86400000 + 1;
  if (days > 366) return "Choose a range of 366 days or fewer.";
  return null;
}
