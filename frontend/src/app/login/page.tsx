"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Fingerprint, Loader2 } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { GoogleAuthSection } from "@/components/auth/google-sign-in";
import { PasswordField } from "@/components/auth/password-field";
import type { AuthUser } from "@/lib/auth-session";
import { conditionalPasskeysSupported, getPasskeyCredential, type PasskeyOptionsEnvelope } from "@/lib/passkeys";


type LoginResponse = { user: AuthUser };

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState<string | null>(null);
  const conditionalPasskeyAbortRef = useRef<AbortController | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("password_changed") === "1") {
      setNotice("Password changed. Your previous sessions were revoked; sign in again with the new password.");
    }
    if (params.get("reset") === "1") {
      setNotice("Password reset successfully. Sign in with your new password.");
    }
    if (params.get("verified") === "1") {
      setNotice("Email verified. You can now sign in.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    conditionalPasskeyAbortRef.current = controller;
    let active = true;
    void (async () => {
      if (!await conditionalPasskeysSupported()) return;
      try {
        const optionsResponse = await fetch("/api/auth/passkeys/options", { method: "POST" });
        if (!optionsResponse.ok || !active) return;
        const options = await optionsResponse.json() as PasskeyOptionsEnvelope;
        const credential = await getPasskeyCredential(options.public_key, {
          conditional: true,
          signal: controller.signal,
        });
        if (!active) return;
        const verifyResponse = await fetch("/api/auth/passkeys/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challenge_id: options.challenge_id, credential }),
        });
        if (!verifyResponse.ok || !active) return;
        const login = await verifyResponse.json() as LoginResponse;
        if (login.user.system_role === "super_admin") router.replace("/super-admin");
        else router.replace("/dashboard");
        router.refresh();
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        // Conditional mediation is intentionally quiet. The explicit passkey
        // button below surfaces actionable errors when the user asks to sign in.
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (conditionalPasskeyAbortRef.current === controller) conditionalPasskeyAbortRef.current = null;
    };
  }, [router]);

  useEffect(() => { setHydrated(true); }, []);

  async function finishAuthentication(user: AuthUser) {
    if (user.system_role === "super_admin") {
      router.replace("/super-admin");
      router.refresh();
      return;
    }

    // DashboardSessionProvider owns the canonical workspace bootstrap and will
    // redirect accounts with no workspace to onboarding. Avoid fetching the
    // organization list here and then fetching it again immediately on dashboard.
    router.replace("/dashboard");
    router.refresh();
  }

  function prepareGoogleLink(credential: string) {
    setPendingGoogleCredential(credential);
    setError(null);
    setNotice("Enter your existing Business OS email or username and password below once. After it is verified, this Google account will be connected securely.");
  }

  async function handlePasskeySignIn() {
    conditionalPasskeyAbortRef.current?.abort();
    conditionalPasskeyAbortRef.current = null;
    setPasskeyLoading(true);
    setError(null);
    setNotice(null);
    try {
      const optionsResponse = await fetch("/api/auth/passkeys/options", { method: "POST" });
      const optionsPayload = await optionsResponse.json().catch(() => null);
      if (!optionsResponse.ok) throw new Error(optionsPayload?.detail ?? "Unable to start passkey sign-in.");

      const options = optionsPayload as PasskeyOptionsEnvelope;
      const credential = await getPasskeyCredential(options.public_key);
      const verifyResponse = await fetch("/api/auth/passkeys/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_id: options.challenge_id, credential }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => null);
      if (!verifyResponse.ok) throw new Error(verifyPayload?.detail ?? "Unable to verify this passkey.");
      await finishAuthentication((verifyPayload as LoginResponse).user);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        setError("Passkey sign-in was cancelled or timed out.");
      } else {
        setError(reason instanceof Error ? reason.message : "Unable to sign in with a passkey.");
      }
      setPasskeyLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated) return;
    conditionalPasskeyAbortRef.current?.abort();
    conditionalPasskeyAbortRef.current = null;
    setLoading(true);
    setError(null);
    if (!pendingGoogleCredential) setNotice(null);

    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: String(form.get("identifier") ?? "").trim(),
          password: form.get("password"),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to sign in. Please try again.");
      }

      const login = (await response.json()) as LoginResponse;

      if (pendingGoogleCredential) {
        const linkResponse = await fetch("/api/profile/google-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: pendingGoogleCredential }),
        });
        const linkPayload = await linkResponse.json().catch(() => null);
        if (!linkResponse.ok) {
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
          setPendingGoogleCredential(null);
          throw new Error(
            `${linkPayload?.detail ?? "Google could not be connected."} Click Continue with Google again and retry.`,
          );
        }
        setPendingGoogleCredential(null);
      }

      await finishAuthentication(login.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthFrame variant="login" eyebrow="WELCOME BACK" title="Sign in to your workspace."
      description="Your clients, projects and finances. Right where you left them."
      asideTitle="One workspace. Every moving part." asideDescription="From the first client conversation to the final payment.">
      <form className="login-form" method="post" onSubmit={handleSubmit}>
        <fieldset disabled={!hydrated} style={{ display: "contents" }} aria-label="Sign-in credentials">
        <label className="login-field"><span>Email or username</span>
          <input name="identifier" type="text" autoComplete="username webauthn" required autoFocus className="login-identifier" placeholder="you@company.com or username" />
        </label>
        <div className="login-password">
          <div className="login-password-label"><span>Password</span><Link href="/forgot-password">Forgot password?</Link></div>
          <PasswordField name="password" label="Password" hideLabel autoComplete="current-password" placeholder="Enter your password" />
        </div>
        {notice ? <div className="login-message login-message-success" role="status"><p>{notice}</p>
          {pendingGoogleCredential ? <button type="button" onClick={() => { setPendingGoogleCredential(null); setNotice(null); }} className="login-cancel-google">Cancel Google connection</button> : null}
        </div> : null}
        {error ? <div className="login-message login-message-error" role="alert">{error}</div> : null}
        <button type="submit" disabled={!hydrated || loading} className="login-submit">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? (pendingGoogleCredential ? "Connecting Google…" : "Signing in…") : (pendingGoogleCredential ? "Confirm password & connect Google" : "Sign in securely")}
          {!loading ? <ArrowRight size={17} /> : null}
        </button>
        </fieldset>
      </form>
      <div className="login-divider" aria-hidden="true"><span />or use another sign-in method<span /></div>
      <div className="login-alternative-methods">
        <button type="button" onClick={() => void handlePasskeySignIn()} disabled={passkeyLoading || loading} className="login-passkey">
          {passkeyLoading ? <Loader2 className="size-4 animate-spin" /> : <Fingerprint size={19} />}
          {passkeyLoading ? "Waiting for passkey…" : "Sign in with a passkey"}
        </button>
        <GoogleAuthSection mode="login" onAuthenticated={finishAuthentication} onLinkRequired={prepareGoogleLink} showEmailDivider={false} />
      </div>
      <div className="login-account-links"><p>New to Business OS? <Link href="/signup">Create your workspace <ArrowRight size={13} /></Link></p><Link href="/verify-email" className="login-verification">Resend verification email</Link></div>
    </AuthFrame>
  );
}
