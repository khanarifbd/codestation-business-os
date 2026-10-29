import { Suspense } from "react";
import { PayablesWorkspace } from "@/components/accounting-payables/payables-workspace";
export default function Page() { return <Suspense fallback={<p className="p-6" role="status">Loading supplier payables…</p>}><PayablesWorkspace/></Suspense>; }
