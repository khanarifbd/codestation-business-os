import { Suspense } from "react";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
export default function Page() { return <Suspense fallback={<p role="status">Loading project…</p>}><ProjectWorkspace /></Suspense>; }
