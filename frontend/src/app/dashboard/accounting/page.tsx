import { Suspense } from "react";
import { AccountingOverviewWorkspace } from "@/components/accounting-accounts/accounting-overview";
export default function Page() { return <Suspense fallback={<p role="status" className="p-6">Loading accounting workspace…</p>}><AccountingOverviewWorkspace /></Suspense>; }
