import { Suspense } from "react";
import { TaxWorkspace } from "@/components/accounting-tax/tax-workspace";

export default function Page() { return <Suspense fallback={null}><TaxWorkspace/></Suspense>; }
