"use client";

import { inventoryCompare } from "@/lib/inventory-decimal";

import Link from "next/link";
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import type { InventoryWorkspaceState } from "@/hooks/use-inventory-workspace";
import { labelType, money, unitMoney, serviceDurationLabel } from "./inventory-model";
import { InventoryBadge, InventoryEmpty, InventoryStatus } from "./inventory-register";
import "./inventory-register.css";

type DetailProps = { vm: InventoryWorkspaceState; section: "items" | "suppliers" | "warehouses" | "purchases"; id: string };

/** Read-only documents backed by the same loaded inventory records as the registers. */
export function InventoryDetail({ vm, section, id }: DetailProps) {
  let content: ReactNode;
  if (section === "items") content = <ItemDetail vm={vm} id={id} />;
  else if (section === "suppliers") content = <SupplierDetail vm={vm} id={id} />;
  else if (section === "warehouses") content = <WarehouseDetail vm={vm} id={id} />;
  else content = <PurchaseDetail vm={vm} id={id} />;
  return <article className="inventory-detail">{!vm.canManage ? <p className="inventory-readonly-note">Read-only access. Changing inventory requires Finance management permission.</p> : null}{content}</article>;
}

function ItemDetail({ vm, id }: Pick<DetailProps, "vm" | "id">) {
  const item = vm.products.find((product) => product.id === id);
  if (!item) return <MissingRecord name="Item" />;
  const tax = vm.taxCodes.find((code) => code.id === item.tax_code_id);
  return <>
    <DocumentHeader eyebrow={labelType(item.item_type)} title={item.name} code={item.sku} status={<InventoryStatus active={item.is_active} />} onEdit={vm.canManage && !vm.saving ? () => vm.openEditItem(item) : undefined} />
    <div className="inventory-document-rail"><DocumentMetric label="Selling price" value={unitMoney(item.selling_price, item.currency)} /><DocumentMetric label="On hand" value={item.item_type === "stock_item" ? `${item.on_hand} ${item.unit}` : "Not a stock item"} /><DocumentMetric label={item.item_type === "service" ? "Service term" : "Reorder level"} value={item.item_type === "service" ? serviceDurationLabel(item.service_duration_months) : `${item.reorder_level} ${item.unit}`} /></div>
    <div className="inventory-document-grid"><div>
      <DetailSection title="Catalog record" eyebrow="Identity"><dl className="inventory-facts"><Fact label="SKU">{item.sku}</Fact><Fact label="Barcode">{item.barcode || "Not specified"}</Fact><Fact label="Category">{vm.categories.find((category) => category.id === item.category_id)?.name || "Uncategorized"}</Fact><Fact label="Unit">{item.unit}</Fact><Fact label="Item type">{labelType(item.item_type)}</Fact>{item.item_type === "service" ? <Fact label="Duration">{serviceDurationLabel(item.service_duration_months)}</Fact> : null}</dl>{item.description ? <div className="inventory-document-note"><h3>Description</h3><p>{item.description}</p></div> : null}</DetailSection>
      <DetailSection title="Stock policy" eyebrow="Handling"><dl className="inventory-facts"><Fact label="Inventory tracking">{item.track_inventory ? "Tracked" : "Not tracked"}</Fact><Fact label="Negative stock">{item.allow_negative_stock ? "Allowed" : "Not allowed"}</Fact><Fact label="Reorder level">{item.reorder_level} {item.unit}</Fact><Fact label="Status"><InventoryStatus active={item.is_active} /></Fact></dl></DetailSection>
    </div><aside><DetailSection title="Pricing & valuation" eyebrow={item.currency || "Currency not specified"}><dl className="inventory-financial-ledger"><Fact label="Selling price">{unitMoney(item.selling_price, item.currency)}</Fact><Fact label="Standard cost">{unitMoney(item.standard_cost, item.currency)}</Fact><Fact label="Last purchase cost">{unitMoney(item.last_purchase_cost, item.currency)}</Fact><Fact label="Inventory value">{money(item.inventory_value, item.currency)}</Fact></dl><p className="inventory-caption">Amounts use the item’s recorded currency.</p></DetailSection><DetailSection title="Sales tax" eyebrow="Tax setting"><p className="inventory-detail-value">{tax ? `${tax.code} · ${tax.rate}%` : item.tax_code_id ? "Tax code details unavailable" : "No tax code"}</p>{tax ? <p className="inventory-muted">{tax.name}</p> : null}</DetailSection></aside></div>
  </>;
}

function SupplierDetail({ vm, id }: Pick<DetailProps, "vm" | "id">) {
  const supplier = vm.suppliers.find((record) => record.id === id);
  if (!supplier) return <MissingRecord name="Supplier" />;
  return <>
    <DocumentHeader eyebrow="Supplier" title={supplier.name} code={supplier.vendor_code} status={<InventoryStatus active={supplier.is_active} />} onEdit={vm.canManage && !vm.saving ? () => vm.openEditSupplier(supplier) : undefined} />
    <div className="inventory-document-rail"><DocumentMetric label="Purchases" value={supplier.purchase_count} /><DocumentMetric label="Default currency" value={supplier.currency || "Not specified"} /><DocumentMetric label="Country" value={supplier.country_code || "Not specified"} /></div>
    <div className="inventory-document-grid"><div><DetailSection title="Contact details" eyebrow="Relationship"><dl className="inventory-facts"><Fact label="Contact name">{supplier.contact_name || "Not specified"}</Fact><Fact label="Email">{supplier.email || "Not specified"}</Fact><Fact label="Phone">{supplier.phone || "Not specified"}</Fact><Fact label="Website">{supplier.website || "Not specified"}</Fact></dl></DetailSection><DetailSection title="Supplier record" eyebrow="Purchasing setup"><dl className="inventory-facts"><Fact label="Vendor code">{supplier.vendor_code}</Fact><Fact label="Tax identifier">{supplier.tax_identifier || "Not specified"}</Fact><Fact label="Country">{supplier.country_code || "Not specified"}</Fact><Fact label="Default currency">{supplier.currency || "Not specified"}</Fact></dl>{supplier.notes ? <div className="inventory-document-note"><h3>Internal notes</h3><p>{supplier.notes}</p></div> : null}</DetailSection></div>
      <aside><DetailSection title="Reported purchase totals" eyebrow="Currency breakdown unavailable"><dl className="inventory-financial-ledger"><Fact label="Purchased">{money(supplier.purchased_total)}</Fact><Fact label="Outstanding">{money(supplier.outstanding_total)}</Fact></dl><p className="inventory-data-note">These are the returned supplier aggregates, not verified single-currency amounts. The supplier’s default currency does not establish the currency of these totals. Use individual receipts for currency-specific values.</p></DetailSection></aside></div>
  </>;
}

function WarehouseDetail({ vm, id }: Pick<DetailProps, "vm" | "id">) {
  const warehouse = vm.warehouses.find((record) => record.id === id);
  if (!warehouse) return <MissingRecord name="Warehouse" />;
  return <><DocumentHeader eyebrow="Warehouse" title={warehouse.name} code={warehouse.code} status={<><InventoryStatus active={warehouse.is_active} />{warehouse.is_default ? <InventoryBadge>Default warehouse</InventoryBadge> : null}</>} onEdit={vm.canManage && !vm.saving ? () => vm.openEditWarehouse(warehouse) : undefined} />
    <div className="inventory-document-grid"><DetailSection title="Location record" eyebrow="Storage"><dl className="inventory-facts"><Fact label="Warehouse code">{warehouse.code}</Fact><Fact label="Warehouse name">{warehouse.name}</Fact><Fact label="Default location">{warehouse.is_default ? "Yes" : "No"}</Fact><Fact label="Status"><InventoryStatus active={warehouse.is_active} /></Fact></dl><div className="inventory-document-note"><h3>Address</h3><p>{warehouse.address || "No address saved"}</p></div></DetailSection><aside><DetailSection title="Stock by location" eyebrow="Inventory register"><p className="inventory-muted">Warehouse quantities, average costs and values are listed in Stock on hand. This location record does not combine balances across currencies.</p></DetailSection></aside></div>
  </>;
}

function PurchaseDetail({ vm, id }: Pick<DetailProps, "vm" | "id">) {
  const purchase = vm.purchases.find((record) => record.id === id);
  if (!purchase) return <MissingRecord name="Purchase receipt" limited />;
  return <><DocumentHeader eyebrow="Purchase receipt" title={purchase.receipt_number} code={purchase.receipt_date} status={<InventoryBadge>{purchase.status}</InventoryBadge>} />
    <div className="inventory-document-rail"><DocumentMetric label="Receipt total" value={money(purchase.total, purchase.currency)} /><DocumentMetric label="Balance due" value={money(purchase.balance_due, purchase.currency)} /><DocumentMetric label="Currency" value={purchase.currency} /></div>
    <div className="inventory-document-grid"><DetailSection title="Receipt record" eyebrow="Supplier & destination"><dl className="inventory-facts"><Fact label="Supplier">{purchase.supplier_name}</Fact><Fact label="Warehouse">{purchase.warehouse_name}</Fact><Fact label="Receipt date">{purchase.receipt_date}</Fact><Fact label="Receipt number">{purchase.receipt_number}</Fact><Fact label="Reference">{purchase.reference || "Not specified"}</Fact><Fact label="Status"><InventoryBadge>{purchase.status}</InventoryBadge></Fact></dl><p className="inventory-data-note">Receipt summary only. Line items are not supplied by this register.</p></DetailSection>
      <aside><DetailSection title="Receipt amounts" eyebrow={purchase.currency}><dl className="inventory-financial-ledger"><Fact label="Subtotal">{money(purchase.subtotal, purchase.currency)}</Fact><Fact label="Tax">{money(purchase.tax_total, purchase.currency)}</Fact><Fact label="Total">{money(purchase.total, purchase.currency)}</Fact><Fact label="Payable">{money(purchase.balance_due, purchase.currency)}</Fact></dl>{(inventoryCompare(purchase.balance_due, "0") ?? 0) > 0 ? <div className="inventory-receipt-next"><p>Settle this receipt in Supplier Payables without creating another bill.</p><Link href="/dashboard/accounting/payables" className="inventory-primary">Settle in Payables</Link></div> : null}</DetailSection></aside></div>
  </>;
}

function DocumentHeader({ eyebrow, title, code, status, onEdit }: { eyebrow: string; title: string; code: string; status: ReactNode; onEdit?: () => void }) { return <header className="inventory-document-header"><div><p className="inventory-eyebrow">{eyebrow}</p><h2>{title}</h2><div className="inventory-document-meta"><span className="inventory-code">{code}</span>{status}</div></div>{onEdit ? <button className="inventory-primary" onClick={onEdit}><Pencil aria-hidden="true" />Edit record</button> : null}</header>; }
function DocumentMetric({ label, value }: { label: string; value: ReactNode }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function DetailSection({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) { return <section className="inventory-detail-section"><p className="inventory-eyebrow">{eyebrow}</p><h3>{title}</h3>{children}</section>; }
function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function MissingRecord({ name, limited = false }: { name: string; limited?: boolean }) { return <InventoryEmpty title={`${name} unavailable`} text={limited ? "This receipt is not in the latest 200 loaded purchases. Return to the purchase register or refresh; no empty receipt has been created." : "This record was not found in the loaded inventory data. Return to the register or refresh inventory."} />; }
