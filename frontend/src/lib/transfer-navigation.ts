import type { TransferBrowse } from "@/components/accounting-transfers/transfer-model";
import type { AccountLedgerBrowse } from "@/components/accounting-accounts/account-model";
export const TRANSFERS_PATH = "/dashboard/accounting/transfers";
export const LEGACY_TRANSFERS_PATH = "/dashboard/finance/transfers";
export function transferBrowse(raw: string | URLSearchParams): TransferBrowse {
  const p = new URLSearchParams(raw), cursor = (p.get("cursor") || "").slice(0, 4095), page = Number(p.get("page"));
  return { search: (p.get("search") || "").slice(0, 500), currency: (p.get("currency") || "").slice(0, 3).toUpperCase(), account_id: (p.get("account_id") || "").slice(0, 200), size: [20, 50, 100].includes(Number(p.get("size"))) ? Number(p.get("size")) : 20, cursor, page: cursor ? Number.isSafeInteger(page) && page >= 2 ? page : 2 : 1, focus: (p.get("focus") || "").slice(0, 200) };
}
export function transferListHref(browse: Partial<TransferBrowse> = {}) {
  const p = new URLSearchParams();
  for (const key of ["search", "currency", "account_id", "focus"] as const) if (browse[key]) p.set(key, browse[key]);
  if (browse.size && browse.size !== 20) p.set("size", String(browse.size));
  if (browse.cursor) { p.set("cursor", browse.cursor); p.set("page", String(browse.page ?? 2)); }
  return TRANSFERS_PATH + (p.size ? `?${p}` : "");
}
export function safeTransferReturn(raw?: string | null) {
  if (!raw || ![TRANSFERS_PATH, LEGACY_TRANSFERS_PATH].some(base => raw === base || raw.startsWith(base + "?"))) return TRANSFERS_PATH;
  return transferListHref(transferBrowse(raw.split("?")[1] || ""));
}
export const transferViewHref = (id: string, returnTo?: string | null) => `${TRANSFERS_PATH}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeTransferReturn(returnTo) })}`;
export const transferCreateHref = (returnTo?: string | null) => `${TRANSFERS_PATH}/new?${new URLSearchParams({ returnTo: safeTransferReturn(returnTo) })}`;
export function transferPageApi(browse: TransferBrowse) {
  const p = new URLSearchParams({ limit: String(browse.size) });
  for (const key of ["cursor", "currency", "account_id"] as const) if (browse[key]) p.set(key, browse[key]);
  if (browse.search.trim()) p.set("search", browse.search.trim());
  return `/api/finance/transfer-page?${p}`;
}
/** Reuse the proven cursor-edge store with a distinct transfer-register scope; never a URL stack. */
export function transferCursorBrowse(browse: TransferBrowse): AccountLedgerBrowse {
  return { search: browse.search, direction: "all", source_type: JSON.stringify([browse.currency, browse.account_id]), date_from: "", date_to: "", size: browse.size, cursor: browse.cursor, page: browse.page };
}
