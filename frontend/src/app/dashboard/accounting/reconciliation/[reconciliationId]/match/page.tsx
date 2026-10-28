import { Suspense } from "react";
import { ReconciliationWorkspace } from "@/components/accounting-reconciliation/reconciliation-workspace";
export default function Page() { return <Suspense fallback={<p className="p-6" role="status">Loading reconciliation workspace…</p>}><ReconciliationWorkspace/></Suspense>; }
