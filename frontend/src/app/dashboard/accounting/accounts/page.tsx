import { Suspense } from "react";
import { AccountsWorkspace } from "@/components/accounting-accounts/account-workspace";
export default function Page() { return <Suspense fallback={<p role="status" className="p-6">Loading accounting workspace…</p>}><AccountsWorkspace /></Suspense>; }
