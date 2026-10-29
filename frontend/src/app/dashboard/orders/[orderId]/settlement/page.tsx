import { Suspense } from "react";
import { OrderSettlementWorkspace } from "@/components/commercial/order-settlement-workspace";
export default function OrderSettlementPage() {
  return <Suspense fallback={<p role="status">Loading settlement…</p>}><OrderSettlementWorkspace/></Suspense>;
}
