import { Suspense } from "react";
export default function InventoryLayout({children}:{children:React.ReactNode}) {
  return <Suspense fallback={<main className="p-6" aria-busy="true" aria-label="Loading inventory">Loading inventory…</main>}>{children}</Suspense>;
}
