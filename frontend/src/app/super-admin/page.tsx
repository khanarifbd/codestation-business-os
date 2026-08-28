"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  CreditCard,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

type Summary = {
  total_users: number;
  active_users: number;
  suspended_users: number;
  verified_users: number;
  unverified_users: number;
  new_users_7d: number;
  new_users_30d: number;
  total_companies: number;
  active_companies: number;
  suspended_companies: number;
  setup_incomplete_companies: number;
  new_companies_7d: number;
  new_companies_30d: number;
  total_subscriptions: number;
  trialing_subscriptions: number;
  active_subscriptions: number;
  past_due_subscriptions: number;
  suspended_subscriptions: number;
  canceled_subscriptions: number;
  trials_ending_7d: number;
  periods_ending_7d: number;
  companies_without_subscription: number;
};

type PlatformOrganization = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    suspension_reason: string | null;
    country_code: string;
    currency: string;
    setup_completed: boolean;
  };
  subscription: {
    plan_code: string;
    status: string;
    billing_cycle: string;
    trial_ends_at: string | null;
    current_period_end: string | null;
  } | null;
  admin_email: string;
  admin_name: string;
};

type PlatformUser = {
  id: string;
  email: string;
  full_name: string;
  system_role: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
};

type ActivityItem = {
  id: string;
  action: string;
  scope: string;
  outcome: string;
  message: string | null;
  created_at: string;
};

type ActivityPage = {
  items: ActivityItem[];
  next_cursor: string | null;
};

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function SuperAdminPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [companies, setCompanies] = useState<PlatformOrganization[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    setError(null);
    const [summaryResponse, companiesResponse, usersResponse, activityResponse] = await Promise.all([
      fetch("/api/platform/summary", { cache: "no-store" }),
      fetch("/api/platform/organizations?limit=50&offset=0", { cache: "no-store" }),
      fetch("/api/platform/users?limit=50&offset=0", { cache: "no-store" }),
      fetch("/api/platform/activity-logs?limit=6", { cache: "no-store" }),
    ]);

    const responses = [summaryResponse, companiesResponse, usersResponse, activityResponse];
    if (responses.some((response) => response.status === 401)) {
      router.replace("/login");
      return;
    }
    if (responses.some((response) => response.status === 403)) {
      router.replace("/dashboard");
      return;
    }

    if (!summaryResponse.ok || !companiesResponse.ok || !usersResponse.ok) {
      setError("Unable to load the platform overview. Refresh the page and try again.");
      setLoading(false);
      return;
    }

    setSummary((await summaryResponse.json()) as Summary);
    setCompanies((await companiesResponse.json()) as PlatformOrganization[]);
    setUsers((await usersResponse.json()) as PlatformUser[]);
    if (activityResponse.ok) {
      const activityPage = (await activityResponse.json()) as ActivityPage;
      setActivity(activityPage.items);
    } else {
      setActivity([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function setCompanyStatus(company: PlatformOrganization) {
    const nextStatus = company.organization.status === "suspended" ? "active" : "suspended";
    const reason =
      nextStatus === "suspended"
        ? window.prompt("Reason for suspension", "Suspended by platform administrator")
        : null;
    if (nextStatus === "suspended" && reason === null) return;

    setUpdatingId(company.organization.id);
    const response = await fetch(
      `/api/platform/organizations/${company.organization.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, reason }),
      },
    );
    setUpdatingId(null);
    if (response.ok) await load();
  }

  async function setSubscriptionStatus(company: PlatformOrganization, status: string) {
    setUpdatingId(company.organization.id);
    const response = await fetch(
      `/api/platform/organizations/${company.organization.id}/subscription`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    setUpdatingId(null);
    if (response.ok) await load();
  }

  async function setUserStatus(user: PlatformUser) {
    setUpdatingId(user.id);
    const response = await fetch(`/api/platform/users/${user.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    setUpdatingId(null);
    if (response.ok) await load();
  }

  const actionItems = useMemo(() => {
    if (!summary) return [];
    return [
      {
        label: "Past due subscriptions",
        description: "Billing attention required",
        count: summary.past_due_subscriptions,
        href: "/super-admin/subscriptions",
        priority: "high" as const,
      },
      {
        label: "Suspended subscriptions",
        description: "Review access and recovery status",
        count: summary.suspended_subscriptions,
        href: "/super-admin/subscriptions",
        priority: "high" as const,
      },
      {
        label: "Trials ending in 7 days",
        description: "Follow up before trial expiry",
        count: summary.trials_ending_7d,
        href: "/super-admin/subscriptions",
        priority: "medium" as const,
      },
      {
        label: "Periods ending in 7 days",
        description: "Active or trial periods nearing end",
        count: summary.periods_ending_7d,
        href: "/super-admin/subscriptions",
        priority: "medium" as const,
      },
      {
        label: "Setup incomplete",
        description: "Active companies not fully onboarded",
        count: summary.setup_incomplete_companies,
        href: "/super-admin/organizations",
        priority: "normal" as const,
      },
      {
        label: "No subscription assigned",
        description: "Companies without a subscription record",
        count: summary.companies_without_subscription,
        href: "/super-admin/organizations",
        priority: "normal" as const,
      },
    ].filter((item) => item.count > 0);
  }, [summary]);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-28 animate-pulse rounded-2xl border bg-white" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-2xl border bg-white" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <section className="rounded-2xl border bg-white p-8 text-center shadow-sm shadow-neutral-200/30">
        <AlertTriangle className="mx-auto size-7 text-amber-500" />
        <h1 className="mt-4 text-xl font-semibold">Platform overview unavailable</h1>
        <p className="mt-2 text-sm text-neutral-500">{error ?? "Unable to load platform summary."}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="mt-5 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </section>
    );
  }

  const verifiedRate = percentage(summary.verified_users, summary.total_users);
  const completedActiveCompanies = Math.max(
    0,
    summary.active_companies - summary.setup_incomplete_companies,
  );
  const setupRate = percentage(completedActiveCompanies, summary.active_companies);

  const cards = [
    {
      label: "Companies",
      value: summary.total_companies,
      detail: `+${summary.new_companies_30d} in 30 days`,
      icon: Building2,
    },
    {
      label: "Active companies",
      value: summary.active_companies,
      detail: `${summary.suspended_companies} suspended`,
      icon: ShieldCheck,
    },
    {
      label: "Users",
      value: summary.total_users,
      detail: `+${summary.new_users_30d} in 30 days`,
      icon: UsersRound,
    },
    {
      label: "Active subscriptions",
      value: summary.active_subscriptions,
      detail: `${summary.trialing_subscriptions} trialing`,
      icon: CreditCard,
    },
    {
      label: "Past due",
      value: summary.past_due_subscriptions,
      detail: "Subscriptions needing attention",
      icon: AlertTriangle,
    },
    {
      label: "Trials ending soon",
      value: summary.trials_ending_7d,
      detail: "Within the next 7 days",
      icon: Clock3,
    },
  ] as const;

  return (
    <>
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-medium text-neutral-500">Global SaaS administration</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Platform Overview</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
            Monitor company growth, account health, subscription risk, onboarding, and privileged platform activity from one operational view.
          </p>
        </div>
        <Link
          href="/super-admin/activity-logs"
          className="inline-flex w-fit items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-neutral-50"
        >
          <Activity className="size-4" />
          View activity logs
        </Link>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {cards.map(({ label, value, detail, icon: Icon }) => (
          <article key={label} className="rounded-2xl border bg-white p-5 shadow-sm shadow-neutral-200/30">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-neutral-500">{label}</p>
              <Icon className="size-4 shrink-0 text-neutral-400" />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
            <p className="mt-2 text-xs leading-5 text-neutral-400">{detail}</p>
          </article>
        ))}
      </div>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-2xl border bg-white p-6 shadow-sm shadow-neutral-200/30">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-400">Growth & activation</p>
              <h2 className="mt-2 text-xl font-semibold">Platform momentum</h2>
            </div>
            <Sparkles className="size-5 text-neutral-300" />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-neutral-50 p-4">
              <p className="text-sm text-neutral-500">New companies</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{summary.new_companies_7d}</p>
                  <p className="mt-1 text-xs text-neutral-400">Last 7 days</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">{summary.new_companies_30d}</p>
                  <p className="mt-1 text-xs text-neutral-400">Last 30 days</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl bg-neutral-50 p-4">
              <p className="text-sm text-neutral-500">New users</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{summary.new_users_7d}</p>
                  <p className="mt-1 text-xs text-neutral-400">Last 7 days</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">{summary.new_users_30d}</p>
                  <p className="mt-1 text-xs text-neutral-400">Last 30 days</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl bg-neutral-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-neutral-500">Company setup completion</p>
                <CheckCircle2 className="size-4 text-neutral-300" />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{setupRate === null ? "—" : `${setupRate}%`}</p>
              <p className="mt-1 text-xs text-neutral-400">
                {summary.setup_incomplete_companies} active companies still incomplete
              </p>
            </div>
            <div className="rounded-2xl bg-neutral-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-neutral-500">Verified users</p>
                <UserCheck className="size-4 text-neutral-300" />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{verifiedRate === null ? "—" : `${verifiedRate}%`}</p>
              <p className="mt-1 text-xs text-neutral-400">
                {summary.verified_users} verified · {summary.unverified_users} unverified
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border bg-white p-6 shadow-sm shadow-neutral-200/30">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-400">Action queue</p>
              <h2 className="mt-2 text-xl font-semibold">Needs attention</h2>
            </div>
            <AlertTriangle className="size-5 text-neutral-300" />
          </div>

          <div className="mt-5 space-y-2.5">
            {actionItems.length ? (
              actionItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          item.priority === "high"
                            ? "bg-rose-500"
                            : item.priority === "medium"
                              ? "bg-amber-500"
                              : "bg-neutral-400"
                        }`}
                      />
                      <p className="truncate text-sm font-semibold">{item.label}</p>
                    </div>
                    <p className="mt-1 truncate pl-4 text-xs text-neutral-400">{item.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold tabular-nums">
                      {item.count}
                    </span>
                    <ArrowRight className="size-4 text-neutral-300" />
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed p-7 text-center">
                <CheckCircle2 className="mx-auto size-6 text-emerald-500" />
                <p className="mt-3 text-sm font-semibold">No urgent platform issues</p>
                <p className="mt-1 text-xs text-neutral-400">Subscription and onboarding queues are currently clear.</p>
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <article className="rounded-2xl border bg-white p-6 shadow-sm shadow-neutral-200/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-400">Subscriptions</p>
              <h2 className="mt-2 text-xl font-semibold">Portfolio health</h2>
            </div>
            <Link href="/super-admin/subscriptions" className="text-sm font-semibold text-neutral-500 hover:text-neutral-950">
              Manage
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
            {[
              ["Active", summary.active_subscriptions],
              ["Trialing", summary.trialing_subscriptions],
              ["Past due", summary.past_due_subscriptions],
              ["Suspended", summary.suspended_subscriptions],
              ["Canceled", summary.canceled_subscriptions],
              ["No subscription", summary.companies_without_subscription],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-neutral-50 p-4">
                <p className="text-xs text-neutral-400">{label}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-neutral-400">{summary.total_subscriptions} subscription records across {summary.total_companies} companies.</p>
        </article>

        <article className="overflow-hidden rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
          <div className="flex items-center justify-between gap-4 border-b px-6 py-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-400">Audit trail</p>
              <h2 className="mt-2 text-xl font-semibold">Recent platform activity</h2>
            </div>
            <Link href="/super-admin/activity-logs" className="text-sm font-semibold text-neutral-500 hover:text-neutral-950">
              View all
            </Link>
          </div>
          <div className="divide-y">
            {activity.length ? (
              activity.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-6 py-4">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100">
                    <Activity className="size-3.5 text-neutral-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                      <p className="truncate text-sm font-semibold">{item.action}</p>
                      <p className="shrink-0 text-xs text-neutral-400">{formatDateTime(item.created_at)}</p>
                    </div>
                    <p className="mt-1 truncate text-xs text-neutral-500">{item.message ?? item.scope}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-10 text-center text-sm text-neutral-400">No recent activity available.</div>
            )}
          </div>
        </article>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
        <div className="flex flex-col justify-between gap-3 border-b px-6 py-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold">Quick company controls</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Existing company controls remain available here until the Organizations workspace is completed.
            </p>
          </div>
          <Link href="/super-admin/organizations" className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950">
            Organizations workspace <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-6 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Admin</th>
                <th className="px-4 py-3 font-medium">Company status</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Subscription</th>
                <th className="px-6 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {companies.map((company) => (
                <tr key={company.organization.id}>
                  <td className="px-6 py-4">
                    <p className="font-medium">{company.organization.name}</p>
                    <p className="mt-1 text-xs text-neutral-400">
                      {company.organization.country_code} · {company.organization.currency}
                      {company.organization.setup_completed ? " · Setup complete" : " · Setup incomplete"}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p>{company.admin_name}</p>
                    <p className="mt-1 text-xs text-neutral-400">{company.admin_email}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize">
                      {company.organization.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 capitalize">
                    {company.subscription?.plan_code ?? "Not assigned"}
                  </td>
                  <td className="px-4 py-4">
                    <select
                      value={company.subscription?.status ?? "active"}
                      disabled={updatingId === company.organization.id}
                      onChange={(event) => void setSubscriptionStatus(company, event.target.value)}
                      className="rounded-lg border bg-white px-2.5 py-2 text-xs outline-none"
                    >
                      <option value="trialing">Trialing</option>
                      <option value="active">Active</option>
                      <option value="past_due">Past due</option>
                      <option value="suspended">Suspended</option>
                      <option value="canceled">Canceled</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      disabled={updatingId === company.organization.id}
                      onClick={() => void setCompanyStatus(company)}
                      className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {company.organization.status === "suspended" ? "Reactivate" : "Suspend"}
                    </button>
                  </td>
                </tr>
              ))}
              {companies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-neutral-400">
                    No companies yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
        <div className="flex flex-col justify-between gap-3 border-b px-6 py-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold">Quick user controls</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Global login accounts. Company permissions remain controlled by tenant memberships.
            </p>
          </div>
          <Link href="/super-admin/users" className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950">
            Users workspace <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-6 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">System role</th>
                <th className="px-4 py-3 font-medium">Verification</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-6 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-4">
                    <p className="font-medium">{user.full_name}</p>
                    <p className="mt-1 text-xs text-neutral-400">{user.email}</p>
                  </td>
                  <td className="px-4 py-4 capitalize">{user.system_role.replaceAll("_", " ")}</td>
                  <td className="px-4 py-4">
                    <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
                      {user.is_verified ? "Verified" : "Unverified"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
                      {user.is_active ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      disabled={updatingId === user.id || user.system_role === "super_admin"}
                      onClick={() => void setUserStatus(user)}
                      className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {user.is_active ? "Suspend" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
