import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  FileText,
  FolderKanban,
  Gauge,
  Globe2,
  Landmark,
  Layers3,
  LifeBuoy,
  LockKeyhole,
  Mail,
  ReceiptText,
  ShieldCheck,
  TrendingUp,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Business OS for CRM, Projects, Finance & Accounting",
  description:
    "Run clients, sales, projects, invoices, payments, accounting, employees and reports from one connected business operating system.",
};

const workflow = [
  "Lead",
  "Client",
  "Quotation",
  "Order",
  "Project",
  "Invoice",
  "Payment",
  "Accounting",
  "Reports",
];

const modules = [
  {
    title: "CRM & clients",
    description:
      "Track leads, acquisition sources, client profiles, communication context and the complete commercial relationship in one place.",
    icon: Users,
    items: ["Lead pipeline", "Client profiles", "Access & shared resources"],
  },
  {
    title: "Quotations & orders",
    description:
      "Move opportunities into structured quotations and confirmed orders without losing the source, client or commercial history.",
    icon: ClipboardCheck,
    items: ["Quotations", "Order execution", "Commercial snapshots"],
  },
  {
    title: "Projects & delivery",
    description:
      "Turn confirmed work into projects, assign responsibility and keep delivery connected to the order that created it.",
    icon: FolderKanban,
    items: ["Projects & tasks", "Team assignment", "Delivery context"],
  },
  {
    title: "Finance & accounting",
    description:
      "Manage invoices, money in and out, accounts, expenses, transfers and proper accounting from the same operational data.",
    icon: Landmark,
    items: ["Invoices & payments", "Accounts & expenses", "Journal & reports"],
  },
  {
    title: "People & payroll",
    description:
      "Keep employees, organization roles and people operations inside the same company workspace with controlled access.",
    icon: UserRoundCheck,
    items: ["Employees", "Roles & permissions", "Payroll operations"],
  },
  {
    title: "Reports & control",
    description:
      "Monitor what is happening across sales, delivery and finance without rebuilding the story from disconnected tools.",
    icon: BarChart3,
    items: ["Business overview", "Financial reporting", "Audit trail"],
  },
];

const monitoring = [
  {
    title: "Know what is moving",
    description: "See active work, orders, projects and client activity without chasing updates across multiple systems.",
    icon: Gauge,
  },
  {
    title: "Know what is owed",
    description: "Follow invoiced, paid and outstanding amounts so receivables do not disappear inside spreadsheets or chat threads.",
    icon: ReceiptText,
  },
  {
    title: "Know where money sits",
    description: "Keep bank, cash and wallet accounts separate by currency and follow real money movement with traceable records.",
    icon: WalletCards,
  },
  {
    title: "Know who can do what",
    description: "Give owners, managers, accountants and employees the access they need without exposing the whole company.",
    icon: LockKeyhole,
  },
];

const audiences = [
  "Software companies",
  "Agencies",
  "Consultancies",
  "Startups",
  "Professional services",
  "Growing SMEs",
];

export default function Home() {
  return (
    <main id="top" className="min-h-screen overflow-x-clip bg-neutral-950 text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[760px] bg-[radial-gradient(circle_at_18%_16%,rgba(255,255,255,0.09),transparent_28%),radial-gradient(circle_at_82%_22%,rgba(59,130,246,0.10),transparent_24%)]" />

      <header className="sticky top-0 z-50 border-b border-white/10 bg-neutral-950/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1480px] items-center justify-between px-5 py-4 sm:px-6 lg:px-10">
          <Link href="/" className="group flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] p-2.5">
              <BrandMark variant="light" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-white/45">CODESTATION AI</p>
              <p className="text-base font-semibold transition group-hover:text-white/80 sm:text-lg">Business OS</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-white/55 lg:flex">
            <a href="#platform" className="transition hover:text-white">Platform</a>
            <a href="#workflow" className="transition hover:text-white">Workflow</a>
            <a href="#finance" className="transition hover:text-white">Finance</a>
            <a href="#security" className="transition hover:text-white">Security</a>
            <Link href="/contact" className="transition hover:text-white">Contact</Link>
            <Link href="/support" className="transition hover:text-white">Support</Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-full px-3 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white sm:px-4">
              Sign in
            </Link>
            <Link href="/signup" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200">
              Create workspace
            </Link>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid w-full max-w-[1480px] gap-12 px-5 pb-20 pt-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.03fr_0.97fr] lg:items-center lg:px-10 lg:pb-28 lg:pt-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/60">
            <Layers3 className="size-3.5" />
            One connected operating system for your business
          </div>
          <h1 className="mt-6 text-[42px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-6xl lg:text-[72px]">
            Run your business with the whole picture in front of you.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/58 sm:text-lg sm:leading-8">
            Bring clients, CRM, quotations, orders, projects, employees, invoices, payments and accounting into one connected workspace. Business OS helps your team operate day to day while giving management a clear view of what is happening across the company.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200">
              Create your workspace <ArrowRight className="size-4" />
            </Link>
            <a href="#platform" className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 px-6 text-sm font-semibold text-white/80 transition hover:bg-white/[0.06]">
              Explore the platform <ChevronRight className="size-4" />
            </a>
          </div>

          <div className="mt-9 grid gap-3 text-sm text-white/55 sm:grid-cols-2">
            <Benefit>Connected sales-to-accounting workflow</Benefit>
            <Benefit>Multi-company and role-based access</Benefit>
            <Benefit>Multi-currency financial operations</Benefit>
            <Benefit>Auditable business and finance records</Benefit>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-8 rounded-[40px] bg-white/[0.035] blur-3xl" />
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.055] p-3 shadow-2xl shadow-black/30 backdrop-blur sm:p-4">
            <div className="rounded-[22px] border border-white/10 bg-[#101010] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-white/35">Business overview</p>
                  <p className="mt-1 text-lg font-semibold">Your company, at a glance</p>
                </div>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">Live operations</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <DashboardMetric label="Active clients" value="24" detail="CRM & relationships" icon={Users} />
                <DashboardMetric label="Open projects" value="8" detail="Delivery in progress" icon={FolderKanban} />
                <DashboardMetric label="Outstanding" value="USD 8,420" detail="Invoices to collect" icon={FileText} />
                <DashboardMetric label="This month" value="USD 21,600" detail="Payments received" icon={TrendingUp} />
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-white/35">Connected workflow</p>
                    <p className="mt-1 text-sm font-semibold">From opportunity to financial record</p>
                  </div>
                  <CheckCircle2 className="size-5 text-emerald-400" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {workflow.slice(0, 8).map((item, index) => (
                    <span key={item} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/55">
                      <span className="flex size-4 items-center justify-center rounded-full bg-white/10 text-[9px] text-white/70">{index + 1}</span>
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <p className="text-xs text-white/35">Financial accounts</p>
                  <div className="mt-3 space-y-2.5 text-sm">
                    <MiniRow label="Bank · BDT" value="৳ 312,500" />
                    <MiniRow label="Wallet · USD" value="$ 4,820" />
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <p className="text-xs text-white/35">Management view</p>
                  <div className="mt-3 space-y-2.5 text-sm">
                    <MiniRow label="Orders completed" value="12" />
                    <MiniRow label="Invoices overdue" value="3" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-white/30">Illustrative overview of the connected Business OS experience</p>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.025]">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-5 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <p className="max-w-xl text-sm leading-6 text-white/45">
            Built for teams that have outgrown disconnected spreadsheets, chats and single-purpose tools.
          </p>
          <div className="flex flex-wrap gap-2">
            {audiences.map((item) => <span key={item} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55">{item}</span>)}
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto w-full max-w-[1480px] px-5 py-20 sm:px-6 lg:px-10 lg:py-28">
        <SectionEyebrow>One connected workflow</SectionEyebrow>
        <div className="mt-4 grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Stop rebuilding the same business story in different tools.</h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-white/50 lg:justify-self-end">
            Business OS keeps the relationship between commercial work and financial results intact. A lead can become a client, quotation, order and project—and the resulting invoice, payment and accounting records remain connected to that journey.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
          <div className="flex min-w-max items-center gap-2 overflow-x-auto pb-2 lg:min-w-0 lg:flex-wrap">
            {workflow.map((item, index) => (
              <div key={item} className="flex items-center gap-2">
                <div className="flex h-20 min-w-[118px] flex-col justify-between rounded-2xl border border-white/10 bg-neutral-950/60 p-4">
                  <span className="text-xs text-white/30">0{index + 1}</span>
                  <span className="text-sm font-semibold text-white/80">{item}</span>
                </div>
                {index < workflow.length - 1 ? <ArrowRight className="size-4 shrink-0 text-white/20" /> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="platform" className="border-y border-white/10 bg-white/[0.025]">
        <div className="mx-auto w-full max-w-[1480px] px-5 py-20 sm:px-6 lg:px-10 lg:py-28">
          <SectionEyebrow>Everything your team needs to operate</SectionEyebrow>
          <div className="mt-4 max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Core business operations, designed to work together.</h2>
            <p className="mt-4 text-base leading-7 text-white/50">
              Give each team a focused workspace while management keeps a connected view of clients, work, money and people.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {modules.map(({ title, description, icon: Icon, items }) => (
              <article key={title} className="group rounded-3xl border border-white/10 bg-neutral-950/50 p-6 transition hover:border-white/20 hover:bg-white/[0.045]">
                <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                  <Icon className="size-5 text-white/75" />
                </div>
                <h3 className="mt-7 text-lg font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/45">{description}</p>
                <div className="mt-6 space-y-2.5">
                  {items.map((item) => <div key={item} className="flex items-center gap-2 text-xs text-white/45"><Check className="size-3.5 text-emerald-400" />{item}</div>)}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1480px] px-5 py-20 sm:px-6 lg:px-10 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <SectionEyebrow>Monitor without micromanaging</SectionEyebrow>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Understand the business without asking five people for five reports.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/50">
              Business OS turns day-to-day operational activity into management visibility. See what needs attention, follow financial movement and keep responsibility clear across the team.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {monitoring.map(({ title, description, icon: Icon }) => (
              <article key={title} className="min-h-56 rounded-3xl border border-white/10 bg-white/[0.035] p-6">
                <Icon className="size-5 text-white/65" />
                <h3 className="mt-10 text-lg font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/45">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="finance" className="border-y border-white/10 bg-[#0d0d0d]">
        <div className="mx-auto grid w-full max-w-[1480px] gap-12 px-5 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-10 lg:py-28">
          <div>
            <SectionEyebrow>Finance that stays connected to operations</SectionEyebrow>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">From invoice to ledger, without losing the business context.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/50">
              Record invoices, incoming and outgoing money, expenses, transfers and account activity while preserving the links back to clients, orders and projects. Financial reporting is built from structured operational records—not hidden frontend totals.
            </p>
            <div className="mt-7 space-y-3">
              <FeatureLine icon={FileCheck2} title="Receivables & payments" text="Know what was invoiced, what was collected and what is still due." />
              <FeatureLine icon={CircleDollarSign} title="Multi-currency accounts" text="Keep BDT, USD and other currencies separate unless an explicit conversion is recorded." />
              <FeatureLine icon={BadgeDollarSign} title="Expenses & profitability" text="Relate costs to clients, projects, orders, invoices and payments where appropriate." />
              <FeatureLine icon={BarChart3} title="Accounting reports" text="Journal, ledger, trial balance, profit & loss and balance sheet remain part of the same financial chain." />
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 sm:p-7">
            <div className="flex items-start justify-between gap-5 border-b border-white/10 pb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-white/35">Financial control</p>
                <p className="mt-1 text-xl font-semibold">Keep currencies honest</p>
              </div>
              <Globe2 className="size-6 text-white/45" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <FinanceCard label="BDT bank" amount="৳ 312,500.00" note="Bank account" />
              <FinanceCard label="USD wallet" amount="$ 4,820.00" note="Marketplace / wallet" />
            </div>
            <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-4">
              <p className="text-sm font-semibold text-amber-100">No silent currency mixing</p>
              <p className="mt-1 text-xs leading-5 text-amber-100/55">BDT 101,500 + USD 900 is not presented as one balance. Cross-currency activity preserves source, destination and conversion information.</p>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
              <p className="text-xs text-white/35">Accounting chain</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/55">
                {["Chart of Accounts", "Journal", "Ledger", "Trial Balance", "P&L / Balance Sheet"].map((item, index, values) => <div key={item} className="flex items-center gap-2"><span className="rounded-lg border border-white/10 px-2.5 py-1.5">{item}</span>{index < values.length - 1 ? <ChevronRight className="size-3 text-white/20" /> : null}</div>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="security" className="mx-auto w-full max-w-[1480px] px-5 py-20 sm:px-6 lg:px-10 lg:py-28">
        <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 sm:p-9 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]"><ShieldCheck className="size-6" /></div>
              <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">One user. Multiple companies. Clear boundaries.</h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/50">
                Business OS is built as a multi-tenant platform. A user can belong to multiple organizations while company data stays organization-scoped and protected by membership and permissions.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SecurityPoint title="Tenant isolation" text="Company records stay scoped to the active organization." />
              <SecurityPoint title="Role-based access" text="Permissions are enforced on the backend, not just hidden in the interface." />
              <SecurityPoint title="Device sessions" text="Review active sessions and remotely revoke access you no longer trust." />
              <SecurityPoint title="Audit trail" text="Sensitive business and financial actions can be traced back to their history." />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.025]">
        <div className="mx-auto grid w-full max-w-[1480px] gap-10 px-5 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-10 lg:py-24">
          <div>
            <SectionEyebrow>Built for growing service businesses</SectionEyebrow>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Start with the operations you need today. Keep one system as the company grows.</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {audiences.map((item) => <div key={item} className="flex min-h-24 items-end rounded-2xl border border-white/10 bg-neutral-950/50 p-4 text-sm font-medium text-white/65"><BriefcaseBusiness className="mr-2 size-4 shrink-0 text-white/35" />{item}</div>)}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1480px] px-5 pt-20 sm:px-6 lg:px-10 lg:pt-28">
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-8">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]"><Mail className="size-5 text-white/70" /></div>
            <h2 className="mt-7 text-2xl font-semibold tracking-tight">Questions before you start?</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/45">Talk to CodeStation AI about your company, workflow, rollout, finance requirements or whether Business OS is the right fit.</p>
            <Link href="/contact" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white/80 transition hover:text-white">Contact us <ArrowRight className="size-4" /></Link>
          </article>
          <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-8">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]"><LifeBuoy className="size-5 text-white/70" /></div>
            <h2 className="mt-7 text-2xl font-semibold tracking-tight">Already using Business OS?</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/45">Get help with account access, CRM, projects, finance, accounting, permissions or another part of your workspace.</p>
            <Link href="/support" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white/80 transition hover:text-white">Visit Help & Support <ArrowRight className="size-4" /></Link>
          </article>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1480px] px-5 py-20 sm:px-6 lg:px-10 lg:py-28">
        <div className="relative overflow-hidden rounded-[36px] border border-white/10 bg-white p-7 text-neutral-950 sm:p-10 lg:p-14">
          <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full border border-neutral-200" />
          <div className="pointer-events-none absolute -right-10 -top-10 size-52 rounded-full border border-neutral-200" />
          <div className="relative max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Bring the business together</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">Give your team one place to work—and yourself one place to understand the company.</h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-500">
              Create your organization workspace and connect the flow from lead and client management through projects, invoicing, payments and financial reporting.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/signup" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-neutral-950 px-6 text-sm font-semibold text-white">Create your workspace <ArrowRight className="size-4" /></Link>
              <Link href="/contact" className="inline-flex h-12 items-center justify-center rounded-full border border-neutral-200 px-6 text-sm font-semibold">Contact us</Link>
              <Link href="/login" className="inline-flex h-12 items-center justify-center rounded-full border border-neutral-200 px-6 text-sm font-semibold">Sign in</Link>
            </div>
          </div>
        </div>
      </section>

      <a
        href="#top"
        aria-label="Scroll to top"
        title="Scroll to top"
        className="fixed bottom-5 right-5 z-40 inline-flex size-11 items-center justify-center rounded-full border border-white/15 bg-neutral-900/90 text-white/75 shadow-xl shadow-black/30 backdrop-blur transition hover:-translate-y-0.5 hover:bg-white hover:text-neutral-950 sm:bottom-7 sm:right-7"
      >
        <ArrowUp className="size-4" />
      </a>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-5 py-8 text-xs text-white/40 sm:px-6 lg:px-10 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] p-2"><BrandMark variant="light" className="h-full w-full" /></div>
            <div><p className="font-semibold text-white/65">CodeStation AI Business OS</p><p className="mt-0.5">One connected system to run your business.</p></div>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/contact" className="transition hover:text-white/75">Contact Us</Link>
            <Link href="/support" className="transition hover:text-white/75">Help & Support</Link>
            <Link href="/privacy" className="transition hover:text-white/75">Privacy Policy</Link>
            <Link href="/terms" className="transition hover:text-white/75">Terms of Service</Link>
            <Link href="/login" className="transition hover:text-white/75">Sign in</Link>
            <Link href="/signup" className="transition hover:text-white/75">Create workspace</Link>
          </nav>
          <p>© {new Date().getFullYear()} CodeStation AI.</p>
        </div>
      </footer>
    </main>
  );
}

function Benefit({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" /><span>{children}</span></div>;
}

function DashboardMetric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Users }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3.5 sm:p-4"><div className="flex items-start justify-between gap-3"><p className="text-xs text-white/35">{label}</p><Icon className="size-4 text-white/30" /></div><p className="mt-4 text-lg font-semibold tracking-tight sm:text-xl">{value}</p><p className="mt-1 text-[11px] text-white/30">{detail}</p></div>;
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-white/40">{label}</span><span className="font-medium text-white/75">{value}</span></div>;
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{children}</p>;
}

function FeatureLine({ icon: Icon, title, text }: { icon: typeof FileCheck2; title: string; text: string }) {
  return <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05]"><Icon className="size-4 text-white/60" /></div><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-white/40">{text}</p></div></div>;
}

function FinanceCard({ label, amount, note }: { label: string; amount: string; note: string }) {
  return <div className="rounded-2xl border border-white/10 bg-neutral-950/55 p-4"><p className="text-xs text-white/35">{label}</p><p className="mt-4 text-xl font-semibold tracking-tight">{amount}</p><p className="mt-1 text-[11px] text-white/30">{note}</p></div>;
}

function SecurityPoint({ title, text }: { title: string; text: string }) {
  return <div className="rounded-2xl border border-white/10 bg-neutral-950/45 p-5"><ShieldCheck className="size-4 text-emerald-400" /><p className="mt-5 text-sm font-semibold">{title}</p><p className="mt-2 text-xs leading-5 text-white/40">{text}</p></div>;
}
