"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  CircleDollarSign,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  Users,
} from "lucide-react";

type TenantContext = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    suspension_reason: string | null;
    country_code: string;
    timezone: string;
    currency: string;
    business_type: string | null;
    team_size: string | null;
    financial_year_start_month: number;
    setup_completed: boolean;
  };
  membership_id: string;
  role: string;
  status: string;
};

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, active: true, href: "/dashboard" },
  { label: "Clients", icon: Users },
  { label: "Orders", icon: ReceiptText },
  { label: "Projects", icon: FolderKanban },
  { label: "Finance", icon: CircleDollarSign },
  { label: "Reports", icon: BarChart3 },
  { label: "Company", icon: Building2, href: "/dashboard/company" },
  { label: "Settings", icon: Settings },
];

export default function DashboardPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      let response = await fetch("/api/tenant", { cache: "no-store" });

      if (response.status === 409) {
        const organizations = await fetch("/api/organizations", { cache: "no-store" });
        if (organizations.status === 401) {
          router.replace("/login");
          return;
        }
        if (organizations.ok) {
          const items = (await organizations.json()) as unknown[];
          if (items.length === 0) {
            router.replace("/onboarding");
            return;
          }
          response = await fetch("/api/tenant", { cache: "no-store" });
        }
      }

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      if (response.status === 403) {
        const payload = await response.json().catch(() => null);
        setError(payload?.detail ?? "This company workspace is not available.");
        setLoading(false);
        return;
      }

      if (!response.ok) {
        setError("Unable to load the active company workspace.");
        setLoading(false);
        return;
      }

      setTenant((await response.json()) as TenantContext);
      setLoading(false);
    })();
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (loading) {
    return <main className="min-h-screen bg-neutral-100" />;
  }

  if (error || !tenant) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-6 text-neutral-950">
        <div className="w-full max-w-lg rounded-3xl border bg-white p-8 text-center shadow-sm">
          <Building2 className="mx-auto size-8 text-neutral-400" />
          <h1 className="mt-5 text-2xl font-semibold">Workspace unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-500">{error}</p>
          <button
            type="button"
            onClick={logout}
            className="mt-6 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-semibold text-white"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  const company = tenant.organization;

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-950">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 border-r border-neutral-200 bg-white p-4 lg:flex lg:flex-col">
          <div className="px-3 py-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p>
            <h1 className="mt-1 text-lg font-semibold">Business OS</h1>
          </div>

          <div className="mt-3 rounded-2xl border bg-neutral-50 p-3">
            <p className="truncate text-sm font-semibold">{company.name}</p>
            <p className="mt-1 text-xs capitalize text-neutral-500">{tenant.role} · {company.currency}</p>
          </div>

          <nav className="mt-5 space-y-1">
            {navigation.map(({ label, icon: Icon, active, href }) => (
              <button
                key={label}
                type="button"
                onClick={() => href && router.push(href)}
                disabled={!href}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  active
                    ? "bg-neutral-950 font-medium text-white"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-neutral-600"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={logout}
            className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </aside>

        <section className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10">
          <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm text-neutral-500">Workspace overview</p>
              <h2 className="mt-1 text-3xl font-semibold tracking-tight">{company.name}</h2>
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard/company")}
              className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              <Building2 className="size-4" />
              Company setup
            </button>
          </header>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Active clients", "0", "CRM foundation"],
              ["Open orders", "0", "Order management"],
              ["Active projects", "0", "Project operations"],
              ["This month revenue", `${company.currency} 0`, "Finance foundation"],
            ].map(([label, value, note]) => (
              <article key={label} className="rounded-2xl border bg-white p-5 shadow-sm shadow-neutral-200/30">
                <p className="text-sm text-neutral-500">{label}</p>
                <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
                <p className="mt-2 text-xs text-neutral-400">{note}</p>
              </article>
            ))}
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.55fr]">
            <section className="rounded-2xl border bg-white p-6 shadow-sm shadow-neutral-200/30">
              <h3 className="font-semibold">Tenant-safe Business OS foundation</h3>
              <p className="mt-1 text-sm text-neutral-500">
                Every company request resolves a validated tenant context before business data is accessed.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  "Client & lead management",
                  "Orders & project workflow",
                  "Invoices, payments & banking",
                  tenant.role === "admin" ? "Employee & company administration" : "Employee workspace",
                ].map((item) => (
                  <div key={item} className="rounded-xl border border-dashed bg-neutral-50 px-4 py-4 text-sm text-neutral-600">
                    {item}
                  </div>
                ))}
              </div>
            </section>

            <aside className="rounded-2xl border bg-white p-6 shadow-sm shadow-neutral-200/30">
              <h3 className="font-semibold">Company context</h3>
              <dl className="mt-5 space-y-4 text-sm">
                <div>
                  <dt className="text-neutral-400">Role</dt>
                  <dd className="mt-1 font-medium capitalize">{tenant.role}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Country</dt>
                  <dd className="mt-1 font-medium">{company.country_code}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Timezone</dt>
                  <dd className="mt-1 font-medium">{company.timezone}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Currency</dt>
                  <dd className="mt-1 font-medium">{company.currency}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
