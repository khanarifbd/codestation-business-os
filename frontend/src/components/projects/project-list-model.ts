import { formatMoneyExact } from "@/lib/sales-money-preview";

export type ProjectEmployeeOption = { id: string; employee_code: string; full_name: string };
export type ProjectListMeta = { employees: ProjectEmployeeOption[]; can_manage_projects: boolean };
export type ProjectSummary = { total: number; planned: number; active: number; on_hold: number; completed: number; cancelled: number };
export type ProjectListRow = { id: string; project_number: string; order_id: string; order_number: string; client_id: string; client_name: string; client_contact_name: string | null; name: string; status: string; priority: string; planned_start_date: string | null; due_date: string | null; currency: string; contract_value: string | number; project_manager_employee_id: string | null; project_manager_name: string | null; member_count: number };
export type ProjectOrder = { id: string; order_number: string; client_name_snapshot: string; status: string; subject: string | null; currency: string; total: string | number; assigned_employee_id: string | null };
export type ExistingProjectLink = { project_id: string; project_number: string; status: string };
export type ProjectCreateValues = { name: string; priority: string; managerId: string; memberIds: string[]; plannedStartDate: string; dueDate: string; description: string };
export function projectMoney(value: string | number, currency: string) { return formatMoneyExact(value, currency); }
export function projectToday() { const v = new Date(); return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`; }
export function projectLabel(value: string) { return value.replaceAll("_", " "); }
