import { ArrowRight, Building2, ChartNoAxesCombined, ShieldCheck, Users } from "lucide-react";

const foundations = [
  {
    title: "Multi-company ready",
    description: "Users, organizations, and memberships are separated from day one.",
    icon: Building2,
  },
  {
    title: "Operations first",
    description: "CRM, orders, projects, finance, HR, and reports will share one business context.",
    icon: ChartNoAxesCombined,
  },
  {
    title: "Team permissions",
    description: "Role and permission controls will keep every workspace scoped to the right people.",
    icon: Users,
  },
  {
    title: "SaaS foundation",
    description: "Tenant boundaries are part of the data model before business modules are added.",
    icon: ShieldCheck,
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-between px-6 py-8 lg:px-10 lg:py-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div>
            <p className="text-sm font-medium tracking-wide text-white/60">CodeStation AI</p>
            <h1 className="text-lg font-semibold">Business OS</h1>
          </div>
          <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
            Foundation v0.1
          </div>
        </header>

        <div className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="max-w-3xl">
            <p className="mb-5 text-sm font-medium uppercase tracking-[0.2em] text-white/45">
              SaaS-first business management
            </p>
            <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-7xl lg:leading-[1.02]">
              One operating system to run your entire business.
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/55 sm:text-lg">
              Start with a company workspace, invite your team, and manage clients, orders,
              projects, finance, employees, and reporting from one connected platform.
            </p>

            <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-neutral-950">
              SaaS foundation in progress
              <ArrowRight className="size-4" />
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
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
              </article>
            ))}
          </div>
        </div>

        <footer className="border-t border-white/10 pt-5 text-xs text-white/35">
          Local development: Next.js frontend + FastAPI backend + SQLite. PostgreSQL-ready by configuration.
        </footer>
      </section>
    </main>
  );
}
