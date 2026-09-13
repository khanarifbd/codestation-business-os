"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";

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

  return <AuthFrame eyebrow="Account recovery" title="Reset your password" description="Enter your account email. If it is eligible for password recovery, we will send a time-limited reset link." asideTitle="Recovery without support tickets." asideDescription="Password reset links are short-lived and invalidate existing sessions when the password changes.">
    <form onSubmit={submit} className="space-y-5">
      <label className="block text-sm font-medium text-neutral-800">Email address<input name="email" type="email" autoComplete="email" required autoFocus className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]" placeholder="you@company.com" /></label>
      {message ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{loading ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}{loading ? "Sending…" : "Send reset link"}</button>
    </form>
    <p className="mt-7 text-center text-sm text-neutral-500"><Link href="/login" className="font-semibold text-neutral-950 underline-offset-4 hover:underline">Back to sign in</Link></p>
  </AuthFrame>;
}
