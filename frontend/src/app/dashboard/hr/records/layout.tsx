import { Suspense } from "react";
export default function RecordsLayout({children}: {children: React.ReactNode}) { return <Suspense fallback={<p role="status">Opening employee records…</p>}>{children}</Suspense>; }
