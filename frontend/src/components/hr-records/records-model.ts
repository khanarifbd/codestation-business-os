import { dateOnly, record, timeId, validCursor } from "@/components/hr-time/hr-time-model";
export type RecordsKind = "documents" | "history";
export type DocumentRow = { id: string; employee_id: string; employee_name: string | null; title: string; document_type: string; reference_number?: string | null; issued_on?: string | null; expires_on?: string | null; file_url?: string | null; notes?: string | null };
export type LifecycleRow = { id: string; employee_id: string; employee_name: string | null; event_type: string; effective_date: string; title: string; details: Record<string, unknown>; notes?: string | null };
export type RecordsRow = DocumentRow | LifecycleRow;
export type RecordsPage = { items: RecordsRow[]; next_cursor: string | null };
const nullable = (v: unknown) => v === null || v === undefined || typeof v === "string";
const optionalDate = (v: unknown) => v === null || v === undefined || dateOnly(v);
export const DOCUMENT_TYPES = ["contract", "identity", "passport", "visa", "certificate", "license", "other"] as const;
export const EVENT_TYPES = ["joining", "confirmation", "promotion", "transfer", "role_change", "compensation_change", "resignation", "termination", "note"] as const;
export function isDocument(v: unknown): v is DocumentRow { return record(v) && timeId(v.id) && timeId(v.employee_id) && nullable(v.employee_name) && typeof v.title === "string" && typeof v.document_type === "string" && nullable(v.reference_number) && optionalDate(v.issued_on) && optionalDate(v.expires_on) && nullable(v.file_url) && nullable(v.notes); }
export function isLifecycle(v: unknown): v is LifecycleRow { return record(v) && timeId(v.id) && timeId(v.employee_id) && nullable(v.employee_name) && typeof v.title === "string" && typeof v.event_type === "string" && dateOnly(v.effective_date) && record(v.details) && nullable(v.notes); }
export function recordsPageValidator(kind: RecordsKind, id = "") { return (v: unknown): v is RecordsPage => record(v) && Array.isArray(v.items) && v.items.length <= (id ? 1 : 100) && v.items.every(kind === "documents" ? isDocument : isLifecycle) && new Set(v.items.map(x => x.id)).size === v.items.length && (v.next_cursor === null || !id && validCursor(v.next_cursor)) && (!id || v.items.every(x => x.id === id)); }
export function recordText(row: RecordsRow) { return [row.employee_name, row.employee_id, row.title, "document_type" in row ? `${row.document_type} ${row.reference_number ?? ""}` : `${row.event_type} ${row.effective_date}`].join(" "); }
/** Never trust a server-supplied URL as an arbitrary browser destination. */
export function documentFileHref(row: DocumentRow) { return row.file_url && timeId(row.id) && encodeURIComponent(row.id) === row.id && row.file_url === `/api/hr-documents/${row.id}/file` ? row.file_url : null; }
