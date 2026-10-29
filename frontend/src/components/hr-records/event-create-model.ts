import { dateOnly, record, timeId } from "@/components/hr-time/hr-time-model";
import { EVENT_TYPES } from "./records-model";

export type EventIntent = Readonly<{ employee_id: string; employee_name: string; event_type: string; effective_date: string; title: string; notes: string | null; details: Readonly<Record<string, never>> }>;
export type EventReceipt = { id: string };
const invalidText = (value: string) => /[\u0000\uD800-\uDFFF]/u.test(value);
export function eventIntent(form: FormData, employees: readonly { id: string; name: string }[]): EventIntent | null {
  const employee = employees.find(item => item.id === form.get("employee_id"));
  const type = form.get("event_type"), date = form.get("effective_date"), rawTitle = form.get("title"), notes = form.get("notes");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (!employee || typeof type !== "string" || !(EVENT_TYPES as readonly string[]).includes(type) || !dateOnly(date) || !title || title.length > 180 || invalidText(title) || notes !== null && (typeof notes !== "string" || invalidText(notes))) return null;
  return Object.freeze({ employee_id: employee.id, employee_name: employee.name, event_type: type, effective_date: date, title, notes: typeof notes === "string" ? notes.trim() || null : null, details: Object.freeze({}) });
}
export function eventReceipt(body: unknown): body is EventReceipt {
  return record(body) && Object.keys(body).length === 1 && timeId(body.id) && body.id !== "new" && encodeURIComponent(body.id) === body.id;
}
export function eventConsequence(type: string) {
  return ["resignation", "termination"].includes(type)
    ? "Saving this event immediately marks the employee inactive and sets their end date to the effective date below, even if that date is in the future. This may affect subsequent payroll. This is not a scheduled change."
    : "This adds an employment history record only. It does not automatically change the employee’s role, compensation, or other employment settings.";
}
