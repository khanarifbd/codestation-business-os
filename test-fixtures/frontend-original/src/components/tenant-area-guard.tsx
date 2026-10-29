"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useDashboardSession } from "@/components/dashboard-session-context";

export function TenantAreaGuard({ children }: { children: ReactNode }) {
  const { profile, tenant, loading, error, reload } = useDashboardSession();

  if (!loading && profile && tenant) return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 text-neutral-950">
      {error ? (
        <div className="w-full max-w-sm rounded-2xl border bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold">Unable to verify account access</p>
          <p className="mt-2 text-sm text-neutral-500">{error}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-5 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <Loader2 className="size-5 animate-spin" />
          Loading workspace…
        </div>
      )}
    </main>
  );
}
