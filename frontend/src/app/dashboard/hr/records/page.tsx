"use client";

import { FormEvent } from "react";
import { recordsEventCreateHref, recordsHref } from "@/lib/hr-records-navigation";
import { Loader2, Plus, Upload, X } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { useHRRecordsBrowse } from "@/hooks/use-hr-records-browse";
import { RecordsRegister } from "@/components/hr-records/records-register";
import { ProjectDialog } from "@/components/projects/project-dialog";
import "@/components/hr-records/records.css";
import { useHRRecordsUpload } from "@/hooks/use-hr-records-upload";

const input = "h-11 w-full min-w-0 max-w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-500";

export default function HRRecordsPage() {
  const upload = useHRRecordsUpload();
  const vm = useHRRecordsBrowse(upload.busy);
  const access = vm.access;
  const load = async (current: () => boolean = vm.current) => { if (current()) await vm.refresh(); };

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const receipt = await upload.submit(event.currentTarget);
    // A refresh is separate from the authoritative upload receipt and never retries it.
    if (receipt?.current()) {
      void load(receipt.current);
    }
  }

  if (vm.accessLoading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;

  if (!vm.canView) return <main className="p-6"><h1 className="text-2xl font-semibold">Employee records</h1><p role="alert" className="mt-4">{vm.accessError || "Your role cannot read this workspace."}</p></main>;

  return <main className="records-workspace min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-neutral-500">Employee information</p><h1 className="mt-1 text-3xl font-semibold">Records</h1><p className="mt-2 max-w-2xl text-sm text-neutral-500">Keep contracts, IDs and employment changes together. Files stay organization-scoped and employee access remains controlled.</p></div>{access?.can_manage ? <div className="flex flex-wrap gap-2"><a href={recordsEventCreateHref(recordsHref(vm.browse))} aria-disabled={upload.busy} onClick={event => { if (upload.busy) event.preventDefault(); }} className="inline-flex min-h-11 items-center rounded-xl border bg-white px-4 text-sm font-semibold">Add employment event</a><button disabled={!upload.canOpen} onClick={() => { upload.open(); }} className="flex min-h-11 max-w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Upload className="size-4" />Upload document</button></div> : null}</header>
    {!upload.isOpen && upload.unresolved ? <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p>{upload.message}</p><p className="mt-2">This page retains the upload lock. Open Upload document to review it, not to resubmit. Reloading or leaving may lose this memory-only result.</p></div> : null}
    {vm.meta.error && vm.canManage ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">Employee context: {vm.meta.error}<button type="button" disabled={upload.busy || vm.meta.loading} onClick={() => void vm.meta.refresh()} className="ml-2 min-h-11 underline">Retry employee context</button></div> : null}
    <RecordsRegister vm={vm} disabled={upload.busy} />
  </div>

  {upload.isOpen ? <Modal title="Upload employee document" onClose={upload.close} pending={upload.busy} dialogLabel="Upload employee document"><div className="space-y-3">{upload.message ? <div role={upload.phase === "rejected" ? "alert" : "status"} className="rounded-xl border bg-neutral-50 p-3 text-sm"><p>{upload.message}</p>{upload.receipt ? <p className="mt-2">Document reference: {upload.receipt.id}</p> : null}{upload.unresolved ? <p className="mt-2">The lock is memory-only. Closing this dialog keeps it on this page; reloading or leaving may lose it. A later record list cannot verify this specific upload.</p> : null}</div> : null}{upload.metaError && ["idle", "rejected"].includes(upload.phase) ? <p role="alert" className="text-sm text-red-700">{upload.metaError}<button type="button" className="ml-2 underline" onClick={() => void upload.refreshContext()}>Retry employee context</button></p> : null}{upload.metaLoading ? <p role="status" className="text-sm text-neutral-500">Checking current employee context…</p> : null}</div><form onSubmit={uploadDocument} onChange={upload.changed} className="mt-4 min-w-0 space-y-4"><fieldset disabled={!upload.canEdit()} className="min-w-0 space-y-4"><div data-records-select><SearchableSelect label="Employee" name="employee_id" required clearable={false} options={upload.employees.map(e => ({ value: e.id, label: `${e.name} · ${e.employee_code}` }))} searchPlaceholder="Search employee..." /></div><Field label="Document title" name="title" required placeholder="Employment contract" /><label className="block text-sm font-medium">Document type<select name="document_type" defaultValue="contract" className={`mt-2 ${input}`}><option value="contract">Contract</option><option value="identity">Identity</option><option value="passport">Passport</option><option value="visa">Visa / work permit</option><option value="certificate">Certificate</option><option value="license">License</option><option value="other">Other</option></select></label><Field label="Reference number" name="reference_number" /><div className="grid min-w-0 gap-4 sm:grid-cols-2"><Field label="Issued on" name="issued_on" type="date" /><Field label="Expires on" name="expires_on" type="date" /></div><label className="block text-sm font-medium">File<input name="file" type="file" required className="mt-2 block w-full min-w-0 max-w-full rounded-xl border bg-white p-3 text-sm" /></label><label className="block text-sm font-medium">Notes<textarea name="notes" className="mt-2 min-h-20 w-full min-w-0 rounded-xl border p-3 text-sm" /></label><Submit saving={upload.busy} label="Upload securely" /></fieldset></form>{upload.phase === "confirmed" ? <p className="mt-4 text-sm text-neutral-500">Close this result before choosing Upload document for a separate new document.</p> : null}</Modal> : null}

  </main>;
}

function Field({ label, name, type = "text", required = false, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) { return <label className="block text-sm font-medium">{label}<input name={name} type={type} required={required} placeholder={placeholder} className={`mt-2 ${input}`} /></label>; }
function Modal({ title, children, onClose, pending = false, dialogLabel }: { title: string; children: React.ReactNode; onClose: () => void; pending?: boolean; dialogLabel?: string }) { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !pending) onClose(); }}><ProjectDialog label={dialogLabel || title} busy={pending} onClose={onClose} className="records-modal max-h-[92vh] w-full min-w-0 max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6"><div className="mb-5 flex items-start justify-between gap-3"><h2 className="min-w-0 break-words text-xl font-semibold">{title}</h2><button type="button" disabled={pending} aria-label={dialogLabel ? "Close document upload" : "Close employment event"} onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-xl border"><X className="size-4" /></button></div>{children}</ProjectDialog></div>; }

function Submit({ saving, label }: { saving: boolean; label: string }) { return <div className="flex justify-end border-t pt-5"><button disabled={saving} className="flex min-h-11 max-w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{saving ? "Saving…" : label}</button></div>; }

