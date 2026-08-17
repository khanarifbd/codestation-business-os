"use client";

import Script from "next/script";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type CredentialResponse = { credential: string };
type GoogleApi = {
  initialize: (config: { client_id: string; callback: (response: CredentialResponse) => void; auto_select?: boolean }) => void;
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
type GoogleWindow = Window & { google?: { accounts: { id: GoogleApi } } };

export function GoogleReauthButton({
  onCredential,
  busy = false,
}: {
  onCredential: (credential: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
  const buttonRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  const initializedRef = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { callbackRef.current = onCredential; }, [onCredential]);

  const handleCredential = useCallback((response: CredentialResponse) => {
    if (!response.credential) {
      setError("Google did not return a verification credential. Please try again.");
      return;
    }
    setError(null);
    void callbackRef.current(response.credential);
  }, []);

  const renderButton = useCallback(() => {
    const google = (window as GoogleWindow).google?.accounts.id;
    const element = buttonRef.current;
    if (!clientId || !scriptReady || !google || !element) return;
    if (!initializedRef.current) {
      google.initialize({ client_id: clientId, callback: handleCredential, auto_select: false });
      initializedRef.current = true;
    }
    const width = Math.max(220, Math.min(420, Math.floor(element.clientWidth || 420)));
    element.replaceChildren();
    google.renderButton(element, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width,
    });
  }, [clientId, handleCredential, scriptReady]);

  useEffect(() => {
    renderButton();
    if (!buttonRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(renderButton);
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, [renderButton]);

  if (!clientId) {
    return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Google verification is not configured for this deployment.</div>;
  }

  return (
    <div className="space-y-3">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setError("Google verification could not be loaded. Please try again.")}
      />
      <div className="relative min-h-11 w-full max-w-md">
        <div ref={buttonRef} className="flex min-h-11 w-full justify-start" aria-label="Verify with Google" />
        {!scriptReady && !error ? <div className="absolute inset-0 flex items-center justify-center rounded-md border bg-white text-sm text-neutral-500"><Loader2 className="mr-2 size-4 animate-spin" />Loading Google verification…</div> : null}
        {busy ? <div className="absolute inset-0 flex items-center justify-center rounded-md border bg-white/95 text-sm font-medium text-neutral-700"><Loader2 className="mr-2 size-4 animate-spin" />Saving password…</div> : null}
      </div>
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
