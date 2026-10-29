import { Suspense } from "react";
import { ProjectCreateWorkspace } from "@/components/projects/project-register-workspace";
export default function Page() { return <Suspense fallback={<p>Loading project handoff…</p>}><ProjectCreateWorkspace/></Suspense>; }
