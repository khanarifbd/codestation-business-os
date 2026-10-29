"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { timeError } from "@/components/hr-time/hr-time-model";
export function useHRTimeLifetime(key: string) {
  const owner = useMemo(() => ({ key }), [key]), active = useRef<object | null>(null);
  useLayoutEffect(() => {
    active.current = owner; return () => {
      if (active.current === owner)
        active.current = null;
    };
  }, [owner]);
  return { owner, current: useCallback(() => active.current === owner, [owner]) };
}
export type HRReadReceipt<T> = {
  owner: object;
  value: T;
};
export function useHRTimeResource<T>(scope: string, url: string, enabled: boolean, validate: (v: unknown) => v is T) {
  const router = useRouter(), owner = useMemo(() => ({ scope, url, enabled, validate }), [scope, url, enabled, validate]);
  const active = useRef<object | null>(null), ready = useRef<HRReadReceipt<T> | null>(null), epoch = useRef(0);
  const [state, setState] = useState<{
    owner: object | null;
    receipt: HRReadReceipt<T> | null;
    loading: boolean;
    error: string | null;
    status: number | null;
  }>({ owner: null, receipt: null, loading: false, error: null, status: null });
  useLayoutEffect(() => {
    active.current = owner; ready.current = null; epoch.current++; return () => {
      if (active.current === owner) {
        active.current = null;
        ready.current = null;
      }
    };
  }, [owner]);
  const isReady = useCallback((receipt: HRReadReceipt<T> | null) => enabled && active.current === owner && Boolean(receipt) && ready.current === receipt, [enabled, owner]);
  const invalidate = useCallback((receipt: HRReadReceipt<T> | null) => {
    if (active.current === owner && ready.current === receipt)
      ready.current = null;
  }, [owner]);
  const refresh = useCallback(async () => {
    if (!enabled || active.current !== owner)
      return null;
    const request = ++epoch.current;
    ready.current = null;
    const current = () => active.current === owner && request === epoch.current;
    setState(old => ({ owner, receipt: old.owner === owner ? old.receipt : null, loading: true, error: null, status: null }));
    let status: number | null = null;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!current())
        return null;
      status = response.status;
      if (status === 401)
        router.replace("/login");
      const value: unknown = await response.json().catch(() => null);
      if (!current())
        return null;
      if (!response.ok)
        throw Error(timeError(value, "HR information could not be read. Retry before making changes."));
      if (!validate(value))
        throw Error("The HR response could not be verified. It is not an empty result.");
      const receipt = { owner, value };
      ready.current = receipt;
      setState({ owner, receipt, loading: false, error: null, status });
      return receipt;
    }
    catch (error) {
      if (current())
        setState(old => ({ owner, receipt: old.owner === owner ? old.receipt : null, loading: false, error: error instanceof Error ? error.message : "HR information unavailable.", status }));
      return null;
    }
  }, [enabled, owner, router, url, validate]);
  useEffect(() => {
    let scheduled = true; queueMicrotask(() => {
      if (scheduled)
        void refresh();
    }); return () => { scheduled = false; };
  }, [refresh]);
  const receipt = enabled && state.owner === owner ? state.receipt : null;
  return { receipt, value: receipt?.value ?? null, loading: enabled && (state.owner !== owner || state.loading), error: enabled && state.owner === owner ? state.error : null, status: enabled && state.owner === owner ? state.status : null, isReady, invalidate, refresh };
}
