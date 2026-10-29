"use client";

import { Suspense } from "react";

/** The list owns its New order action; nested routes retain only the loading boundary. */
export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<main className="min-h-screen bg-[var(--app-canvas)] p-5 sm:p-8" aria-busy="true" aria-label="Loading orders"><div className="mx-auto max-w-[1500px]"><div className="h-24 animate-pulse rounded-lg border bg-white" /><div className="mt-5 h-80 animate-pulse rounded-lg border bg-white" /></div></main>}>{children}</Suspense>;
}
