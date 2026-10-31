"use client";
import { useId, useState, type FormEvent } from "react";
import { dashboardDateShortcut, validateDashboardDateRange, type DashboardDatePreset, type DashboardDateRange } from "@/lib/dashboard-date-range";
import "./dashboard-date-filter.css";
export type DashboardDateFilterProps = DashboardDateRange & {
 timezone: string; preset: DashboardDatePreset; busy: boolean;
 onRange: (range: DashboardDateRange) => void;
 onPreset: (preset: Exclude<DashboardDatePreset,"custom">) => void;
};
const presets = [["today","Today"],["week","This week (Mon–today)"],["month","This month"],["last_month","Last month"],["quarter","This quarter"],["year","This year"]] as const;
export function DashboardDateFilter({from,to,timezone,preset,busy,onRange,onPreset}:DashboardDateFilterProps) {
 const id=useId(),[draftFrom,setFrom]=useState(from),[draftTo,setTo]=useState(to),[error,setError]=useState<string|null>(null);
 const today=dashboardDateShortcut("today",timezone).to;
 function apply(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;const range={from:draftFrom,to:draftTo};const issue=validateDashboardDateRange(range,timezone);setError(issue);if(!issue)onRange(range);}
 return <form className="dashboard-date-filter" aria-label="Dashboard date range" onSubmit={apply} noValidate>
  <fieldset disabled={busy}><legend>Filter date range</legend>
   <div className="dashboard-date-shortcuts">{presets.map(([key,label])=><button key={key} type="button" aria-pressed={preset===key} onClick={()=>{const range=dashboardDateShortcut(key,timezone);setFrom(range.from);setTo(range.to);setError(null);onPreset(key);}}>{label}</button>)}</div>
   <div className="dashboard-date-fields"><label htmlFor={`${id}-from`}>From<input id={`${id}-from`} type="date" value={draftFrom} max={today} onChange={event=>{setFrom(event.target.value);setError(null);}} aria-invalid={Boolean(error)} aria-describedby={`${id}-help${error?` ${id}-error`:""}`} /></label>
   <label htmlFor={`${id}-to`}>To<input id={`${id}-to`} type="date" value={draftTo} max={today} onChange={event=>{setTo(event.target.value);setError(null);}} aria-invalid={Boolean(error)} aria-describedby={`${id}-help${error?` ${id}-error`:""}`} /></label>
   <button className="dashboard-date-apply" type="submit">{busy?"Updating…":"Apply range"}</button></div>
  </fieldset>
  <p id={`${id}-help`}>Both dates are included · {timezone} · Weeks begin Monday. Applies to trends, period financials and economics; current-status cards remain current.</p>
  {error?<p id={`${id}-error`} role="alert">{error}</p>:null}
 </form>;
}
