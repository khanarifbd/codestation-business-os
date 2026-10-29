"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Mail } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthNotice, AuthBackLink } from "@/components/auth/auth-notice";

export default function VerifyEmailPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [verified, setVerified] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextToken = params.get("token") ?? "";
    setToken(nextToken);
    setEmail(params.get("email") ?? "");
    if (!nextToken) return;
    setChecking(true);
    void fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: nextToken }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to verify this email link.");
      setVerified(true);
      setMessage(payload?.message ?? "Email verified. You can now sign in.");
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Unable to verify this email link.");
    }).finally(() => setChecking(false));
  }, []);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResending(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/verification/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to resend verification email.");
      setMessage(payload?.message ?? "If the account needs verification, a verification email will be sent.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to resend verification email.");
    } finally {
      setResending(false);
    }
  }

  return <AuthFrame variant="verification" eyebrow="EMAIL VERIFICATION" title={verified ? "You're verified. You're ready." : "Your next step is in your inbox."} description={verified ? "Your email is confirmed. Continue to sign in to Business OS." : token ? "We're checking your verification link. This page will update when the check finishes." : "Confirm your email address before signing in with a password. Need another link? Request one below."} asideTitle="A connected business." asideDescription="Confirm your email to continue.">
    {checking ? <div className="auth-checking" role="status"><Loader2 className="size-5 animate-spin" aria-hidden="true" /><span>Verifying your email…</span></div> : null}
    {verified ? <div className="auth-verified"><span className="auth-verified-icon"><CheckCircle2 size={29} strokeWidth={1.5} aria-hidden="true" /></span><AuthNotice kind="success">{message}</AuthNotice><Link href="/login?verified=1" className="login-submit">Continue to sign in <ArrowRight size={15} aria-hidden="true" /></Link></div> : null}
    {!checking && !verified ? <>
      <form onSubmit={resend} className="login-form">
        <label className="login-field">Account email<input name="email" type="email" defaultValue={email} autoComplete="email" required placeholder="you@company.com" /></label>
        {message ? <AuthNotice kind="success">{message}</AuthNotice> : null}
        {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
        <button type="submit" disabled={resending} className="login-submit">{resending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" aria-hidden="true" />}{resending ? "Sending…" : "Resend verification email"}</button>
      </form>
      <div className="auth-help-card"><Mail size={18} aria-hidden="true" /><div><strong>Can’t find the email?</strong><p>Check your spam or junk folder, and make sure the email above is the one you used to sign up.</p></div></div>
      <AuthBackLink />
    </> : null}
  </AuthFrame>;
}
