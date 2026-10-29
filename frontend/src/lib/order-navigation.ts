/** Only the existing order register is accepted as a document return destination. */
export const ORDER_LIST_PATH = "/dashboard/orders";
export const ORDER_STATUSES = ["confirmed", "in_progress", "completed", "cancelled"] as const;

export function safeOrderReturnHref(raw: string | null | undefined) {
  if (!raw || !raw.startsWith(`${ORDER_LIST_PATH}?`) && raw !== ORDER_LIST_PATH) return ORDER_LIST_PATH;
  const params = new URLSearchParams(raw.split("?")[1] || "");
  const clean = new URLSearchParams();
  const search = params.get("search")?.trim();
  const status = params.get("status");
  const requestedPages = Number.parseInt(params.get("pages") || "1", 10);
  const pages = Number.isSafeInteger(requestedPages) && requestedPages > 0 ? requestedPages : 1;
  if (search) clean.set("search", search.slice(0, 500));
  if (status && ORDER_STATUSES.some(value => value === status)) clean.set("status", status);
  if (pages > 1) clean.set("pages", String(pages));
  const focus = params.get("focus");
  if (focus) clean.set("focus", focus.slice(0, 200));
  return `${ORDER_LIST_PATH}${clean.size ? `?${clean}` : ""}`;
}

export function orderReturnHref(search: string | URLSearchParams) {
  return safeOrderReturnHref(new URLSearchParams(search).get("returnTo"));
}

export function orderDocumentHref(id: string | number, mode: "view" | "edit" | "commercial" | "settlement" = "view", returnTo?: string) {
  const path = `${ORDER_LIST_PATH}/${encodeURIComponent(String(id))}${mode === "view" ? "" : `/${mode}`}`;
  return `${path}?${new URLSearchParams({ returnTo: safeOrderReturnHref(returnTo) })}`;
}

export function orderCreateHref(returnTo?: string) {
  return `${ORDER_LIST_PATH}/new?${new URLSearchParams({ returnTo: safeOrderReturnHref(returnTo) })}`;
}
