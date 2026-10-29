import { Suspense } from "react";
import { HRTimeWorkspace } from "@/components/hr-time/hr-time-workspace";
export default function Page() {
  return <Suspense fallback={<p role="status">Opening Time &amp; Leave…</p>}>
    <HRTimeWorkspace />
  </Suspense>;
}
