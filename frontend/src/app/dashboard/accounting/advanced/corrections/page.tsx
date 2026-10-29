import { Suspense } from "react";
import { AdvancedWorkspace } from "@/components/accounting-advanced/advanced-workspace";
export default function Page() { return <Suspense fallback={<p className="p-6 text-sm">Loading accounting workspace…</p>}><AdvancedWorkspace/></Suspense>; }
