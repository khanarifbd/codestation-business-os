import type { HRAccess } from "@/components/hr-module-nav";
export type HRTimeSummary = {
  today: string;
  timezone: string;
  metrics: {
    active_employees: number;
    present_today: number;
    absent_today: number;
    on_leave_today: number;
  };
  attention: {
    pending_leave: number;
    documents_expiring_30d: number;
    active_candidates: number;
    pending_invitations: number;
  };
  setup: {
    departments: number;
    leave_types: number;
    shifts: number;
    holidays: number;
    employees: number;
  };
  recruitment: {
    open_jobs: number;
  };
};
export type HRTimeMeta = {
  employees: {
    id: string;
    employee_code: string;
    name: string;
  }[];
};
export type AttendanceRow = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  attendance_date: string;
  status: string;
  attendance_mode: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  work_minutes: number;
  overtime_minutes: number;
  notes: string | null;
};
export type LeaveRow = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  leave_type_id: string;
  leave_type_name: string | null;
  start_date: string;
  end_date: string;
  days: string;
  reason: string | null;
  status: string;
  review_notes: string | null;
};
export type TimeRow = AttendanceRow | LeaveRow;
export type TimePage<T = TimeRow> = {
  items: T[];
  next_cursor: string | null;
};
export type AttendanceDraft = {
  employee_id: string;
  attendance_date: string;
  status: string;
  hours: string;
  overtime_hours: string;
  notes: string;
};
export const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export function dateOnly(v: unknown): v is string { return text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v; }
export function timeId(v: unknown): v is string { return text(v) && v.length > 0 && v.length <= 36 && !/[/?#\\\x00-\x20]/.test(v); }
const instant = (v: unknown) => v === null || text(v) && Number.isFinite(Date.parse(v));
export function validHRAccess(v: unknown): v is HRAccess { return record(v) && ["can_view", "can_manage", "can_self", "can_view_people", "can_manage_people", "can_invite_employees", "can_manage_structure", "is_employee"].every(k => typeof v[k] === "boolean") && text(v.timezone) && text(v.currency); }
export function isHRTimeSummary(v: unknown): v is HRTimeSummary {
  if (!record(v) || !dateOnly(v.today) || !text(v.timezone))
    return false;
  const groups = { metrics: ["active_employees", "present_today", "absent_today", "on_leave_today"], attention: ["pending_leave", "documents_expiring_30d", "active_candidates", "pending_invitations"], setup: ["departments", "leave_types", "shifts", "holidays", "employees"], recruitment: ["open_jobs"] };
  return Object.entries(groups).every(([key, fields]) => { const group = v[key]; return record(group) && fields.every(field => count(group[field])); });
}
export function isHRTimeMeta(v: unknown): v is HRTimeMeta { return record(v) && Array.isArray(v.employees) && v.employees.every(x => record(x) && timeId(x.id) && text(x.employee_code) && text(x.name)) && new Set(v.employees.map(x => x.id)).size === v.employees.length; }
export function isAttendance(v: unknown): v is AttendanceRow { return record(v) && timeId(v.id) && timeId(v.employee_id) && nullableText(v.employee_name) && dateOnly(v.attendance_date) && text(v.status) && nullableText(v.attendance_mode) && instant(v.check_in_at) && instant(v.check_out_at) && count(v.work_minutes) && count(v.overtime_minutes) && nullableText(v.notes); }
export function isLeave(v: unknown): v is LeaveRow { return record(v) && timeId(v.id) && timeId(v.employee_id) && timeId(v.leave_type_id) && nullableText(v.employee_name) && nullableText(v.leave_type_name) && dateOnly(v.start_date) && dateOnly(v.end_date) && v.start_date <= v.end_date && text(v.days) && /^\d+(?:\.\d+)?$/.test(v.days) && text(v.status) && nullableText(v.reason) && nullableText(v.review_notes); }
export function validCursor(v: unknown): v is string { return text(v) && /^[A-Za-z0-9_-]{1,4096}$/.test(v); }
export function timePageValidator(kind: "attendance" | "leave", id = "") {
  return (v: unknown): v is TimePage => record(v) && Array.isArray(v.items) && v.items.length <= (id ? 1 : 100) && v.items.every(kind === "attendance" ? isAttendance : isLeave) && new Set(v.items.map(x => x.id)).size === v.items.length && (v.next_cursor === null || !id && validCursor(v.next_cursor)) && (!id || v.items.every(x => x.id === id));
}
export const attendanceDefaults = (): AttendanceDraft => ({ employee_id: "", attendance_date: "", status: "present", hours: "8", overtime_hours: "0", notes: "" });
export function attendanceError(v: AttendanceDraft, meta: HRTimeMeta | null) {
  if (!meta?.employees.some(e => e.id === v.employee_id))
    return "Choose an employee from the current company’s active employee list.";
  if (!dateOnly(v.attendance_date))
    return "Enter a valid company work date.";
  if (!["present", "late", "remote", "absent"].includes(v.status))
    return "Choose an existing attendance status.";
  for (const key of ["hours", "overtime_hours"] as const)
    if (!Number.isFinite(Number(v[key] || 0)) || Number(v[key] || 0) < 0 || !Number.isSafeInteger(Math.round(Number(v[key] || 0) * 60)))
      return "Hours must be nonnegative and produce a valid whole-minute value.";
  return null;
}
export function attendancePayload(v: AttendanceDraft) { const hours = Math.max(0, Number(v.hours || 0)), overtimeHours = Math.max(0, Number(v.overtime_hours || 0)); return { employee_id: v.employee_id, attendance_date: v.attendance_date, status: v.status || "present", work_minutes: Math.round(hours * 60), overtime_minutes: Math.round(overtimeHours * 60), notes: v.notes.trim() || null }; }
export function timeError(body: unknown, fallback: string) { return record(body) && text(body.detail) ? body.detail : fallback; }
export function knownTimeRejection(status: number) { return [400, 401, 403, 404, 409, 422].includes(status); }
export function minuteLabel(value: number) { return `${Math.floor(value / 60)}h ${value % 60}m`; }
export function timeLabel(value: string) { return value.replaceAll("_", " "); }
export function timeInstant(value: string | null, timezone: string) {
  if (!value)
    return "Not recorded"; try {
      return new Date(value).toLocaleString(undefined, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
    }
  catch {
    return `${value} · timezone unavailable`;
  }
}
