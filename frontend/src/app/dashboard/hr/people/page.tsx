"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Loader2, MailPlus, Pencil, Plus, Search, UserCheck, UsersRound, X } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";

type Person = {
  id: string;
  full_name: string;
  login_email: string;
  employee_code: string;
  role_name: string;
  membership_status: string;
  department_id: string | null;
  department_name: string | null;
  designation_id: string | null;
  designation_name: string | null;
  manager_employee_id: string | null;
  work_email: string | null;
  phone: string | null;
  work_phone: string | null;
  employment_type: string;
  employment_status: string;
  join_date: string | null;
  end_date: string | null;
  work_location: string | null;
  notes: string | null;
};
type NamedOption = { id: string; name: string; code?: string | null };
type InviteRole = { id: string; name: string; slug: string };
type Invitation = { id: string; email: string; full_name: string; employee_code: string; role_name: string; expires_at: string };
type Bundle = {
  people: Person[];
  departments: NamedOption[];
  designations: NamedOption[];
  invite_roles: InviteRole[];
  invitations: Invitation[];
  capabilities: { can_manage_people: boolean; can_invite_employees: boolean; can_manage_structure: boolean };
};
type Modal = "edit" | "invite" | "department" | "designation" | null;
type View = "directory" | "structure" | "invitations";

const input = "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";

export default function HRPeoplePage() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>("directory");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api/hr${path}`, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "People request failed.");
    return payload as T;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setBundle(await api<Bundle>("/people")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load People."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => {
    if (!bundle) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return bundle.people;
    return bundle.people.filter(person => `${person.full_name} ${person.employee_code} ${person.login_email} ${person.work_email ?? ""} ${person.department_name ?? ""} ${person.designation_name ?? ""} ${person.work_location ?? ""}`.toLowerCase().includes(needle));
  }, [bundle, search]);
  const active = bundle?.people.filter(item => item.employment_status === "active" && item.membership_status === "active").length ?? 0;
  const departmentOptions = [{ value: "", label: "No department" }, ...(bundle?.departments ?? []).map(item => ({ value: item.id, label: item.name }))];
  const designationOptions = [{ value: "", label: "No designation" }, ...(bundle?.designations ?? []).map(item => ({ value: item.id, label: item.name }))];
  const managerOptions = [{ value: "", label: "No manager" }, ...(bundle?.people ?? []).filter(person => person.id !== editing?.id && person.employment_status === "active").map(person => ({ value: person.id, label: `${person.full_name} · ${person.employee_code}` }))];
  const roleOptions = (bundle?.invite_roles ?? []).map(role => ({ value: role.id, label: role.name }));

  async function mutate(action: () => Promise<void>, success: string) {
    setSaving(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); setModal(null); setEditing(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save People change."); }
    finally { setSaving(false); }
  }

  async function updatePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const form = new FormData(event.currentTarget);
    await mutate(async () => {
      await api(`/people/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        department_id: String(form.get("department_id") || "") || null,
        designation_id: String(form.get("designation_id") || "") || null,
        manager_employee_id: String(form.get("manager_employee_id") || "") || null,
        work_email: String(form.get("work_email") || "").trim() || null,
        phone: String(form.get("phone") || "").trim() || null,
        work_phone: String(form.get("work_phone") || "").trim() || null,
        employment_type: String(form.get("employment_type") || "full_time"),
        join_date: String(form.get("join_date") || "") || null,
        end_date: String(form.get("end_date") || "") || null,
        work_location: String(form.get("work_location") || "").trim() || null,
        notes: String(form.get("notes") || "").trim() || null,
      }) });
    }, "Employee profile updated");
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let inviteUrl = "";
    await mutate(async () => {
      const result = await api<{ invite_token: string; email: string }>("/people/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        full_name: String(form.get("full_name") || "").trim(), email: String(form.get("email") || "").trim(), role_id: String(form.get("role_id") || ""), department_id: String(form.get("department_id") || "") || null, designation_id: String(form.get("designation_id") || "") || null, employee_code: String(form.get("employee_code") || "").trim() || null,
      }) });
      inviteUrl = `${window.location.origin}/invite/${result.invite_token}`;
      await navigator.clipboard?.writeText(inviteUrl).catch(() => undefined);
    }, "Employee invitation created. The invite link was copied when browser permission allowed.");
  }

  async function addStructure(event: FormEvent<HTMLFormElement>, kind: "department" | "designation") {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await mutate(async () => {
      await api(`/people/${kind === "department" ? "departments" : "designations"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(form.get("name") || "").trim(), code: String(form.get("code") || "").trim() || null, description: String(form.get("description") || "").trim() || null }) });
    }, `${kind === "department" ? "Department" : "Designation"} created`);
  }

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
  if (!bundle) return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-5xl rounded-2xl border bg-white p-6 text-sm text-red-700">{error ?? "People directory is unavailable."}</div></main>;

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-neutral-500">Your company directory</p><h1 className="mt-1 text-3xl font-semibold">People</h1><p className="mt-2 max-w-2xl text-sm text-neutral-500">Invite people, keep their work profile accurate and organize departments without exposing company security controls.</p></div>{bundle.capabilities.can_invite_employees ? <button onClick={() => setModal("invite")} disabled={!roleOptions.length} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><MailPlus className="size-4" />Invite person</button> : null}</header>
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}{error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="People" value={bundle.people.length} icon={UsersRound} /><Metric label="Active" value={active} icon={UserCheck} /><Metric label="Departments" value={bundle.departments.length} icon={Building2} /><Metric label="Invites pending" value={bundle.invitations.length} icon={MailPlus} /></div>

    <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5"><div className="flex gap-1 overflow-x-auto rounded-xl bg-neutral-100 p-1"><Tab active={view === "directory"} onClick={() => setView("directory")}>Directory</Tab><Tab active={view === "structure"} onClick={() => setView("structure")}>Structure</Tab>{bundle.capabilities.can_invite_employees ? <Tab active={view === "invitations"} onClick={() => setView("invitations")}>Invitations</Tab> : null}</div>{view === "directory" ? <div className="relative w-full lg:w-80"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code, team or role..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm" /></div> : null}</div>
      {view === "directory" ? <Directory rows={people} canManage={bundle.capabilities.can_manage_people} onEdit={person => { setEditing(person); setModal("edit"); }} /> : view === "structure" ? <Structure departments={bundle.departments} designations={bundle.designations} canManage={bundle.capabilities.can_manage_structure} onAdd={kind => setModal(kind)} /> : <Invitations rows={bundle.invitations} />}
    </section>
  </div>

  {modal === "edit" && editing ? <Modal title={`Edit ${editing.full_name}`} onClose={() => { setModal(null); setEditing(null); }}><form onSubmit={updatePerson} className="space-y-4"><div className="rounded-xl bg-neutral-50 p-4"><p className="font-medium">{editing.full_name}</p><p className="mt-1 text-xs text-neutral-500">{editing.employee_code} · {editing.role_name} · login {editing.login_email}</p><p className="mt-2 text-xs text-neutral-400">Role and login access are security settings and are intentionally managed separately by a company administrator.</p></div><div className="grid gap-4 sm:grid-cols-2"><SearchableSelect label="Department" name="department_id" defaultValue={editing.department_id} options={departmentOptions} searchPlaceholder="Search department..." /><SearchableSelect label="Designation" name="designation_id" defaultValue={editing.designation_id} options={designationOptions} searchPlaceholder="Search designation..." /><SearchableSelect label="Manager" name="manager_employee_id" defaultValue={editing.manager_employee_id} options={managerOptions} searchPlaceholder="Search manager..." /><label className="block text-sm font-medium">Employment type<select name="employment_type" defaultValue={editing.employment_type} className={`mt-2 ${input}`}><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="internship">Internship</option><option value="temporary">Temporary</option></select></label><Field label="Work email" name="work_email" type="email" defaultValue={editing.work_email ?? ""} /><Field label="Phone" name="phone" defaultValue={editing.phone ?? ""} /><Field label="Work phone" name="work_phone" defaultValue={editing.work_phone ?? ""} /><Field label="Work location" name="work_location" defaultValue={editing.work_location ?? ""} /><Field label="Join date" name="join_date" type="date" defaultValue={editing.join_date ?? ""} /><Field label="End date" name="end_date" type="date" defaultValue={editing.end_date ?? ""} /></div><label className="block text-sm font-medium">Internal HR note<textarea name="notes" defaultValue={editing.notes ?? ""} className="mt-2 min-h-24 w-full rounded-xl border p-3 text-sm" /></label><Submit saving={saving} label="Save profile" /></form></Modal> : null}
  {modal === "invite" ? <Modal title="Invite a person" onClose={() => setModal(null)}><form onSubmit={invite} className="space-y-4"><Field label="Full name" name="full_name" required /><Field label="Email" name="email" type="email" required /><SearchableSelect label="Employee role" name="role_id" required clearable={false} options={roleOptions} searchPlaceholder="Search allowed roles..." /><div className="grid gap-4 sm:grid-cols-2"><SearchableSelect label="Department" name="department_id" options={departmentOptions} searchPlaceholder="Search department..." /><SearchableSelect label="Designation" name="designation_id" options={designationOptions} searchPlaceholder="Search designation..." /></div><Field label="Employee code (optional)" name="employee_code" placeholder="Auto-generated if blank" /><p className="rounded-xl bg-neutral-50 p-3 text-xs leading-5 text-neutral-500">Only roles you are allowed to grant are shown. Delegated HR users cannot invite someone into a higher-privilege role.</p><Submit saving={saving} label="Create invitation" /></form></Modal> : null}
  {modal === "department" ? <Modal title="Add department" onClose={() => setModal(null)}><form onSubmit={e => void addStructure(e, "department")} className="space-y-4"><Field label="Department name" name="name" required placeholder="Engineering" /><Field label="Code" name="code" placeholder="ENG" /><TextArea label="Description" name="description" /><Submit saving={saving} label="Add department" /></form></Modal> : null}
  {modal === "designation" ? <Modal title="Add designation" onClose={() => setModal(null)}><form onSubmit={e => void addStructure(e, "designation")} className="space-y-4"><Field label="Designation name" name="name" required placeholder="Senior Engineer" /><Field label="Code" name="code" placeholder="SWE-SR" /><TextArea label="Description" name="description" /><Submit saving={saving} label="Add designation" /></form></Modal> : null}
  </main>;
}

function Directory({ rows, canManage, onEdit }: { rows: Person[]; canManage: boolean; onEdit: (person: Person) => void }) { if (!rows.length) return <Empty text="No people found." />; return <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-400"><tr><th className="px-5 py-3">Person</th><th>Team</th><th>Role</th><th>Type</th><th>Status</th><th>Location</th><th className="pr-5 text-right">Action</th></tr></thead><tbody className="divide-y">{rows.map(person => <tr key={person.id}><td className="px-5 py-4"><p className="font-medium">{person.full_name}</p><p className="mt-1 text-xs text-neutral-400">{person.employee_code} · {person.work_email || person.login_email}</p></td><td><p>{person.department_name || "—"}</p><p className="mt-1 text-xs text-neutral-400">{person.designation_name || "No designation"}</p></td><td>{person.role_name}</td><td className="capitalize">{person.employment_type.replaceAll("_", " ")}</td><td><Status value={person.employment_status === "active" && person.membership_status !== "active" ? "access suspended" : person.employment_status} /></td><td>{person.work_location || "—"}</td><td className="pr-5 text-right">{canManage ? <button onClick={() => onEdit(person)} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold"><Pencil className="size-3" />Edit</button> : <span className="text-xs text-neutral-400">View only</span>}</td></tr>)}</tbody></table></div>; }
function Structure({ departments, designations, canManage, onAdd }: { departments: NamedOption[]; designations: NamedOption[]; canManage: boolean; onAdd: (kind: "department" | "designation") => void }) { return <div className="grid gap-6 p-5 lg:grid-cols-2"><StructureList title="Departments" rows={departments} canManage={canManage} onAdd={() => onAdd("department")} /><StructureList title="Designations" rows={designations} canManage={canManage} onAdd={() => onAdd("designation")} /></div>; }
function StructureList({ title, rows, canManage, onAdd }: { title: string; rows: NamedOption[]; canManage: boolean; onAdd: () => void }) { return <section className="rounded-xl border p-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-neutral-500">Keep the list short and meaningful.</p></div>{canManage ? <button onClick={onAdd} className="rounded-lg border px-3 py-2 text-xs font-semibold"><Plus className="mr-1 inline size-3" />Add</button> : null}</div><div className="mt-4 space-y-2">{rows.length ? rows.map(item => <div key={item.id} className="rounded-lg bg-neutral-50 px-3 py-2.5"><p className="text-sm font-medium">{item.name}</p>{item.code ? <p className="mt-0.5 text-xs text-neutral-400">{item.code}</p> : null}</div>) : <Empty text={`No ${title.toLowerCase()} yet.`} />}</div></section>; }
function Invitations({ rows }: { rows: Invitation[] }) { if (!rows.length) return <Empty text="No active pending invitations." />; return <div className="divide-y">{rows.map(row => <div key={row.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{row.full_name}</p><p className="mt-1 text-sm text-neutral-500">{row.email} · {row.role_name} · {row.employee_code}</p></div><p className="text-xs text-neutral-400">Expires {new Date(row.expires_at).toLocaleDateString()}</p></div>)}</div>; }
function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof UsersRound }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-3xl font-semibold">{value}</p></article>; }
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${active ? "bg-white shadow-sm" : "text-neutral-500"}`}>{children}</button>; }
function Status({ value }: { value: string }) { const positive = value === "active"; const cls = positive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : value.includes("suspend") || value === "terminated" ? "border-red-200 bg-red-50 text-red-700" : "bg-neutral-50 text-neutral-600"; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${cls}`}>{value.replaceAll("_", " ")}</span>; }
function Field({ label, name, type = "text", required = false, placeholder, defaultValue }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string }) { return <label className="block text-sm font-medium">{label}<input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} className={`mt-2 ${input}`} /></label>; }
function TextArea({ label, name }: { label: string; name: string }) { return <label className="block text-sm font-medium">{label}<textarea name={name} className="mt-2 min-h-24 w-full rounded-xl border p-3 text-sm" /></label>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{children}</div></div>; }
function Submit({ saving, label }: { saving: boolean; label: string }) { return <div className="flex justify-end border-t pt-5"><button disabled={saving} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : label}</button></div>; }
function Empty({ text }: { text: string }) { return <div className="px-6 py-12 text-center text-sm text-neutral-400">{text}</div>; }
