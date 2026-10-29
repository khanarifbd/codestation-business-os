import { isPersonalWorkspace, type PersonalWorkspace } from "@/components/my-work/my-work-model";

export type SelfData = {
  employee: {
    id: string;
    employee_code: string;
    employment_status: string;
    join_date?: string | null;
    work_location?: string | null;
  };
  leave_requests: { id: string; leave_type?: string; start_date: string; end_date: string; days: string; status: string }[];
  attendance: { date: string; status: string; attendance_mode?: string | null; check_in_at?: string | null; check_out_at?: string | null; work_minutes: number }[];
  documents: { id: string; title: string; document_type: string; expires_on?: string | null; file_url?: string | null }[];
  performance: { id: string; period_start: string; period_end: string; status: string; rating?: string | null; self_review?: string | null; manager_review?: string | null }[];
  announcements: { id: string; title: string; body: string; is_policy: boolean; published_at?: string | null }[];
  payslips: { run_id: string; entry_id: string; run_number: string; period_name: string; currency: string; gross_pay: string; net_pay: string; status: string }[];
};

export type Meta = { leave_types: { id: string; name: string; code: string; annual_allowance_days: string; is_paid: boolean }[] };

export type PolicyAck = Record<string, string>;

export type AttendanceRequest = {
  id: string; request_type: string; work_date: string; reason: string; status: string;
  requested_mode: string | null; review_notes: string | null;
};

export type AttendancePlan = {
  date: string; timezone: string; mode: "office" | "remote" | "field" | "off" | "unconfigured";
  weekly_modes: string[] | null; office_name: string | null;
  attendance: { check_in_at: string | null; check_out_at: string | null; attendance_mode: string | null; status: string } | null;
  requests: AttendanceRequest[];
};

export type LeaveBalance = {
  year: number;
  items: {
    leave_type_id: string;
    name: string;
    code: string;
    is_paid: boolean;
    allowance_days: string;
    approved_days: string;
    pending_days: string;
    remaining_days: string;
  }[];
};

export type MonthlyAttendance = {
  month: string;
  summary: {
    present: number;
    late: number;
    absent: number;
    leave: number;
    holiday: number;
    off: number;
    missing: number;
    work_minutes: number;
    overtime_minutes: number;
  };
  days: {
    date: string;
    status: string;
    attendance_mode?: string | null;
    check_in_at: string | null;
    check_out_at: string | null;
    work_minutes: number;
    overtime_minutes: number;
    holiday_name: string | null;
  }[];
};

export type HomeData = {
  today: string;
  attendance: {
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    work_minutes: number;
  } | null;
  pending_leave: number;
  annual_leave: {
    allowance_days: string;
    approved_days: string;
    pending_days: string;
    remaining_days: string;
  } | null;
  latest_payslip: {
    entry_id: string;
    period_name: string;
    currency: string;
    net_pay: string;
    status: string;
  } | null;
  policies_to_acknowledge: number;
};

export type WorkspaceData = PersonalWorkspace & { today: string; timezone: string };
export const SELF_VIEWS = ["overview", "attendance", "leave", "records", "reviews", "pay", "policies"] as const;
export type SelfView = typeof SELF_VIEWS[number];
export type SelfBrowse = { view: SelfView; month: string; focus: string };
export type SelfMode = "home" | "register" | "leave" | "remote" | "correction" | "review" | "review_edit";
export type SelfValues = Record<string, string>;
export type SelfResources = {
  self: SelfData | null; meta: Meta | null; acks: PolicyAck | null;
  balance: LeaveBalance | null; monthly: MonthlyAttendance | null; plan: AttendancePlan | null;
  home: HomeData | null; work: WorkspaceData | null;
};
export const emptySelfResources = (): SelfResources => ({ self: null, meta: null, acks: null, balance: null, monthly: null, plan: null, home: null, work: null });
export const WORK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function selfLabel(value: string) { return value.replaceAll("_", " "); }
export function selfMoney(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
export function selfDuration(minutes: number) { const hours = Math.floor(minutes / 60), rest = minutes % 60; return !hours ? `${rest}m` : rest ? `${hours}h ${rest}m` : `${hours}h`; }
export function selfDateTime(value?: string | null, timezone?: string) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return value; return date.toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined); }
export function selfDateOffset(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10); }
export function selfWeekday(value: string) { return (new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7; }
export function selfInitialValues(mode: SelfMode, review?: SelfData["performance"][number] | null): SelfValues {
  if (mode === "review_edit") return { self_review: review?.self_review || "" };
  if (mode === "leave") return { leave_type_id: "", start_date: "", end_date: "", reason: "" };
  return { work_date: "", reason: "", check_in: "", check_out: "" };
}
export function selfEditorPayload(mode: SelfMode, values: SelfValues) {
  if (mode === "review_edit") { if (!values.self_review?.trim()) throw new Error("Write your self review before saving."); return { self_review: values.self_review }; }
  if (mode === "leave") {
    if (!values.leave_type_id || !values.start_date || !values.end_date) throw new Error("Choose a leave type and both dates.");
    if (values.end_date < values.start_date) throw new Error("End date cannot be before start date.");
    return { leave_type_id: values.leave_type_id, start_date: values.start_date, end_date: values.end_date, reason: values.reason || null };
  }
  if (mode !== "remote" && mode !== "correction") throw new Error("This workspace is read-only.");
  const reason = (values.reason || "").trim();
  if (!values.work_date || reason.length < 5 || reason.length > 1000) throw new Error("Choose a work date and provide a reason of 5–1,000 characters.");
  const payload: Record<string, string> = { request_type: mode === "remote" ? "mode" : "correction", work_date: values.work_date, reason };
  if (mode === "correction") {
    if (!values.check_in || !values.check_out) throw new Error("Enter both check-in and check-out times.");
    const start = new Date(values.check_in), end = new Date(values.check_out);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Invalid correction times.");
    payload.proposed_check_in_at = start.toISOString(); payload.proposed_check_out_at = end.toISOString();
  }
  return payload;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function strings(value: Record<string, unknown>, keys: string[]) { return keys.every(key => typeof value[key] === "string"); }
function nullable(value: unknown) { return value === null || typeof value === "string"; }
function optional(value: unknown) { return value === undefined || nullable(value); }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value); }
function rows(value: unknown, check: (row: Record<string, unknown>) => boolean) { return Array.isArray(value) && value.every(row => object(row) && check(row)); }
function attendanceTimes(value: Record<string, unknown>) { return nullable(value.check_in_at) && nullable(value.check_out_at); }
function balanceRow(row: Record<string, unknown>) { return strings(row, ["leave_type_id", "name", "code", "allowance_days", "approved_days", "pending_days", "remaining_days"]) && typeof row.is_paid === "boolean"; }
export function isSelfResource(key: keyof SelfResources, value: unknown): boolean {
  if (key === "work") return isPersonalWorkspace(value) && typeof value.today === "string" && typeof value.timezone === "string";
  if (!object(value)) return false;
  if (key === "self") return object(value.employee) && strings(value.employee, ["id", "employee_code", "employment_status"]) && optional(value.employee.join_date) && optional(value.employee.work_location)
    && rows(value.leave_requests, row => strings(row, ["id", "start_date", "end_date", "days", "status"]) && optional(row.leave_type))
    && rows(value.attendance, row => strings(row, ["date", "status"]) && number(row.work_minutes) && optional(row.attendance_mode) && optional(row.check_in_at) && optional(row.check_out_at))
    && rows(value.documents, row => strings(row, ["id", "title", "document_type"]) && optional(row.expires_on) && optional(row.file_url))
    && rows(value.performance, row => strings(row, ["id", "period_start", "period_end", "status"]) && optional(row.rating) && optional(row.self_review) && optional(row.manager_review))
    && rows(value.announcements, row => strings(row, ["id", "title", "body"]) && typeof row.is_policy === "boolean" && optional(row.published_at))
    && rows(value.payslips, row => strings(row, ["run_id", "entry_id", "run_number", "period_name", "currency", "gross_pay", "net_pay", "status"]));
  if (key === "meta") return rows(value.leave_types, row => strings(row, ["id", "name", "code", "annual_allowance_days"]) && typeof row.is_paid === "boolean");
  if (key === "acks") return Object.values(value).every(v => typeof v === "string");
  if (key === "balance") return number(value.year) && rows(value.items, balanceRow);
  if (key === "monthly") return typeof value.month === "string" && object(value.summary) && ["present", "late", "absent", "leave", "holiday", "off", "missing", "work_minutes", "overtime_minutes"].every(k => number((value.summary as Record<string, unknown>)[k]))
    && rows(value.days, row => strings(row, ["date", "status"]) && attendanceTimes(row) && number(row.work_minutes) && number(row.overtime_minutes) && nullable(row.holiday_name) && optional(row.attendance_mode));
  if (key === "plan") return strings(value, ["date", "timezone"]) && ["office", "remote", "field", "off", "unconfigured"].includes(String(value.mode)) && nullable(value.office_name)
    && (value.weekly_modes === null || Array.isArray(value.weekly_modes) && value.weekly_modes.length === 7 && value.weekly_modes.every(mode => ["office", "remote", "field", "off"].includes(String(mode))))
    && (value.attendance === null || object(value.attendance) && strings(value.attendance, ["status"]) && attendanceTimes(value.attendance) && nullable(value.attendance.attendance_mode))
    && rows(value.requests, row => strings(row, ["id", "request_type", "work_date", "reason", "status"]) && nullable(row.requested_mode) && nullable(row.review_notes));
  if (key === "home") return typeof value.today === "string" && number(value.pending_leave) && number(value.policies_to_acknowledge)
    && (value.attendance === null || object(value.attendance) && strings(value.attendance, ["status"]) && attendanceTimes(value.attendance) && number(value.attendance.work_minutes))
    && (value.annual_leave === null || object(value.annual_leave) && strings(value.annual_leave, ["allowance_days", "approved_days", "pending_days", "remaining_days"]))
    && (value.latest_payslip === null || object(value.latest_payslip) && strings(value.latest_payslip, ["entry_id", "period_name", "currency", "net_pay", "status"]));
  return false;
}
