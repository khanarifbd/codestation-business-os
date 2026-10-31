"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

/** A review belongs to one committed source snapshot, not just its URL/ID.
 * Explicit refresh retires it synchronously, even before the next render. */
export function useAdvancedReviewScope(source: unknown) {
  const [generation, setGeneration] = useState(0);
  const token = useMemo(() => ({ source, generation }), [source, generation]);
  const active = useRef<typeof token | null>(null), reviewed = useRef<typeof token | null>(null);
  useLayoutEffect(() => {
    active.current = token;
    return () => { if (active.current === token) active.current = null; };
  }, [token]);
  const isCurrent = () => active.current === token;
  function markReviewed() { if (!isCurrent()) return false; reviewed.current = token; return true; }
  function invalidate() {
    if (!isCurrent()) return false;
    active.current = null; reviewed.current = null; setGeneration(value => value + 1); return true;
  }
  async function confirm(run: () => Promise<void>, close: () => void) {
    if (!isCurrent()) return;
    if (reviewed.current !== token) { close(); return; }
    return run();
  }
  return { isCurrent, markReviewed, invalidate, confirm };
}
