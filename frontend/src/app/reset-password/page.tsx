"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Loader2, KeyRound } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthNotice, AuthBackLink } from "@/components/auth/auth-notice";
import { PasswordField } from "@/components/auth/password-field";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm_password") ?? "");
    if (!token) {
      setError("This password reset link is missing its token. Request a new reset email.");
      return;
    }
    if (password !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to reset the password.");
      window.location.assign("/login?reset=1");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset the password.");
      setLoading(false);
    }
  }

  return <AuthFrame variant="reset" eyebrow="ACCOUNT RECOVERY" title="A new password. A fresh start." description="Choose a password with at least 8 characters. After a successful reset, sign in again on your devices." asideTitle="A fresh start." asideDescription="Choose a new password for your account.">
    {!token ? <div className="auth-top-notice"><AuthNotice kind="info"><strong>A reset link is needed</strong><p>Open the link from your recovery email, or request a new one below.</p></AuthNotice></div> : null}
    <form onSubmit={submit} className="login-form">
      <div className="auth-password-field"><PasswordField name="password" label="New password" autoComplete="new-password" placeholder="At least 8 characters" /></div>
      <div className="auth-password-field"><PasswordField name="confirm_password" label="Confirm new password" autoComplete="new-password" placeholder="Repeat the new password" /></div>
      {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
      <button type="submit" disabled={loading || !token} className="login-submit">{loading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" aria-hidden="true" />}{loading ? "Resetting…" : "Reset password"}</button>
    </form>
    <p className="auth-field-hint auth-session-note">A successful reset signs out your older Business OS sessions.</p>
    {!token ? <p className="auth-recovery-link"><Link href="/forgot-password">Request a new reset link <ArrowRight size={13} aria-hidden="true" /></Link></p> : null}
    <AuthBackLink />
  </AuthFrame>;
}
