export type Tab = "overview" | "milestones" | "tasks" | "work" | "documents" | "notes" | "credentials" | "team" | "review_tips";
export type ProjectMember = { id: string; employee_id: string; employee_code: string; full_name: string; role_label: string | null; tab_permissions: Tab[] };
export type ProjectAccess = { allowed_tabs: Tab[]; can_manage_project: boolean; is_project_manager: boolean; current_employee_id: string | null };
export type ProjectDetail = { id: string; project_number: string; order_number: string; order_status: string; quotation_number: string | null; client_name: string; name: string; status: string; priority: string; planned_start_date: string | null; due_date: string | null; currency: string; contract_value: string | number; project_manager_employee_id: string | null; project_manager_name: string | null; description: string | null; notes: string | null; members: ProjectMember[]; access: ProjectAccess };
export type Summary = { progress_percent: number; milestone_count: number; task_count: number; open_task_count: number; overdue_task_count: number; blocked_task_count: number; document_count: number; credential_count: number };
export type MilestoneRow = { id: string; title: string; description: string | null; status: string; sort_order: number; progress_percent: number; due_date: string | null };
export type TaskRow = { id: string; task_code: string; milestone_id: string | null; milestone_title: string | null; title: string; description: string | null; status: string; priority: string; progress_percent: number; assignee_employee_id: string | null; assignee_name: string | null; planned_start_date: string | null; due_date: string | null; estimated_minutes: number | null };
export type WorkLog = { id: string; task_id: string; task_code: string; task_title: string; employee_name: string; note: string; progress_percent: number; time_spent_minutes: number | null; created_at: string };
export type DocumentRow = { id: string; title: string; document_type: string; original_filename: string; content_type: string | null; size_bytes: number; notes: string | null; created_at: string };
export type CredentialRow = { id: string; name: string; credential_type: string; environment: string; username: string | null; url: string | null; notes: string | null; access_level: string; last_revealed_by: string | null; last_revealed_at: string | null; created_at: string; updated_at: string };
export type Workspace = { summary: Summary; milestones: MilestoneRow[]; tasks: TaskRow[]; recent_work: WorkLog[]; documents: DocumentRow[]; credentials: CredentialRow[]; can_manage_credentials: boolean };
export type EmployeeOption = { id: string; employee_code: string; full_name: string };
export type Meta = { employees: EmployeeOption[]; can_manage_projects: boolean };
export type CredentialValues = { name: string; credential_type: string; environment: string; username: string; secret: string; url: string; notes: string; access_level: string };
export type TaskEditValues = { title: string; description: string; milestone_id: string; priority: string; assignee_employee_id: string; planned_start_date: string; due_date: string; estimated_hours: string };

export const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "milestones", label: "Milestones" }, { id: "tasks", label: "Tasks" },
  { id: "work", label: "Work Log" }, { id: "documents", label: "Documents" }, { id: "notes", label: "Notes" }, { id: "credentials", label: "Credentials" }, { id: "team", label: "Team" },
  { id: "review_tips", label: "Review & Tips" },
];
export const allTabIds = tabs.map((item) => item.id);
export const defaultMemberTabs: Tab[] = ["overview", "milestones", "tasks", "work", "documents", "notes", "team"];
export const previewTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "text/plain"]);

export function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
export function pretty(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()); }
export function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
export function localDateKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
export function isOverdueDate(dueDate: string | null, status: string) { return Boolean(dueDate && dueDate < localDateKey() && !["completed", "cancelled"].includes(status)); }
export function vaultMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Unable to save credential.";
  if (message.toLowerCase().includes("encryption key") || message.toLowerCase().includes("credentials vault")) return "Credentials Vault is temporarily unavailable. Please contact your administrator.";
  return message;
}


export type ProjectEditorMode = "milestone" | "milestone_edit" | "task" | "task_edit" | "progress" | "document" | "document_edit" | "credential" | "credential_edit" | "team";
export type ProjectWorkspaceRoute = { kind: "register" | "record" | "editor" | "invalid"; section?: Tab; id?: string; editorMode?: ProjectEditorMode };
export function parseProjectWorkspaceRoute(pathname: string, projectId: string): ProjectWorkspaceRoute {
  const base = `/dashboard/projects/${encodeURIComponent(projectId)}`;
  if (pathname === base || pathname === `${base}/`) return { kind: "register" };
  if (!pathname.startsWith(`${base}/`)) return { kind: "invalid" };
  let parts: string[];
  try { parts = pathname.slice(base.length + 1).split("/").map(decodeURIComponent); } catch { return { kind: "invalid" }; }
  const [section, id, action] = parts;
  if (section === "team" && id === "edit" && parts.length === 2) return { kind: "editor", section: "team", editorMode: "team" };
  const modes = { milestones: "milestone", tasks: "task", documents: "document", credentials: "credential" } as const;
  if (!(section in modes)) return { kind: "invalid" };
  const mode = modes[section as keyof typeof modes];
  const tab = section as Tab;
  if (parts.length === 2 && id === "new") return { kind: "editor", section: tab, editorMode: mode };
  if (parts.length === 3 && id && action === "edit") return { kind: "editor", section: tab, id, editorMode: `${mode}_edit` as ProjectEditorMode };
  if (parts.length === 3 && id && section === "tasks" && action === "progress") return { kind: "editor", section: "tasks", id, editorMode: "progress" };
  if (parts.length === 2 && id && (section === "tasks" || section === "milestones")) return { kind: "record", section: tab, id };
  return { kind: "invalid" };
}
