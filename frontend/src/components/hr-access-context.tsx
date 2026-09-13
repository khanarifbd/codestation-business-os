"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { HRAccess } from "@/components/hr-module-nav";

type HRAccessState = { access: HRAccess | null; loading: boolean; error: string | null };
const HRAccessContext = createContext<HRAccessState | null>(null);

export function HRAccessProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<HRAccessState>({ access: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/hr/access", { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); if (!cancelled) setState({ access: null, loading: false, error: "Authentication required" }); return; }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to load HR access.");
        if (!cancelled) setState({ access: payload as HRAccess, loading: false, error: null });
      } catch (reason) {
        if (!cancelled) setState({ access: null, loading: false, error: reason instanceof Error ? reason.message : "Unable to load HR access." });
      }
    })();
    return () => { cancelled = true; };
  }, [router]);
  return <HRAccessContext.Provider value={state}>{children}</HRAccessContext.Provider>;
}

export function useHRAccess() {
  const value = useContext(HRAccessContext);
  if (!value) throw new Error("useHRAccess must be used within HRAccessProvider");
  return value;
}
