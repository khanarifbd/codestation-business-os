import { Suspense } from "react";
import { RecordsDocument } from "@/components/hr-records/records-document";
export default function Page() { return <Suspense fallback={<p role="status">Opening employee record…</p>}><RecordsDocument /></Suspense>; }
