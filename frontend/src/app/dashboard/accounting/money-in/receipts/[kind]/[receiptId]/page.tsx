import { Suspense } from "react";
import { MoneyInWorkspace } from "@/components/accounting-money-in/money-in-workspace";
export default function Page() {
  return <Suspense fallback={<p className="p-6" role="status">Loading money received…</p>}><MoneyInWorkspace/></Suspense>;
}
