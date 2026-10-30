import { Suspense } from "react";
import { FinanceCompatibilityShell } from "@/components/finance/finance-compatibility-shell";

export default function FinancePage() {
  return <Suspense fallback={<p role="status" className="p-6">Loading Finance…</p>}><FinanceCompatibilityShell /></Suspense>;
}
