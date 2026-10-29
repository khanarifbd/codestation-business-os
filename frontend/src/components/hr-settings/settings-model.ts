import { dateOnly, isHRTimeMeta, record, timeId, type HRTimeMeta } from "@/components/hr-time/hr-time-model";
export type Shift = { id: string; name: string; start_time: string; end_time: string; is_active: boolean; break_minutes: number; grace_minutes: number; weekly_off_days: number[] };
export type LeaveType = { id: string; name: string; code: string; annual_allowance_days: string | number; is_paid: boolean; is_active: boolean; requires_approval: boolean };
export type Holiday = { id: string; name: string; holiday_date: string; is_paid: boolean; notes: string | null };
export type Assignment = { id: string; employee_id: string; employee_code: string; employee_name: string | null; shift_id: string; shift_name: string; effective_from: string; effective_to: string | null };
export type AssignmentMeta = HRTimeMeta & { shifts: Pick<Shift, "id" | "name" | "start_time" | "end_time">[] };
const validDate = (v: unknown): v is string => dateOnly(v) && !v.startsWith("0000-");
const text = (v: unknown): v is string => typeof v === "string";
const time = (v: unknown): v is string => text(v) && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const unique = <T extends { id: string }>(v: unknown, valid: (x: unknown) => x is T, limit = Infinity): v is T[] => Array.isArray(v) && v.length <= limit && v.every(valid) && new Set(v.map(x => x.id)).size === v.length;
export function isShift(v: unknown): v is Shift { return record(v) && timeId(v.id) && text(v.name) && time(v.start_time) && time(v.end_time) && typeof v.is_active === "boolean" && integer(v.break_minutes) && integer(v.grace_minutes) && Array.isArray(v.weekly_off_days) && v.weekly_off_days.every(x => Number.isInteger(x) && x >= 0 && x <= 6); }
export function isLeaveType(v: unknown): v is LeaveType { return record(v) && timeId(v.id) && text(v.name) && text(v.code) && (text(v.annual_allowance_days) || typeof v.annual_allowance_days === "number") && /^\d+(?:\.\d+)?$/.test(String(v.annual_allowance_days)) && Number.isFinite(Number(v.annual_allowance_days)) && typeof v.is_paid === "boolean" && typeof v.is_active === "boolean" && typeof v.requires_approval === "boolean"; }
export function isHoliday(v: unknown): v is Holiday { return record(v) && timeId(v.id) && text(v.name) && validDate(v.holiday_date) && typeof v.is_paid === "boolean" && (v.notes === null || text(v.notes)); }
export function isAssignment(v: unknown): v is Assignment { return record(v) && timeId(v.id) && timeId(v.employee_id) && text(v.employee_code) && (v.employee_name === null || text(v.employee_name)) && timeId(v.shift_id) && text(v.shift_name) && validDate(v.effective_from) && (v.effective_to === null || validDate(v.effective_to)); }
export const isShifts = (v: unknown): v is Shift[] => unique(v, isShift);
export const isLeaveTypes = (v: unknown): v is LeaveType[] => unique(v, isLeaveType);
export const isHolidays = (v: unknown): v is Holiday[] => unique(v, isHoliday, 300);
export const isAssignments = (v: unknown): v is Assignment[] => unique(v, isAssignment, 300);
export function isAssignmentMeta(v: unknown): v is AssignmentMeta { return record(v) && unique(v.shifts, (x): x is AssignmentMeta["shifts"][number] => record(x) && timeId(x.id) && text(x.name) && time(x.start_time) && time(x.end_time)) && isHRTimeMeta(v); }
export type AssignmentIntent = Readonly<{ employee_id: string; employee_name: string; employee_code: string; shift_id: string; shift_name: string; start_time: string; end_time: string; effective_from: string }>;
export function assignmentIntent(form: FormData, meta: AssignmentMeta | null): AssignmentIntent | null {
  const employee = meta?.employees.find(x => x.id === form.get("employee_id")), shift = meta?.shifts.find(x => x.id === form.get("shift_id")), date = form.get("effective_from");
  if (!employee || !shift || !validDate(date)) return null;
  return Object.freeze({ employee_id: employee.id, employee_name: employee.name, employee_code: employee.employee_code, shift_id: shift.id, shift_name: shift.name, start_time: shift.start_time, end_time: shift.end_time, effective_from: date });
}
export function assignmentReceipt(v: unknown): v is { id: string } { return record(v) && Object.keys(v).length === 1 && timeId(v.id) && v.id !== "new" && /^[A-Za-z0-9_-]+$/.test(v.id); }
export const ASSIGNMENT_EFFECT = "This adds a schedule assignment from the date shown. It does not end earlier assignments, check for overlaps, or prevent duplicates. Review existing assignments first. This form does not change attendance already recorded.";
