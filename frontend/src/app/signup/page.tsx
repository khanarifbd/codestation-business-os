"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Loader2, Mail } from "lucide-react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthNotice } from "@/components/auth/auth-notice";
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
      if (items.length > 0) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
    }
    window.location.replace("/onboarding");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email") ?? "").trim().toLowerCase();
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.get("full_name"),
          email,
          password: form.get("password"),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to create your account.");
      }

      router.replace(`/verify-email?email=${encodeURIComponent(email)}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create your account.");
      setLoading(false);
    }
  }

  return (
    <AuthFrame variant="signup"
      eyebrow="CREATE YOUR ACCOUNT"
      title="Make room for better work."
      description="Start with your account. Your company workspace comes next."
      asideTitle="A connected business." asideDescription="Set up your Business OS account."
    >
      <form className="login-form" onSubmit={handleSubmit}>
        <label className="login-field">Full name
          <input name="full_name" type="text" autoComplete="name" required minLength={2} autoFocus placeholder="Your full name" />
        </label>
        <label className="login-field">Work email
          <input name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
        </label>
        <div className="auth-password-field">
          <PasswordField name="password" label="Password" autoComplete="new-password" placeholder="Create a password" />
          <p className="auth-field-hint">Use at least 8 characters.</p>
        </div>
        {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
        <button type="submit" disabled={loading} className="login-submit">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? "Creating account…" : "Create account"}
          {!loading ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
        </button>
      </form>
      <p className="auth-next-step"><Mail size={15} aria-hidden="true" /><span>Next: verify your email before signing in.</span></p>
      <div className="auth-google-option"><GoogleAuthSection mode="signup" onAuthenticated={finishGoogleAuthentication} showEmailDivider={false} /></div>
      <div className="login-account-links"><p>Already have an account? <Link href="/login">Sign in <ArrowRight size={12} aria-hidden="true" /></Link></p></div>
      <p className="auth-provider-note">Google accounts are verified by Google. Password accounts require email verification.</p>
    </AuthFrame>
  );
}
