export type Tab = "overview" | "items" | "service_sales" | "suppliers" | "warehouses" | "purchases" | "stock" | "movements" | "categories";
export type Overview = {
  base_currency: string;
  stock_products: number;
  service_items: number;
  inventory_values: { currency: string; value: string }[];
  low_stock_count: number;
  out_of_stock_count: number;
  active_suppliers: number;
  active_warehouses: number;
  low_stock: { id: string; sku: string; name: string; on_hand: string; reorder_level: string; unit: string }[];
};
export type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  item_type: string;
  category_id: string | null;
  category_name?: string | null;
  unit: string;
  currency: string;
  selling_price: string;
  standard_cost: string;
  last_purchase_cost: string;
  reorder_level: string;
  tax_code_id: string | null;
  track_inventory: boolean;
  allow_negative_stock: boolean;
  is_active: boolean;
  on_hand: string;
  inventory_value: string;
  service_duration_months: number | null;
};
export type Warehouse = { id: string; code: string; name: string; address: string | null; is_default: boolean; is_active: boolean };
export type Category = { id: string; name: string; description: string | null; is_active: boolean };
export type Supplier = {
  id: string;
  vendor_code: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  tax_identifier: string | null;
  country_code: string | null;
  currency: string | null;
  notes: string | null;
  is_active: boolean;
  purchase_count: number;
  purchased_total: string;
  outstanding_total: string;
};
export type TaxCode = { id: string; code: string; name: string; tax_kind: string; rate: string };
export type Stock = {
  product_id: string;
  sku: string;
  product_name: string;
  warehouse_id: string;
  warehouse_name: string;
  on_hand: string;
  average_unit_cost: string;
  inventory_value: string;
  currency: string;
  reorder_level: string;
};
export type Purchase = {
  id: string;
  receipt_number: string;
  supplier_name: string;
  warehouse_id: string;
  warehouse_name: string;
  receipt_date: string;
  currency: string;
  subtotal: string;
  tax_total: string;
  total: string;
  balance_due: string;
  status: string;
  reference: string | null;
};
export type Movement = {
  id: string;
  product_id?: string;
  movement_date: string;
  movement_type: string;
  sku: string;
  product_name: string;
  warehouse_name: string;
  quantity: string;
  unit_cost: string;
  total_cost: string;
  quantity_after: string;
  reference: string | null;
  reason: string | null;
};
export type Modal = "item" | "supplier" | "warehouse" | "categories" | "purchase" | "adjustment" | "transfer" | null;
export type PurchaseLine = { product_id: string; quantity: string; unit_cost: string; tax_code_id: string };

export type ItemForm = ReturnType<typeof emptyItem>;
export type SupplierForm = ReturnType<typeof emptySupplier>;
export type WarehouseForm = ReturnType<typeof emptyWarehouse>;

export const today = () => new Date().toISOString().slice(0, 10);
export const money = (value: string | number, currency = "") => `${currency ? `${currency} ` : ""}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const emptyItem = (currency = "BDT") => ({ sku: "", barcode: "", name: "", description: "", item_type: "stock_item", category_id: "", unit: "unit", currency, selling_price: "0", standard_cost: "0", reorder_level: "0", tax_code_id: "", track_inventory: true, allow_negative_stock: false, is_active: true, service_duration_months: "" });
export const emptySupplier = (currency = "BDT") => ({ name: "", contact_name: "", email: "", phone: "", website: "", tax_identifier: "", country_code: "BD", currency, notes: "", is_active: true });
export const emptyWarehouse = () => ({ code: "", name: "", address: "", is_default: false, is_active: true });

export function labelType(value: string) { return value === "stock_item" ? "Stock product" : value === "service" ? "Service" : "Non-stock product"; }
export function serviceDurationLabel(months: number | null) { return months == null ? "One-time" : `${months} month${months === 1 ? "" : "s"}`; }
export function modalTitle(modal: Modal, id: string | null) { if (modal === "item") return id ? "Edit product / service" : "Add product / service"; if (modal === "supplier") return id ? "Edit supplier" : "Add supplier"; if (modal === "warehouse") return id ? "Edit warehouse" : "Add warehouse"; if (modal === "categories") return "Manage categories"; if (modal === "purchase") return "Receive purchase"; if (modal === "transfer") return "Transfer stock"; return "Adjust stock"; }
