"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
import { inventoryBrowseHref, inventoryBrowseState, inventoryDocumentHref, inventoryReturnHref, parseInventoryRoute, type InventoryBrowse, type InventorySection } from "@/lib/inventory-navigation";
import { type Tab, type Overview, type Product, type Warehouse, type Category, type Supplier, type TaxCode, type Stock, type Purchase, type Movement, type PurchaseLine, type ItemForm, type SupplierForm, type WarehouseForm, today, emptyItem, emptySupplier, emptyWarehouse } from "@/components/inventory/inventory-model";

export function useInventoryWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { tenant } = useDashboardSession();
  const canManage = Boolean(tenant?.permissions.some(permission => permission === "*" || permission === "finance.manage"));
  const route = useMemo(() => parseInventoryRoute(pathname), [pathname]);
  const queryState = inventoryBrowseState(searchParams.toString());
  const tab: Tab = route.section === "adjustments" || route.section === "transfers" ? "stock" : route.section || queryState.tab;
  const search = queryState.search;
  const itemFilter = queryState.itemFilter;
  const lowStockOnly = queryState.lowStockOnly;
  const modal = route.modal;
  const editingId = route.mode === "edit" ? route.id || null : null;
  const isEditor = route.mode === "create" || route.mode === "edit";
  const listHref = inventoryBrowseHref({ ...queryState, tab });
  const returnHref = route.mode === "list" ? listHref : inventoryReturnHref(searchParams.toString());
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
  const [coreReady, setCoreReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState("BDT");
  const [createdDate] = useState(today);
  const [loadedTabs, setLoadedTabs] = useState<Set<Tab>>(() => new Set(["overview", "suppliers", "warehouses", "categories", "service_sales"]));
  const loadedTabsRef = useRef(loadedTabs);
  const serviceTermsRef = useRef<Map<string, number | null> | null>(null);
  const coreServiceIdsRef = useRef<Set<string>>(new Set());
  const coreRequestRef = useRef(0);
  const tabRequestRef = useRef(0);
  const activeTabRef = useRef(tab);
  const mountedRef = useRef(true);
  const saveInFlightRef = useRef(false);
  const committedDocumentRef = useRef(false);
  const [documentCommitted, setDocumentCommitted] = useState(false);
  const [persistedProductId, setPersistedProductId] = useState<string | null>(null);
  const persistedProductRef = useRef<string | null>(null);
  const [itemDraft, setItemForm] = useState<ItemForm | null>(null);
  const [supplierDraft, setSupplierForm] = useState<SupplierForm | null>(null);
  const [warehouseDraft, setWarehouseForm] = useState<WarehouseForm | null>(null);
  const [categoryDraftValue, setCategoryDraft] = useState<{ id: string; name: string; description: string } | null>(null);
  const [adjustDraft, setAdjustForm] = useState<{ product_id: string; warehouse_id: string; adjustment_date: string; quantity_delta: string; unit_cost: string; reason: string; reference: string } | null>(null);
  const [purchaseDraft, setPurchaseForm] = useState<{ supplier_id: string; warehouse_id: string; receipt_date: string; currency: string; reference: string; notes: string } | null>(null);
  const [purchaseLinesDraft, setPurchaseLines] = useState<PurchaseLine[] | null>(null);
  const [transferDraft, setTransferForm] = useState<{ product_id: string; from_warehouse_id: string; to_warehouse_id: string; transfer_date: string; quantity: string; reason: string; reference: string } | null>(null);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init });
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { detail: "Unexpected server response" }; }
    if (!response.ok) throw new Error(getApiErrorMessage(payload, "Inventory request failed"));
    return payload;
  }, []);

  const loadCore = useCallback(async (showLoader = true) => {
    const identity = ++coreRequestRef.current;
    tabRequestRef.current += 1;
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const [summaryData, productData, warehouseData, categoryData, supplierData, taxData] = await Promise.all([
        request("/api/inventory/dashboard-summary"), request("/api/inventory/products?include_inactive=true"),
        request("/api/inventory/warehouses"), request("/api/inventory/categories"),
        request("/api/inventory/suppliers?include_inactive=true"), request("/api/accounting/tax/codes"),
      ]);
      if (!mountedRef.current || identity !== coreRequestRef.current) return false;
      setOverview(summaryData);
      setBaseCurrency(summaryData.base_currency || "BDT");
      // A new product snapshot cannot reuse terms from an older catalog snapshot.
      serviceTermsRef.current = null;
      const nextTabs = new Set(loadedTabsRef.current); nextTabs.delete("items"); loadedTabsRef.current = nextTabs; setLoadedTabs(nextTabs);
      coreServiceIdsRef.current = new Set((productData as Product[]).filter(item => item.item_type === "service").map(item => item.id));
      setProducts((productData as Omit<Product, "service_duration_months">[]).map(item => ({ ...item, service_duration_months: serviceTermsRef.current?.get(item.id) ?? null })));
      setWarehouses(warehouseData); setCategories(categoryData); setSuppliers(supplierData); setTaxCodes(taxData);
      setCoreReady(true);
      return true;
    } catch (reason) {
      if (!mountedRef.current || identity !== coreRequestRef.current) return false;
      // Do not retain another successful read as if the denied current workspace loaded.
      setCoreReady(false); setOverview(null); setProducts([]); setWarehouses([]); setCategories([]); setSuppliers([]); setTaxCodes([]);
      coreServiceIdsRef.current = new Set();
      setError(reason instanceof Error ? reason.message : "Could not load inventory");
      return false;
    } finally { if (mountedRef.current && identity === coreRequestRef.current && showLoader) setLoading(false); }
  }, [request]);

  const loadTab = useCallback(async (target: Tab, force = false) => {
    if (!force && loadedTabsRef.current.has(target)) { setLoading(false); return true; }
    if (["overview", "suppliers", "warehouses", "categories", "service_sales"].includes(target)) { setLoading(false); return true; }
    const identity = ++tabRequestRef.current;
    setLoading(true); setError(null);
    try {
      const url = target === "items" ? "/api/services/catalog?include_inactive=true" : `/api/inventory/${target}`;
      const payload = await request(url);
      if (!mountedRef.current || identity !== tabRequestRef.current) return false;
      if (target === "items") {
        if (!Array.isArray(payload) || payload.some(item => !item || typeof item.product_id !== "string" || !(item.duration_months === null || Number.isInteger(item.duration_months) && item.duration_months >= 1 && item.duration_months <= 120))) throw new Error("Service terms could not be verified. Reload before editing the catalog.");
        const serviceTerms = new Map<string, number | null>(payload.map((item: { product_id: string; duration_months: number | null }) => [item.product_id, item.duration_months]));
        if ([...coreServiceIdsRef.current].some(id => !serviceTerms.has(id))) throw new Error("The service catalog changed while loading. Reload to verify each service term before editing.");
        serviceTermsRef.current = serviceTerms;
        setProducts(current => current.map(item => ({ ...item, service_duration_months: serviceTerms.get(item.id) ?? null })));
      } else if (target === "purchases") setPurchases(payload);
      else if (target === "stock") setStock(payload);
      else if (target === "movements") setMovements(payload);
      const next = new Set(loadedTabsRef.current); next.add(target); loadedTabsRef.current = next; setLoadedTabs(next);
      return true;
    } catch (reason) {
      if (!mountedRef.current || identity !== tabRequestRef.current) return false;
      if (target === "purchases") setPurchases([]);
      if (target === "stock") setStock([]);
      if (target === "movements") setMovements([]);
      const next = new Set(loadedTabsRef.current); next.delete(target); loadedTabsRef.current = next; setLoadedTabs(next);
      if (target === "items") serviceTermsRef.current = null;
      setError(reason instanceof Error ? reason.message : "Could not load inventory section");
      return false;
    } finally { if (mountedRef.current && identity === tabRequestRef.current) setLoading(false); }
  }, [request]);

  useEffect(() => { activeTabRef.current = tab; }, [tab]);
  useEffect(() => {
    mountedRef.current = true;
    void loadCore();
    return () => { mountedRef.current = false; coreRequestRef.current += 1; tabRequestRef.current += 1; };
  }, [loadCore]);
  useEffect(() => {
    if (coreReady) void loadTab(tab);
    // A failed read is retried only by Refresh, never by loading=false transitions.
    return () => { tabRequestRef.current += 1; };
  }, [coreReady, tab, loadTab]);

  const activeStockProducts = useMemo(() => products.filter((product) => product.item_type === "stock_item" && product.track_inventory && product.is_active), [products]);
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.is_active), [suppliers]);
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active), [warehouses]);
  const activeCategoryOptions = useMemo(() => [
    { value: "", label: "Uncategorized" },
    ...categories.filter((category) => category.is_active).map((category) => ({ value: category.id, label: category.name })),
  ], [categories]);
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

  const selectedItem = editingId ? products.find(item => item.id === editingId) : undefined;
  const selectedSupplier = editingId ? suppliers.find(item => item.id === editingId) : undefined;
  const selectedWarehouse = editingId ? warehouses.find(item => item.id === editingId) : undefined;
  const selectedCategory = editingId ? categories.find(item => item.id === editingId) : undefined;
  const requestedItemType = searchParams.get("itemType") || "stock_item";
  const newItemType = ["stock_item", "non_stock_item", "service"].includes(requestedItemType) ? requestedItemType : "stock_item";
  const initialItemForm: ItemForm = selectedItem ? { sku: selectedItem.sku, barcode: selectedItem.barcode ?? "", name: selectedItem.name, description: selectedItem.description ?? "", item_type: selectedItem.item_type, category_id: selectedItem.category_id ?? "", unit: selectedItem.unit, currency: selectedItem.currency, selling_price: String(selectedItem.selling_price), standard_cost: String(selectedItem.standard_cost), reorder_level: String(selectedItem.reorder_level), tax_code_id: selectedItem.tax_code_id ?? "", track_inventory: selectedItem.track_inventory, allow_negative_stock: selectedItem.allow_negative_stock, is_active: selectedItem.is_active, service_duration_months: selectedItem.service_duration_months == null ? "" : String(selectedItem.service_duration_months) } : { ...emptyItem(baseCurrency), item_type: newItemType, track_inventory: newItemType === "stock_item" };
  const initialSupplierForm: SupplierForm = selectedSupplier ? { name: selectedSupplier.name, contact_name: selectedSupplier.contact_name ?? "", email: selectedSupplier.email ?? "", phone: selectedSupplier.phone ?? "", website: selectedSupplier.website ?? "", tax_identifier: selectedSupplier.tax_identifier ?? "", country_code: selectedSupplier.country_code ?? "", currency: selectedSupplier.currency ?? baseCurrency, notes: selectedSupplier.notes ?? "", is_active: selectedSupplier.is_active } : emptySupplier(baseCurrency);
  const initialWarehouseForm: WarehouseForm = selectedWarehouse ? { code: selectedWarehouse.code, name: selectedWarehouse.name, address: selectedWarehouse.address ?? "", is_default: selectedWarehouse.is_default, is_active: selectedWarehouse.is_active } : { ...emptyWarehouse(), is_default: warehouses.length === 0 };
  const initialCategoryDraft = selectedCategory ? { id: selectedCategory.id, name: selectedCategory.name, description: selectedCategory.description || "" } : { id: "", name: "", description: "" };
  const defaultWarehouseId = activeWarehouses.find(warehouse => warehouse.is_default)?.id ?? activeWarehouses[0]?.id ?? "";
  const firstSupplier = activeSuppliers[0];
  const initialPurchaseForm = { supplier_id: firstSupplier?.id ?? "", warehouse_id: defaultWarehouseId, receipt_date: createdDate, currency: firstSupplier?.currency || baseCurrency, reference: "", notes: "" };
  const initialPurchaseLines: PurchaseLine[] = [{ product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }];
  const initialAdjustForm = { product_id: activeStockProducts[0]?.id || "", warehouse_id: defaultWarehouseId, adjustment_date: createdDate, quantity_delta: "", unit_cost: "", reason: "", reference: "" };
  const sourceRow = stock.find(row => Number(row.on_hand) > 0 && activeStockProducts.some(item => item.id === row.product_id) && activeWarehouses.some(warehouse => warehouse.id === row.warehouse_id));
  const initialTransferForm = { product_id: sourceRow?.product_id || "", from_warehouse_id: sourceRow?.warehouse_id || "", to_warehouse_id: activeWarehouses.find(warehouse => warehouse.id !== sourceRow?.warehouse_id)?.id || "", transfer_date: createdDate, quantity: "", reason: "Stock transfer", reference: "" };
  const itemForm = itemDraft ?? initialItemForm;
  const supplierForm = supplierDraft ?? initialSupplierForm;
  const warehouseForm = warehouseDraft ?? initialWarehouseForm;
  const categoryDraft = categoryDraftValue ?? initialCategoryDraft;
  const adjustForm = adjustDraft ?? initialAdjustForm;
  const purchaseForm = purchaseDraft ?? initialPurchaseForm;
  const purchaseLines = purchaseLinesDraft ?? initialPurchaseLines;
  const transferForm = transferDraft ?? initialTransferForm;
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


  const sectionReady = coreReady && loadedTabs.has(tab);
  const recordExists = !editingId || Boolean(modal === "item" ? selectedItem : modal === "supplier" ? selectedSupplier : modal === "warehouse" ? selectedWarehouse : modal === "categories" ? selectedCategory : false);
  const setupError = modal === "purchase" && missingPurchaseSetup.length ? `Before receiving a purchase, add ${missingPurchaseSetup.join(", ")}.` : modal === "adjustment" && (!activeStockProducts.length || !activeWarehouses.length) ? "Add an active stock product and warehouse before posting a stock adjustment." : modal === "transfer" && activeWarehouses.length < 2 ? "Add at least two active warehouses before transferring stock." : modal === "transfer" && !sourceRow ? "There is no available stock in active products and warehouses to transfer yet." : null;
  const documentReady = sectionReady && recordExists && !setupError;
  const baselineSnapshot = JSON.stringify(modal === "item" ? initialItemForm : modal === "supplier" ? initialSupplierForm : modal === "warehouse" ? initialWarehouseForm : modal === "categories" ? initialCategoryDraft : modal === "purchase" ? [initialPurchaseForm, initialPurchaseLines] : modal === "adjustment" ? initialAdjustForm : initialTransferForm);
  const draftSnapshot = JSON.stringify(modal === "item" ? itemForm : modal === "supplier" ? supplierForm : modal === "warehouse" ? warehouseForm : modal === "categories" ? categoryDraft : modal === "purchase" ? [purchaseForm, purchaseLines] : modal === "adjustment" ? adjustForm : transferForm);
  const hasChanges = isEditor && !documentCommitted && documentReady && (saving || persistedProductId !== null || baselineSnapshot !== draftSnapshot);
  const navigation = useDocumentNavigationGuard(hasChanges, { documentLabel: "inventory", isBusy: saving, enabled: isEditor });

  function browse(update: InventoryBrowse, replace = false) {
    const next = inventoryBrowseHref({ ...queryState, tab, ...update, focus: update.focus || "" });
    if (!navigation.confirmLeave()) return;
    if (replace) router.replace(next, { scroll: false }); else router.push(next, { scroll: false });
  }
  function setTab(value: Tab) { browse({ tab: value, search: "", lowStockOnly: false }); }
  function setSearch(value: string) { browse({ search: value }, true); }
  function setItemFilter(value: string) { browse({ itemFilter: value }); }
  function setLowStockOnly(value: boolean | ((current: boolean) => boolean)) { browse({ lowStockOnly: typeof value === "function" ? value(lowStockOnly) : value }); }
  function rowReturn(id: string) { return inventoryBrowseHref({ ...queryState, tab, focus: id }); }
  function openView(section: "items" | "suppliers" | "warehouses" | "purchases", id: string) { router.push(inventoryDocumentHref(section, id, "view", rowReturn(id))); }
  function enterEditor(section: InventorySection, id: string | null = null, type?: string) {
    if (!canManage) { setError("Your company role does not have permission to manage inventory."); return; }
    const context = route.mode === "list" ? id ? rowReturn(id) : listHref : returnHref;
    navigation.navigate(inventoryDocumentHref(section, id, id ? "edit" : "create", context, type));
  }
  function openNewItem(type = "stock_item") { enterEditor("items", null, type); }
  function openEditItem(product: Product) { enterEditor("items", product.id); }
  function openNewSupplier() { enterEditor("suppliers"); }
  function openEditSupplier(supplier: Supplier) { enterEditor("suppliers", supplier.id); }
  function openNewWarehouse() { enterEditor("warehouses"); }
  function openEditWarehouse(warehouse: Warehouse) { enterEditor("warehouses", warehouse.id); }
  function openCategories() { browse({ tab: "categories", search: "" }); }
  function openNewCategory() { enterEditor("categories"); }
  function openEditCategory(category: Category) { enterEditor("categories", category.id); }
  function openPurchase() { enterEditor("purchases"); }
  function openAdjustment() { enterEditor("adjustments"); }
  function openTransfer() { enterEditor("transfers"); }
  function closeDocument() { navigation.navigate(returnHref); }
  function backToRegister() { router.push(returnHref); }

  async function refresh() {
    if (saving || !navigation.confirmLeave()) return;
    if (isEditor) { navigation.navigate(window.location.href, { discard: true, replace: true }); return; }
    if (await loadCore()) await loadTab(activeTabRef.current, true);
  }
  useEffect(() => {
    if (route.mode === "list" && sectionReady && !loading && queryState.focus) document.getElementById(`inventory-row-${queryState.focus}`)?.focus();
  }, [route.mode, sectionReady, loading, queryState.focus]);

  async function save(url: string, method: "POST" | "PATCH", body: unknown, success: string) {
    if (isEditor && committedDocumentRef.current) return true;
    if (saveInFlightRef.current || !canManage || isEditor && !documentReady) return false;
    saveInFlightRef.current = true; setSaving(true); setError(null); setMessage(null);
    let committed = false;
    try {
      await request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      committed = true;
      if (!mountedRef.current) return true;
      setMessage(success);
      if (isEditor) { committedDocumentRef.current = true; setDocumentCommitted(true); navigation.markClean(); navigation.navigate(returnHref, { discard: true, replace: true }); }
      else { if (await loadCore(false)) await loadTab(activeTabRef.current, true); }
      return true;
    } catch (reason) {
      if (mountedRef.current) setError(committed ? "The change was saved, but the view could not refresh. Reload before taking another action." : reason instanceof Error ? reason.message : "Could not save record");
      return committed;
    } finally { saveInFlightRef.current = false; if (mountedRef.current) setSaving(false); }
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault();
    if (saveInFlightRef.current || committedDocumentRef.current || !canManage || !documentReady) return;
    const duration = itemForm.item_type === "service" && itemForm.service_duration_months !== "" ? Number(itemForm.service_duration_months) : null;
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 120)) { setError("Service duration must be a whole number between 1 and 120 months."); return; }
    const { service_duration_months: _duration, ...baseForm } = itemForm;
    const body = { ...baseForm, barcode: baseForm.barcode || null, description: baseForm.description || null, category_id: baseForm.category_id || null, tax_code_id: baseForm.tax_code_id || null, selling_price: Number(baseForm.selling_price), standard_cost: Number(baseForm.standard_cost), reorder_level: Number(baseForm.reorder_level), track_inventory: baseForm.item_type === "stock_item" ? baseForm.track_inventory : false };
    saveInFlightRef.current = true; setSaving(true); setError(null); setMessage(null);
    try {
      const coreId = editingId ?? persistedProductRef.current;
      const saved = await request(coreId ? `/api/inventory/products/${coreId}` : "/api/inventory/products", { method: coreId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const productId = coreId ?? saved.id;
      // The core product is already committed. Retain its ID before a second write.
      persistedProductRef.current = productId;
      if (mountedRef.current) setPersistedProductId(productId);
      if (baseForm.item_type === "service") await request(`/api/services/catalog/${productId}/duration`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duration_months: duration }) });
      if (!mountedRef.current) return;
      setMessage(editingId ? "Item updated." : "Item added to catalog.");
      committedDocumentRef.current = true; setDocumentCommitted(true);
      navigation.markClean(); navigation.navigate(returnHref, { discard: true, replace: true });
    } catch (reason) {
      if (!mountedRef.current) return;
      const detail = reason instanceof Error ? reason.message : "Could not save item";
      setError(committedDocumentRef.current ? "The item was saved, but the page could not navigate. Return to inventory to review the saved record; do not submit it again." : persistedProductRef.current ? `The item record is saved, but the remaining update did not complete. Your fields are retained; retry updates the same item. ${detail}` : detail);
    } finally { saveInFlightRef.current = false; if (mountedRef.current) setSaving(false); }
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
    const saved = await save(categoryDraft.id ? `/api/inventory/categories/${categoryDraft.id}` : "/api/inventory/categories", categoryDraft.id ? "PATCH" : "POST", { name: categoryDraft.name, description: categoryDraft.description || null }, categoryDraft.id ? "Category updated." : "Category added.");
    if (saved) setCategoryDraft(null);
  }

  async function toggleCategory(category: Category) {
    await save(`/api/inventory/categories/${category.id}`, "PATCH", { is_active: !category.is_active }, `Category ${category.is_active ? "disabled" : "enabled"}.`);

  }

  async function toggleSupplier(supplier: Supplier) {
    await save(`/api/inventory/suppliers/${supplier.id}`, "PATCH", { is_active: !supplier.is_active }, `Supplier ${supplier.is_active ? "disabled" : "enabled"}.`);

  }

  async function toggleItem(product: Product) {
    await save(`/api/inventory/products/${product.id}`, "PATCH", { is_active: !product.is_active }, `Item ${product.is_active ? "disabled" : "enabled"}.`);

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


  // Expose the presentation contract only; request identities and write latches stay private.
  return {
    activeCategoryOptions, activeStockProducts, activeSuppliers, activeWarehouses, adjustForm, backToRegister, baseCurrency,
    browse, canManage, categories, categoryDraft, closeDocument, coreReady, documentCommitted,
    documentReady, editingId, error, filteredItems, filteredMovements, filteredPurchases, filteredStock,
    filteredSuppliers, isEditor, itemFilter, itemForm, loading, lowStockOnly, message,
    missingPurchaseSetup, modal, movements, openAdjustment, openCategories, openEditCategory, openEditItem,
    openEditSupplier, openEditWarehouse, openNewCategory, openNewItem, openNewSupplier, openNewWarehouse, openPurchase,
    openTransfer, openView, overview, products, purchaseForm, purchaseLines, purchaseProducts,
    purchaseTaxes, purchaseTotals, purchases, refresh, route, salesTaxes, saveCategory,
    saving, search, sectionReady, setAdjustForm, setCategoryDraft, setItemFilter, setItemForm,
    setLowStockOnly, setPurchaseForm, setPurchaseLines, setSearch, setSupplierForm, setTab, setTransferForm,
    setWarehouseForm, setupError, submitAdjustment, submitItem, submitPurchase, submitSupplier, submitTransfer,
    submitWarehouse, supplierForm, suppliers, tab, taxCodes, toggleCategory, toggleItem,
    toggleSupplier, transferAvailable, transferForm, transferProducts, warehouseForm, warehouses,
  };
}

export type InventoryWorkspaceState = ReturnType<typeof useInventoryWorkspace>;
