"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { FileText, History, Loader2, Plus, Search, Upload, X } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import type { HRAccess } from "@/components/hr-module-nav";

type Employee = { id: string; employee_code: string; name: string };
type Meta = { employees: Employee[] };
type DocumentRow = { id: string; employee_id: string; employee_name: string | null; title: string; document_type: string; reference_number?: string | null; issued_on?: string | null; expires_on?: string | null; file_url?: string | null; notes?: string | null };
type Lifecycle = { id: string; employee_id: string; employee_name: string | null; event_type: string; effective_date: string; title: string; details: Record<string, unknown>; notes?: string | null };
type View = "documents" | "history";

const input = "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";

export default function HRRecordsPage() {
  const [access, setAccess] = useState<HRAccess | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [history, setHistory] = useState<Lifecycle[]>([]);
  const [view, setView] = useState<View>("documents");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<"document" | "history" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api/hr${path}`, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "HR records request failed.");
    return payload as T;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextAccess, nextMeta, nextDocs, nextHistory] = await Promise.all([
        api<HRAccess>("/access"), api<Meta>("/meta"), api<DocumentRow[]>("/documents"), api<Lifecycle[]>("/lifecycle"),
      ]);
      setAccess(nextAccess); setMeta(nextMeta); setDocuments(nextDocs); setHistory(nextHistory);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load employee records."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const docRows = useMemo(() => filter(documents, search, row => `${row.employee_name ?? ""} ${row.title} ${row.document_type} ${row.reference_number ?? ""}`), [documents, search]);
  const historyRows = useMemo(() => filter(history, search, row => `${row.employee_name ?? ""} ${row.title} ${row.event_type} ${row.effective_date}`), [history, search]);
  const employeeOptions = (meta?.employees ?? []).map(e => ({ value: e.id, label: `${e.name} · ${e.employee_code}` }));

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch("/api/hr-documents/upload", { method: "POST", body: data });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to upload document.");
      setMessage("Employee document uploaded securely"); setModal(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to upload document."); }
    finally { setSaving(false); }
  }

  async function addHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      await api("/lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        employee_id: String(form.get("employee_id") || ""), event_type: String(form.get("event_type") || "note"), effective_date: String(form.get("effective_date") || ""), title: String(form.get("title") || "").trim(), details: {}, notes: String(form.get("notes") || "").trim() || null,
      }) });
      setMessage("Employment history updated"); setModal(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to add employment event."); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-neutral-500">Employee information</p><h1 className="mt-1 text-3xl font-semibold">Records</h1><p className="mt-2 max-w-2xl text-sm text-neutral-500">Keep contracts, IDs and employment changes together. Files stay organization-scoped and employee access remains controlled.</p></div>{access?.can_manage ? <div className="flex gap-2"><button onClick={() => { setView("history"); setModal("history"); }} className="h-11 rounded-xl border bg-white px-4 text-sm font-semibold">Add employment event</button><button onClick={() => { setView("documents"); setModal("document"); }} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Upload className="size-4" />Upload document</button></div> : null}</header>
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}{error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex gap-1 rounded-xl bg-neutral-100 p-1"><button onClick={() => setView("documents")} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${view === "documents" ? "bg-white shadow-sm" : "text-neutral-500"}`}><FileText className="size-4" />Documents</button><button onClick={() => setView("history")} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${view === "history" ? "bg-white shadow-sm" : "text-neutral-500"}`}><History className="size-4" />Employment history</button></div><div className="relative w-full sm:w-80"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee or record..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm" /></div></div>
      {view === "documents" ? <Documents rows={docRows} /> : <HistoryRows rows={historyRows} />}
    </section>
  </div>

  {modal === "document" ? <Modal title="Upload employee document" onClose={() => setModal(null)}><form onSubmit={uploadDocument} className="space-y-4"><SearchableSelect label="Employee" name="employee_id" required clearable={false} options={employeeOptions} searchPlaceholder="Search employee..." /><Field label="Document title" name="title" required placeholder="Employment contract" /><label className="block text-sm font-medium">Document type<select name="document_type" defaultValue="contract" className={`mt-2 ${input}`}><option value="contract">Contract</option><option value="identity">Identity</option><option value="passport">Passport</option><option value="visa">Visa / work permit</option><option value="certificate">Certificate</option><option value="license">License</option><option value="other">Other</option></select></label><Field label="Reference number" name="reference_number" /><div className="grid gap-4 sm:grid-cols-2"><Field label="Issued on" name="issued_on" type="date" /><Field label="Expires on" name="expires_on" type="date" /></div><label className="block text-sm font-medium">File<input name="file" type="file" required className="mt-2 block w-full rounded-xl border bg-white p-3 text-sm" /></label><label className="block text-sm font-medium">Notes<textarea name="notes" className="mt-2 min-h-20 w-full rounded-xl border p-3 text-sm" /></label><Submit saving={saving} label="Upload securely" /></form></Modal> : null}

  {modal === "history" ? <Modal title="Add employment event" onClose={() => setModal(null)}><form onSubmit={addHistory} className="space-y-4"><SearchableSelect label="Employee" name="employee_id" required clearable={false} options={employeeOptions} searchPlaceholder="Search employee..." /><label className="block text-sm font-medium">Event<select name="event_type" defaultValue="confirmation" className={`mt-2 ${input}`}><option value="joining">Joining</option><option value="confirmation">Confirmation</option><option value="promotion">Promotion</option><option value="transfer">Transfer</option><option value="role_change">Role change</option><option value="compensation_change">Compensation change</option><option value="resignation">Resignation</option><option value="termination">Termination</option><option value="note">Other note</option></select></label><Field label="Effective date" name="effective_date" type="date" required /><Field label="Title" name="title" required placeholder="Promoted to Senior Engineer" /><label className="block text-sm font-medium">Notes<textarea name="notes" className="mt-2 min-h-24 w-full rounded-xl border p-3 text-sm" /></label><Submit saving={saving} label="Save event" /></form></Modal> : null}
  </main>;
}

function Documents({ rows }: { rows: DocumentRow[] }) { if (!rows.length) return <Empty text="No employee documents found." />; return <div className="divide-y">{rows.map(row => <div key={row.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{row.title}</p><p className="mt-1 text-sm text-neutral-500">{row.employee_name ?? "Employee"} · {row.document_type.replaceAll("_", " ")}{row.reference_number ? ` · ${row.reference_number}` : ""}</p><p className="mt-1 text-xs text-neutral-400">{row.expires_on ? `Expires ${row.expires_on}` : "No expiry date"}</p></div>{row.file_url ? <button onClick={() => window.open(row.file_url || `/api/hr-documents/${row.id}/file`, "_blank", "noopener,noreferrer")} className="h-10 rounded-xl border px-4 text-sm font-semibold">Open file</button> : <span className="text-xs text-neutral-400">Metadata only</span>}</div>)}</div>; }
function HistoryRows({ rows }: { rows: Lifecycle[] }) { if (!rows.length) return <Empty text="No employment history found." />; return <div className="divide-y">{rows.map(row => <div key={row.id} className="grid gap-2 p-5 sm:grid-cols-[160px_1fr_auto] sm:items-center"><div><p className="text-sm font-medium">{row.effective_date}</p><p className="mt-1 text-xs capitalize text-neutral-400">{row.event_type.replaceAll("_", " ")}</p></div><div><p className="font-medium">{row.title}</p><p className="mt-1 text-sm text-neutral-500">{row.employee_name ?? "Employee"}{row.notes ? ` · ${row.notes}` : ""}</p></div><History className="size-4 text-neutral-300" /></div>)}</div>; }
function Field({ label, name, type = "text", required = false, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) { return <label className="block text-sm font-medium">{label}<input name={name} type={type} required={required} placeholder={placeholder} className={`mt-2 ${input}`} /></label>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{children}</div></div>; }
function Submit({ saving, label }: { saving: boolean; label: string }) { return <div className="flex justify-end border-t pt-5"><button disabled={saving} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{saving ? "Saving…" : label}</button></div>; }
function Empty({ text }: { text: string }) { return <div className="px-6 py-16 text-center text-sm text-neutral-400">{text}</div>; }
function filter<T>(rows: T[], search: string, text: (row: T) => string) { const needle = search.trim().toLowerCase(); return needle ? rows.filter(row => text(row).toLowerCase().includes(needle)) : rows; }
