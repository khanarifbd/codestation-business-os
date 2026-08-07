"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");
    if (password !== confirmation) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: form.get("full_name"),
        email: form.get("email"),
        password,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.detail ?? "Unable to create your account.");
      setLoading(false);
      return;
    }

    router.replace("/onboarding");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-950">
      <div className="mx-auto grid min-h-[calc(100vh-6rem)] max-w-6xl overflow-hidden rounded-3xl border bg-white shadow-sm lg:grid-cols-[0.95fr_1.05fr]">
        <section className="hidden bg-neutral-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <p className="text-sm text-white/50">CodeStation AI</p>
            <h1 className="mt-1 text-xl font-semibold">Business OS</h1>
          </div>
          <div>
            <p className="max-w-md text-4xl font-semibold tracking-tight">
              Your company starts with one secure workspace.
            </p>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/50">
              Create your account first, then configure the company, currency, timezone, and operations.
            </p>
          </div>
          <p className="text-xs text-white/35">Multi-tenant SaaS foundation</p>
        </section>

        <section className="flex items-center justify-center p-7 sm:p-12">
          <div className="w-full max-w-md">
            <p className="text-sm font-medium text-neutral-500">Start your workspace</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Create your account</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-500">
              You will create and configure your company in the next step.
            </p>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="block text-sm font-medium">
                Full name
                <input
                  name="full_name"
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500"
                  placeholder="Your full name"
                />
              </label>

              <label className="block text-sm font-medium">
                Work email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500"
                  placeholder="you@company.com"
                />
              </label>

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500"
                    placeholder="8+ characters"
                  />
                </label>
                <label className="block text-sm font-medium">
                  Confirm password
                  <input
                    name="password_confirmation"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500"
                    placeholder="Repeat password"
                  />
                </label>
              </div>

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                Create account
                {!loading ? <ArrowRight className="size-4" /> : null}
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-neutral-500">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-neutral-950 hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
