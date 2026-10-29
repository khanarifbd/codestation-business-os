import { Suspense } from "react";
import { LoanWorkspace } from "@/components/accounting-loans/loan-workspace";

export default function Page() { return <Suspense fallback={null}><LoanWorkspace/></Suspense>; }
