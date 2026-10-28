import { Suspense } from "react";
import { PeopleStructureWorkspace } from "@/components/people/people-workspace";

export default function Page() {
  return <Suspense fallback={<div role="status" className="p-6 text-sm text-neutral-500">Loading structure editor…</div>}><PeopleStructureWorkspace /></Suspense>;
}
