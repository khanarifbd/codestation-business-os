import { Suspense } from "react";
import { EmployeeHomeWorkspace } from "@/components/self-service/self-service-workspace";

export default function Page() {
  return <Suspense fallback={<div role="status" className="p-6 text-sm text-neutral-500">Loading employee workspace…</div>}><EmployeeHomeWorkspace /></Suspense>;
}
