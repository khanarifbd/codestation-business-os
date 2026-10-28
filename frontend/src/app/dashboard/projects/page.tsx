import { Suspense } from "react";
import { ProjectRegisterWorkspace } from "@/components/projects/project-register-workspace";
export default function Page() { return <Suspense fallback={<p>Loading projects…</p>}><ProjectRegisterWorkspace/></Suspense>; }
