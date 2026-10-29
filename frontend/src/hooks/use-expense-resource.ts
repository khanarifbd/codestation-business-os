"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiErrorMessage } from "@/lib/api-error";

/** A read has an explicit identity and retry, never an automatic failure loop. */
export function useExpenseResource<T>(url: string, enabled: boolean, validate: (value: unknown) => value is T) {
  const router = useRouter();
  const mounted = useRef(true), epoch = useRef(0);
  const [state, setState] = useState<{ key: string; value: T | null; loading: boolean; error: string | null }>({ key: "", value: null, loading: false, error: null });
  const refresh = useCallback(async () => {
    if (!enabled || !mounted.current) return null;
    const identity = ++epoch.current;
    setState({ key: url, value: null, loading: true, error: null });
    try {
      const response = await fetch(url, { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!mounted.current || identity !== epoch.current) return null;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Expense information is unavailable."));
      if (!validate(payload)) throw new Error("The expense response could not be verified. Reload rather than treating it as an empty or zero balance.");
      setState({ key: url, value: payload, loading: false, error: null });
      return payload;
    } catch (reason) {
      if (mounted.current && identity === epoch.current) setState({ key: url, value: null, loading: false, error: reason instanceof Error ? reason.message : "Expense information is unavailable." });
      return null;
    }
  }, [enabled, url, validate, router]);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    // Defer the external read until setup settles; cancelled effects must not
    // start requests (including Strict Mode's first setup).
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; mounted.current = false; epoch.current += 1; };
  }, [refresh]);
  return {
    value: enabled && state.key === url ? state.value : null,
    error: enabled && state.key === url ? state.error : null,
    loading: enabled && (state.key !== url || state.loading),
    refresh,
  };
}
