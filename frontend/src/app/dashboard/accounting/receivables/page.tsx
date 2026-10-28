import { Suspense } from "react";
import { ReceivablesWorkspace } from "@/components/accounting-receivables/receivables-workspace";
export default function Page() {
  return <Suspense fallback={<p className="p-6" role="status">Loading receivables…</p>}><ReceivablesWorkspace/></Suspense>;
}
