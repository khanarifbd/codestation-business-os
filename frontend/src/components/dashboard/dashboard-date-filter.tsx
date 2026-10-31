"use client";
import { useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { dashboardDateShortcut, validateDashboardDateRange, type DashboardDatePreset, type DashboardDateRange } from "@/lib/dashboard-date-range";
import "./dashboard-date-filter.css";
export type DashboardDateFilterProps = DashboardDateRange & {
 timezone: string; preset: DashboardDatePreset; busy: boolean;
 onRange: (range: DashboardDateRange) => void;
 onPreset: (preset: Exclude<DashboardDatePreset,"custom">, range: DashboardDateRange) => void;
};
const presets = [["today","Today"],["week","This week (Mon–today)"],["month","This month"],["last_month","Last month"],["quarter","This quarter"],["year","This year"]] as const;
export function DashboardDateFilter({from,to,timezone,preset,busy,onRange,onPreset}:DashboardDateFilterProps) {
 const id=useId(),[draftFrom,setFrom]=useState(from),[draftTo,setTo]=useState(to),[draftPreset,setDraftPreset]=useState<DashboardDatePreset>(preset),[error,setError]=useState<string|null>(null),[open,setOpen]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null),first=useRef<HTMLInputElement>(null),admitted=useRef(false);
 const today=dashboardDateShortcut("today",timezone).to;
 function resetDraft(){setFrom(from);setTo(to);setDraftPreset(preset);setError(null);}
 function show(){if(busy||dialog.current?.open)return;resetDraft();admitted.current=false;dialog.current?.showModal();setOpen(true);first.current?.focus();}
 function close(){dialog.current?.close();setOpen(false);trigger.current?.focus();}
 function dismiss(){resetDraft();close();}
 function apply(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||admitted.current||!dialog.current?.open)return;
  const range={from:draftFrom,to:draftTo},issue=validateDashboardDateRange(range,timezone);setError(issue);if(issue)return;
  admitted.current=true;close();if(draftPreset==="custom")onRange(range);else onPreset(draftPreset,range);
 }
 function backdrop(event:MouseEvent<HTMLDialogElement>){if(event.target!==event.currentTarget)return;const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dismiss();}
 return <div className="dashboard-date-control">
  <button ref={trigger} type="button" className="dashboard-date-trigger" aria-label="Choose dashboard date range" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-popup`} aria-disabled={busy} onClick={show}>Date range <span>{from} – {to}</span><span aria-hidden="true">⌄</span>{busy?<span>Updating…</span>:null}</button>
  <dialog ref={dialog} id={`${id}-popup`} className="dashboard-date-popup" aria-labelledby={`${id}-title`} aria-modal="true" onCancel={event=>{event.preventDefault();dismiss();}} onClick={backdrop} onClose={()=>{setOpen(false);trigger.current?.focus();}}>
   <form className="dashboard-date-filter" aria-label="Dashboard date range" onSubmit={apply} noValidate>
    <header><h3 id={`${id}-title`}>Dashboard date range</h3><p>Select dates, then apply. Your current chart stays unchanged until you apply.</p></header>
    <fieldset disabled={busy}><legend>Filter date range</legend>
     <div className="dashboard-date-shortcuts">{presets.map(([key,label])=><button key={key} type="button" aria-pressed={draftPreset===key} onClick={()=>{if(busy)return;const range=dashboardDateShortcut(key,timezone);setFrom(range.from);setTo(range.to);setDraftPreset(key);setError(null);}}>{label}</button>)}</div>
     <div className="dashboard-date-fields"><label htmlFor={`${id}-from`}>From<input ref={first} id={`${id}-from`} type="date" value={draftFrom} max={today} onChange={event=>{setFrom(event.target.value);setDraftPreset("custom");setError(null);}} aria-invalid={Boolean(error)} aria-describedby={`${id}-help${error?` ${id}-error`:""}`} /></label>
     <label htmlFor={`${id}-to`}>To<input id={`${id}-to`} type="date" value={draftTo} max={today} onChange={event=>{setTo(event.target.value);setDraftPreset("custom");setError(null);}} aria-invalid={Boolean(error)} aria-describedby={`${id}-help${error?` ${id}-error`:""}`} /></label></div>
    </fieldset>
    <p id={`${id}-help`}>Both dates included · {timezone} · Weeks begin Monday. Applies to trends, period financials and economics; current-status cards remain current.</p>
    {error?<p id={`${id}-error`} role="alert">{error}</p>:null}
    <footer><button type="button" className="dashboard-date-cancel" onClick={dismiss}>Cancel</button><button className="dashboard-date-apply" type="submit" disabled={busy}>Apply range</button></footer>
   </form>
  </dialog>
 </div>;
}
