"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const HEARTBEAT_THROTTLE_MS = 2 * 60 * 1000;
const PROTECTED_PATHS = ["/dashboard", "/super-admin", "/onboarding"];

function isProtected(pathname: string) {
  return PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** Only real foreground user interactions renew the server-side idle deadline. */
export function SessionActivityTracker() {
  const pathname = usePathname();
  const router = useRouter();
  const lastHeartbeatRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!isProtected(pathname)) return;
    let disposed = false;

    async function onInteraction() {
      if (disposed || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const now = Date.now();
      if (inFlightRef.current || now - lastHeartbeatRef.current < HEARTBEAT_THROTTLE_MS) return;
      lastHeartbeatRef.current = now;
      inFlightRef.current = true;
      try {
        const response = await fetch("/api/auth/session/activity", {
          method: "POST",
          cache: "no-store",
        });
        if (disposed) return;
        if (response.status === 401) {
          router.replace("/login");
          router.refresh();
        } else if (!response.ok) {
          lastHeartbeatRef.current = 0;
        }
      } catch {
        if (!disposed) lastHeartbeatRef.current = 0;
      } finally {
        inFlightRef.current = false;
      }
    }

    const trigger = () => { void onInteraction(); };
    window.addEventListener("pointerdown", trigger, { passive: true });
    window.addEventListener("keydown", trigger);
    window.addEventListener("touchstart", trigger, { passive: true });
    window.addEventListener("scroll", trigger, { passive: true, capture: true });
    return () => {
      disposed = true;
      window.removeEventListener("pointerdown", trigger);
      window.removeEventListener("keydown", trigger);
      window.removeEventListener("touchstart", trigger);
      window.removeEventListener("scroll", trigger, true);
    };
  }, [pathname, router]);

  return null;
}
