"use client";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
/** Immutable key identity plus layout-owned mutable lifetime; A→B→A is a new identity. */
export function useIdentityLifetime(key: string) {
  const identity = useMemo(() => ({ key }), [key]);
  const active = useRef({ identity, alive: false, reads: 0 });
  useLayoutEffect(() => {
    active.current = { identity, alive: true, reads: active.current.reads + 1 };
    return () => { if (active.current.identity === identity) { active.current.alive = false; active.current.reads += 1; } };
  }, [identity]);
  const current = useCallback(() => active.current.alive && active.current.identity === identity, [identity]);
  const nextRead = useCallback(() => { active.current.reads += 1; return active.current.reads; }, []);
  const isReadCurrent = useCallback((request: number) => current() && request === active.current.reads, [current]);
  return { identity, current, nextRead, isReadCurrent };
}
