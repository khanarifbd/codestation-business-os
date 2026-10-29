"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import { SearchableSelect } from "@/components/searchable-select";
import { ServiceDurationFields } from "@/components/service-duration-fields";
import type { InventoryWorkspaceState } from "@/hooks/use-inventory-workspace";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from "@/lib/company-options";
import { labelType, money } from "./inventory-model";
import "./inventory-editor.css";

type EditorProps = { vm: InventoryWorkspaceState };

/** Document presentation only. Drafts, validation and mutations remain in the workspace controller. */
export function InventoryEditor({ vm }: EditorProps) {
  switch (vm.modal) {
    case "item": return <ItemEditor vm={vm} />;
    case "supplier": return <SupplierEditor vm={vm} />;
    case "warehouse": return <WarehouseEditor vm={vm} />;
    case "categories": return <CategoryEditor vm={vm} />;
    case "purchase": return <PurchaseEditor vm={vm} />;
    case "adjustment": return <AdjustmentEditor vm={vm} />;
    case "transfer": return <TransferEditor vm={vm} />;
    default: return null;
  }
}

function ItemEditor({ vm }: EditorProps) {
  const { itemForm, setItemForm, editingId, activeCategoryOptions, salesTaxes, submitItem } = vm;
  return <EditorForm vm={vm} onSubmit={submitItem} saveLabel={editingId ? "Update item" : "Add item"} summary={
    <EditorContext eyebrow="Catalog entry" title={itemForm.name || "Product / service"} note="Adding or updating a catalog item does not receive stock. Record a purchase or stock adjustment to change quantity.">
      <ContextRow label="Item type" value={labelType(itemForm.item_type)} />
      <ContextRow label="SKU / code" value={itemForm.sku || "Not entered"} />
      <ContextRow label="Selling price" value={money(itemForm.selling_price, itemForm.currency)} />
      <ContextRow label="Unit" value={itemForm.unit || "Not entered"} />
      {editingId ? <ContextRow label="Availability" value={itemForm.is_active ? "Active" : "Inactive"} /> : null}
    </EditorContext>
  }>
    <EditorSection number="01" title="Catalog identity" description="Define how your team finds and identifies this item.">
<Select label="Item type" helpText="Choose Stock product for a physical item whose quantity you track, Non-stock product for something you sell without stock tracking, or Service for work you provide." value={itemForm.item_type} onChange={(value) => setItemForm({ ...itemForm, item_type: value, track_inventory: value === "stock_item", service_duration_months: value === "service" ? itemForm.service_duration_months : "" })} options={[["stock_item", "Stock product"], ["non_stock_item", "Non-stock product"], ["service", "Service"]]} />
<Input label="SKU / Code" helpText="A unique, stable internal code used in search, sales documents and reports. Example: PROD-001 or WEB-DEV. Avoid reusing the same code for different items." value={itemForm.sku} onChange={(value) => setItemForm({ ...itemForm, sku: value })} />
<Input label="Name" helpText="The customer-facing name shown when this catalog item is selected in quotations, orders and invoices." value={itemForm.name} onChange={(value) => setItemForm({ ...itemForm, name: value })} />
<SearchableField label="Category" helpText="Groups similar products or services for faster search and reporting. Example: Tracking Device. Leave Uncategorized if you do not need grouping yet." value={itemForm.category_id} onChange={(value) => setItemForm({ ...itemForm, category_id: value })} options={activeCategoryOptions} placeholder="Uncategorized" searchPlaceholder="Search categories..." />
<Input label="Barcode" helpText="Optional barcode or manufacturer code used for scanning or external identification. Leave blank when the item has no barcode." optional value={itemForm.barcode} onChange={(value) => setItemForm({ ...itemForm, barcode: value })} />
<Input label="Unit" helpText="How quantity is measured. Use pcs or unit for physical products; hour, day, project or month for services. Enter a unit name, not a quantity." value={itemForm.unit} onChange={(value) => setItemForm({ ...itemForm, unit: value })} />
</EditorSection>
<EditorSection number="02" title="Pricing & stock policy" description="Defaults for sales documents; stock quantities are managed separately.">
<CurrencyInput label="Currency" helpText="The currency of this item's default selling price. Pick the currency you normally quote or sell this item in; Business OS keeps currencies separate." value={itemForm.currency} onChange={(value) => setItemForm({ ...itemForm, currency: value })} />
<Input label="Selling price" helpText="Default price per unit used to prefill quotations, orders and invoices. You can still change the final price on a specific sales document." type="number" value={itemForm.selling_price} onChange={(value) => setItemForm({ ...itemForm, selling_price: value })} />
{itemForm.item_type === "service" ? <ServiceDurationFields durationMonths={itemForm.service_duration_months} onChange={(value) => setItemForm({ ...itemForm, service_duration_months: value })} /> : null}
{itemForm.item_type === "stock_item" ? <><Input label="Standard unit cost" helpText="Your expected/default acquisition cost for one unit. It helps prefill stock cost when no purchase history exists, but entering a value here does not add stock. Example: if one item costs 350 in the selected currency, enter 350. Receive a purchase or post a stock adjustment to add quantity." type="number" value={itemForm.standard_cost} onChange={(value) => setItemForm({ ...itemForm, standard_cost: value })} /><Input label="Low-stock alert level" helpText="The on-hand quantity at or below which Business OS flags this item as low stock. Example: enter 10 to get an alert at 10 units or fewer. Use 0 if you only want an out-of-stock warning." type="number" value={itemForm.reorder_level} onChange={(value) => setItemForm({ ...itemForm, reorder_level: value })} /></> : null}
<Select label="Sales tax" helpText="Default sales tax for this item when used in sales documents. Choose No tax when tax does not apply; the selected tax is snapshotted on the transaction." required={false} value={itemForm.tax_code_id} onChange={(value) => setItemForm({ ...itemForm, tax_code_id: value })} options={[["", "No tax"], ...salesTaxes.map((tax) => [tax.id, `${tax.code} · ${tax.rate}%`])]} />
</EditorSection>
<EditorSection number="03" title="Description & availability" description="Keep the catalog entry clear and up to date.">
<Input label="Description" helpText="Optional details that help your team and customers understand what is included in the product or service." optional value={itemForm.description} onChange={(value) => setItemForm({ ...itemForm, description: value })} />
{editingId ? <label className="inventory-editor-check"><input type="checkbox" checked={itemForm.is_active} onChange={(event) => setItemForm({ ...itemForm, is_active: event.target.checked })} />Active item</label> : null}
</EditorSection>
  </EditorForm>;
}
function SupplierEditor({ vm }: EditorProps) {
  const { supplierForm, setSupplierForm, editingId, submitSupplier } = vm;
  return <EditorForm vm={vm} onSubmit={submitSupplier} saveLabel={editingId ? "Update supplier" : "Add supplier"} summary={
    <EditorContext eyebrow="Supplier record" title={supplierForm.name || "Supplier details"} note="This saves supplier details only. Receive a purchase separately to record received goods and their cost.">
      <ContextRow label="Contact" value={supplierForm.contact_name || "Not entered"} />
      <ContextRow label="Default currency" value={supplierForm.currency || "Not selected"} />
      <ContextRow label="Country" value={supplierForm.country_code || "Not selected"} />
      {editingId ? <ContextRow label="Availability" value={supplierForm.is_active ? "Active" : "Inactive"} /> : null}
    </EditorContext>
  }>
    <EditorSection number="01" title="Supplier & contacts" description="Identify the business and the people you work with.">
<Input label="Supplier name" value={supplierForm.name} onChange={(value) => setSupplierForm({ ...supplierForm, name: value })} />
<Input label="Contact person" optional value={supplierForm.contact_name} onChange={(value) => setSupplierForm({ ...supplierForm, contact_name: value })} />
<Input label="Email" optional type="email" value={supplierForm.email} onChange={(value) => setSupplierForm({ ...supplierForm, email: value })} />
<Input label="Phone" optional value={supplierForm.phone} onChange={(value) => setSupplierForm({ ...supplierForm, phone: value })} />
</EditorSection>
<EditorSection number="02" title="Purchasing details" description="Default currency and supporting business information.">
<SearchableSelect label="Country" value={supplierForm.country_code} onValueChange={(value) => setSupplierForm({ ...supplierForm, country_code: value })} options={COUNTRY_OPTIONS} placeholder="Select country" searchPlaceholder="Search country or code..." />
<CurrencyInput label="Default currency" value={supplierForm.currency} onChange={(value) => setSupplierForm({ ...supplierForm, currency: value })} />
<Input label="Tax / VAT ID" optional value={supplierForm.tax_identifier} onChange={(value) => setSupplierForm({ ...supplierForm, tax_identifier: value })} />
<Input label="Website" optional value={supplierForm.website} onChange={(value) => setSupplierForm({ ...supplierForm, website: value })} />
</EditorSection>
<EditorSection number="03" title="Internal notes & availability" description="Keep useful context with the supplier record.">
<Input label="Notes" optional value={supplierForm.notes} onChange={(value) => setSupplierForm({ ...supplierForm, notes: value })} />
{editingId ? <label className="inventory-editor-check"><input type="checkbox" checked={supplierForm.is_active} onChange={(event) => setSupplierForm({ ...supplierForm, is_active: event.target.checked })} />Active supplier</label> : null}
</EditorSection>
  </EditorForm>;
}
function WarehouseEditor({ vm }: EditorProps) {
  const { warehouseForm, setWarehouseForm, editingId, submitWarehouse } = vm;
  return <EditorForm vm={vm} onSubmit={submitWarehouse} saveLabel={editingId ? "Update warehouse" : "Add warehouse"} summary={
    <EditorContext eyebrow="Stock location" title={warehouseForm.name || "Warehouse details"} note="Saving warehouse details does not move stock. Use a stock transfer to move existing quantity between locations.">
      <ContextRow label="Warehouse code" value={warehouseForm.code || "Not entered"} />
      <ContextRow label="Default warehouse" value={warehouseForm.is_default ? "Yes" : "No"} />
      {editingId ? <ContextRow label="Availability" value={warehouseForm.is_active ? "Active" : "Inactive"} /> : null}
    </EditorContext>
  }>
    <EditorSection number="01" title="Warehouse identity" description="A clear code and name help distinguish your stock locations.">
<Input label="Warehouse code" value={warehouseForm.code} onChange={(value) => setWarehouseForm({ ...warehouseForm, code: value.toUpperCase() })} />
<Input label="Warehouse name" value={warehouseForm.name} onChange={(value) => setWarehouseForm({ ...warehouseForm, name: value })} />
<Input label="Address" optional value={warehouseForm.address} onChange={(value) => setWarehouseForm({ ...warehouseForm, address: value })} />
</EditorSection>
<EditorSection number="02" title="Location preferences" description="Choose the default location and keep its availability current.">
<label className="inventory-editor-check"><input type="checkbox" checked={warehouseForm.is_default} onChange={(event) => setWarehouseForm({ ...warehouseForm, is_default: event.target.checked })} />Use as default warehouse</label>
{editingId ? <label className="inventory-editor-check"><input type="checkbox" checked={warehouseForm.is_active} onChange={(event) => setWarehouseForm({ ...warehouseForm, is_active: event.target.checked })} />Active warehouse</label> : null}
</EditorSection>
  </EditorForm>;
}
function CategoryEditor({ vm }: EditorProps) {
  const { categoryDraft, setCategoryDraft, saveCategory } = vm;
  return <EditorForm vm={vm} onSubmit={saveCategory} saveLabel={categoryDraft.id ? "Update" : "Add"} summary={
    <EditorContext eyebrow="Catalog organization" title={categoryDraft.name || "Category details"} note="A category organizes catalog items. It does not change their quantity, pricing or currency.">
      <ContextRow label="Action" value={categoryDraft.id ? "Update category" : "Add category"} />
    </EditorContext>
  }>
    <EditorSection number="01" title="Category details" description="Group related products and services with a useful, recognizable name.">
<Input label="Category name" value={categoryDraft.name} onChange={(value) => setCategoryDraft({ ...categoryDraft, name: value })} />
<Input label="Description" optional value={categoryDraft.description} onChange={(value) => setCategoryDraft({ ...categoryDraft, description: value })} />
</EditorSection>
  </EditorForm>;
}
function PurchaseEditor({ vm }: EditorProps) {
  const { purchaseForm, setPurchaseForm, purchaseLines, setPurchaseLines, suppliers, baseCurrency, activeSuppliers, activeWarehouses, purchaseProducts, purchaseTaxes, purchaseTotals, submitPurchase } = vm;
  return <EditorForm vm={vm} onSubmit={submitPurchase} saveLabel={"Receive purchase & update stock"} summary={
    <EditorContext eyebrow="Purchase receipt" title="Receipt estimate" caution note="Receiving this purchase posts the receipt and increases stock in the selected warehouse. Review quantities and unit costs before continuing.">
      <ContextRow label="Currency" value={purchaseForm.currency} />
      <ContextRow label="Subtotal" value={money(purchaseTotals.subtotal, purchaseForm.currency)} />
      <ContextRow label="Estimated tax" value={money(purchaseTotals.tax, purchaseForm.currency)} />
      <ContextRow label="Estimated total" value={money(purchaseTotals.total, purchaseForm.currency)} strong />
      <ContextRow label="Receive into" value={activeWarehouses.find((warehouse) => warehouse.id === purchaseForm.warehouse_id)?.name || "Choose a warehouse"} />
    </EditorContext>
  }>
    <EditorSection number="01" title="Receipt details" description="Link the supplier, receiving location and purchase currency."><SearchableField label="Supplier" helpText="Choose the supplier you purchased from. This links the purchase to the supplier record and payable history." value={purchaseForm.supplier_id} onChange={(value) => { const supplier = suppliers.find((item) => item.id === value); const currency = supplier?.currency || baseCurrency; setPurchaseForm({ ...purchaseForm, supplier_id: value, currency }); setPurchaseLines([{ product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }]); }} options={activeSuppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.name} · ${supplier.vendor_code}`, keywords: `${supplier.name} ${supplier.vendor_code} ${supplier.contact_name ?? ""} ${supplier.email ?? ""}` }))} placeholder="Select supplier" searchPlaceholder="Search supplier name or code..." /><SearchableField label="Receive into warehouse" helpText="Choose the warehouse that will receive the stock. The received quantity and inventory value will increase in this location." value={purchaseForm.warehouse_id} onChange={(value) => setPurchaseForm({ ...purchaseForm, warehouse_id: value })} options={activeWarehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} · ${warehouse.code}`, keywords: `${warehouse.name} ${warehouse.code} ${warehouse.address ?? ""}` }))} placeholder="Select warehouse" searchPlaceholder="Search warehouse name or code..." /><Input label="Purchase date" helpText="The date the goods were received or the purchase was recorded. This date is used for inventory movement and related accounting timing." type="date" value={purchaseForm.receipt_date} onChange={(value) => setPurchaseForm({ ...purchaseForm, receipt_date: value })} /><CurrencyInput label="Purchase currency" helpText="The currency shown on the supplier purchase. Product choices are filtered to stock items using this currency, and Business OS keeps different currencies separate." value={purchaseForm.currency} onChange={(value) => { setPurchaseForm({ ...purchaseForm, currency: value }); setPurchaseLines([{ product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }]); }} /><Input label="Supplier invoice / reference" helpText="Optional supplier invoice number, bill number, purchase reference or memo used for tracking and reconciliation." optional value={purchaseForm.reference} onChange={(value) => setPurchaseForm({ ...purchaseForm, reference: value })} /><Input label="Notes" helpText="Optional internal note about this purchase. Use it for delivery details, special terms or other context your team may need later." optional value={purchaseForm.notes} onChange={(value) => setPurchaseForm({ ...purchaseForm, notes: value })} /></EditorSection>
    <EditorSection number="02" title="Products received" description={`Only active stock products using ${purchaseForm.currency} are shown.`} fullWidth actions={<button type="button" className="inventory-editor-secondary" onClick={() => setPurchaseLines([...purchaseLines, { product_id: "", quantity: "1", unit_cost: "0", tax_code_id: "" }])}>+ Add line</button>}>
      {purchaseProducts.length === 0 ? <div className="inventory-editor-warning">No active stock product uses {purchaseForm.currency}. Change the purchase currency or add a matching product.</div> : null}<div className="inventory-purchase-lines">{purchaseLines.map((line, index) => <div key={index} className="inventory-purchase-line"><SearchableField label="Product" helpText="Choose the stock product being received. Only active stock-tracked products matching the purchase currency are available." value={line.product_id} onChange={(value) => { const product = purchaseProducts.find((item) => item.id === value); const next = [...purchaseLines]; next[index] = { ...line, product_id: value, unit_cost: product ? String(product.last_purchase_cost || product.standard_cost || 0) : line.unit_cost }; setPurchaseLines(next); }} options={purchaseProducts.map((product) => ({ value: product.id, label: `${product.sku} · ${product.name}`, keywords: `${product.sku} ${product.name} ${product.category_name ?? ""}` }))} placeholder="Select product" searchPlaceholder="Search product, SKU or category..." /><Input label="Qty" helpText="Enter the quantity actually received into stock for this product line." type="number" value={line.quantity} onChange={(value) => { const next = [...purchaseLines]; next[index] = { ...line, quantity: value }; setPurchaseLines(next); }} /><Input label="Unit cost" helpText="Enter the supplier cost for one unit in the selected purchase currency. This contributes to inventory valuation and cost history." type="number" value={line.unit_cost} onChange={(value) => { const next = [...purchaseLines]; next[index] = { ...line, unit_cost: value }; setPurchaseLines(next); }} /><Select label="Tax" helpText="Choose the purchase tax applied to this line. Select No tax when none applies; tax affects the purchase total and related accounting." required={false} value={line.tax_code_id} onChange={(value) => { const next = [...purchaseLines]; next[index] = { ...line, tax_code_id: value }; setPurchaseLines(next); }} options={[["", "No tax"], ...purchaseTaxes.map((tax) => [tax.id, `${tax.code} · ${tax.rate}%`])]} /><button type="button" disabled={purchaseLines.length === 1} onClick={() => setPurchaseLines(purchaseLines.filter((_, itemIndex) => itemIndex !== index))} className="inventory-editor-remove">Remove</button></div>)}</div>
    </EditorSection>
  </EditorForm>;
}
function AdjustmentEditor({ vm }: EditorProps) {
  const { adjustForm, setAdjustForm, activeStockProducts, activeWarehouses, submitAdjustment } = vm;
  return <EditorForm vm={vm} onSubmit={submitAdjustment} saveLabel={"Post adjustment"} summary={
    <EditorContext eyebrow="Stock adjustment" title="Review stock impact" caution note="Posting changes the selected warehouse’s on-hand stock. Check the quantity sign, date and cost before posting.">
      <ContextRow label="Product" value={activeStockProducts.find((product) => product.id === adjustForm.product_id)?.name || "Choose a product"} />
      <ContextRow label="Warehouse" value={activeWarehouses.find((warehouse) => warehouse.id === adjustForm.warehouse_id)?.name || "Choose a warehouse"} />
      <ContextRow label="Quantity change" value={adjustForm.quantity_delta || "Not entered"} strong />
      <ContextRow label="Adjustment date" value={adjustForm.adjustment_date || "Not entered"} />
    </EditorContext>
  }>
    <EditorSection number="01" title="Stock & location" description="Choose the product and warehouse affected by this adjustment.">
<Select label="Product" value={adjustForm.product_id} onChange={(value) => setAdjustForm({ ...adjustForm, product_id: value })} options={[["", "Select product"], ...activeStockProducts.map((product) => [product.id, `${product.sku} · ${product.name}`])]} />
<Select label="Warehouse" value={adjustForm.warehouse_id} onChange={(value) => setAdjustForm({ ...adjustForm, warehouse_id: value })} options={[["", "Select warehouse"], ...activeWarehouses.map((warehouse) => [warehouse.id, warehouse.name])]} />
</EditorSection>
<EditorSection number="02" title="Quantity & cost" description="Use a positive quantity to add stock or a negative quantity to remove it.">
<Input label="Adjustment date" type="date" value={adjustForm.adjustment_date} onChange={(value) => setAdjustForm({ ...adjustForm, adjustment_date: value })} />
<Input label="Quantity change (+ add / - remove)" type="number" value={adjustForm.quantity_delta} onChange={(value) => setAdjustForm({ ...adjustForm, quantity_delta: value })} />
<Input label="Unit cost for stock added" optional type="number" value={adjustForm.unit_cost} onChange={(value) => setAdjustForm({ ...adjustForm, unit_cost: value })} />
</EditorSection>
<EditorSection number="03" title="Reason & reference" description="Record why the stock quantity is changing.">
<Input label="Reason" value={adjustForm.reason} onChange={(value) => setAdjustForm({ ...adjustForm, reason: value })} />
<Input label="Reference" optional value={adjustForm.reference} onChange={(value) => setAdjustForm({ ...adjustForm, reference: value })} />
</EditorSection>
  </EditorForm>;
}
function TransferEditor({ vm }: EditorProps) {
  const { transferForm, setTransferForm, activeWarehouses, transferProducts, transferAvailable, submitTransfer } = vm;
  return <EditorForm vm={vm} onSubmit={submitTransfer} saveLabel={"Transfer stock"} summary={
    <EditorContext eyebrow="Warehouse transfer" title="Stock movement" caution note="Warehouse transfer only moves inventory location. It does not create income, expense or a new accounting journal.">
      <ContextRow label="From" value={activeWarehouses.find((warehouse) => warehouse.id === transferForm.from_warehouse_id)?.name || "Choose a warehouse"} />
      <ContextRow label="To" value={activeWarehouses.find((warehouse) => warehouse.id === transferForm.to_warehouse_id)?.name || "Choose a warehouse"} />
      <ContextRow label="Available at source" value={transferAvailable?.on_hand ?? "Choose a product"} />
      <ContextRow label="Quantity to move" value={transferForm.quantity || "Not entered"} strong />
    </EditorContext>
  }>
    <EditorSection number="01" title="Transfer route" description="Select the source and a different destination warehouse.">
<Select label="From warehouse" value={transferForm.from_warehouse_id} onChange={(value) => { const destination = activeWarehouses.find((warehouse) => warehouse.id !== value); setTransferForm({ ...transferForm, from_warehouse_id: value, to_warehouse_id: destination?.id ?? "", product_id: "" }); }} options={[["", "Select source warehouse"], ...activeWarehouses.map((warehouse) => [warehouse.id, warehouse.name])]} />
<Select label="To warehouse" value={transferForm.to_warehouse_id} onChange={(value) => setTransferForm({ ...transferForm, to_warehouse_id: value })} options={[["", "Select destination warehouse"], ...activeWarehouses.filter((warehouse) => warehouse.id !== transferForm.from_warehouse_id).map((warehouse) => [warehouse.id, warehouse.name])]} />
</EditorSection>
<EditorSection number="02" title="Product & quantity" description="Choose available stock to move between the selected locations.">
<Select label="Product" value={transferForm.product_id} onChange={(value) => setTransferForm({ ...transferForm, product_id: value })} options={[["", "Select available product"], ...transferProducts.map((product) => [product.id, `${product.sku} · ${product.name}`])]} />
<Input label="Transfer date" type="date" value={transferForm.transfer_date} onChange={(value) => setTransferForm({ ...transferForm, transfer_date: value })} />
<Input label={`Quantity${transferAvailable ? ` · available ${transferAvailable.on_hand}` : ""}`} type="number" value={transferForm.quantity} onChange={(value) => setTransferForm({ ...transferForm, quantity: value })} />
</EditorSection>
<EditorSection number="03" title="Reason & reference" description="Keep the movement understandable in the stock history.">
<Input label="Reason" value={transferForm.reason} onChange={(value) => setTransferForm({ ...transferForm, reason: value })} />
<Input label="Reference" optional value={transferForm.reference} onChange={(value) => setTransferForm({ ...transferForm, reference: value })} />
</EditorSection>
  </EditorForm>;
}

function EditorForm({ vm, onSubmit, saveLabel, summary, children }: EditorProps & { onSubmit: (event: FormEvent) => void; saveLabel: string; summary: ReactNode; children: ReactNode }) {
  return <form className="inventory-editor" onSubmit={onSubmit} aria-busy={vm.saving}>
    <fieldset disabled={vm.saving} className="inventory-editor-fieldset">
      <legend className="sr-only">Inventory document fields</legend>
      <div className="inventory-editor-layout">
        <div className="inventory-editor-main">{children}</div>
        {summary}
      </div>
      <footer className="inventory-editor-footer">
        <p>{vm.saving ? "Saving… If you leave now, check the record before retrying because the result may be uncertain." : "Review the details before saving to this company."}</p>
        <div className="inventory-editor-footer-actions">
          <button type="button" className="inventory-editor-secondary" onClick={() => vm.closeDocument()}>Cancel</button>
          <button type="submit" className="inventory-editor-primary">{vm.saving ? "Saving…" : saveLabel}</button>
        </div>
      </footer>
    </fieldset>
  </form>;
}

function EditorSection({ number, title, description, children, actions, fullWidth = false }: { number: string; title: string; description: string; children: ReactNode; actions?: ReactNode; fullWidth?: boolean }) {
  const titleId = useId();
  return <section className="inventory-editor-section" aria-labelledby={titleId}>
    <header className="inventory-editor-section-heading">
      <span className="inventory-editor-section-number" aria-hidden="true">{number}</span>
      <div><h2 id={titleId}>{title}</h2><p>{description}</p></div>
      {actions ? <div className="inventory-editor-section-actions">{actions}</div> : null}
    </header>
    <div className={fullWidth ? "inventory-editor-section-content" : "inventory-editor-fields"}>{children}</div>
  </section>;
}

function EditorContext({ eyebrow, title, note, caution = false, children }: { eyebrow: string; title: string; note: string; caution?: boolean; children: ReactNode }) {
  return <aside className="inventory-editor-context" aria-label={eyebrow}>
    <header><p>{eyebrow}</p><h2>{title}</h2></header>
    <dl>{children}</dl>
    <div className={`inventory-editor-context-note${caution ? " inventory-editor-context-caution" : ""}`}><strong>{caution ? "Before you post" : "Good to know"}</strong><p>{note}</p></div>
  </aside>;
}

function ContextRow({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return <div className={strong ? "inventory-editor-context-total" : undefined}><dt>{label}</dt><dd>{value}</dd></div>;
}

function FieldCaption({ label, optional, helpText, id }: { label: string; optional?: boolean; helpText?: string; id?: string }) {
  return <div className="inventory-editor-field-caption">
    <label htmlFor={id}>{label}{optional ? <span>Optional</span> : null}</label>
    {helpText ? <details className="inventory-editor-field-help"><summary aria-label={`About ${label}`}>Guide</summary><p>{helpText}</p></details> : null}
  </div>;
}

function Input({ label, value, onChange, type = "text", optional = false, helpText }: { label: string; value: string; onChange: (value: string) => void; type?: string; optional?: boolean; helpText?: string }) {
  const id = useId();
  return <div className="inventory-editor-field">
    <FieldCaption label={label} optional={optional} helpText={helpText} id={id} />
    <input id={id} aria-label={label} required={!optional} type={type} step={type === "number" ? "any" : undefined} value={value} onChange={(event) => onChange(event.target.value)} />
  </div>;
}

function Select({ label, value, onChange, options, required = true, helpText }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; required?: boolean; helpText?: string }) {
  const id = useId();
  return <div className="inventory-editor-field">
    <FieldCaption label={label} helpText={helpText} id={id} />
    <select id={id} aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>
  </div>;
}

function SearchableField({ label, value, onChange, options, placeholder, searchPlaceholder, helpText }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string; keywords?: string }[]; placeholder: string; searchPlaceholder: string; helpText?: string }) {
  return <div className="inventory-editor-field inventory-editor-searchable">
    <FieldCaption label={label} helpText={helpText} />
    <SearchableSelect label={label} value={value} onValueChange={onChange} options={options} placeholder={placeholder} searchPlaceholder={searchPlaceholder} />
  </div>;
}

function CurrencyInput({ label, value, onChange, helpText }: { label: string; value: string; onChange: (value: string) => void; helpText?: string }) {
  return <div className="inventory-editor-field inventory-editor-searchable">
    <FieldCaption label={label} helpText={helpText} />
    <SearchableSelect label={label} value={value} onValueChange={onChange} options={CURRENCY_OPTIONS} placeholder="Select currency" searchPlaceholder="Search currency or code..." clearable={false} />
  </div>;
}
