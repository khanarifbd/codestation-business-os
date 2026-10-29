import { Suspense } from "react";
import { TransfersWorkspace } from "@/components/accounting-transfers/transfer-workspace";
export default function Page() { return <Suspense fallback={<p role="status" className="p-6">Loading transfers…</p>}><TransfersWorkspace /></Suspense>; }
