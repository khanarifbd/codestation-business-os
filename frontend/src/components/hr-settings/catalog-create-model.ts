import { dateOnly } from "@/components/hr-time/hr-time-model";
import { isHoliday, isLeaveType, isShift } from "./settings-model";
export const CATALOG_KINDS = ["leave", "shift", "holiday"] as const;
export type CatalogKind = typeof CATALOG_KINDS[number];
export type CatalogIntent = Readonly<
  { kind: "leave"; payload: Readonly<{ name: string; code: string; annual_allowance_days: string; is_paid: boolean; requires_approval: boolean }> } |
  { kind: "shift"; payload: Readonly<{ name: string; start_time: string; end_time: string; break_minutes: number; grace_minutes: number; weekly_off_days: readonly number[] }> } |
  { kind: "holiday"; payload: Readonly<{ name: string; holiday_date: string; is_paid: boolean; notes: string | null }> }
>;
export type CatalogReceipt = { id: string; name: string };
export const catalogLabels = { leave: "leave type", shift: "work schedule", holiday: "holiday" };
export const catalogEndpoints = { leave: "/api/hr/leave-types", shift: "/api/hr/shifts", holiday: "/api/hr/holidays" };
export const catalogViews = { leave: "leave", shift: "shifts", holiday: "holidays" } as const;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const invalid = (v: string) => /[\u0000\uD800-\uDFFF]/u.test(v);
const text = (f: FormData, key: string) => { const v = f.get(key); return typeof v === "string" && !invalid(v) ? v.trim() : null; };
const cents = (v: unknown) => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v);
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(s)) return null;
  const [a,b=""] = s.split(".");return Number(a) * 100 + Number(b.padEnd(2,"0"));
};
const minutes = (v: string | null) => v !== null && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) <= 2147483647 ? Number(v) : null;
export function catalogIntent(kind: CatalogKind, f: FormData): CatalogIntent | null {
  const name = text(f,"name"); if (!name || name.length > (kind === "holiday" ? 160 : 120)) return null;
  if (kind === "leave") {
    const code = text(f,"code")?.toUpperCase(), allowance = text(f,"allowance");
    if (!code || code.length > 24 || cents(allowance) === null) return null;
    return Object.freeze({kind,payload:Object.freeze({name,code,annual_allowance_days:allowance!,is_paid:f.get("is_paid")==="on",requires_approval:f.get("requires_approval")==="on"})});
  }
  if (kind === "shift") {
    const start = text(f,"start_time"), end = text(f,"end_time"), pause = minutes(text(f,"break_minutes")), grace = minutes(text(f,"grace_minutes"));
    const days = f.getAll("weekly_off_days");
    if (!start || !end || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) || pause === null || grace === null || days.some(x=>typeof x!=="string" || !/^[0-6]$/.test(x)) || new Set(days).size!==days.length) return null;
    return Object.freeze({kind,payload:Object.freeze({name,start_time:start,end_time:end,break_minutes:pause,grace_minutes:grace,weekly_off_days:Object.freeze(days.map(Number))})});
  }
  const date = text(f,"holiday_date"), notes = text(f,"notes");
  if (!dateOnly(date) || date.startsWith("0000-") || notes === null) return null;
  return Object.freeze({kind,payload:Object.freeze({name,holiday_date:date,is_paid:f.get("is_paid")==="on",notes:notes || null})});
}
/** Exact endpoint status is checked by controller; receipt must match every reviewed effect. */
export function catalogReceipt(intent: CatalogIntent, body: unknown): CatalogReceipt | null {
  const p = intent.payload;
  if (intent.kind === "leave") {
    const x=intent.payload;
    if (!isLeaveType(body) || !body.is_active || body.name!==x.name || body.code!==x.code || cents(body.annual_allowance_days)===null || cents(body.annual_allowance_days)!==cents(x.annual_allowance_days) || body.is_paid!==x.is_paid || body.requires_approval!==x.requires_approval) return null;
  } else if (intent.kind === "shift") {
    const x=intent.payload;
    if (!isShift(body) || !body.is_active || body.name!==x.name || ![x.start_time,x.start_time+":00"].includes(body.start_time) || ![x.end_time,x.end_time+":00"].includes(body.end_time) || body.break_minutes!==x.break_minutes || body.grace_minutes!==x.grace_minutes || JSON.stringify(body.weekly_off_days)!==JSON.stringify(x.weekly_off_days)) return null;
  } else {
    const x=intent.payload;
    if (!isHoliday(body) || body.name!==x.name || body.holiday_date!==x.holiday_date || body.is_paid!==x.is_paid || body.notes!==x.notes) return null;
  }
  const value=body as {id:string};
  return !invalid(value.id) && value.id!=="new" && encodeURIComponent(value.id)===value.id ? {id:value.id,name:p.name} : null;
}
export function catalogReview(intent: CatalogIntent): [string,string][] {
  const p=intent.payload, rows: [string,string][]=[["Name",p.name]];
  if (intent.kind === "leave") { const x=intent.payload; rows.push(["Code",x.code],["Annual allowance",`${x.annual_allowance_days} day(s)`],["Paid",x.is_paid?"Yes":"No"],["Approval required",x.requires_approval?"Yes":"No"]); }
  else if (intent.kind === "shift") { const x=intent.payload; rows.push(["Hours",`${x.start_time} → ${x.end_time}`],["Break",`${x.break_minutes} minutes`],["Grace",`${x.grace_minutes} minutes`],["Weekly days off",x.weekly_off_days.map(i=>WEEKDAYS[i]).join(", ") || "None selected"]); }
  else { const x=intent.payload; rows.push(["Date",x.holiday_date],["Paid",x.is_paid?"Yes":"No"],["Notes",x.notes || "No notes"]); }
  return rows;
}
