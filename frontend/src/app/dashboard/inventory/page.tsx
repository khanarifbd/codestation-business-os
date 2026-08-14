"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  ClipboardList,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShoppingCart,
  Store,
  Truck,
  Warehouse as WarehouseIcon,
} from "lucide-react";

import { getApiErrorMessage } from "@/lib/api-error";

type Tab = "overview" | "items" | "suppliers" | "warehouses" | "purchases" | "stock" | "movements";
type Overview = {
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
type Product = {
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
};
type Warehouse = { id: string; code: string; name: string; address: string | null; is_default: boolean; is_active: boolean };
type Category = { id: string; name: string; description: string | null; is_active: boolean };
type Supplier = {
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
type TaxCode = { id: string; code: string; name: string; tax_kind: string; rate: string };
type Stock = {
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
type Purchase = {
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
type Movement = {
  id: string;
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
type Modal = "item" | "supplier" | "warehouse" | "categories" | "purchase" | "adjustment" | "transfer" | null;
type PurchaseLine = { product_id: string; quantity: string; unit_cost: string; tax_code_id: string };

type ItemForm = ReturnType<typeof emptyItem>;
type SupplierForm = ReturnType<typeof emptySupplier>;
type WarehouseForm = ReturnType<typeof emptyWarehouse>;

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: string | number, currency = "") => `${currency ? `${currency} ` : ""}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const emptyItem = (currency = "BDT") => ({ sku: "", barcode: "", name: "", description: "", item_type: "stock_item", category_id: "", unit: "unit", currency, selling_price: "0", standard_cost: "0", reorder_level: "0", tax_code_id: "", track_inventory: true, allow_negative_stock: false, is_active: true });
const emptySupplier = (currency = "BDT") => ({ name: "", contact_name: "", email: "", phone: "", website: "", tax_identifier: "", country_code: "BD", currency, notes: "", is_active: true });
const emptyWarehouse = () => ({ code: "", name: "", address: "", is_default: false, is_active: true });

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [itemFilter, setItemFilter] = useState<"all" | "stock_item" | "service" | "non_stock_item">("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState("BDT");
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItem());
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(emptySupplier());
  const [warehouseForm, setWarehouseForm] = useState<WarehouseForm>(emptyWarehouse());
  const [categoryDraft, setCategoryDraft] = useState({ id: "", name: "", description: "" });
  const [adjustForm, setAdjustForm] = useState({ product_id: "", warehouse_id: "", adjustment_date: today(), quantity_delta: "", unit_cost: "", reason: "", reference: "" });
  const [purchaseForm, setPurchaseForm] = useState({ supplier_id: "", warehouse_id: "", receipt_date: today(), currency: "BDT", reference: "", notes: "" });
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([{ product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }]);
  const [transferForm, setTransferForm] = useState({ product_id: "", from_warehouse_id: "", to_warehouse_id: "", transfer_date: today(), quantity: "", reason: "Stock transfer", reference: "" });

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init });
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { detail: "Unexpected server response" }; }
    if (!response.ok) throw new Error(getApiErrorMessage(payload, "Inventory request failed"));
    return payload;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const urls = [
        "/api/inventory/dashboard-summary",
        "/api/inventory/products?include_inactive=true",
        "/api/inventory/warehouses",
        "/api/inventory/categories",
        "/api/inventory/suppliers?include_inactive=true",
        "/api/inventory/stock",
        "/api/inventory/purchases",
        "/api/inventory/movements",
        "/api/accounting/tax/codes",
      ];
      const payload = await Promise.all(urls.map((url) => request(url)));
      setOverview(payload[0]);
      setBaseCurrency(payload[0].base_currency || "BDT");
      setProducts(payload[1]);
      setWarehouses(payload[2]);
      setCategories(payload[3]);
      setSuppliers(payload[4]);
      setStock(payload[5]);
      setPurchases(payload[6]);
      setMovements(payload[7]);
      setTaxCodes(payload[8]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load inventory");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  async function save(url: string, method: "POST" | "PATCH", body: unknown, success: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setModal(null);
      setEditingId(null);
      setMessage(success);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save record");
    } finally {
      setSaving(false);
    }
  }

  const activeStockProducts = useMemo(() => products.filter((product) => product.item_type === "stock_item" && product.track_inventory && product.is_active), [products]);
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.is_active), [suppliers]);
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active), [warehouses]);
  const filteredItems = useMemo(() => products.filter((product) => {
    const query = search.toLowerCase();
    const matches = !query || `${product.sku} ${product.name} ${product.category_name ?? ""}`.toLowerCase().includes(query);
    return matches && (itemFilter === "all" || product.item_type === itemFilter);
  }), [products, search, itemFilter]);
  const filteredSuppliers = useMemo(() => suppliers.filter((supplier) => !search || `${supplier.vendor_code} ${supplier.name} ${supplier.contact_name ?? ""} ${supplier.email ?? ""}`.toLowerCase().includes(search.toLowerCase())), [suppliers, search]);
  const filteredPurchases = useMemo(() => purchases.filter((purchase) => !search || `${purchase.receipt_number} ${purchase.supplier_name} ${purchase.warehouse_name} ${purchase.reference ?? ""}`.toLowerCase().includes(search.toLowerCase())), [purchases, search]);
  const filteredStock = useMemo(() => stock.filter((row) => {
    const matchesSearch = !search || `${row.sku} ${row.product_name} ${row.warehouse_name}`.toLowerCase().includes(search.toLowerCase());
    const matchesLow = !lowStockOnly || Number(row.on_hand) <= Number(row.reorder_level);
    return matchesSearch && matchesLow;
  }), [stock, search, lowStockOnly]);
  const filteredMovements = useMemo(() => movements.filter((movement) => !search || `${movement.sku} ${movement.product_name} ${movement.warehouse_name} ${movement.movement_type} ${movement.reason ?? ""} ${movement.reference ?? ""}`.toLowerCase().includes(search.toLowerCase())), [movements, search]);
  const salesTaxes = taxCodes.filter((tax) => tax.tax_kind === "sales");
  const purchaseTaxes = taxCodes.filter((tax) => tax.tax_kind === "purchase");
  const purchaseProducts = useMemo(() => activeStockProducts.filter((product) => product.currency === purchaseForm.currency), [activeStockProducts, purchaseForm.currency]);
  const transferProducts = useMemo(() => {
    const ids = new Set(stock.filter((row) => row.warehouse_id === transferForm.from_warehouse_id && Number(row.on_hand) > 0).map((row) => row.product_id));
    return activeStockProducts.filter((product) => ids.has(product.id));
  }, [stock, transferForm.from_warehouse_id, activeStockProducts]);
  const transferAvailable = useMemo(() => stock.find((row) => row.warehouse_id === transferForm.from_warehouse_id && row.product_id === transferForm.product_id), [stock, transferForm.from_warehouse_id, transferForm.product_id]);
  const purchaseTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const line of purchaseLines) {
      const base = Number(line.quantity || 0) * Number(line.unit_cost || 0);
      subtotal += base;
      const taxCode = purchaseTaxes.find((item) => item.id === line.tax_code_id);
      if (taxCode) tax += base * Number(taxCode.rate || 0) / 100;
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [purchaseLines, purchaseTaxes]);

  const missingPurchaseSetup = useMemo(() => {
    const missing: string[] = [];
    if (!activeStockProducts.length) missing.push("at least one active stock product");
    if (!activeSuppliers.length) missing.push("an active supplier");
    if (!activeWarehouses.length) missing.push("an active warehouse");
    return missing;
  }, [activeStockProducts, activeSuppliers, activeWarehouses]);

  function openNewItem(type = "stock_item") {
    setEditingId(null);
    setItemForm({ ...emptyItem(baseCurrency), item_type: type, track_inventory: type === "stock_item" });
    setModal("item");
  }

  function openEditItem(product: Product) {
    setEditingId(product.id);
    setItemForm({ sku: product.sku, barcode: product.barcode ?? "", name: product.name, description: product.description ?? "", item_type: product.item_type, category_id: product.category_id ?? "", unit: product.unit, currency: product.currency, selling_price: String(product.selling_price), standard_cost: String(product.standard_cost), reorder_level: String(product.reorder_level), tax_code_id: product.tax_code_id ?? "", track_inventory: product.track_inventory, allow_negative_stock: product.allow_negative_stock, is_active: product.is_active });
    setModal("item");
  }

  function openNewSupplier() {
    setEditingId(null);
    setSupplierForm(emptySupplier(baseCurrency));
    setModal("supplier");
  }

  function openEditSupplier(supplier: Supplier) {
    setEditingId(supplier.id);
    setSupplierForm({ name: supplier.name, contact_name: supplier.contact_name ?? "", email: supplier.email ?? "", phone: supplier.phone ?? "", website: supplier.website ?? "", tax_identifier: supplier.tax_identifier ?? "", country_code: supplier.country_code ?? "", currency: supplier.currency ?? baseCurrency, notes: supplier.notes ?? "", is_active: supplier.is_active });
    setModal("supplier");
  }

  function openNewWarehouse() {
    setEditingId(null);
    setWarehouseForm({ code: "", name: "", address: "", is_default: warehouses.length === 0, is_active: true });
    setModal("warehouse");
  }

  function openEditWarehouse(warehouse: Warehouse) {
    setEditingId(warehouse.id);
    setWarehouseForm({ code: warehouse.code, name: warehouse.name, address: warehouse.address ?? "", is_default: warehouse.is_default, is_active: warehouse.is_active });
    setModal("warehouse");
  }

  function openPurchase() {
    if (missingPurchaseSetup.length) {
      setError(`Before receiving a purchase, add ${missingPurchaseSetup.join(", ")}.`);
      setMessage(null);
      return;
    }
    const supplier = activeSuppliers[0];
    const currency = supplier?.currency || baseCurrency;
    setPurchaseForm({ supplier_id: supplier?.id ?? "", warehouse_id: activeWarehouses.find((warehouse) => warehouse.is_default)?.id ?? activeWarehouses[0]?.id ?? "", receipt_date: today(), currency, reference: "", notes: "" });
    setPurchaseLines([{ product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }]);
    setModal("purchase");
  }

  function openAdjustment() {
    if (!activeStockProducts.length || !activeWarehouses.length) {
      setError("Add an active stock product and warehouse before posting a stock adjustment.");
      return;
    }
    setAdjustForm({ product_id: activeStockProducts[0].id, warehouse_id: activeWarehouses.find((warehouse) => warehouse.is_default)?.id ?? activeWarehouses[0].id, adjustment_date: today(), quantity_delta: "", unit_cost: "", reason: "", reference: "" });
    setModal("adjustment");
  }

  function openTransfer() {
    if (activeWarehouses.length < 2) {
      setError("Add at least two active warehouses before transferring stock.");
      return;
    }
    const sourceRow = stock.find((row) => Number(row.on_hand) > 0);
    if (!sourceRow) {
      setError("There is no available stock to transfer yet.");
      return;
    }
    const destination = activeWarehouses.find((warehouse) => warehouse.id !== sourceRow.warehouse_id);
    if (!destination) {
      setError("A second active warehouse is required for stock transfer.");
      return;
    }
    setTransferForm({ product_id: sourceRow.product_id, from_warehouse_id: sourceRow.warehouse_id, to_warehouse_id: destination.id, transfer_date: today(), quantity: "", reason: "Stock transfer", reference: "" });
    setModal("transfer");
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault();
    const body = { ...itemForm, barcode: itemForm.barcode || null, description: itemForm.description || null, category_id: itemForm.category_id || null, tax_code_id: itemForm.tax_code_id || null, selling_price: Number(itemForm.selling_price), standard_cost: Number(itemForm.standard_cost), reorder_level: Number(itemForm.reorder_level), track_inventory: itemForm.item_type === "stock_item" ? itemForm.track_inventory : false };
    await save(editingId ? `/api/inventory/products/${editingId}` : "/api/inventory/products", editingId ? "PATCH" : "POST", body, editingId ? "Item updated." : "Item added to catalog.");
  }

  async function submitSupplier(event: FormEvent) {
    event.preventDefault();
    const body = { ...supplierForm, contact_name: supplierForm.contact_name || null, email: supplierForm.email || null, phone: supplierForm.phone || null, website: supplierForm.website || null, tax_identifier: supplierForm.tax_identifier || null, country_code: supplierForm.country_code || null, currency: supplierForm.currency || null, notes: supplierForm.notes || null };
    await save(editingId ? `/api/inventory/suppliers/${editingId}` : "/api/inventory/suppliers", editingId ? "PATCH" : "POST", body, editingId ? "Supplier updated." : "Supplier added.");
  }

  async function submitWarehouse(event: FormEvent) {
    event.preventDefault();
    await save(editingId ? `/api/inventory/warehouses/${editingId}` : "/api/inventory/warehouses", editingId ? "PATCH" : "POST", { ...warehouseForm, address: warehouseForm.address || null }, editingId ? "Warehouse updated." : "Warehouse added.");
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    await save(categoryDraft.id ? `/api/inventory/categories/${categoryDraft.id}` : "/api/inventory/categories", categoryDraft.id ? "PATCH" : "POST", { name: categoryDraft.name, description: categoryDraft.description || null }, categoryDraft.id ? "Category updated." : "Category added.");
    setModal("categories");
    setCategoryDraft({ id: "", name: "", description: "" });
  }

  async function toggleCategory(category: Category) {
    await save(`/api/inventory/categories/${category.id}`, "PATCH", { is_active: !category.is_active }, `Category ${category.is_active ? "disabled" : "enabled"}.`);
    setModal("categories");
  }

  async function toggleSupplier(supplier: Supplier) {
    await save(`/api/inventory/suppliers/${supplier.id}`, "PATCH", { is_active: !supplier.is_active }, `Supplier ${supplier.is_active ? "disabled" : "enabled"}.`);
    setTab("suppliers");
  }

  async function toggleItem(product: Product) {
    await save(`/api/inventory/products/${product.id}`, "PATCH", { is_active: !product.is_active }, `Item ${product.is_active ? "disabled" : "enabled"}.`);
    setTab("items");
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault();
    await save("/api/inventory/adjustments", "POST", { ...adjustForm, quantity_delta: Number(adjustForm.quantity_delta), unit_cost: adjustForm.unit_cost ? Number(adjustForm.unit_cost) : null, reference: adjustForm.reference || null }, "Stock adjustment posted.");
  }

  async function submitPurchase(event: FormEvent) {
    event.preventDefault();
    const supplier = suppliers.find((item) => item.id === purchaseForm.supplier_id);
    if (!supplier) { setError("Choose a supplier first."); return; }
    const lines = purchaseLines.filter((line) => line.product_id).map((line) => ({ product_id: line.product_id, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost), tax_code_id: line.tax_code_id || null }));
    if (!lines.length) { setError("Add at least one product line."); return; }
    await save("/api/inventory/purchases", "POST", { supplier_name: supplier.name, vendor_id: supplier.id, warehouse_id: purchaseForm.warehouse_id, receipt_date: purchaseForm.receipt_date, currency: purchaseForm.currency, reference: purchaseForm.reference || null, notes: purchaseForm.notes || null, items: lines }, "Purchase received and stock updated.");
  }

  async function submitTransfer(event: FormEvent) {
    event.preventDefault();
    await save("/api/inventory/transfers", "POST", { ...transferForm, quantity: Number(transferForm.quantity), reference: transferForm.reference || null }, "Stock transferred between warehouses.");
  }

  const tabs: { id: Tab; label: string; icon: typeof Boxes }[] = [
    { id: "overview", label: "Overview", icon: Boxes },
    { id: "items", label: "Products & Services", icon: Store },
    { id: "suppliers", label: "Suppliers", icon: Truck },
    { id: "warehouses", label: "Warehouses", icon: WarehouseIcon },
    { id: "purchases", label: "Purchases", icon: ShoppingCart },
    { id: "stock", label: "Stock", icon: PackagePlus },
    { id: "movements", label: "Movement History", icon: ClipboardList },
  ];

  const inventoryValueNode = overview?.inventory_values.length ? (
    <span className="block space-y-1">
      {overview.inventory_values.map((item) => <span key={item.currency} className="block text-xl font-semibold">{money(item.value, item.currency)}</span>)}
    </span>
  ) : "—";

  return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1500px] space-y-6">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Operations</p><h1 className="mt-1 text-3xl font-semibold">Inventory</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Manage products, suppliers, warehouses, purchases and stock movement without mixing currencies.</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={openPurchase} className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><ShoppingCart className="size-4" />Receive purchase</button><button onClick={() => openNewItem()} className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"><Plus className="size-4" />Add item</button><button onClick={() => void load()} className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm"><RefreshCw className="size-4" />Refresh</button></div>
    </header>

    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="h-fit overflow-x-auto rounded-2xl border bg-white p-2">
        <p className="hidden px-3 pb-2 pt-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 lg:block">Inventory menu</p>
        <div className="flex min-w-max gap-1 lg:block lg:min-w-0">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setTab(id); setSearch(""); setLowStockOnly(false); }} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm lg:mb-1 lg:w-full lg:gap-3 ${tab === id ? "bg-neutral-950 font-medium text-white" : "text-neutral-600 hover:bg-neutral-100"}`}><Icon className="size-4" />{label}</button>)}</div>
      </aside>

      <section className="min-w-0">{loading ? <Panel><p className="text-sm text-neutral-500">Loading inventory…</p></Panel> : <>
        {tab === "overview" ? <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Stock products" value={overview?.stock_products ?? 0} onClick={() => { setTab("items"); setItemFilter("stock_item"); }} />
            <Metric label="Service items" value={overview?.service_items ?? 0} onClick={() => { setTab("items"); setItemFilter("service"); }} />
            <Metric label="Inventory value" value={inventoryValueNode} hint={overview?.inventory_values.length && overview.inventory_values.length > 1 ? "Shown separately by currency" : "View stock valuation"} onClick={() => setTab("stock")} />
            <Metric label="Low stock" value={overview?.low_stock_count ?? 0} hint={overview?.out_of_stock_count ? `${overview.out_of_stock_count} out of stock` : "View items to reorder"} onClick={() => { setTab("stock"); setLowStockOnly(true); }} />
          </div>

          <Panel>
            <SectionTitle title="Setup readiness" subtitle="Complete these once, then daily inventory work becomes much faster" />
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <SetupItem ready={activeStockProducts.length > 0} title="Stock product" detail={activeStockProducts.length ? `${activeStockProducts.length} active` : "Required before purchases"} onClick={() => openNewItem("stock_item")} />
              <SetupItem ready={activeSuppliers.length > 0} title="Supplier" detail={activeSuppliers.length ? `${activeSuppliers.length} active` : "Required before purchases"} onClick={openNewSupplier} />
              <SetupItem ready={activeWarehouses.length > 0} title="Warehouse" detail={activeWarehouses.length ? `${activeWarehouses.length} active` : "Required before purchases"} onClick={openNewWarehouse} />
            </div>
            {missingPurchaseSetup.length === 0 ? <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="size-4" />Inventory is ready to receive purchases.</div> : <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800"><AlertTriangle className="size-4" />Finish the missing setup before receiving stock.</div>}
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel><SectionTitle title="Quick actions" subtitle="Common day-to-day inventory work" /><div className="mt-4 grid gap-3 sm:grid-cols-2"><Quick title="Add a product" text="Physical item you buy, keep in stock and sell." onClick={() => openNewItem("stock_item")} /><Quick title="Add a service" text="Service you quote, order and invoice without stock." onClick={() => openNewItem("service")} /><Quick title="Receive a purchase" text="Increase stock and create the related payable accounting entry." onClick={openPurchase} /><Quick title="Adjust stock" text="Correct damaged, counted or opening stock with a reason." onClick={openAdjustment} /><Quick title="Transfer stock" text="Move existing stock between warehouses without changing total inventory value." onClick={openTransfer} /><Quick title="Add a supplier" text="Save supplier details and default purchasing currency." onClick={openNewSupplier} /></div></Panel>
            <Panel><SectionTitle title="Low stock" subtitle="Items at or below their reorder level" />{overview?.low_stock.length ? <div className="mt-3 divide-y">{overview.low_stock.map((item) => <button key={item.id} onClick={() => { setTab("stock"); setLowStockOnly(true); setSearch(item.sku); }} className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:bg-neutral-50"><div><p className="font-medium">{item.name}</p><p className="text-xs text-neutral-400">{item.sku}</p></div><span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-700">{item.on_hand} {item.unit} · reorder {item.reorder_level}</span></button>)}</div> : <Empty text="No low-stock items right now." />}</Panel>
          </div>
        </div> : null}

        {tab === "items" ? <div className="space-y-4"><Toolbar title="Products & Services" subtitle="One catalog for stock products, non-stock items and services" actionLabel="Add item" onAction={() => openNewItem()} secondaryLabel="Manage categories" onSecondary={() => setModal("categories")} /><div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 sm:flex-row"><SearchBox value={search} onChange={setSearch} placeholder="Search SKU, name or category…" /><select value={itemFilter} onChange={(event) => setItemFilter(event.target.value as typeof itemFilter)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="all">All items</option><option value="stock_item">Stock products</option><option value="non_stock_item">Non-stock products</option><option value="service">Services</option></select></div><Table headers={["SKU", "Item", "Type", "Category", "Sell price", "On hand", "Status", "Action"]}>{filteredItems.map((product) => <tr key={product.id} className="border-t"><Td><b>{product.sku}</b></Td><Td><p className="font-medium">{product.name}</p><p className="max-w-xs truncate text-xs text-neutral-400">{product.description || "—"}</p></Td><Td><Badge>{labelType(product.item_type)}</Badge></Td><Td>{categories.find((category) => category.id === product.category_id)?.name || "Uncategorized"}</Td><Td>{money(product.selling_price, product.currency)}</Td><Td>{product.item_type === "stock_item" ? product.on_hand : "—"}</Td><Td><Status active={product.is_active} /></Td><Td><div className="flex gap-2"><IconButton title="Edit" onClick={() => openEditItem(product)} /><button onClick={() => void toggleItem(product)} className="rounded-lg border px-2.5 py-1.5 text-xs font-medium">{product.is_active ? "Disable" : "Enable"}</button></div></Td></tr>)}</Table>{filteredItems.length === 0 ? <Empty text="No matching items. Add your first product or service." /> : null}</div> : null}

        {tab === "suppliers" ? <div className="space-y-4"><Toolbar title="Suppliers" subtitle="People and companies you purchase products from" actionLabel="Add supplier" onAction={openNewSupplier} /><div className="rounded-2xl border bg-white p-4"><SearchBox value={search} onChange={setSearch} placeholder="Search supplier, contact or email…" /></div><Table headers={["Supplier", "Contact", "Currency", "Purchases", "Purchased", "Outstanding", "Status", "Action"]}>{filteredSuppliers.map((supplier) => <tr key={supplier.id} className="border-t"><Td><p className="font-medium">{supplier.name}</p><p className="text-xs text-neutral-400">{supplier.vendor_code}</p></Td><Td><p>{supplier.contact_name || "—"}</p><p className="text-xs text-neutral-400">{supplier.email || supplier.phone || ""}</p></Td><Td>{supplier.currency || "—"}</Td><Td>{supplier.purchase_count}</Td><Td>{money(supplier.purchased_total, supplier.currency || "")}</Td><Td>{money(supplier.outstanding_total, supplier.currency || "")}</Td><Td><Status active={supplier.is_active} /></Td><Td><div className="flex gap-2"><IconButton title="Edit" onClick={() => openEditSupplier(supplier)} /><button onClick={() => void toggleSupplier(supplier)} className="rounded-lg border px-2.5 py-1.5 text-xs font-medium">{supplier.is_active ? "Disable" : "Enable"}</button></div></Td></tr>)}</Table>{filteredSuppliers.length === 0 ? <Empty text="No matching suppliers." /> : null}</div> : null}

        {tab === "warehouses" ? <div className="space-y-4"><Toolbar title="Warehouses" subtitle="Locations where physical stock is stored" actionLabel="Add warehouse" onAction={openNewWarehouse} /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{warehouses.map((warehouse) => <div key={warehouse.id} className="rounded-2xl border bg-white p-5"><div className="flex items-start justify-between"><div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><WarehouseIcon className="size-5" /></div><IconButton title="Edit" onClick={() => openEditWarehouse(warehouse)} /></div><h3 className="mt-4 font-semibold">{warehouse.name}</h3><p className="mt-1 text-xs text-neutral-400">{warehouse.code}</p><p className="mt-3 min-h-10 text-sm text-neutral-500">{warehouse.address || "No address saved"}</p><div className="mt-4 flex gap-2">{warehouse.is_default ? <Badge>Default</Badge> : null}<Status active={warehouse.is_active} /></div></div>)}</div>{warehouses.length === 0 ? <Empty text="Add at least one warehouse before receiving stock." /> : null}</div> : null}

        {tab === "purchases" ? <div className="space-y-4"><Toolbar title="Purchases" subtitle="Receive products from suppliers and increase stock" actionLabel="Receive purchase" onAction={openPurchase} /><div className="rounded-2xl border bg-white p-4"><SearchBox value={search} onChange={setSearch} placeholder="Search receipt, supplier, warehouse or reference…" /></div><Table headers={["Receipt", "Supplier", "Warehouse", "Date", "Total", "Payable", "Status"]}>{filteredPurchases.map((purchase) => <tr key={purchase.id} className="border-t"><Td><b>{purchase.receipt_number}</b>{purchase.reference ? <p className="text-xs text-neutral-400">Ref: {purchase.reference}</p> : null}</Td><Td>{purchase.supplier_name}</Td><Td>{purchase.warehouse_name}</Td><Td>{purchase.receipt_date}</Td><Td>{money(purchase.total, purchase.currency)}</Td><Td>{money(purchase.balance_due, purchase.currency)}</Td><Td><Badge>{purchase.status}</Badge></Td></tr>)}</Table>{filteredPurchases.length === 0 ? <Empty text="No matching purchases." /> : null}</div> : null}

        {tab === "stock" ? <div className="space-y-4"><Toolbar title="Stock on Hand" subtitle="Current quantity, average cost and inventory value by warehouse" actionLabel="Adjust stock" onAction={openAdjustment} secondaryLabel="Transfer stock" onSecondary={openTransfer} secondaryIcon={ArrowRightLeft} /><div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 sm:flex-row"><SearchBox value={search} onChange={setSearch} placeholder="Search product, SKU or warehouse…" /><button onClick={() => setLowStockOnly((current) => !current)} className={`h-11 rounded-xl border px-4 text-sm font-medium ${lowStockOnly ? "bg-amber-50 text-amber-800" : "bg-white"}`}>{lowStockOnly ? "Showing low stock" : "Low stock only"}</button></div><Table headers={["Product", "Warehouse", "On hand", "Average cost", "Inventory value", "Reorder level"]}>{filteredStock.map((row) => <tr key={`${row.product_id}-${row.warehouse_id}`} className="border-t"><Td><p className="font-medium">{row.product_name}</p><p className="text-xs text-neutral-400">{row.sku}</p></Td><Td>{row.warehouse_name}</Td><Td><b className={Number(row.on_hand) <= Number(row.reorder_level) ? "text-amber-700" : ""}>{row.on_hand}</b></Td><Td>{money(row.average_unit_cost, row.currency)}</Td><Td>{money(row.inventory_value, row.currency)}</Td><Td>{row.reorder_level}</Td></tr>)}</Table>{filteredStock.length === 0 ? <Empty text={lowStockOnly ? "No low-stock balances match this filter." : "No stock balances yet. Receive a purchase to add inventory."} /> : null}</div> : null}

        {tab === "movements" ? <div className="space-y-4"><Toolbar title="Movement History" subtitle="Audit trail of every stock increase, decrease and warehouse transfer" /><div className="rounded-2xl border bg-white p-4"><SearchBox value={search} onChange={setSearch} placeholder="Search product, warehouse, movement or reason…" /></div><Table headers={["Date", "Product", "Warehouse", "Movement", "Quantity", "Unit cost", "After", "Reason"]}>{filteredMovements.map((movement) => <tr key={movement.id} className="border-t"><Td>{movement.movement_date}</Td><Td><p className="font-medium">{movement.product_name}</p><p className="text-xs text-neutral-400">{movement.sku}</p></Td><Td>{movement.warehouse_name}</Td><Td><Badge>{movement.movement_type.replaceAll("_", " ")}</Badge></Td><Td className={Number(movement.quantity) < 0 ? "text-red-600" : "text-emerald-700"}>{Number(movement.quantity) > 0 ? "+" : ""}{movement.quantity}</Td><Td>{money(movement.unit_cost, products.find((product) => product.sku === movement.sku)?.currency || "")}</Td><Td>{movement.quantity_after}</Td><Td>{movement.reason || movement.reference || "—"}</Td></tr>)}</Table>{filteredMovements.length === 0 ? <Empty text="No matching stock movements." /> : null}</div> : null}
      </>}</section>
    </div>

    {modal ? <ModalShell title={modalTitle(modal, editingId)} onClose={() => { setModal(null); setEditingId(null); }}>
      {modal === "item" ? <form onSubmit={submitItem} className="grid gap-4 md:grid-cols-2"><Select label="Item type" value={itemForm.item_type} onChange={(value) => setItemForm({ ...itemForm, item_type: value, track_inventory: value === "stock_item" })} options={[["stock_item", "Stock product"], ["non_stock_item", "Non-stock product"], ["service", "Service"]]} /><Input label="SKU / Code" value={itemForm.sku} onChange={(value) => setItemForm({ ...itemForm, sku: value })} /><Input label="Name" value={itemForm.name} onChange={(value) => setItemForm({ ...itemForm, name: value })} /><Select label="Category" value={itemForm.category_id} onChange={(value) => setItemForm({ ...itemForm, category_id: value })} options={[["", "Uncategorized"], ...categories.filter((category) => category.is_active).map((category) => [category.id, category.name])]} /><Input label="Barcode" optional value={itemForm.barcode} onChange={(value) => setItemForm({ ...itemForm, barcode: value })} /><Input label="Unit" value={itemForm.unit} onChange={(value) => setItemForm({ ...itemForm, unit: value })} /><CurrencyInput label="Currency" value={itemForm.currency} onChange={(value) => setItemForm({ ...itemForm, currency: value })} /><Input label="Selling price" type="number" value={itemForm.selling_price} onChange={(value) => setItemForm({ ...itemForm, selling_price: value })} />{itemForm.item_type === "stock_item" ? <><Input label="Opening / standard cost" type="number" value={itemForm.standard_cost} onChange={(value) => setItemForm({ ...itemForm, standard_cost: value })} /><Input label="Low-stock reorder level" type="number" value={itemForm.reorder_level} onChange={(value) => setItemForm({ ...itemForm, reorder_level: value })} /></> : null}<Select label="Sales tax" value={itemForm.tax_code_id} onChange={(value) => setItemForm({ ...itemForm, tax_code_id: value })} options={[["", "No tax"], ...salesTaxes.map((tax) => [tax.id, `${tax.code} · ${tax.rate}%`])]} /><Input label="Description" optional value={itemForm.description} onChange={(value) => setItemForm({ ...itemForm, description: value })} />{editingId ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={itemForm.is_active} onChange={(event) => setItemForm({ ...itemForm, is_active: event.target.checked })} />Active item</label> : null}<Save saving={saving} text={editingId ? "Update item" : "Add item"} /></form> : null}

      {modal === "supplier" ? <form onSubmit={submitSupplier} className="grid gap-4 md:grid-cols-2"><Input label="Supplier name" value={supplierForm.name} onChange={(value) => setSupplierForm({ ...supplierForm, name: value })} /><Input label="Contact person" optional value={supplierForm.contact_name} onChange={(value) => setSupplierForm({ ...supplierForm, contact_name: value })} /><Input label="Email" optional type="email" value={supplierForm.email} onChange={(value) => setSupplierForm({ ...supplierForm, email: value })} /><Input label="Phone" optional value={supplierForm.phone} onChange={(value) => setSupplierForm({ ...supplierForm, phone: value })} /><Input label="Country code" optional value={supplierForm.country_code} onChange={(value) => setSupplierForm({ ...supplierForm, country_code: value.toUpperCase() })} /><CurrencyInput label="Default currency" value={supplierForm.currency} onChange={(value) => setSupplierForm({ ...supplierForm, currency: value })} /><Input label="Tax / VAT ID" optional value={supplierForm.tax_identifier} onChange={(value) => setSupplierForm({ ...supplierForm, tax_identifier: value })} /><Input label="Website" optional value={supplierForm.website} onChange={(value) => setSupplierForm({ ...supplierForm, website: value })} /><Input label="Notes" optional value={supplierForm.notes} onChange={(value) => setSupplierForm({ ...supplierForm, notes: value })} />{editingId ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={supplierForm.is_active} onChange={(event) => setSupplierForm({ ...supplierForm, is_active: event.target.checked })} />Active supplier</label> : null}<Save saving={saving} text={editingId ? "Update supplier" : "Add supplier"} /></form> : null}

      {modal === "warehouse" ? <form onSubmit={submitWarehouse} className="grid gap-4"><Input label="Warehouse code" value={warehouseForm.code} onChange={(value) => setWarehouseForm({ ...warehouseForm, code: value.toUpperCase() })} /><Input label="Warehouse name" value={warehouseForm.name} onChange={(value) => setWarehouseForm({ ...warehouseForm, name: value })} /><Input label="Address" optional value={warehouseForm.address} onChange={(value) => setWarehouseForm({ ...warehouseForm, address: value })} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={warehouseForm.is_default} onChange={(event) => setWarehouseForm({ ...warehouseForm, is_default: event.target.checked })} />Use as default warehouse</label>{editingId ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={warehouseForm.is_active} onChange={(event) => setWarehouseForm({ ...warehouseForm, is_active: event.target.checked })} />Active warehouse</label> : null}<Save saving={saving} text={editingId ? "Update warehouse" : "Add warehouse"} /></form> : null}

      {modal === "categories" ? <div className="space-y-5"><form onSubmit={saveCategory} className="grid gap-3 rounded-xl bg-neutral-50 p-4 md:grid-cols-[1fr_1.5fr_auto]"><Input label="Category name" value={categoryDraft.name} onChange={(value) => setCategoryDraft({ ...categoryDraft, name: value })} /><Input label="Description" optional value={categoryDraft.description} onChange={(value) => setCategoryDraft({ ...categoryDraft, description: value })} /><button disabled={saving} className="self-end rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white">{categoryDraft.id ? "Update" : "Add"}</button></form><div className="divide-y rounded-xl border">{categories.map((category) => <div key={category.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-medium">{category.name}</p><p className="text-xs text-neutral-400">{category.description || "No description"}</p></div><div className="flex gap-2"><button onClick={() => setCategoryDraft({ id: category.id, name: category.name, description: category.description ?? "" })} className="rounded-lg border px-2.5 py-1.5 text-xs">Edit</button><button onClick={() => void toggleCategory(category)} className="rounded-lg border px-2.5 py-1.5 text-xs">{category.is_active ? "Disable" : "Enable"}</button></div></div>)}</div></div> : null}

      {modal === "purchase" ? <form onSubmit={submitPurchase} className="space-y-5"><div className="grid gap-4 md:grid-cols-2"><Select label="Supplier" value={purchaseForm.supplier_id} onChange={(value) => { const supplier = suppliers.find((item) => item.id === value); const currency = supplier?.currency || baseCurrency; setPurchaseForm({ ...purchaseForm, supplier_id: value, currency }); setPurchaseLines([{ product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }]); }} options={[["", "Select supplier"], ...activeSuppliers.map((supplier) => [supplier.id, `${supplier.name} · ${supplier.vendor_code}`])]} /><Select label="Receive into warehouse" value={purchaseForm.warehouse_id} onChange={(value) => setPurchaseForm({ ...purchaseForm, warehouse_id: value })} options={[["", "Select warehouse"], ...activeWarehouses.map((warehouse) => [warehouse.id, warehouse.name])]} /><Input label="Purchase date" type="date" value={purchaseForm.receipt_date} onChange={(value) => setPurchaseForm({ ...purchaseForm, receipt_date: value })} /><CurrencyInput label="Purchase currency" value={purchaseForm.currency} onChange={(value) => { setPurchaseForm({ ...purchaseForm, currency: value }); setPurchaseLines([{ product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }]); }} /><Input label="Supplier invoice / reference" optional value={purchaseForm.reference} onChange={(value) => setPurchaseForm({ ...purchaseForm, reference: value })} /><Input label="Notes" optional value={purchaseForm.notes} onChange={(value) => setPurchaseForm({ ...purchaseForm, notes: value })} /></div><div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Products received</h3><p className="mt-1 text-xs text-neutral-500">Only stock products using {purchaseForm.currency} are shown.</p></div><button type="button" onClick={() => setPurchaseLines([...purchaseLines, { product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }])} className="rounded-lg border px-3 py-2 text-xs font-semibold">+ Add line</button></div>{purchaseProducts.length === 0 ? <div className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">No active stock product uses {purchaseForm.currency}. Change the purchase currency or add a matching product.</div> : null}<div className="space-y-3">{purchaseLines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border p-3 md:grid-cols-[2fr_0.7fr_1fr_1fr_auto]"><Select label="Product" value={line.product_id} onChange={(value) => { const product = purchaseProducts.find((item) => item.id === value); const next = [...purchaseLines]; next[index] = { ...line, product_id: value, unit_cost: product ? String(product.last_purchase_cost || product.standard_cost || 0) : line.unit_cost }; setPurchaseLines(next); }} options={[["", "Select product"], ...purchaseProducts.map((product) => [product.id, `${product.sku} · ${product.name}`])]} /><Input label="Qty" type="number" value={line.quantity} onChange={(value) => { const next = [...purchaseLines]; next[index] = { ...line, quantity: value }; setPurchaseLines(next); }} /><Input label="Unit cost" type="number" value={line.unit_cost} onChange={(value) => { const next = [...purchaseLines]; next[index] = { ...line, unit_cost: value }; setPurchaseLines(next); }} /><Select label="Tax" value={line.tax_code_id} onChange={(value) => { const next = [...purchaseLines]; next[index] = { ...line, tax_code_id: value }; setPurchaseLines(next); }} options={[["", "No tax"], ...purchaseTaxes.map((tax) => [tax.id, `${tax.code} · ${tax.rate}%`])]} /><button type="button" disabled={purchaseLines.length === 1} onClick={() => setPurchaseLines(purchaseLines.filter((_, itemIndex) => itemIndex !== index))} className="self-end rounded-lg border px-3 py-2.5 text-xs disabled:opacity-30">Remove</button></div>)}</div></div><div className="grid gap-3 rounded-xl bg-neutral-50 p-4 sm:grid-cols-3"><Total label="Subtotal" value={money(purchaseTotals.subtotal, purchaseForm.currency)} /><Total label="Estimated tax" value={money(purchaseTotals.tax, purchaseForm.currency)} /><Total label="Estimated total" value={money(purchaseTotals.total, purchaseForm.currency)} strong /></div><Save saving={saving} text="Receive purchase & update stock" /></form> : null}

      {modal === "adjustment" ? <form onSubmit={submitAdjustment} className="grid gap-4 md:grid-cols-2"><Select label="Product" value={adjustForm.product_id} onChange={(value) => setAdjustForm({ ...adjustForm, product_id: value })} options={[["", "Select product"], ...activeStockProducts.map((product) => [product.id, `${product.sku} · ${product.name}`])]} /><Select label="Warehouse" value={adjustForm.warehouse_id} onChange={(value) => setAdjustForm({ ...adjustForm, warehouse_id: value })} options={[["", "Select warehouse"], ...activeWarehouses.map((warehouse) => [warehouse.id, warehouse.name])]} /><Input label="Adjustment date" type="date" value={adjustForm.adjustment_date} onChange={(value) => setAdjustForm({ ...adjustForm, adjustment_date: value })} /><Input label="Quantity change (+ add / - remove)" type="number" value={adjustForm.quantity_delta} onChange={(value) => setAdjustForm({ ...adjustForm, quantity_delta: value })} /><Input label="Unit cost for stock added" optional type="number" value={adjustForm.unit_cost} onChange={(value) => setAdjustForm({ ...adjustForm, unit_cost: value })} /><Input label="Reason" value={adjustForm.reason} onChange={(value) => setAdjustForm({ ...adjustForm, reason: value })} /><Input label="Reference" optional value={adjustForm.reference} onChange={(value) => setAdjustForm({ ...adjustForm, reference: value })} /><Save saving={saving} text="Post adjustment" /></form> : null}

      {modal === "transfer" ? <form onSubmit={submitTransfer} className="grid gap-4 md:grid-cols-2"><Select label="From warehouse" value={transferForm.from_warehouse_id} onChange={(value) => { const destination = activeWarehouses.find((warehouse) => warehouse.id !== value); setTransferForm({ ...transferForm, from_warehouse_id: value, to_warehouse_id: destination?.id ?? "", product_id: "" }); }} options={[["", "Select source warehouse"], ...activeWarehouses.map((warehouse) => [warehouse.id, warehouse.name])]} /><Select label="To warehouse" value={transferForm.to_warehouse_id} onChange={(value) => setTransferForm({ ...transferForm, to_warehouse_id: value })} options={[["", "Select destination warehouse"], ...activeWarehouses.filter((warehouse) => warehouse.id !== transferForm.from_warehouse_id).map((warehouse) => [warehouse.id, warehouse.name])]} /><Select label="Product" value={transferForm.product_id} onChange={(value) => setTransferForm({ ...transferForm, product_id: value })} options={[["", "Select available product"], ...transferProducts.map((product) => [product.id, `${product.sku} · ${product.name}`])]} /><Input label="Transfer date" type="date" value={transferForm.transfer_date} onChange={(value) => setTransferForm({ ...transferForm, transfer_date: value })} /><Input label={`Quantity${transferAvailable ? ` · available ${transferAvailable.on_hand}` : ""}`} type="number" value={transferForm.quantity} onChange={(value) => setTransferForm({ ...transferForm, quantity: value })} /><Input label="Reason" value={transferForm.reason} onChange={(value) => setTransferForm({ ...transferForm, reason: value })} /><Input label="Reference" optional value={transferForm.reference} onChange={(value) => setTransferForm({ ...transferForm, reference: value })} /><div className="md:col-span-2 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600">Warehouse transfer only moves inventory location. It does not create income, expense or a new accounting journal.</div><Save saving={saving} text="Transfer stock" /></form> : null}
    </ModalShell> : null}
  </div></main>;
}

function labelType(value: string) { return value === "stock_item" ? "Stock product" : value === "service" ? "Service" : "Non-stock product"; }
function modalTitle(modal: Modal, id: string | null) { if (modal === "item") return id ? "Edit product / service" : "Add product / service"; if (modal === "supplier") return id ? "Edit supplier" : "Add supplier"; if (modal === "warehouse") return id ? "Edit warehouse" : "Add warehouse"; if (modal === "categories") return "Manage categories"; if (modal === "purchase") return "Receive purchase"; if (modal === "transfer") return "Transfer stock"; return "Adjust stock"; }
function Panel({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border bg-white p-5">{children}</div>; }
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-neutral-500">{subtitle}</p></div>; }
function Metric({ label, value, hint = "View details →", onClick }: { label: string; value: React.ReactNode; hint?: string; onClick: () => void }) { return <button onClick={onClick} className="rounded-2xl border bg-white p-5 text-left transition hover:border-neutral-400"><p className="text-sm text-neutral-500">{label}</p><div className="mt-2 text-3xl font-semibold">{value}</div><p className="mt-3 text-xs text-neutral-400">{hint}</p></button>; }
function Quick({ title, text, onClick }: { title: string; text: string; onClick: () => void }) { return <button onClick={onClick} className="rounded-xl border p-4 text-left hover:bg-neutral-50"><p className="font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{text}</p></button>; }
function SetupItem({ ready, title, detail, onClick }: { ready: boolean; title: string; detail: string; onClick: () => void }) { return <button onClick={onClick} className="flex items-center gap-3 rounded-xl border p-4 text-left hover:bg-neutral-50">{ready ? <CheckCircle2 className="size-5 text-emerald-600" /> : <AlertTriangle className="size-5 text-amber-600" />}<div><p className="font-medium">{title}</p><p className="mt-0.5 text-xs text-neutral-500">{detail}</p></div></button>; }
function Toolbar({ title, subtitle, actionLabel, onAction, secondaryLabel, onSecondary, secondaryIcon: SecondaryIcon = Settings2 }: { title: string; subtitle: string; actionLabel?: string; onAction?: () => void; secondaryLabel?: string; onSecondary?: () => void; secondaryIcon?: typeof Settings2 }) { return <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-neutral-500">{subtitle}</p></div><div className="flex flex-wrap gap-2">{secondaryLabel ? <button onClick={onSecondary} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-medium"><SecondaryIcon className="size-4" />{secondaryLabel}</button> : null}{actionLabel ? <button onClick={onAction} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-3 text-sm font-medium text-white"><Plus className="size-4" />{actionLabel}</button> : null}</div></div>; }
function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) { return <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr>{headers.map((header) => <th key={header} className="px-4 py-3 font-medium">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <td className={`px-4 py-3 ${className}`}>{children}</td>; }
function Badge({ children }: { children: React.ReactNode }) { return <span className="inline-flex rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">{children}</span>; }
function Status({ active }: { active: boolean }) { return <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-medium ${active ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>{active ? "Active" : "Inactive"}</span>; }
function IconButton({ title, onClick }: { title: string; onClick: () => void }) { return <button title={title} onClick={onClick} className="rounded-lg border p-2 hover:bg-neutral-50"><Pencil className="size-3.5" /></button>; }
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <div className="relative flex-1"><Search className="absolute left-3 top-3.5 size-4 text-neutral-400" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-neutral-600" /></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed bg-white px-6 py-12 text-center text-sm text-neutral-500">{text}</div>; }
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-6 flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-neutral-500">Complete the fields below. Changes are saved to this company only.</p></div><button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm">Close</button></div>{children}</div></div>; }
function Input({ label, value, onChange, type = "text", optional = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; optional?: boolean }) { return <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}{optional ? <span className="ml-1 font-normal text-neutral-400">(optional)</span> : null}</span><input required={!optional} type={type} step={type === "number" ? "any" : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl border px-3 outline-none focus:border-neutral-700" /></label>; }
function CurrencyInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span><input required minLength={3} maxLength={3} value={value} onChange={(event) => onChange(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} className="h-11 rounded-xl border px-3 uppercase outline-none focus:border-neutral-700" /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span><select required value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl border bg-white px-3">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>; }
function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div><p className="text-xs text-neutral-500">{label}</p><p className={`mt-1 ${strong ? "text-lg font-semibold" : "font-medium"}`}>{value}</p></div>; }
function Save({ saving, text }: { saving: boolean; text: string }) { return <div className="md:col-span-2"><button disabled={saving} className="rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : text}</button></div>; }
