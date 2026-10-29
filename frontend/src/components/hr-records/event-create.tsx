"use client";
import { useEffect, useRef } from "react";
import { SearchableSelect } from "@/components/searchable-select";
import { useHRRecordsEventCreate } from "@/hooks/use-hr-records-event-create";
import { recordsDocumentHref } from "@/lib/hr-records-navigation";
import { EVENT_TYPES } from "./records-model";
import { eventConsequence } from "./event-create-model";
import "./records.css";

const control = "mt-2 min-h-11 w-full min-w-0 rounded-xl border bg-white px-3 py-2 text-sm";
const button = "inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50";
export function EventCreate() {
  const vm = useHRRecordsEventCreate();
  const reviewHeading = useRef<HTMLHeadingElement>(null), reviewButton = useRef<HTMLButtonElement>(null), status = useRef<HTMLDivElement>(null);
  const previous = useRef({ scope: vm.scope, phase: vm.phase, busy: vm.busy });
  useEffect(() => {
    const prior = previous.current;
    previous.current = { scope: vm.scope, phase: vm.phase, busy: vm.busy };
    if (prior.scope !== vm.scope) return;
    if (vm.phase === "review" || !vm.busy && ["confirmed", "unknown", "acknowledged"].includes(vm.phase)) reviewHeading.current?.focus();
    else if (vm.phase === "idle" && prior.phase === "review") reviewButton.current?.focus();
    else if (vm.message && ["idle", "rejected"].includes(vm.phase)) status.current?.focus();
  }, [vm.scope, vm.phase, vm.busy, vm.message]);
  if (vm.accessLoading) return <main className="p-6"><p role="status">Checking employment event access…</p></main>;
  if (!vm.canManage) return <main className="p-6"><h1 className="text-2xl font-semibold">Add employment event</h1><p role="alert" className="mt-4">{vm.accessError || "Your role cannot create employment events in this workspace."}</p><a href={vm.returnHref} className={`mt-4 ${button}`}>Back to register</a></main>;
  const editing = ["idle", "rejected"].includes(vm.phase);
  return <main className="records-workspace min-h-screen bg-[var(--app-canvas)] p-4 sm:p-8"><div className="mx-auto max-w-3xl">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-neutral-500">Employee information · New record</p><h1 className="mt-2 text-3xl font-semibold">Add employment event</h1><p className="mt-2 max-w-xl text-sm text-neutral-600">Prepare the details, review their effect, then save once. Existing employment events remain read-only.</p></div><a href={vm.returnHref} aria-disabled={vm.busy} onClick={event => { if (vm.busy) event.preventDefault(); }} className={button}>{vm.phase === "confirmed" ? "Back to register" : "Cancel"}</a></header>
    {vm.message ? <div ref={status} tabIndex={-1} role={vm.phase === "rejected" || editing ? "alert" : "status"} className="mt-6 rounded-xl border bg-white p-4 text-sm"><p>{vm.message}</p>{vm.unresolved ? <p className="mt-3">This lock exists only on this page. Leaving or reloading may lose it. A matching or missing record in a later list does not verify this request’s outcome.</p> : null}</div> : null}
    <form key={vm.scope} hidden={!editing} onChange={vm.changed} onSubmit={event => { event.preventDefault(); vm.review(event.currentTarget); }} className="records-modal mt-6 rounded-2xl border bg-white p-4 sm:p-6">
      {vm.meta.error ? <div role="alert" className="mb-4 text-sm text-red-700">{vm.meta.error}<button type="button" disabled={vm.meta.loading} onClick={() => void vm.meta.refresh()} className="ml-2 min-h-11 underline">Retry employee context</button></div> : null}
      {vm.meta.loading ? <p role="status" className="mb-4 text-sm">Checking current company employees…</p> : null}
      <fieldset disabled={!vm.canEdit()} className="min-w-0 space-y-5">
        <div data-records-select><SearchableSelect label="Employee" name="employee_id" required clearable={false} options={(vm.meta.value?.employees ?? []).map(employee => ({ value: employee.id, label: `${employee.name} · ${employee.employee_code}` }))} searchPlaceholder="Search employee…" /></div>
        <label className="block text-sm font-medium">Event type<select name="event_type" defaultValue="confirmation" className={control}>{EVENT_TYPES.map(type => <option value={type} key={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
        <label className="block text-sm font-medium">Effective date<input name="effective_date" type="date" required className={control} /></label>
        <label className="block text-sm font-medium">Title<input name="title" required maxLength={180} placeholder="Promoted to Senior Engineer" className={control} /></label>
        <label className="block text-sm font-medium">Notes<textarea name="notes" className={`${control} min-h-28`} /></label>
        <p className="text-sm text-neutral-600">Resignation and termination immediately mark the employee inactive when saved, even with a future effective date. You will review this before saving.</p>
        <div className="flex justify-end border-t pt-5"><button ref={reviewButton} className={`${button} bg-neutral-950 text-white`}>Review event</button></div>
      </fieldset>
    </form>
    {vm.intent && !editing ? <section aria-label="Review employment event" className="mt-6 rounded-2xl border bg-white p-4 sm:p-6"><h2 ref={reviewHeading} tabIndex={-1} className="text-xl font-semibold outline-offset-4">{vm.phase === "confirmed" ? "Saved event" : "Review event"}</h2><dl className="mt-5 grid gap-4 sm:grid-cols-2">{[["Employee", vm.intent.employee_name], ["Employee ID", vm.intent.employee_id], ["Event type", vm.intent.event_type.replaceAll("_", " ")], ["Effective date", vm.intent.effective_date], ["Title", vm.intent.title], ["Notes", vm.intent.notes || "No notes"]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm text-neutral-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl><p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{eventConsequence(vm.intent.event_type)}</p>
      {vm.phase === "review" || vm.busy ? <div className="mt-6 flex flex-wrap justify-end gap-3 border-t pt-5"><button type="button" disabled={vm.busy} onClick={vm.edit} className={button}>Edit details</button><button type="button" disabled={vm.busy || !vm.meta.isReady(vm.meta.receipt)} onClick={() => void vm.submit()} className={`${button} bg-neutral-950 text-white`}>{vm.busy ? "Saving…" : "Confirm and save event"}</button></div> : null}
      {vm.phase === "confirmed" && vm.receipt ? <footer className="mt-6 border-t pt-5"><p className="break-words text-sm">Event reference: {vm.receipt.id}</p><a href={recordsDocumentHref("history", vm.receipt.id, vm.returnHref)} className={`mt-4 ${button} bg-neutral-950 text-white`}>View saved event</a><p className="mt-3 text-sm text-neutral-600">If the detail page cannot load, retry that read. Do not save this event again.</p></footer> : null}
    </section> : null}
  </div></main>;
}
