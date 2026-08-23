import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CircleUserRound,
  FolderKanban,
  Landmark,
  LifeBuoy,
  LockKeyhole,
  Mail,
  UsersRound,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Help & Support | CodeStation AI Business OS",
  description:
    "Get help with Business OS account access, CRM, clients, projects, finance, accounting, security and workspace setup.",
};

const helpAreas = [
  {
    title: "Getting started",
    description: "Workspace setup, company details, users, roles, permissions and the core Business OS workflow.",
    icon: BookOpenCheck,
  },
  {
    title: "Account & sign-in",
    description: "Email or username sign-in, Google account linking, password access, devices and session security.",
    icon: CircleUserRound,
  },
  {
    title: "CRM, clients & sales",
    description: "Leads, client profiles, quotations, orders, client access and the connected commercial journey.",
    icon: UsersRound,
  },
  {
    title: "Projects & delivery",
    description: "Projects, teams, tasks, order relationships, delivery context and project financial visibility.",
    icon: FolderKanban,
  },
  {
    title: "Finance & accounting",
    description: "Invoices, payments, accounts, expenses, transfers, receivables, journal, ledger and financial reports.",
    icon: Landmark,
  },
  {
    title: "Security & permissions",
    description: "Tenant isolation, role-based access, active device sessions, audit records and account security questions.",
    icon: LockKeyhole,
  },
];

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-white/10 bg-neutral-950/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] p-2.5"><BrandMark variant="light" className="h-full w-full" /></div>
            <div><p className="text-[10px] font-semibold tracking-[0.18em] text-white/40">CODESTATION AI</p><p className="text-sm font-semibold sm:text-base">Business OS</p></div>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/contact" className="rounded-full px-3 py-2 text-sm font-medium text-white/65 transition hover:bg-white/[0.06] hover:text-white">Contact</Link>
            <Link href="/login" className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/[0.06]">Sign in</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/55"><LifeBuoy className="size-3.5" />Help & Support</div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Get the right help for the part of your business you are working on.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/50">
            Business OS connects sales, delivery, finance and people operations. Use the areas below to identify what you need help with, then contact us with enough context to investigate quickly.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {helpAreas.map(({ title, description, icon: Icon }) => (
            <article key={title} className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]"><Icon className="size-5 text-white/70" /></div>
              <h2 className="mt-7 text-lg font-semibold">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-white/45">{description}</p>
            </article>
          ))}
        </div>

        <section className="mt-8 grid gap-6 rounded-3xl border border-white/10 bg-white/[0.025] p-6 sm:p-8 lg:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold">Before you contact support</h2>
            <p className="mt-3 text-sm leading-6 text-white/45">The most useful support request usually includes:</p>
            <ul className="mt-5 space-y-3 text-sm text-white/55">
              <li>• Your company/workspace name.</li>
              <li>• The page or feature where the issue occurred.</li>
              <li>• What you were trying to do and what happened instead.</li>
              <li>• The exact error message, if one appeared.</li>
              <li>• A screenshot when it helps explain the issue.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-5">
            <Mail className="size-5 text-white/65" />
            <h2 className="mt-5 text-lg font-semibold">Contact support</h2>
            <p className="mt-3 text-sm leading-6 text-white/45">Send your Business OS support request to CodeStation AI.</p>
            <a href="mailto:info@codestationai.com?subject=Business%20OS%20support%20request" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white/80 underline decoration-white/25 underline-offset-4 hover:text-white">info@codestationai.com <ArrowRight className="size-4" /></a>
            <p className="mt-5 text-xs leading-5 text-amber-100/55">Never send passwords, recovery codes, 2FA codes or other authentication secrets in a support request.</p>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white p-6 text-neutral-950 sm:p-8">
          <h2 className="text-xl font-semibold">New to Business OS?</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">Start by creating your organization workspace. If you want to discuss whether Business OS fits your company before signing up, contact us first.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 text-sm font-semibold text-white">Create workspace <ArrowRight className="size-4" /></Link>
            <Link href="/contact" className="inline-flex h-11 items-center justify-center rounded-full border border-neutral-200 px-5 text-sm font-semibold">Contact us</Link>
          </div>
        </section>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 text-xs text-white/40 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>© {new Date().getFullYear()} CodeStation AI. Business OS.</p>
          <nav className="flex flex-wrap gap-4">
            <Link href="/">Home</Link>
            <Link href="/contact">Contact Us</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
