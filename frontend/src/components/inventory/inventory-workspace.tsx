"use client";

import { usePathname } from "next/navigation";
import { ArrowLeft, Boxes, ClipboardList, PackagePlus, Plus, RefreshCw, ShoppingCart, Store, Truck, Warehouse, BarChart3, Settings2 } from "lucide-react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useInventoryWorkspace } from "@/hooks/use-inventory-workspace";
import { RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import { InventoryRegister } from "./inventory-register";
import { InventoryDetail } from "./inventory-detail";
import { InventoryEditor } from "./inventory-editor";
import { modalTitle, type Tab } from "./inventory-model";
import "./inventory-workspace.css";

const sections: { id: Tab; label: string; icon: typeof Boxes }[] = [
  { id: "overview", label: "Overview", icon: Boxes },
  { id: "items", label: "Products & services", icon: Store },
  { id: "stock", label: "Stock on hand", icon: PackagePlus },
  { id: "purchases", label: "Purchases", icon: ShoppingCart },
  { id: "movements", label: "Movements", icon: ClipboardList },
  { id: "suppliers", label: "Suppliers", icon: Truck },
  { id: "warehouses", label: "Warehouses", icon: Warehouse },
  { id: "service_sales", label: "Service sales", icon: BarChart3 },
  { id: "categories", label: "Categories", icon: Settings2 },
];

/** Keying by company and document path prevents a stale record/draft crossing identities. */
export function InventoryWorkspace() {
  const { tenant } = useDashboardSession();
  const pathname = usePathname();
  return <InventoryWorkspaceContent key={`${tenant?.organization.id || "no-company"}:${pathname}`} />;
}
export default InventoryWorkspace;

function InventoryWorkspaceContent() {
  const vm = useInventoryWorkspace();
  const isList = vm.route.mode === "list";
  const title = isList ? "Inventory" : vm.isEditor ? modalTitle(vm.modal, vm.editingId) : "Inventory record";
  const loading = vm.loading || !vm.sectionReady && !vm.error;
  return <RelationshipPage className="inventory-workspace">
    {!isList ? <div className="inventory-document-context"><button onClick={vm.isEditor ? vm.closeDocument : vm.backToRegister} className="inventory-back" disabled={vm.saving}><ArrowLeft aria-hidden="true" />Back to inventory</button><span>{vm.route.section?.replaceAll("_", " ")} / {vm.route.mode === "create" ? "New" : vm.route.mode === "edit" ? "Edit" : "View"}</span></div> : null}
    {isList || vm.isEditor ? <header className={`inventory-workspace-header${isList && vm.tab !== "overview" ? " inventory-workspace-header-compact" : ""}`}><div><p className="inventory-eyebrow">Operations / {vm.isEditor ? "Document workspace" : "Inventory"}</p><h1>{title}</h1><p>{vm.isEditor ? "Review the record and its stock impact before saving." : "Know what is on hand, what needs attention and where to work next."}</p></div>{isList ? <div className="inventory-header-actions">{vm.canManage && vm.tab === "overview" ? <><button onClick={vm.openPurchase} className="inventory-primary"><ShoppingCart aria-hidden="true" />Receive purchase</button><button onClick={() => vm.openNewItem()} className="inventory-secondary"><Plus aria-hidden="true" />Add item</button></> : null}<button onClick={() => void vm.refresh()} disabled={vm.loading || vm.saving} className="inventory-secondary"><RefreshCw aria-hidden="true" />Refresh</button></div> : null}</header> : null}
    {isList ? <nav className="inventory-section-nav" aria-label="Inventory sections">{sections.map(({id,label,icon:Icon})=><button key={id} onClick={()=>vm.setTab(id)} aria-current={vm.tab===id?"page":undefined}><Icon aria-hidden="true" />{label}</button>)}</nav> : null}
    {!vm.canManage ? <RelationshipNotice>Read-only inventory access. Managing records and posting stock changes requires your company’s finance management permission.</RelationshipNotice> : null}
    {vm.message ? <RelationshipNotice tone="success">{vm.message}</RelationshipNotice> : null}
    {vm.error ? <RelationshipNotice tone="error">{vm.error}{!vm.isEditor || !vm.sectionReady ? <button onClick={()=>void vm.refresh()} className="inventory-text-action" disabled={vm.loading || vm.saving}>Retry loading</button> : null}</RelationshipNotice> : null}
    {vm.saving ? <RelationshipNotice>Saving this change. Keep this page open; if the connection is interrupted, check the saved record before retrying.</RelationshipNotice> : null}
    {vm.route.mode === "invalid" ? <InventoryState title="Inventory page not found" text="Return to the inventory register to select an available record or action." />
      : loading ? <InventoryState loading title="Loading inventory…" text="Retrieving this company’s records and the selected section." />
      : !vm.coreReady || !vm.sectionReady ? <InventoryState title="Inventory section unavailable" text="The requested records could not be loaded. Use Retry loading; a failed request is not an empty inventory." />
      : vm.isEditor && !vm.canManage ? <InventoryState title="This action is restricted" text="Your role can view inventory but cannot manage this record or post stock changes." />
      : vm.isEditor && !vm.documentReady ? <InventoryState title={vm.setupError ? "Setup required" : "Record unavailable"} text={vm.setupError || "This record was not found in the available company records. Return to the register before continuing."} />
      : vm.isEditor && vm.documentCommitted ? <section className="inventory-workspace-state"><h2>Change saved</h2><p>This operation has completed. Return to inventory to review the saved result; do not submit it again.</p><button className="inventory-primary" onClick={vm.closeDocument}>Return to inventory</button></section>
      : vm.isEditor ? <InventoryEditor vm={vm} />
      : vm.route.mode === "view" && vm.route.id ? <InventoryDetail vm={vm} section={vm.route.section as "items" | "suppliers" | "warehouses" | "purchases"} id={vm.route.id} />
      : <InventoryRegister vm={vm} />}
  </RelationshipPage>;
}
function InventoryState({title,text,loading=false}:{title:string;text:string;loading?:boolean}) {
  return <section className="inventory-workspace-state" role={loading?"status":undefined} aria-busy={loading||undefined}><Boxes aria-hidden="true" /><h2>{title}</h2><p>{text}</p></section>;
}
