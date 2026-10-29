"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Loader2, KeyRound } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";
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

  return <AuthFrame eyebrow="Account recovery" title="Choose a new password" description="A successful reset revokes every older Business OS session for this user." asideTitle="One reset, old sessions revoked." asideDescription="The reset link is time-limited and becomes unusable after the password changes.">
    <form onSubmit={submit} className="space-y-5">
      <PasswordField name="password" label="New password" autoComplete="new-password" placeholder="At least 8 characters" />
      <PasswordField name="confirm_password" label="Confirm new password" autoComplete="new-password" placeholder="Repeat the new password" />
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      <button type="submit" disabled={loading || !token} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{loading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{loading ? "Resetting…" : "Reset password"}</button>
    </form>
    {!token ? <p className="mt-5 text-center text-sm text-neutral-500"><Link href="/forgot-password" className="font-semibold text-neutral-950 underline-offset-4 hover:underline">Request a new reset link</Link></p> : null}
    <p className="mt-7 text-center text-sm text-neutral-500"><Link href="/login" className="font-semibold text-neutral-950 underline-offset-4 hover:underline">Back to sign in</Link></p>
  </AuthFrame>;
}
