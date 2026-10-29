"use client";

import { FormEvent, useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthNotice, AuthBackLink } from "@/components/auth/auth-notice";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to request a password reset.");
      setMessage(payload?.message ?? "If an eligible account exists, reset instructions will be sent.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to request a password reset.");
    } finally {
      setLoading(false);
    }
  }

  return <AuthFrame variant="recovery" eyebrow="ACCOUNT RECOVERY" title="Let's get you back in." description="Enter your account email. If it's eligible for recovery, we'll send a time-limited reset link." asideTitle="A fresh start." asideDescription="Recover access to your account.">
    <form onSubmit={submit} className="login-form">
      <label className="login-field">Email address<input name="email" type="email" autoComplete="email" required autoFocus placeholder="you@company.com" /></label>
      {message ? <AuthNotice kind="success">{message}</AuthNotice> : null}
      {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
      <button type="submit" disabled={loading} className="login-submit">{loading ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" aria-hidden="true" />}{loading ? "Sending…" : "Send reset link"}</button>
    </form>
    <div className="auth-help-card"><Mail size={18} aria-hidden="true" /><div><strong>Check the right inbox</strong><p>Use the email you signed up with. If an email arrives, open its link to choose a new password.</p></div></div>
    <AuthBackLink />
  </AuthFrame>;
}
