import { Suspense } from "react";
import { ExpenseWorkspace } from "@/components/expenses/expense-workspace";
export default function Page() { return <Suspense fallback={<p className="p-6" role="status">Loading expense workspace…</p>}><ExpenseWorkspace/></Suspense>; }
