"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";

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

  return <AuthFrame eyebrow="Email verification" title={verified ? "Email verified" : "Verify your email"} description={token ? "We are validating your time-limited verification link." : "Password accounts must verify their email address before signing in."} asideTitle="Verified identity before workspace access." asideDescription="Google accounts are verified by Google; password accounts confirm mailbox ownership with a signed, expiring link.">
    {checking ? <div className="flex items-center justify-center gap-3 rounded-xl border bg-neutral-50 px-4 py-8 text-sm text-neutral-600"><Loader2 className="size-5 animate-spin" />Verifying your email…</div> : null}
    {verified ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800"><div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" />Verification complete</div><p className="mt-1">{message}</p><Link href="/login?verified=1" className="mt-4 inline-flex font-semibold underline-offset-4 hover:underline">Continue to sign in</Link></div> : null}
    {!checking && !verified ? <>
      {message ? <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      <form onSubmit={resend} className="space-y-5">
        <label className="block text-sm font-medium text-neutral-800">Account email<input name="email" type="email" defaultValue={email} autoComplete="email" required className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]" placeholder="you@company.com" /></label>
        <button type="submit" disabled={resending} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{resending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}{resending ? "Sending…" : "Resend verification email"}</button>
      </form>
      <p className="mt-7 text-center text-sm text-neutral-500"><Link href="/login" className="font-semibold text-neutral-950 underline-offset-4 hover:underline">Back to sign in</Link></p>
    </> : null}
  </AuthFrame>;
}
