"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { GoogleAuthSection } from "@/components/auth/google-sign-in";
import { PasswordField } from "@/components/auth/password-field";
import type { AuthUser } from "@/lib/auth-session";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finishGoogleAuthentication(user: AuthUser) {
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

    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.get("full_name"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to create your account.");
      }

      router.replace("/onboarding");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create your account.");
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="Create your workspace"
      title="Start with one account"
      description="Create your identity first. In the next step you will configure the company, country, timezone and business defaults."
      asideTitle="Build your operating system around the company."
      asideDescription="Start simple, then connect clients, quotations, orders, projects, invoices, payments, accounting and reports as your business runs."
    >
      <GoogleAuthSection mode="signup" onAuthenticated={finishGoogleAuthentication} />

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-neutral-800">
          Full name
          <input
            name="full_name"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            autoFocus
            className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-[15px] outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]"
            placeholder="Your full name"
          />
        </label>

        <label className="block text-sm font-medium text-neutral-800">
          Work email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-[15px] outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]"
            placeholder="you@company.com"
          />
        </label>

        <div>
          <PasswordField name="password" label="Password" autoComplete="new-password" placeholder="Create a secure password" />
          <p className="mt-2 text-xs text-neutral-400">Use at least 8 characters. You can skip passwords entirely when you continue with Google.</p>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 focus:outline-none focus:ring-4 focus:ring-neutral-950/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {loading ? "Creating account…" : "Create account"}
          {!loading ? <ArrowRight className="size-4" /> : null}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-neutral-500">
        Already have a workspace?{" "}
        <Link href="/login" className="font-semibold text-neutral-950 underline-offset-4 hover:underline">Sign in</Link>
      </p>

      <p className="mt-4 text-center text-xs leading-5 text-neutral-400">
        Account creation does not create a company automatically — your tenant workspace is configured in onboarding.
      </p>
    </AuthFrame>
  );
}
