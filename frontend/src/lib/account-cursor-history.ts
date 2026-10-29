import type { AccountLedgerBrowse } from "@/components/accounting-accounts/account-model";

// Never persist search terms, account values or transaction rows. The browser's
// per-tab session store contains only opaque cursor edges; its key hashes scope.
type CursorEdge = { page: number; cursor: string; previous: string };
const memory = new Map<string, CursorEdge>();
export function accountCursorHistoryScope(companyId: string, membershipId: string, accountId: string, browse: AccountLedgerBrowse) {
    return JSON.stringify([companyId, membershipId, accountId, browse.search.trim(), browse.direction, browse.source_type, browse.date_from, browse.date_to, browse.size]);
}
function entryKey(scope: string, page: number, cursor: string) {
    return JSON.stringify([scope, page, cursor]);
}
async function storageKey(key: string) {
    try {
        const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
        return "business-os:account-cursor:v1:" + Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    } catch { return null; }
}
function validEdge(value: unknown, page: number, cursor: string): value is CursorEdge {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const edge = value as Partial<CursorEdge>;
    return edge.page === page && edge.cursor === cursor && typeof edge.previous === "string" && edge.previous.length < 4096 && (page === 2 ? edge.previous === "" : edge.previous.length > 0);
}
export async function readPreviousAccountCursor(scope: string, browse: AccountLedgerBrowse): Promise<string | undefined> {
    if (browse.page <= 1 || !browse.cursor) return undefined;
    const key = entryKey(scope, browse.page, browse.cursor), cached = memory.get(key);
    if (cached) return cached.previous;
    const storage = await storageKey(key);
    if (!storage) return undefined;
    try {
        const raw = window.sessionStorage.getItem(storage);
        const value: unknown = raw ? JSON.parse(raw) : null;
        if (!validEdge(value, browse.page, browse.cursor)) return undefined;
        memory.set(key, value);
        return value.previous;
    } catch { return undefined; }
}
export async function rememberAccountCursorStep(scope: string, current: AccountLedgerBrowse, nextCursor: string) {
    const edge = { page: current.page + 1, cursor: nextCursor, previous: current.cursor };
    const key = entryKey(scope, edge.page, edge.cursor);
    memory.set(key, edge);
    const storage = await storageKey(key);
    if (storage) {
        try { window.sessionStorage.setItem(storage, JSON.stringify(edge)); }
        catch { /* Quota or disabled storage: keep this document's volatile history. */ }
    }
}
