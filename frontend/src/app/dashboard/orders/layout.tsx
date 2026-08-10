"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="relative">
      {pathname === "/dashboard/orders" ? <Link href="/dashboard/orders/new" className="absolute right-5 top-5 z-20 inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white shadow-sm sm:right-8 lg:right-10 lg:top-10"><Plus className="size-4" />New order</Link> : null}
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
    </div>
  );
}
