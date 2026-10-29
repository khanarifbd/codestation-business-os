import { Suspense } from "react";
import { MyWorkRegisterWorkspace } from "@/components/my-work/my-work-workspace";
export default function Page() { return <Suspense fallback={<p role="status">Loading My Work…</p>}><MyWorkRegisterWorkspace /></Suspense>; }
