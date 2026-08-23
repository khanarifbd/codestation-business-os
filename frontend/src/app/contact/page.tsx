import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, LifeBuoy, Mail, ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Contact CodeStation AI Business OS",
  description:
    "Contact CodeStation AI about Business OS product questions, sales, support, partnerships, privacy or account access.",
};

const contactOptions = [
  {
    title: "Product & sales",
    description:
      "Talk to us about using Business OS for your company, your workflow, multi-company access, finance and accounting, or rollout planning.",
    icon: Building2,
    subject: "Business OS product inquiry",
  },
  {
    title: "Help & support",
    description:
      "Already using Business OS? Send us the workspace name, affected page or feature, what you expected and what happened.",
    icon: LifeBuoy,
    subject: "Business OS support request",
  },
  {
    title: "Privacy & security",
    description:
      "Contact us about privacy requests, account security, data handling or a security concern involving Business OS.",
    icon: ShieldCheck,
    subject: "Business OS privacy or security question",
  },
];

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-white/10 bg-neutral-950/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] p-2.5">
              <BrandMark variant="light" className="h-full w-full" />
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-[0.18em] text-white/40">CODESTATION AI</p>
              <p className="text-sm font-semibold sm:text-base">Business OS</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/support" className="rounded-full px-3 py-2 text-sm font-medium text-white/65 transition hover:bg-white/[0.06] hover:text-white">Support</Link>
            <Link href="/login" className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/[0.06]">Sign in</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Contact us</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Questions about Business OS? We are here to help.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/50">
            Whether you are evaluating Business OS for your company or already running your team on it, contact CodeStation AI for product, support, privacy or security questions.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {contactOptions.map(({ title, description, icon: Icon, subject }) => (
            <article key={title} className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]"><Icon className="size-5 text-white/70" /></div>
              <h2 className="mt-7 text-lg font-semibold">{title}</h2>
              <p className="mt-3 min-h-24 text-sm leading-6 text-white/45">{description}</p>
              <a
                href={`mailto:info@codestationai.com?subject=${encodeURIComponent(subject)}`}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white/75 transition hover:text-white"
              >
                Email CodeStation AI <ArrowRight className="size-4" />
              </a>
            </article>
          ))}
        </div>

        <section className="mt-6 grid gap-4 rounded-3xl border border-white/10 bg-white/[0.025] p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex items-center gap-2"><Mail className="size-5 text-white/65" /><h2 className="text-lg font-semibold">Primary contact</h2></div>
            <p className="mt-3 text-sm leading-6 text-white/45">For Business OS inquiries and support, email us at:</p>
            <a href="mailto:info@codestationai.com" className="mt-2 inline-flex text-lg font-semibold text-white underline decoration-white/25 underline-offset-4 hover:decoration-white">info@codestationai.com</a>
          </div>
          <Link href="/support" className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-neutral-950">
            Visit Help & Support <ArrowRight className="size-4" />
          </Link>
        </section>

        <section className="mt-6 rounded-3xl border border-amber-300/15 bg-amber-300/[0.05] p-6 text-sm leading-6 text-amber-50/65">
          <strong className="text-amber-50">Security reminder:</strong> never send your password, recovery code, 2FA code or other authentication secret by email. For support, share only the information needed to identify the workspace, page and issue.
        </section>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 text-xs text-white/40 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>© {new Date().getFullYear()} CodeStation AI. Business OS.</p>
          <nav className="flex flex-wrap gap-4">
            <Link href="/">Home</Link>
            <Link href="/support">Help & Support</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
