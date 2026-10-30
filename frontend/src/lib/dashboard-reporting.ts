import { formatMoneyExact } from "./sales-money-preview";

export type ReportingPreset = "month" | "last_month" | "quarter" | "year";

/** Reporting dates belong to the company, not the viewer's browser timezone. */
export function reportingRange(preset: ReportingPreset, timezone: string | null | undefined, now = new Date()) {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", { ...options, timeZone: timezone || "UTC" });
  } catch {
    // Older or malformed organization settings must not break the dashboard.
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", { ...options, timeZone: "UTC" });
  }
  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(value => value.type === type)?.value);
  const year = part("year"), month = part("month"), day = part("day");
  // UTC is used only for calendar arithmetic AFTER resolving the company date.
  // setUTCFullYear also avoids Date.UTC's special handling of years 0..99.
  const calendar = (calendarYear: number, monthIndex: number, calendarDay: number) => {
    const date = new Date(0);
    date.setUTCFullYear(calendarYear, monthIndex, calendarDay);
    return date.toISOString().slice(0, 10);
  };
  const to = calendar(year, month - 1, day);
  if (preset === "last_month") return { from: calendar(year, month - 2, 1), to: calendar(year, month - 1, 0), label: "Last month" };
  if (preset === "quarter") return { from: calendar(year, Math.floor((month - 1) / 3) * 3, 1), to, label: "This quarter" };
  if (preset === "year") return { from: calendar(year, 0, 1), to, label: "This year" };
  return { from: calendar(year, month - 1, 1), to, label: "This month" };
}

/** Keep the existing two-decimal ledger contract and explicit currency code. */
export function formatDashboardMoney(value: string | number, currency: string) {
  return formatMoneyExact(value || 0, currency);
}
