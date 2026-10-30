"use client";

import { inventoryCompare } from "@/lib/inventory-decimal";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowRightLeft, Check, ClipboardList, PackagePlus, Plus, Search, Settings2, ShoppingCart } from "lucide-react";
import { ServiceSalesPanel } from "@/components/service-sales-panel";
import type { InventoryWorkspaceState } from "@/hooks/use-inventory-workspace";
import { labelType, money, unitMoney, serviceDurationLabel } from "./inventory-model";
import "./inventory-register.css";

type WorkspaceProps = { vm: InventoryWorkspaceState };

/** Presentation only. All records, filtering and write actions stay in the workspace controller. */
export function InventoryRegister({ vm }: WorkspaceProps) {
  let content: ReactNode;
  switch (vm.tab) {
    case "overview": content = <OverviewRegister vm={vm} />; break;
    case "items": content = <ItemsRegister vm={vm} />; break;
    case "service_sales": content = <ServiceSalesPanel />; break;
    case "suppliers": content = <SuppliersRegister vm={vm} />; break;
    case "warehouses": content = <WarehousesRegister vm={vm} />; break;
    case "purchases": content = <PurchasesRegister vm={vm} />; break;
    case "stock": content = <StockRegister vm={vm} />; break;
    case "movements": content = <MovementsRegister vm={vm} />; break;
    case "categories": content = <CategoriesRegister vm={vm} />; break;
  }
  return <div className="inventory-register">{!vm.canManage ? <p className="inventory-readonly-note">Read-only access. Creating or changing inventory requires Finance management permission.</p> : null}{content}</div>;
}

function OverviewRegister({ vm }: WorkspaceProps) {
  const summary = vm.overview;
  if (!summary) return <InventoryEmpty title="Inventory summary unavailable" text="Refresh inventory to load the current position." />;
  return <div className="inventory-overview">
    <div className="inventory-overview-main">
      <section className="inventory-attention" aria-labelledby="inventory-attention-title">
        <div className="inventory-section-heading"><div><p className="inventory-eyebrow">Stock attention</p><h2 id="inventory-attention-title">Reorder watch</h2></div><button className="inventory-text-action" onClick={() => vm.browse({ tab: "stock", lowStockOnly: true, search: "" })}>Low-stock balances <ArrowRight aria-hidden="true" /></button></div>
        <div className="inventory-attention-summary"><strong>{summary.low_stock_count}</strong><div><p>products at or below reorder level</p><span>Includes {summary.out_of_stock_count} out of stock</span></div></div>
        <p className="inventory-caption">Product totals across locations · up to 20 products listed. Open a row for low-stock warehouse balances.</p>
        {summary.low_stock.length ? <ul className="inventory-watch-list">{summary.low_stock.map((item) => <li key={item.id}><button onClick={() => vm.browse({ tab: "stock", lowStockOnly: true, search: item.sku })}><span><b>{item.name}</b><small>{item.sku}</small></span><span className="inventory-watch-quantity"><b>{item.on_hand} <small>{item.unit}</small></b><small>Reorder at {item.reorder_level}</small></span><ArrowRight aria-hidden="true" /></button></li>)}</ul> : <div className="inventory-clear-state"><Check aria-hidden="true" /><span>No low-stock items right now.</span></div>}
      </section>
      <section className="inventory-valuation" aria-labelledby="inventory-valuation-title"><div className="inventory-section-heading"><div><p className="inventory-eyebrow">Current position</p><h2 id="inventory-valuation-title">Inventory value</h2></div><button className="inventory-text-action" onClick={() => vm.setTab("stock")}>Stock ledger <ArrowRight aria-hidden="true" /></button></div>
        {summary.inventory_values.length ? <dl className="inventory-currency-ledger">{summary.inventory_values.map((value) => <div key={value.currency}><dt>{value.currency}</dt><dd>{money(value.value, value.currency)}</dd></div>)}</dl> : <p className="inventory-muted inventory-inset">No inventory valuation reported.</p>}
        <p className="inventory-caption">Currencies are shown separately. No combined monetary total.</p>
      </section>
    </div>
    <aside className="inventory-overview-side">
      <section className="inventory-work-group" aria-labelledby="inventory-daily-title"><p className="inventory-eyebrow">Daily work</p><h2 id="inventory-daily-title">Move stock forward</h2><div className="inventory-action-list">
        <WorkAction title="Receive a purchase" text="Receive stock and record the related payable." icon={<ShoppingCart />} onClick={vm.openPurchase} disabled={!vm.canManage || vm.saving} />
        <WorkAction title="Adjust stock" text="Record counted, damaged or opening stock with a reason." icon={<PackagePlus />} onClick={vm.openAdjustment} disabled={!vm.canManage || vm.saving} />
        <WorkAction title="Transfer stock" text="Move available stock between warehouses." icon={<ArrowRightLeft />} onClick={vm.openTransfer} disabled={!vm.canManage || vm.saving} />
        <WorkAction title="Movement history" text="Review stock increases, decreases and transfers." icon={<ClipboardList />} onClick={() => vm.setTab("movements")} />
      </div></section>
      <section className="inventory-setup" aria-labelledby="inventory-setup-title"><p className="inventory-eyebrow">Purchase readiness</p><h2 id="inventory-setup-title">Before receiving stock</h2><ul>
        <SetupRow disabled={!vm.canManage || vm.saving} title="Stock products" count={vm.activeStockProducts.length} onClick={() => vm.openNewItem("stock_item")} />
        <SetupRow disabled={!vm.canManage || vm.saving} title="Suppliers" count={vm.activeSuppliers.length} onClick={vm.openNewSupplier} />
        <SetupRow disabled={!vm.canManage || vm.saving} title="Warehouses" count={vm.activeWarehouses.length} onClick={vm.openNewWarehouse} />
      </ul><p className="inventory-readiness" data-ready={vm.missingPurchaseSetup.length === 0}>{vm.missingPurchaseSetup.length === 0 ? "Ready to receive purchases." : "Complete the missing setup before receiving stock."}</p></section>
    </aside>
    <section className="inventory-catalog-strip" aria-label="Catalog and locations">
      <CatalogCount label="Stock products" value={summary.stock_products} onClick={() => vm.browse({ tab: "items", itemFilter: "stock_item", search: "" })} />
      <CatalogCount label="Service items" value={summary.service_items} onClick={() => vm.browse({ tab: "items", itemFilter: "service", search: "" })} />
      <CatalogCount label="Active suppliers" value={summary.active_suppliers} onClick={() => vm.setTab("suppliers")} />
      <CatalogCount label="Active warehouses" value={summary.active_warehouses} onClick={() => vm.setTab("warehouses")} />
    </section>
    <section className="inventory-catalog-work" aria-label="Manage catalog"><div><p className="inventory-eyebrow">Catalog & services</p><h2>Build the catalog your team works from</h2><p>Stock products, non-stock items and one-time or fixed-term services.</p></div><div className="inventory-actions"><button className="inventory-secondary" disabled={!vm.canManage || vm.saving} onClick={() => vm.openNewItem("stock_item")}><Plus aria-hidden="true" />Add a product</button><button className="inventory-secondary" disabled={!vm.canManage || vm.saving} onClick={() => vm.openNewItem("service")}><Plus aria-hidden="true" />Add a service</button><button className="inventory-secondary" onClick={() => vm.setTab("service_sales")}>Service sales <ArrowRight aria-hidden="true" /></button><button className="inventory-text-action" onClick={vm.openCategories}>Manage categories <Settings2 aria-hidden="true" /></button></div></section>
  </div>;
}

function ItemsRegister({ vm }: WorkspaceProps) {
  return <>
    <RegisterHeader title="Products & services" description="One catalog for stock products, non-stock items and one-time or fixed-term services." count={vm.filteredItems.length} actions={<><button className="inventory-secondary" onClick={vm.openCategories}><Settings2 aria-hidden="true" />Categories</button><AddButton disabled={!vm.canManage || vm.saving} onClick={() => vm.openNewItem()}>Add item</AddButton></>} />
    <div className="inventory-filters"><SearchField value={vm.search} onChange={vm.setSearch} label="Search items" placeholder="Search SKU, name or category…" /><label className="inventory-select"><span>Item type</span><select value={vm.itemFilter} onChange={(event) => vm.setItemFilter(event.target.value as typeof vm.itemFilter)}><option value="all">All items</option><option value="stock_item">Stock products</option><option value="non_stock_item">Non-stock products</option><option value="service">Services</option></select></label></div>
    <RegisterTable label="Products and services" headers={["SKU", "Item", "Type", "Duration", "Category", "Sell price", "On hand", "Status", "Actions"]}>{vm.filteredItems.map((product) => <tr key={product.id} id={`inventory-row-${product.id}`} data-inventory-row={product.id} tabIndex={-1}>
      <Cell label="SKU" className="inventory-code">{product.sku}</Cell><Cell label="Item" primary><RecordButton onClick={() => vm.openView("items", product.id)}>{product.name}</RecordButton><p className="inventory-row-note">{product.description || "—"}</p></Cell>
      <Cell label="Type"><InventoryBadge>{labelType(product.item_type)}</InventoryBadge></Cell><Cell label="Duration">{product.item_type === "service" ? serviceDurationLabel(product.service_duration_months) : "—"}</Cell><Cell label="Category">{vm.categories.find((category) => category.id === product.category_id)?.name || "Uncategorized"}</Cell>
      <Cell label="Sell price" numeric>{unitMoney(product.selling_price, product.currency)}</Cell><Cell label="On hand" numeric>{product.item_type === "stock_item" ? product.on_hand : "—"}</Cell><Cell label="Status"><InventoryStatus active={product.is_active} /></Cell>
      <Cell label="Actions" actions><button disabled={!vm.canManage || vm.saving} onClick={() => vm.openEditItem(product)}>Edit<span className="sr-only"> {product.name}</span></button><button disabled={!vm.canManage || vm.saving} onClick={() => void vm.toggleItem(product)}>{product.is_active ? "Disable" : "Enable"}<span className="sr-only"> {product.name}</span></button></Cell>
    </tr>)}</RegisterTable>
    {!vm.filteredItems.length ? <InventoryEmpty title={vm.products.length ? "No matching items" : "Your catalog is empty"} text={vm.products.length ? "Change the search or item type to see other catalog entries." : "Add your first product or service to get started."} /> : null}
  </>;
}

function SuppliersRegister({ vm }: WorkspaceProps) {
  return <>
    <RegisterHeader title="Suppliers" description="People and companies you purchase products from." count={vm.filteredSuppliers.length} actions={<AddButton disabled={!vm.canManage || vm.saving} onClick={vm.openNewSupplier}>Add supplier</AddButton>} />
    <div className="inventory-filters"><SearchField value={vm.search} onChange={vm.setSearch} label="Search suppliers" placeholder="Search supplier, contact or email…" /></div>
    <RegisterTable label="Suppliers" headers={["Supplier", "Contact", "Default currency", "Purchases", "Purchased", "Outstanding", "Status", "Actions"]}>{vm.filteredSuppliers.map((supplier) => <tr key={supplier.id} id={`inventory-row-${supplier.id}`} data-inventory-row={supplier.id} tabIndex={-1}>
      <Cell label="Supplier" primary><RecordButton onClick={() => vm.openView("suppliers", supplier.id)}>{supplier.name}</RecordButton><p className="inventory-row-note inventory-code">{supplier.vendor_code}</p></Cell><Cell label="Contact"><p>{supplier.contact_name || "—"}</p><p className="inventory-row-note">{supplier.email || supplier.phone || ""}</p></Cell>
      <Cell label="Default currency">{supplier.currency || "Not specified"}</Cell><Cell label="Purchases" numeric>{supplier.purchase_count}</Cell><Cell label="Purchased" numeric>{money(supplier.purchased_total)}<small className="inventory-row-note">Currency unverified</small></Cell><Cell label="Outstanding" numeric>{money(supplier.outstanding_total)}<small className="inventory-row-note">Currency unverified</small></Cell><Cell label="Status"><InventoryStatus active={supplier.is_active} /></Cell>
      <Cell label="Actions" actions><button disabled={!vm.canManage || vm.saving} onClick={() => vm.openEditSupplier(supplier)}>Edit<span className="sr-only"> {supplier.name}</span></button><button disabled={!vm.canManage || vm.saving} onClick={() => void vm.toggleSupplier(supplier)}>{supplier.is_active ? "Disable" : "Enable"}<span className="sr-only"> {supplier.name}</span></button></Cell>
    </tr>)}</RegisterTable>
    <p className="inventory-data-note">Purchased and outstanding are supplier aggregates as returned by the service; their currency breakdown is not provided. The supplier’s default currency does not establish the currency of these totals. Use purchase receipts for currency-specific amounts.</p>
    {!vm.filteredSuppliers.length ? <InventoryEmpty title={vm.suppliers.length ? "No matching suppliers" : "No suppliers yet"} text={vm.suppliers.length ? "Try another supplier, contact or email." : "Add a supplier before receiving a purchase."} /> : null}
  </>;
}

function WarehousesRegister({ vm }: WorkspaceProps) {
  return <><RegisterHeader title="Warehouses" description="Locations where physical stock is stored." count={vm.warehouses.length} actions={<AddButton disabled={!vm.canManage || vm.saving} onClick={vm.openNewWarehouse}>Add warehouse</AddButton>} />
    <RegisterTable label="Warehouses" headers={["Warehouse", "Code", "Address", "Default", "Status", "Actions"]}>{vm.warehouses.map((warehouse) => <tr key={warehouse.id} id={`inventory-row-${warehouse.id}`} data-inventory-row={warehouse.id} tabIndex={-1}>
      <Cell label="Warehouse" primary><RecordButton onClick={() => vm.openView("warehouses", warehouse.id)}>{warehouse.name}</RecordButton></Cell><Cell label="Code" className="inventory-code">{warehouse.code}</Cell><Cell label="Address">{warehouse.address || "No address saved"}</Cell><Cell label="Default">{warehouse.is_default ? <InventoryBadge>Default</InventoryBadge> : "—"}</Cell><Cell label="Status"><InventoryStatus active={warehouse.is_active} /></Cell><Cell label="Actions" actions><button disabled={!vm.canManage || vm.saving} onClick={() => vm.openEditWarehouse(warehouse)}>Edit<span className="sr-only"> {warehouse.name}</span></button></Cell>
    </tr>)}</RegisterTable>{!vm.warehouses.length ? <InventoryEmpty title="No warehouses yet" text="Add at least one warehouse before receiving stock." /> : null}</>;
}

function PurchasesRegister({ vm }: WorkspaceProps) {
  return <><RegisterHeader title="Purchases" description="Latest 200 receipts. Receive stock from suppliers and settle in Supplier Payables without creating another bill." count={vm.filteredPurchases.length} actions={<AddButton disabled={!vm.canManage || vm.saving} onClick={vm.openPurchase}>Receive purchase</AddButton>} />
    <div className="inventory-filters"><SearchField value={vm.search} onChange={vm.setSearch} label="Search purchases" placeholder="Search receipt, supplier, warehouse or reference…" /></div>
    <RegisterTable label="Purchase receipts" headers={["Receipt", "Supplier", "Warehouse", "Date", "Total", "Payable", "Status"]}>{vm.filteredPurchases.map((purchase) => <tr key={purchase.id} id={`inventory-row-${purchase.id}`} data-inventory-row={purchase.id} tabIndex={-1}>
      <Cell label="Receipt" primary><RecordButton onClick={() => vm.openView("purchases", purchase.id)}>{purchase.receipt_number}</RecordButton>{purchase.reference ? <p className="inventory-row-note">Ref: {purchase.reference}</p> : null}</Cell><Cell label="Supplier">{purchase.supplier_name}</Cell><Cell label="Warehouse">{purchase.warehouse_name}</Cell><Cell label="Date">{purchase.receipt_date}</Cell><Cell label="Total" numeric>{money(purchase.total, purchase.currency)}</Cell><Cell label="Payable" numeric>{money(purchase.balance_due, purchase.currency)}{(inventoryCompare(purchase.balance_due, "0") ?? 0) > 0 ? <Link href="/dashboard/accounting/payables" className="inventory-inline-link">Settle in Payables</Link> : null}</Cell><Cell label="Status"><InventoryBadge>{purchase.status}</InventoryBadge></Cell>
    </tr>)}</RegisterTable>{!vm.filteredPurchases.length ? <InventoryEmpty title={vm.purchases.length ? "No matching purchases" : "No purchases received yet"} text={vm.purchases.length ? "Try a different receipt, supplier, warehouse or reference." : "Receive a purchase to add stock and its related payable."} /> : null}</>;
}

function StockRegister({ vm }: WorkspaceProps) {
  return <><RegisterHeader title="Stock on hand" description="Current quantity, average cost and value by warehouse. The low-stock filter checks each warehouse balance, not the product total." count={vm.filteredStock.length} actions={<><button className="inventory-secondary" disabled={!vm.canManage || vm.saving} onClick={vm.openTransfer}><ArrowRightLeft aria-hidden="true" />Transfer stock</button><AddButton disabled={!vm.canManage || vm.saving} onClick={vm.openAdjustment}>Adjust stock</AddButton></>} />
    <div className="inventory-filters"><SearchField value={vm.search} onChange={vm.setSearch} label="Search stock" placeholder="Search product, SKU or warehouse…" /><button className="inventory-filter-toggle" aria-pressed={vm.lowStockOnly} onClick={() => vm.setLowStockOnly((current) => !current)}>{vm.lowStockOnly ? "Showing low stock" : "Low stock only"}</button></div>
    <RegisterTable label="Stock by warehouse" headers={["Product", "Warehouse", "On hand", "Average cost", "Inventory value", "Reorder level"]}>{vm.filteredStock.map((row) => <tr key={`${row.product_id}-${row.warehouse_id}`} id={`inventory-row-${row.product_id}-${row.warehouse_id}`} data-inventory-row={row.product_id} tabIndex={-1}>
      <Cell label="Product" primary><b>{row.product_name}</b><p className="inventory-row-note inventory-code">{row.sku}</p></Cell><Cell label="Warehouse">{row.warehouse_name}</Cell><Cell label="On hand" numeric><b className={(inventoryCompare(row.on_hand, row.reorder_level) ?? 1) <= 0 ? "inventory-low-quantity" : ""}>{row.on_hand}</b></Cell><Cell label="Average cost" numeric>{unitMoney(row.average_unit_cost, row.currency)}</Cell><Cell label="Inventory value" numeric>{money(row.inventory_value, row.currency)}</Cell><Cell label="Reorder level" numeric>{row.reorder_level}</Cell>
    </tr>)}</RegisterTable>{!vm.filteredStock.length ? <InventoryEmpty title="No stock balances to show" text={vm.lowStockOnly ? "No low-stock balances match this filter." : vm.search ? "No balances match this product, SKU or warehouse." : "Receive a purchase to add inventory."} /> : null}</>;
}

function MovementsRegister({ vm }: WorkspaceProps) {
  return <><RegisterHeader title="Movement history" description="Latest 200 stock increases, decreases and warehouse transfers." count={vm.filteredMovements.length} /><div className="inventory-filters"><SearchField value={vm.search} onChange={vm.setSearch} label="Search movements" placeholder="Search product, warehouse, movement or reason…" /></div>
    <RegisterTable label="Stock movements" headers={["Date", "Product", "Warehouse", "Movement", "Quantity", "Unit cost", "After", "Reason / reference"]}>{vm.filteredMovements.map((movement) => {
      const product = movement.product_id ? vm.products.find((item) => item.id === movement.product_id) : vm.products.find((item) => item.sku === movement.sku);
      const currency = product?.currency;
      return <tr key={movement.id} id={`inventory-row-${movement.id}`} data-inventory-row={movement.id} tabIndex={-1}><Cell label="Date">{movement.movement_date}</Cell><Cell label="Product" primary><b>{movement.product_name}</b><p className="inventory-row-note inventory-code">{movement.sku}</p></Cell><Cell label="Warehouse">{movement.warehouse_name}</Cell><Cell label="Movement"><InventoryBadge>{movement.movement_type.replaceAll("_", " ")}</InventoryBadge></Cell><Cell label="Quantity" numeric><span className={(inventoryCompare(movement.quantity, "0") ?? 0) < 0 ? "inventory-negative" : "inventory-positive"}>{(inventoryCompare(movement.quantity, "0") ?? 0) > 0 ? "+" : ""}{movement.quantity}</span></Cell><Cell label="Unit cost" numeric>{unitMoney(movement.unit_cost, currency || "")}{!currency ? <small className="inventory-row-note">Currency unavailable</small> : null}</Cell><Cell label="After" numeric>{movement.quantity_after}</Cell><Cell label="Reason / reference">{movement.reason || movement.reference || "—"}{movement.reason && movement.reference ? <p className="inventory-row-note">Ref: {movement.reference}</p> : null}</Cell></tr>;
    })}</RegisterTable>{!vm.filteredMovements.length ? <InventoryEmpty title={vm.movements.length ? "No matching stock movements" : "No stock movements yet"} text={vm.movements.length ? "Try a different product, warehouse, movement or reason." : "Posted stock changes will appear in this history."} /> : null}</>;
}

function CategoriesRegister({ vm }: WorkspaceProps) {
  return <><RegisterHeader title="Categories" description="Organize the product and service catalog without changing stock balances." count={vm.categories.length} actions={<AddButton disabled={!vm.canManage || vm.saving} onClick={vm.openNewCategory}>Add category</AddButton>} /><RegisterTable label="Catalog categories" headers={["Category", "Description", "Status", "Actions"]}>{vm.categories.map((category) => <tr key={category.id} id={`inventory-row-${category.id}`} data-inventory-row={category.id} tabIndex={-1}><Cell label="Category" primary><b>{category.name}</b></Cell><Cell label="Description">{category.description || "No description"}</Cell><Cell label="Status"><InventoryStatus active={category.is_active} /></Cell><Cell label="Actions" actions><button disabled={!vm.canManage || vm.saving} onClick={() => vm.openEditCategory(category)}>Edit<span className="sr-only"> {category.name}</span></button><button disabled={!vm.canManage || vm.saving} onClick={() => void vm.toggleCategory(category)}>{category.is_active ? "Disable" : "Enable"}<span className="sr-only"> {category.name}</span></button></Cell></tr>)}</RegisterTable>{!vm.categories.length ? <InventoryEmpty title="No categories yet" text="Add a category to organize your catalog. Items can also remain uncategorized." /> : null}</>;
}

function RegisterHeader({ title, description, count, actions }: { title: string; description: string; count: number; actions?: ReactNode }) {
  return <header className="inventory-register-header"><div><p className="inventory-eyebrow">{count} {count === 1 ? "record" : "records"} shown</p><h2>{title}</h2><p>{description}</p></div>{actions ? <div className="inventory-actions">{actions}</div> : null}</header>;
}
function AddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled: boolean }) { return <button className="inventory-primary" disabled={disabled} onClick={onClick}><Plus aria-hidden="true" />{children}</button>; }
function RecordButton({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="inventory-record-link" onClick={onClick}>{children}</button>; }
function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (value: string) => void; label: string; placeholder: string }) { return <label className="inventory-search"><span className="sr-only">{label}</span><Search aria-hidden="true" /><input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>; }
function RegisterTable({ label, headers, children }: { label: string; headers: string[]; children: ReactNode }) { return <div className="inventory-table-wrap"><table className="inventory-table"><caption className="sr-only">{label}</caption><thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Cell({ label, children, primary = false, numeric = false, actions = false, className = "" }: { label: string; children: ReactNode; primary?: boolean; numeric?: boolean; actions?: boolean; className?: string }) { return <td data-label={label} className={`${primary ? "inventory-cell-primary" : ""} ${numeric ? "inventory-number" : ""} ${actions ? "inventory-cell-actions" : ""} ${className}`}>{actions ? <div className="inventory-row-actions">{children}</div> : <div className="inventory-cell-value">{children}</div>}</td>; }
export function InventoryBadge({ children }: { children: ReactNode }) { return <span className="inventory-badge">{children}</span>; }
export function InventoryStatus({ active }: { active: boolean }) { return <span className="inventory-status" data-active={active}>{active ? "Active" : "Inactive"}</span>; }
export function InventoryEmpty({ title, text }: { title: string; text: string }) { return <div className="inventory-empty"><h3>{title}</h3><p>{text}</p></div>; }
function WorkAction({ title, text, icon, onClick, disabled = false }: { title: string; text: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) { return <button disabled={disabled} onClick={onClick}><span className="inventory-action-icon" aria-hidden="true">{icon}</span><span><b>{title}</b><small>{text}</small></span><ArrowRight aria-hidden="true" /></button>; }
function SetupRow({ title, count, onClick, disabled }: { title: string; count: number; onClick: () => void; disabled: boolean }) { return <li><span className="inventory-setup-indicator" data-ready={count > 0}>{count > 0 ? <Check aria-hidden="true" /> : "!"}</span><span><b>{title}</b><small>{count ? `${count} active` : "Required before purchases"}</small></span><button disabled={disabled} onClick={onClick} aria-label={`Add ${title === "Stock products" ? "stock product" : title === "Suppliers" ? "supplier" : "warehouse"}`}><Plus aria-hidden="true" /></button></li>; }
function CatalogCount({ label, value, onClick }: { label: string; value: number; onClick: () => void }) { return <button onClick={onClick}><span>{label}</span><strong>{value}</strong><ArrowRight aria-hidden="true" /></button>; }
