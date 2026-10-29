import { Suspense } from "react";
export default function HRSettingsLayout({ children }: { children: React.ReactNode }) { return <Suspense fallback={<main className="p-6"><p role="status">Loading company HR setup…</p></main>}>{children}</Suspense>; }
