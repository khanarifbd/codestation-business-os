import { Suspense } from "react";
import { MyWorkTaskWorkspace } from "@/components/my-work/my-work-workspace";
export default function Page() { return <Suspense fallback={<p role="status">Loading task…</p>}><MyWorkTaskWorkspace /></Suspense>; }
