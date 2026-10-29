import type { Modal, Tab } from "@/components/inventory/inventory-model";

export const INVENTORY_PATH = "/dashboard/inventory";
export const INVENTORY_TABS: Tab[] = ["overview", "items", "service_sales", "suppliers", "warehouses", "purchases", "stock", "movements", "categories"];
export type InventorySection = "items" | "suppliers" | "warehouses" | "categories" | "purchases" | "adjustments" | "transfers";
export type InventoryRoute = { mode: "list" | "view" | "create" | "edit" | "invalid"; section?: InventorySection; id?: string; modal: Modal };
export type InventoryBrowse = { tab?: Tab; search?: string; itemFilter?: string; lowStockOnly?: boolean; focus?: string };
const sections: InventorySection[] = ["items", "suppliers", "warehouses", "categories", "purchases", "adjustments", "transfers"];
const editors: Record<InventorySection, Modal> = { items: "item", suppliers: "supplier", warehouses: "warehouse", categories: "categories", purchases: "purchase", adjustments: "adjustment", transfers: "transfer" };

export function inventoryBrowseHref(value: InventoryBrowse = {}) {
  const query = new URLSearchParams();
  if (value.tab && INVENTORY_TABS.includes(value.tab) && value.tab !== "overview") query.set("tab", value.tab);
  if (value.search) query.set("search", value.search.slice(0, 500));
  if (value.itemFilter && ["stock_item", "non_stock_item", "service"].includes(value.itemFilter)) query.set("type", value.itemFilter);
  if (value.lowStockOnly) query.set("low", "1");
  if (value.focus) query.set("focus", value.focus.slice(0, 200));
  return `${INVENTORY_PATH}${query.size ? `?${query}` : ""}`;
}
export function inventoryBrowseState(search: string | URLSearchParams): Required<InventoryBrowse> {
  const params = new URLSearchParams(search);
  const tab = params.get("tab") as Tab;
  const type = params.get("type") || "all";
  return { tab: INVENTORY_TABS.includes(tab) ? tab : "overview", search: (params.get("search") || "").slice(0, 500), itemFilter: ["stock_item", "non_stock_item", "service"].includes(type) ? type : "all", lowStockOnly: params.get("low") === "1", focus: (params.get("focus") || "").slice(0, 200) };
}
export function safeInventoryReturnHref(raw: string | null | undefined) {
  if (!raw || raw !== INVENTORY_PATH && !raw.startsWith(`${INVENTORY_PATH}?`)) return INVENTORY_PATH;
  return inventoryBrowseHref(inventoryBrowseState(raw.split("?")[1] || ""));
}
export function inventoryReturnHref(search: string | URLSearchParams) {
  return safeInventoryReturnHref(new URLSearchParams(search).get("returnTo"));
}
export function inventoryDocumentHref(section: InventorySection, id: string | null, mode: "view" | "edit" | "create", returnTo?: string, itemType?: string) {
  const suffix = mode === "create" ? "new" : `${encodeURIComponent(id || "")}${mode === "edit" ? "/edit" : ""}`;
  const query = new URLSearchParams({ returnTo: safeInventoryReturnHref(returnTo) });
  if (section === "items" && mode === "create" && ["stock_item", "non_stock_item", "service"].includes(itemType || "")) query.set("itemType", itemType!);
  return `${INVENTORY_PATH}/${section}/${suffix}?${query}`;
}
export function parseInventoryRoute(pathname: string): InventoryRoute {
  if (pathname === INVENTORY_PATH || pathname === `${INVENTORY_PATH}/`) return { mode: "list", modal: null };
  if (!pathname.startsWith(`${INVENTORY_PATH}/`)) return { mode: "invalid", modal: null };
  let parts: string[];
  try { parts = pathname.slice(INVENTORY_PATH.length + 1).split("/").map(decodeURIComponent); } catch { return { mode: "invalid", modal: null }; }
  const section = parts[0] as InventorySection;
  if (!sections.includes(section)) return { mode: "invalid", modal: null };
  if (parts.length === 1 && !["adjustments", "transfers"].includes(section)) return { mode: "list", section, modal: null };
  if (parts.length === 2 && parts[1] === "new") return { mode: "create", section, modal: editors[section] };
  if (parts.length === 3 && parts[1] && parts[2] === "edit" && ["items", "suppliers", "warehouses", "categories"].includes(section)) return { mode: "edit", section, id: parts[1], modal: editors[section] };
  if (parts.length === 2 && parts[1] && ["items", "suppliers", "warehouses", "purchases"].includes(section)) return { mode: "view", section, id: parts[1], modal: null };
  return { mode: "invalid", modal: null };
}
