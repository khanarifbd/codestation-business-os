"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { GoogleAuthSection } from "@/components/auth/google-sign-in";
import { PasswordField } from "@/components/auth/password-field";
import type { AuthUser } from "@/lib/auth-session";

type LoginResponse = { user: AuthUser };

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function finishAuthentication(user: AuthUser) {
    if (user.system_role === "super_admin") {
      router.replace("/super-admin");
      router.refresh();
      return;
    }

    const organizations = await fetch("/api/organizations", { cache: "no-store" });
    if (organizations.ok) {
      const items = (await organizations.json()) as unknown[];
      router.replace(items.length > 0 ? "/dashboard" : "/onboarding");
    } else {
      router.replace("/onboarding");
    }
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to sign in. Please try again.");
      }

      const login = (await response.json()) as LoginResponse;
      await finishAuthentication(login.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="Welcome back"
      title="Sign in to Business OS"
      description="Pick up exactly where your team left off — clients, projects, finance and operations in one workspace."
      asideTitle="Your business, connected from lead to ledger."
      asideDescription="Move from client conversations to delivery, invoicing, payments and accounting without stitching together separate tools."
    >
      <GoogleAuthSection mode="login" onAuthenticated={finishAuthentication} />

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-neutral-800">
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-[15px] outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]"
            placeholder="you@company.com"
          />
        </label>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-neutral-800">Password</span>
            <Link href="/forgot-password" className="text-xs font-semibold text-neutral-600 underline-offset-4 hover:text-neutral-950 hover:underline">Forgot password?</Link>
          </div>
          <PasswordField
            name="password"
            label=""
            autoComplete="current-password"
            placeholder="Enter your password"
          />
        </div>

        {notice ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{notice}</div>
        ) : null}
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 focus:outline-none focus:ring-4 focus:ring-neutral-950/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
          {loading ? "Signing in…" : "Sign in securely"}
          {!loading ? <ArrowRight className="size-4" /> : null}
        </button>
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-neutral-500">
        <Link href="/verify-email" className="font-medium underline-offset-4 hover:text-neutral-950 hover:underline">Resend verification email</Link>
      </div>

      <p className="mt-7 text-center text-sm text-neutral-500">
        New to Business OS?{" "}
        <Link href="/signup" className="font-semibold text-neutral-950 underline-offset-4 hover:underline">
          Create your workspace
        </Link>
      </p>

      <p className="mt-4 text-center text-xs leading-5 text-neutral-400">
        Your Business OS session is kept in secure HttpOnly cookies after authentication.
      </p>
    </AuthFrame>
  );
}
