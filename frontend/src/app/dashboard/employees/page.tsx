"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Building2,
  Check,
  ClipboardCopy,
  Loader2,
  MailPlus,
  Pencil,
  Plus,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

type Role = { id: string; name: string; slug: string; description: string | null; is_system: boolean; is_active: boolean; permissions: string[] };
type Department = { id: string; name: string; code: string | null; description: string | null; is_active: boolean };
type Designation = { id: string; name: string; code: string | null; description: string | null; is_active: boolean };
type Employee = {
  id: string; user_id: string; full_name: string; login_email: string; employee_code: string;
  role_id: string; role_name: string; role_slug: string; membership_status: string;
  department_id: string | null; department_name: string | null; designation_id: string | null;
  designation_name: string | null; manager_employee_id: string | null; work_email: string | null;
  phone: string | null; work_phone: string | null; employment_type: string; employment_status: string;
  join_date: string | null; end_date: string | null; work_location: string | null; notes: string | null;
};
type Invitation = { id: string; email: string; full_name: string; role_id: string; role_name: string; department_id: string | null; designation_id: string | null; employee_code: string; status: string; expires_at: string; created_at: string };
type Bundle = {
  summary: { total_employees: number; active_employees: number; suspended_memberships: number; pending_invitations: number };
  employees: Employee[]; departments: Department[]; designations: Designation[]; roles: Role[];
  invitations: Invitation[]; permission_catalog: string[];
};
type Tab = "employees" | "invitations" | "structure" | "roles";
type Option = readonly [string, string];

const inputClass = "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";
const tabs: Array<[Tab, string]> = [
  ["employees", "Employees"],
  ["invitations", "Invitations"],
  ["structure", "Departments & Designations"],
  ["roles", "Roles & Permissions"],
];

function value(form: FormData, name: string) {
  const result = String(form.get(name) ?? "").trim();
  return result || null;
}

export default function EmployeesPage() {
  const router = useRouter();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [tab, setTab] = useState<Tab>("employees");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/team", { cache: "no-store" });
    if (response.status === 401) { router.replace("/login"); return; }
    if (response.status === 403) { router.replace("/dashboard"); return; }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.detail ?? "Unable to load employee management.");
      setLoading(false);
      return;
    }
    setBundle((await response.json()) as Bundle);
    setLoading(false);
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function api(path: string, method: string, body?: unknown) {
    const response = await fetch(`/api/team${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Unable to save changes.");
    return payload;
  }

  async function run(work: () => Promise<void>, success: string) {
    setSaving(true); setError(null); setMessage(null);
    try { await work(); await load(); setMessage(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save changes."); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="size-6 animate-spin" /></main>;
  if (!bundle) return <main className="p-8"><div className="rounded-2xl border bg-white p-8 text-red-600">{error ?? "Employee management unavailable"}</div></main>;

  const activeRoles = bundle.roles.filter((item) => item.is_active);
  const activeDepartments = bundle.departments.filter((item) => item.is_active);
  const activeDesignations = bundle.designations.filter((item) => item.is_active);
  const summaryCards: Array<{ label: string; count: number; icon: LucideIcon }> = [
    { label: "Employees", count: bundle.summary.total_employees, icon: UsersRound },
    { label: "Active", count: bundle.summary.active_employees, icon: BadgeCheck },
    { label: "Suspended", count: bundle.summary.suspended_memberships, icon: UserRoundCog },
    { label: "Pending invites", count: bundle.summary.pending_invitations, icon: MailPlus },
  ];

  return (
    <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Company administration</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Employees & Team</h1>
            <p className="mt-2 text-sm text-neutral-500">Manage company access, employee profiles, structure and permissions.</p>
          </div>
          <button type="button" onClick={() => setTab("invitations")} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white">
            <MailPlus className="size-4" /> Invite employee
          </button>
        </header>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map(({ label, count, icon: Icon }) => (
            <article key={label} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div>
              <p className="mt-4 text-3xl font-semibold">{count}</p>
            </article>
          ))}
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border bg-white p-2 shadow-sm">
          <div className="flex min-w-max gap-1">
            {tabs.map(([id, label]) => (
              <button type="button" key={id} onClick={() => { setTab(id); setError(null); setMessage(null); }} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${tab === id ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>{label}</button>
            ))}
          </div>
        </div>

        {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        {tab === "employees" ? <EmployeesTable employees={bundle.employees} onEdit={setEditingEmployee} /> : null}

        {tab === "invitations" ? (
          <div className="mt-5 grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <h2 className="font-semibold">Invite employee</h2>
              <p className="mt-1 text-sm text-neutral-500">A secure invite link is valid for 7 days.</p>
              <form onSubmit={(event) => {
                event.preventDefault();
                const formElement = event.currentTarget;
                const form = new FormData(formElement);
                void run(async () => {
                  const result = await api("/invitations", "POST", {
                    full_name: value(form, "full_name"),
                    email: value(form, "email"),
                    role_id: value(form, "role_id"),
                    department_id: value(form, "department_id"),
                    designation_id: value(form, "designation_id"),
                    employee_code: value(form, "employee_code"),
                  });
                  setInviteLink(`${window.location.origin}/invite/${result.invite_token}`);
                  formElement.reset();
                }, "Invitation created");
              }} className="mt-5 space-y-4">
                <Field label="Full name" name="full_name" required />
                <Field label="Email" name="email" type="email" required />
                <Select label="Role" name="role_id" options={activeRoles.map((r) => [r.id, r.name] as const)} required />
                <Select label="Department" name="department_id" options={activeDepartments.map((d) => [d.id, d.name] as const)} empty="No department" />
                <Select label="Designation" name="designation_id" options={activeDesignations.map((d) => [d.id, d.name] as const)} empty="No designation" />
                <Field label="Employee code" name="employee_code" placeholder="Leave blank for automatic numbering" />
                <button disabled={saving} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 text-sm font-semibold text-white">{saving ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />} Create invite</button>
              </form>
              {inviteLink ? <div className="mt-5 rounded-xl border bg-neutral-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Invite link</p><p className="mt-2 break-all text-sm">{inviteLink}</p><button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)} className="mt-3 inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-semibold"><ClipboardCopy className="size-3.5" /> Copy link</button></div> : null}
            </section>
            <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="border-b px-6 py-5"><h2 className="font-semibold">Invitation history</h2></div>
              <div className="divide-y">{bundle.invitations.map((invite) => <div key={invite.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{invite.full_name}</p><p className="mt-1 text-sm text-neutral-500">{invite.email} · {invite.role_name} · {invite.employee_code}</p><p className="mt-1 text-xs text-neutral-400">Expires {new Date(invite.expires_at).toLocaleString()}</p></div><div className="flex items-center gap-2"><span className="rounded-full border px-2.5 py-1 text-xs capitalize">{invite.status}</span>{invite.status === "pending" ? <button type="button" disabled={saving} onClick={() => void run(() => api(`/invitations/${invite.id}/revoke`, "POST").then(() => undefined), "Invitation revoked")} className="rounded-lg border px-3 py-2 text-xs font-semibold">Revoke</button> : null}</div></div>)}</div>
            </section>
          </div>
        ) : null}

        {tab === "structure" ? (
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <StructureCard title="Departments" icon={Building2} items={bundle.departments} saving={saving} onCreate={(form) => run(() => api("/departments", "POST", { name: value(form, "name"), code: value(form, "code"), description: value(form, "description") }).then(() => undefined), "Department created")} onToggle={(item) => run(() => api(`/departments/${item.id}`, "PATCH", { is_active: !item.is_active }).then(() => undefined), "Department updated")} />
            <StructureCard title="Designations" icon={BadgeCheck} items={bundle.designations} saving={saving} onCreate={(form) => run(() => api("/designations", "POST", { name: value(form, "name"), code: value(form, "code"), description: value(form, "description") }).then(() => undefined), "Designation created")} onToggle={(item) => run(() => api(`/designations/${item.id}`, "PATCH", { is_active: !item.is_active }).then(() => undefined), "Designation updated")} />
          </div>
        ) : null}

        {tab === "roles" ? (
          <div className="mt-5 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2"><ShieldCheck className="size-4" /><h2 className="font-semibold">Create custom role</h2></div>
              <p className="mt-1 text-sm text-neutral-500">Choose only the permissions this role needs.</p>
              <form onSubmit={(event) => {
                event.preventDefault();
                const formElement = event.currentTarget;
                const form = new FormData(formElement);
                void run(async () => {
                  await api("/roles", "POST", {
                    name: value(form, "name"),
                    description: value(form, "description"),
                    permissions: bundle.permission_catalog.filter((permission) => form.get(`permission:${permission}`) === "on"),
                  });
                  formElement.reset();
                }, "Role created");
              }} className="mt-5 space-y-4">
                <Field label="Role name" name="name" required />
                <Field label="Description" name="description" />
                <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border p-3">{bundle.permission_catalog.map((permission) => <label key={permission} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-neutral-50"><input type="checkbox" name={`permission:${permission}`} /> {permission}</label>)}</div>
                <button disabled={saving} className="h-11 w-full rounded-xl bg-neutral-950 text-sm font-semibold text-white">Create role</button>
              </form>
            </section>
            <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="border-b px-6 py-5"><h2 className="font-semibold">Company roles</h2><p className="mt-1 text-sm text-neutral-500">Built-in Admin/User roles are protected.</p></div>
              <div className="divide-y">{bundle.roles.map((role) => <div key={role.id} className="p-5"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{role.name}</p><p className="mt-1 text-xs text-neutral-400">{role.is_system ? "Built-in role" : "Custom role"}</p></div><span className="rounded-full border px-2.5 py-1 text-xs">{role.is_active ? "Active" : "Inactive"}</span></div><p className="mt-3 text-sm text-neutral-500">{role.description ?? "No description"}</p><div className="mt-3 flex flex-wrap gap-1.5">{role.permissions.map((permission) => <span key={permission} className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-600">{permission}</span>)}</div></div>)}</div>
            </section>
          </div>
        ) : null}
      </div>

      {editingEmployee ? <EmployeeModal employee={editingEmployee} employees={bundle.employees} roles={activeRoles} departments={activeDepartments} designations={activeDesignations} saving={saving} onClose={() => setEditingEmployee(null)} onSave={(form) => void run(async () => {
        await api(`/employees/${editingEmployee.id}`, "PATCH", {
          role_id: value(form, "role_id"),
          membership_status: value(form, "membership_status"),
          department_id: value(form, "department_id"),
          designation_id: value(form, "designation_id"),
          manager_employee_id: value(form, "manager_employee_id"),
          work_email: value(form, "work_email"),
          phone: value(form, "phone"),
          work_phone: value(form, "work_phone"),
          employment_type: value(form, "employment_type"),
          join_date: value(form, "join_date"),
          work_location: value(form, "work_location"),
          notes: value(form, "notes"),
        });
        setEditingEmployee(null);
      }, "Employee updated")} /> : null}
    </main>
  );
}

function EmployeesTable({ employees, onEdit }: { employees: Employee[]; onEdit: (employee: Employee) => void }) {
  return <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
    <div className="border-b px-6 py-5"><h2 className="font-semibold">Company employees</h2><p className="mt-1 text-sm text-neutral-500">Login identity and company HR profile remain separate.</p></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-6 py-3 font-medium">Employee</th><th className="px-4 py-3 font-medium">Role</th><th className="px-4 py-3 font-medium">Department</th><th className="px-4 py-3 font-medium">Designation</th><th className="px-4 py-3 font-medium">Status</th><th className="px-6 py-3 text-right font-medium">Action</th></tr></thead><tbody className="divide-y">
      {employees.map((employee) => <tr key={employee.id}><td className="px-6 py-4"><p className="font-medium">{employee.full_name}</p><p className="mt-1 text-xs text-neutral-400">{employee.employee_code} · {employee.login_email}</p></td><td className="px-4 py-4">{employee.role_name}</td><td className="px-4 py-4">{employee.department_name ?? "—"}</td><td className="px-4 py-4">{employee.designation_name ?? "—"}</td><td className="px-4 py-4"><span className="rounded-full border px-2.5 py-1 text-xs capitalize">{employee.membership_status}</span></td><td className="px-6 py-4 text-right"><button type="button" onClick={() => onEdit(employee)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-neutral-50"><Pencil className="size-3.5" /> Edit</button></td></tr>)}
    </tbody></table></div>
  </section>;
}

function Field({ label, name, type = "text", required = false, placeholder, defaultValue }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string | null }) {
  return <label className="block text-sm font-medium">{label}<input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue ?? ""} className={inputClass} /></label>;
}

function Select({ label, name, options, required = false, empty, defaultValue }: { label: string; name: string; options: Option[]; required?: boolean; empty?: string; defaultValue?: string | null }) {
  return <label className="block text-sm font-medium">{label}<select name={name} required={required} defaultValue={defaultValue ?? ""} className={inputClass}>{empty ? <option value="">{empty}</option> : null}{!required && !empty ? <option value="">—</option> : null}{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
}

function StructureCard({ title, icon: Icon, items, saving, onCreate, onToggle }: { title: string; icon: LucideIcon; items: Array<Department | Designation>; saving: boolean; onCreate: (form: FormData) => Promise<void>; onToggle: (item: Department | Designation) => Promise<void> }) {
  return <section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><Icon className="size-4" /><h2 className="font-semibold">{title}</h2></div><form onSubmit={(event) => { event.preventDefault(); const element = event.currentTarget; void onCreate(new FormData(element)).then(() => element.reset()); }} className="mt-5 grid gap-3 sm:grid-cols-[1fr_120px_auto]"><Field label="Name" name="name" required /><Field label="Code" name="code" /><button disabled={saving} className="mt-auto flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Plus className="size-4" /> Add</button><div className="sm:col-span-3"><Field label="Description" name="description" /></div></form><div className="mt-5 divide-y rounded-xl border">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-neutral-400">{item.code ?? "No code"}{item.description ? ` · ${item.description}` : ""}</p></div><button type="button" disabled={saving} onClick={() => void onToggle(item)} className="rounded-lg border px-3 py-2 text-xs font-semibold">{item.is_active ? "Deactivate" : "Activate"}</button></div>)}</div></section>;
}

function EmployeeModal({ employee, employees, roles, departments, designations, saving, onClose, onSave }: { employee: Employee; employees: Employee[]; roles: Role[]; departments: Department[]; designations: Designation[]; saving: boolean; onClose: () => void; onSave: (form: FormData) => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-5"><div><h2 className="font-semibold">Edit employee</h2><p className="mt-1 text-sm text-neutral-500">{employee.full_name} · {employee.employee_code}</p></div><button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-lg border"><X className="size-4" /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave(new FormData(event.currentTarget)); }} className="grid gap-4 p-6 sm:grid-cols-2"><Select label="Role" name="role_id" defaultValue={employee.role_id} required options={roles.map((r) => [r.id, r.name] as const)} /><Select label="Access status" name="membership_status" defaultValue={employee.membership_status} required options={[["active", "Active"], ["suspended", "Suspended"]]} /><Select label="Department" name="department_id" defaultValue={employee.department_id} empty="No department" options={departments.map((d) => [d.id, d.name] as const)} /><Select label="Designation" name="designation_id" defaultValue={employee.designation_id} empty="No designation" options={designations.map((d) => [d.id, d.name] as const)} /><Select label="Manager" name="manager_employee_id" defaultValue={employee.manager_employee_id} empty="No manager" options={employees.filter((e) => e.id !== employee.id).map((e) => [e.id, `${e.full_name} (${e.employee_code})`] as const)} /><Field label="Work email" name="work_email" type="email" defaultValue={employee.work_email} /><Field label="Phone" name="phone" defaultValue={employee.phone} /><Field label="Work phone" name="work_phone" defaultValue={employee.work_phone} /><Select label="Employment type" name="employment_type" defaultValue={employee.employment_type} required options={[["full_time", "Full-time"], ["part_time", "Part-time"], ["contract", "Contract"], ["intern", "Intern"], ["consultant", "Consultant"]]} /><Field label="Join date" name="join_date" type="date" defaultValue={employee.join_date} /><Field label="Work location" name="work_location" defaultValue={employee.work_location} /><div className="sm:col-span-2"><Field label="Notes" name="notes" defaultValue={employee.notes} /></div><div className="sm:col-span-2 flex justify-end gap-2 border-t pt-5"><button type="button" onClick={onClose} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white">{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save employee</button></div></form></div></div>;
}
