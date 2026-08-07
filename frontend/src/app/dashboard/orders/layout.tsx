import { Suspense } from "react";

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10">
          <div className="mx-auto max-w-[1500px]">
            <div className="h-28 animate-pulse rounded-2xl border bg-white" />
            <div className="mt-5 h-96 animate-pulse rounded-2xl border bg-white" />
          </div>
        </main>
      }
    >
      {children}
    </Suspense>
  );
}
