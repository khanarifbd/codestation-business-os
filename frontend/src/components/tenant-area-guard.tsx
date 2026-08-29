"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

type ProfileRole = {
  system_role?: string;
};

export function TenantAreaGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const verify = useCallback(async () => {
    setAllowed(false);
    setError(null);

    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        throw new Error("Unable to verify your account access.");
      }

      const profile = (await response.json()) as ProfileRole;
      if (profile.system_role === "super_admin") {
        router.replace("/super-admin");
        router.refresh();
        return;
      }

      setAllowed(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to verify your account access.");
    }
  }, [router]);

  useEffect(() => {
    void verify();
  }, [verify, attempt]);

  if (allowed) return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 text-neutral-950">
      {error ? (
        <div className="w-full max-w-sm rounded-2xl border bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold">Unable to verify account access</p>
          <p className="mt-2 text-sm text-neutral-500">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-5 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <Loader2 className="size-5 animate-spin" />
          Verifying account access…
        </div>
      )}
    </main>
  );
}
