import { dateOnly, timeId, validCursor } from "@/components/hr-time/hr-time-model";
import { DOCUMENT_TYPES, EVENT_TYPES, type RecordsKind } from "@/components/hr-records/records-model";
export const HR_RECORDS = "/dashboard/hr/records";
export const HR_EVENT_CREATE = `${HR_RECORDS}/history/new`;
export function recordsEventCreateHref(back: string) { return `${HR_EVENT_CREATE}?${new URLSearchParams({returnTo:safeRecordsReturn(back)})}`; }
export type RecordsBrowse = { view: RecordsKind; type: string; employee: string; from: string; to: string; search: string; cursor: string; size: number };
export function recordsBrowse(raw: string | URLSearchParams): RecordsBrowse {
  const q = new URLSearchParams(raw), one = (k: string) => q.getAll(k).length <= 1 ? q.get(k) ?? "" : "";
  const view = one("view") === "history" ? "history" : "documents", types: readonly string[] = view === "history" ? EVENT_TYPES : DOCUMENT_TYPES;
  return { view, type: types.includes(one("type")) ? one("type") : "", employee: timeId(one("employee")) ? one("employee") : "", from: dateOnly(one("from")) ? one("from") : "", to: dateOnly(one("to")) ? one("to") : "", search: one("search").slice(0,300), cursor: validCursor(one("cursor")) ? one("cursor") : "", size: [20,50,100].includes(Number(one("size"))) ? Number(one("size")) : 50 };
}
export function recordsHref(v: Partial<RecordsBrowse> = {}) { const q = new URLSearchParams(); for (const k of ["view","type","employee","from","to","search","cursor"] as const) if (v[k] && !(k === "view" && v.view === "documents")) q.set(k, v[k]!); if (v.size && v.size !== 50) q.set("size",String(v.size)); return HR_RECORDS + (q.size ? `?${q}` : ""); }
export function safeRecordsReturn(raw?: string | null) { return raw && (raw === HR_RECORDS || raw.startsWith(HR_RECORDS+"?")) && !raw.includes("#") ? recordsHref(recordsBrowse(raw.split("?")[1] ?? "")) : HR_RECORDS; }
export function recordsRoute(path: string): { mode: "register" | "document" | "create" | "unavailable"; kind: RecordsKind; id: string } {
  if (path === HR_EVENT_CREATE) return { mode:"create",kind:"history",id:"" };
  if (path === HR_RECORDS) return { mode:"register",kind:"documents",id:"" };
  const parts = path.startsWith(HR_RECORDS+"/") ? path.slice(HR_RECORDS.length+1).split("/") : [];
  let id=""; try { id=decodeURIComponent(parts[1] ?? ""); } catch { /* invalid route */ }
  return parts.length === 2 && ["documents","history"].includes(parts[0]) && timeId(id) ? {mode:"document",kind:parts[0] as RecordsKind,id} : {mode:"unavailable",kind:"documents",id:""};
}
export function recordsDocumentHref(kind: RecordsKind, id: string, back: string) { return `${HR_RECORDS}/${kind}/${encodeURIComponent(id)}?${new URLSearchParams({returnTo:safeRecordsReturn(back)})}`; }
export function recordsApi(b: RecordsBrowse, id="") { const q=new URLSearchParams({mode:"page",limit:String(b.size)}); if(id) q.set("record_id",id); else for(const [k,v] of [["employee_id",b.employee],[b.view === "documents" ? "document_type":"event_type",b.type],["date_from",b.from],["date_to",b.to],["cursor",b.cursor]]) if(v) q.set(k,v); return `/api/hr/${b.view === "documents" ? "documents":"lifecycle"}?${q}`; }
// Only observed cursor edges, scoped by owner and server filters. Reload may lose Previous.
const edges=new Map<string,string>();
const key=(scope:string,b:RecordsBrowse,cursor:string)=>JSON.stringify([scope,b.view,b.type,b.employee,b.from,b.to,b.size,cursor]);
export function rememberRecordsCursor(scope:string,b:RecordsBrowse,next:string) { if(edges.size>=256) edges.clear(); edges.set(key(scope,b,next),b.cursor); }
export function previousRecordsCursor(scope:string,b:RecordsBrowse) { return edges.get(key(scope,b,b.cursor)); }
