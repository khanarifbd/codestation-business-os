/** A date-only stock document defaults to the organization's calendar date, not the UTC day. */
export function inventoryToday(timezone: string | null | undefined, now = new Date()): string {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", { ...options, timeZone: timezone || "UTC" }); }
  catch { formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", { ...options, timeZone: "UTC" }); }
  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
