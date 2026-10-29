"use client";

import Script from "next/script";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AuthUser } from "@/lib/auth-session";

type CredentialResponse = {
  credential: string;
  select_by?: string;
};

type GoogleIdApi = {
  initialize: (config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  renderButton: (
    element: HTMLElement,
    options: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
      width?: number;
    },
  ) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleIdApi;
      };
    };
  }
}

const EXISTING_ACCOUNT_LINK_DETAIL_PREFIX = "This email already has a Business OS account.";

export function GoogleAuthSection({
  mode,
  onAuthenticated,
  onLinkRequired,
}: {
  mode: "login" | "signup";
  onAuthenticated: (user: AuthUser) => void | Promise<void>;
  onLinkRequired?: (credential: string) => void;
}) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
  const buttonRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onAuthenticated);
  const linkRequiredRef = useRef(onLinkRequired);
  const initializedRef = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onAuthenticated;
  }, [onAuthenticated]);

  useEffect(() => {
    linkRequiredRef.current = onLinkRequired;
  }, [onLinkRequired]);

  useEffect(() => {
    if (window.google?.accounts.id) setScriptReady(true);
  }, []);

  const handleCredential = useCallback(async (response: CredentialResponse) => {
    if (!response.credential) {
      setError("Google did not return a sign-in credential. Please try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const upstream = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const payload = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        const detail = typeof payload?.detail === "string" ? payload.detail : "";
        const needsAuthenticatedLink =
          mode === "login"
          && upstream.status === 409
          && detail.startsWith(EXISTING_ACCOUNT_LINK_DETAIL_PREFIX)
          && Boolean(linkRequiredRef.current);
        if (needsAuthenticatedLink) {
          linkRequiredRef.current?.(response.credential);
          setError("This email already uses password sign-in. Enter your password below once to securely connect this Google account.");
          setBusy(false);
          return;
        }
        throw new Error(detail || "Unable to sign in with Google.");
      }
      await callbackRef.current(payload.user as AuthUser);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in with Google.");
      setBusy(false);
    }
  }, [mode]);

  const renderGoogleButton = useCallback(() => {
    if (!clientId || !scriptReady || !window.google?.accounts.id || !buttonRef.current) return;

    if (!initializedRef.current) {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      initializedRef.current = true;
    }

    const element = buttonRef.current;
    const width = Math.max(220, Math.min(400, Math.floor(element.clientWidth || 400)));
    element.replaceChildren();
    window.google.accounts.id.renderButton(element, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: mode === "signup" ? "signup_with" : "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width,
    });
  }, [clientId, handleCredential, mode, scriptReady]);

  useEffect(() => {
    renderGoogleButton();
    if (!buttonRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => renderGoogleButton());
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, [renderGoogleButton]);

  if (!clientId) return null;

  return (
    <div className="space-y-5">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onReady={() => setScriptReady(true)}
        onError={() => setError("Google sign-in could not be loaded. You can still continue with email.")}
      />

      <div className="relative min-h-11 w-full">
        <div ref={buttonRef} className="flex min-h-11 w-full justify-center" aria-label="Sign in with Google" />
        {!scriptReady && !error ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-md border border-neutral-200 bg-white text-sm text-neutral-500">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading Google sign-in…
          </div>
        ) : null}
        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-md border border-neutral-200 bg-white/95 text-sm font-medium text-neutral-700">
            <Loader2 className="mr-2 size-4 animate-spin" /> Signing you in…
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="flex items-center gap-3" aria-hidden="true">
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">or continue with email</span>
        <div className="h-px flex-1 bg-neutral-200" />
      </div>
    </div>
  );
}
