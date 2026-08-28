"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CreditCard, ShieldCheck, UserRound } from "lucide-react";

type Summary = {
  total_users: number;
  total_companies: number;
  active_companies: number;
  suspended_companies: number;
  trialing_subscriptions: number;
  active_subscriptions: number;
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
  };
  subscription: {
    plan_code: string;
    status: string;
    billing_cycle: string;
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

export default function SuperAdminPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [companies, setCompanies] = useState<PlatformOrganization[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    const [summaryResponse, companiesResponse, usersResponse] = await Promise.all([
      fetch("/api/platform/summary", { cache: "no-store" }),
      fetch("/api/platform/organizations?limit=50&offset=0", { cache: "no-store" }),
      fetch("/api/platform/users?limit=50&offset=0", { cache: "no-store" }),
    ]);

    if (
      summaryResponse.status === 401 ||
      companiesResponse.status === 401 ||
      usersResponse.status === 401
    ) {
      router.replace("/login");
      return;
    }
    if (
      summaryResponse.status === 403 ||
      companiesResponse.status === 403 ||
      usersResponse.status === 403
    ) {
      router.replace("/dashboard");
      return;
    }

    if (summaryResponse.ok) setSummary((await summaryResponse.json()) as Summary);
    if (companiesResponse.ok) {
      setCompanies((await companiesResponse.json()) as PlatformOrganization[]);
    }
    if (usersResponse.ok) setUsers((await usersResponse.json()) as PlatformUser[]);
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

  if (loading) {
    return <div className="h-64 animate-pulse rounded-2xl border bg-white" />;
  }

  const cards = [
    ["Companies", summary?.total_companies ?? 0, Building2],
    ["Active companies", summary?.active_companies ?? 0, ShieldCheck],
    ["Users", summary?.total_users ?? 0, UserRound],
    ["Active subscriptions", summary?.active_subscriptions ?? 0, CreditCard],
  ] as const;

  return (
    <>
      <header>
        <p className="text-sm font-medium text-neutral-500">Global SaaS administration</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Super Admin Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          Manage companies, subscriptions, user accounts, and platform access independently from tenant workspaces.
        </p>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, Icon]) => (
          <article key={label} className="rounded-2xl border bg-white p-5 shadow-sm shadow-neutral-200/30">
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-500">{label}</p>
              <Icon className="size-4 text-neutral-400" />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
          </article>
        ))}
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
        <div className="border-b px-6 py-5">
          <h2 className="font-semibold">Companies</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {summary?.suspended_companies ?? 0} suspended · {summary?.trialing_subscriptions ?? 0} trials
          </p>
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
        <div className="border-b px-6 py-5">
          <h2 className="font-semibold">User accounts</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Global login accounts. Company permissions remain controlled by tenant memberships.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-6 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">System role</th>
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
