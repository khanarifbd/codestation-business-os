import {Suspense} from "react";
import {PayrollWorkspace} from "@/components/payroll/payroll-workspace";
export default function Page(){return <Suspense fallback={<div className="p-6" role="status">Loading payroll…</div>}><PayrollWorkspace/></Suspense>;}
