/** Internal quotation routes only. Never forward an untrusted return URL to the router. */
export const QUOTATION_LIST_PATH = "/dashboard/quotations";
export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "rejected", "cancelled"] as const;

export function safeQuotationReturnHref(raw: string | null | undefined) {
  if (!raw || !raw.startsWith(`${QUOTATION_LIST_PATH}?`) && raw !== QUOTATION_LIST_PATH) return QUOTATION_LIST_PATH;
  const params = new URLSearchParams(raw.split("?")[1] || "");
  const clean = new URLSearchParams();
  const search = params.get("search")?.trim();
  const status = params.get("status");
  const pages = Math.min(100, Math.max(1, Number.parseInt(params.get("pages") || "1", 10) || 1));
  if (search) clean.set("search", search.slice(0, 500));
  if (status && QUOTATION_STATUSES.some(value => value === status)) clean.set("status", status);
  if (pages > 1) clean.set("pages", String(pages));
  const focus = params.get("focus");
  if (focus) clean.set("focus", focus.slice(0, 200));
  return `${QUOTATION_LIST_PATH}${clean.size ? `?${clean}` : ""}`;
}

export function quotationReturnHref(search: string | URLSearchParams) {
  return safeQuotationReturnHref(new URLSearchParams(search).get("returnTo"));
}

export function quotationDocumentHref(id: string | number, mode: "view" | "edit" = "view", returnTo?: string) {
  const path = `${QUOTATION_LIST_PATH}/${encodeURIComponent(String(id))}${mode === "edit" ? "/edit" : ""}`;
  return `${path}?${new URLSearchParams({ returnTo: safeQuotationReturnHref(returnTo) })}`;
}

export function quotationCreateHref(returnTo?: string) {
  return `${QUOTATION_LIST_PATH}/new?${new URLSearchParams({ returnTo: safeQuotationReturnHref(returnTo) })}`;
}
