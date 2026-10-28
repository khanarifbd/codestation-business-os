import type { AccountLedgerBrowse } from "@/components/accounting-accounts/account-model";
export const ACCOUNTS_PATH = "/dashboard/accounting/accounts";
export function accountListHref(focus = "") {
    const p = new URLSearchParams();
    if (focus)
        p.set("focus", focus.slice(0, 200));
    return `${ACCOUNTS_PATH}${p.size ? `?${p}` : ""}`;
}
export function safeAccountListReturn(raw?: string | null) {
    if (!raw || raw !== ACCOUNTS_PATH && !raw.startsWith(`${ACCOUNTS_PATH}?`))
        return ACCOUNTS_PATH;
    return accountListHref(new URLSearchParams(raw.split("?")[1]).get("focus") ?? "");
}
export function accountLedgerState(raw: string | URLSearchParams): AccountLedgerBrowse {
    const p = new URLSearchParams(raw);
    let cursor = p.get("cursor") ?? "";
    if (cursor.length >= 4096) cursor = "";
    let page = Number(p.get("page"));
    if (!Number.isSafeInteger(page) || page < 2) page = cursor ? 2 : 1;
    // Keep old shared links on their current page; new links never serialize the stack.
    let cursors: string[] = [];
    try {
        const value: unknown = JSON.parse(p.get("cursors") ?? "[]");
        if (Array.isArray(value))
            cursors = value.filter((cursor): cursor is string => typeof cursor === "string" && cursor.length > 0 && cursor.length < 4096);
    }
    catch {
    }
    if (!p.has("cursor") && cursors.length) { cursor = cursors.at(-1)!; page = cursors.length + 1; }
    if (!cursor) page = 1;
    const direction = p.get("direction");
    const date = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(p.get(key) ?? "") ? p.get(key)! : "";
    return {
        search: (p.get("search") ?? "").slice(0, 500), direction: direction === "credit" || direction === "debit" ? direction : "all", source_type: (p.get("source_type") ?? "").slice(0, 80), date_from: date("date_from"), date_to: date("date_to"), size: [20, 50, 100].includes(Number(p.get("size"))) ? Number(p.get("size")) : 20, cursor, page
    };
}
export function accountViewHref(id: string, returnTo?: string | null, browse: Partial<AccountLedgerBrowse> = {}) {
    const p = new URLSearchParams();
    if (browse.search)
        p.set("search", browse.search);
    if (browse.direction && browse.direction !== "all")
        p.set("direction", browse.direction);
    for (const key of ["source_type", "date_from", "date_to"] as const)
        if (browse[key])
            p.set(key, browse[key]);
    if (browse.size && browse.size !== 20)
        p.set("size", String(browse.size));
    if (browse.cursor) {
        p.set("cursor", browse.cursor);
        p.set("page", String(browse.page ?? 2));
    }
    p.set("returnTo", safeAccountListReturn(returnTo));
    return `${ACCOUNTS_PATH}/${encodeURIComponent(id)}?${p}`;
}
export function safeAccountViewReturn(raw: string | null, id: string) {
    const path = `${ACCOUNTS_PATH}/${encodeURIComponent(id)}`;
    if (!raw || raw !== path && !raw.startsWith(`${path}?`))
        return accountViewHref(id);
    const p = new URLSearchParams(raw.split("?")[1]);
    return accountViewHref(id, p.get("returnTo"), accountLedgerState(p));
}
export function accountCreateHref(returnTo?: string | null) {
    return `${ACCOUNTS_PATH}/new?${new URLSearchParams({ returnTo: safeAccountListReturn(returnTo) })}`;
}
export function accountEditHref(id: string, returnTo: string) {
    return `${ACCOUNTS_PATH}/${encodeURIComponent(id)}/edit?${new URLSearchParams({ returnTo: safeAccountViewReturn(returnTo, id) })}`;
}
export function accountLedgerApi(id: string, browse: AccountLedgerBrowse) {
    const p = new URLSearchParams({ limit: String(browse.size) });
    const cursor = browse.cursor;
    if (cursor)
        p.set("cursor", cursor);
    if (browse.search.trim())
        p.set("search", browse.search.trim());
    if (browse.direction !== "all")
        p.set("direction", browse.direction);
    for (const key of ["source_type", "date_from", "date_to"] as const)
        if (browse[key])
            p.set(key, browse[key]);
    return `/api/finance/accounts/${encodeURIComponent(id)}/ledger-page?${p}`;
}
