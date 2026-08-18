import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  CheckCircle2,
  ShieldCheck,
  Users,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";

const foundations = [
  {
    title: "Clients & sales",
    description: "Manage leads, clients, quotations and orders in one connected sales workflow.",
    icon: Building2,
  },
  {
    title: "Projects & operations",
    description: "Turn confirmed work into projects and tasks while keeping delivery connected to sales.",
    icon: ChartNoAxesCombined,
  },
  {
    title: "Finance & accounting",
    description: "Track invoices, payments, accounts, expenses and multi-currency accounting with audit history.",
    icon: ShieldCheck,
  },
  {
    title: "People & permissions",
    description: "Run people operations with organization-scoped roles and permissions for every workspace.",
    icon: Users,
  },
];

const highlights = [
  "One workspace for CRM, delivery, finance and people operations",
  "Multi-tenant organization isolation and role-based access",
  "Multi-currency sales and accounting with auditable financial records",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:px-10 lg:py-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <Link href="/" className="group flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] p-2.5">
              <BrandMark variant="light" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-sm font-medium tracking-wide text-white/55">CODESTATION AI</p>
              <p className="text-lg font-semibold transition group-hover:text-white/85">Business OS</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200"
            >
              Start free
            </Link>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="max-w-3xl">
            <p className="mb-5 text-sm font-medium uppercase tracking-[0.2em] text-white/45">
              Global business management platform
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-7xl lg:leading-[1.02]">
              CodeStation AI Business OS
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/60 sm:text-lg">
              CodeStation AI Business OS is a multi-tenant business management platform for SMEs,
              software companies, agencies and service businesses. It connects CRM, quotations,
              orders, projects, invoices, payments, accounting, people operations and reports in
              one organization-scoped workspace.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-neutral-950"
              >
                Create your workspace
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white/80"
              >
                Sign in
              </Link>
            </div>

            <div className="mt-9 space-y-3">
              {highlights.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-white/55">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {foundations.map(({ title, description, icon: Icon }) => (
              <article
                key={title}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur"
              >
                <div className="mb-8 flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06]">
                  <Icon className="size-5 text-white/75" />
                </div>
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
              </article>
            ))}
          </div>
        </div>

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Google Sign-In and your data</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/50">
            Google Sign-In is an optional way to create or access your Business OS account. When
            you choose it, we use Google-provided identity information only to authenticate you
            and safely link your Business OS account. We do not receive your Google password, and
            signing in does not give Business OS access to your Gmail, Drive, Calendar or other
            Google services.
          </p>
          <p className="mt-3 text-sm text-white/55">
            Learn more in our{" "}
            <Link href="/privacy" className="font-semibold text-white underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <footer className="flex flex-col gap-3 border-t border-white/10 pt-5 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} CodeStation AI. CodeStation AI Business OS.</p>
          <nav className="flex flex-wrap gap-4">
            <Link href="/privacy" className="transition hover:text-white/75">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition hover:text-white/75">
              Terms of Service
            </Link>
            <Link href="/login" className="transition hover:text-white/75">
              Sign in
            </Link>
          </nav>
        </footer>
      </section>
    </main>
  );
}
