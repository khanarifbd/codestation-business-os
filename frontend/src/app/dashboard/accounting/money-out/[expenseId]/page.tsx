import { Suspense } from "react";
import { MoneyOutWorkspace } from "@/components/accounting-money-out/money-out-workspace";
export default function Page() {
  return <Suspense fallback={<p className="p-6" role="status">Loading money paid…</p>}><MoneyOutWorkspace/></Suspense>;
}
