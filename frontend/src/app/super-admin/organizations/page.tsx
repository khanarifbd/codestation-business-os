"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  FilterX,
  Search,
  UsersRound,
} from "lucide-react";

type Subscription = {
  id: string;
  organization_id: string;
  plan_code: string;
  status: string;
  billing_cycle: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
};

type OrganizationItem = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    suspension_reason: string | null;
    suspended_at: string | null;
    country_code: string;
    timezone: string;
    currency: string;
    business_type: string | null;
    team_size: string | null;
    financial_year_start_month: number;
    setup_completed: boolean;
    created_by_user_id: string;
  };
  subscription: Subscription | null;
  created_by_email: string;
  created_by_name: string;
  member_count: number;
  active_member_count: number;
  created_at: string;
};

type OrganizationPage = {
  items: OrganizationItem[];
  total: number;
  limit: number;
  offset: number;
  country_codes: string[];
  plan_codes: string[];
};

const PAGE_SIZE = 25;

function statusClass(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "trialing") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "past_due") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "suspended" || status === "canceled") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function errorDetail(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  return fallback;
}

export default function SuperAdminOrganizationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<OrganizationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [planCodes, setPlanCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const [query, setQuery] = useState("");
  const [organizationStatus, setOrganizationStatus] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [setupCompleted, setSetupCompleted] = useState("");
  const [planCode, setPlanCode] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      async function load() {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (query.trim()) params.set("q", query.trim());
        if (organizationStatus) params.set("organization_status", organizationStatus);
        if (subscriptionStatus) params.set("subscription_status", subscriptionStatus);
        if (countryCode) params.set("country_code", countryCode);
        if (setupCompleted) params.set("setup_completed", setupCompleted);
        if (planCode) params.set("plan_code", planCode);

        const response = await fetch(`/api/platform/organization-directory?${params.toString()}`, {
          cache: "no-store",
        });

        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/dashboard");
          return;
        }

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setItems([]);
          setTotal(0);
          setError(errorDetail(payload, "Unable to load organizations."));
          setLoading(false);
          return;
        }

        const page = payload as OrganizationPage;
        setItems(page.items);
        setTotal(page.total);
        setCountryCodes(page.country_codes);
        setPlanCodes(page.plan_codes);
        setLoading(false);
      }

      void load();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    query,
    organizationStatus,
    subscriptionStatus,
    countryCode,
    setupCompleted,
    planCode,
    offset,
    refreshKey,
    router,
  ]);

  function resetOffset() {
    setOffset(0);
  }

  function clearFilters() {
    setQuery("");
    setOrganizationStatus("");
    setSubscriptionStatus("");
    setCountryCode("");
    setSetupCompleted("");
    setPlanCode("");
    setOffset(0);
  }

  async function toggleOrganizationStatus(item: OrganizationItem) {
    const nextStatus = item.organization.status === "suspended" ? "active" : "suspended";
    const reason =
      nextStatus === "suspended"
        ? window.prompt("Reason for suspension", "Suspended by platform administrator")
        : null;
    if (nextStatus === "suspended" && reason === null) return;

    setUpdatingId(item.organization.id);
    setError(null);
    const response = await fetch(`/api/platform/organizations/${item.organization.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus, reason }),
    });
    const payload = await response.json().catch(() => null);
    setUpdatingId(null);
    if (!response.ok) {
      setError(errorDetail(payload, "Unable to update organization status."));
      return;
    }
    setRefreshKey((value) => value + 1);
  }

  async function changeSubscriptionStatus(item: OrganizationItem, status: string) {
    setUpdatingId(item.organization.id);
    setError(null);
    const response = await fetch(
      `/api/platform/organizations/${item.organization.id}/subscription`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    const payload = await response.json().catch(() => null);
    setUpdatingId(null);
    if (!response.ok) {
      setError(errorDetail(payload, "Unable to update subscription status."));
      return;
    }
    setRefreshKey((value) => value + 1);
  }

  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + PAGE_SIZE, total);
  const filtersActive = Boolean(
    query || organizationStatus || subscriptionStatus || countryCode || setupCompleted || planCode,
  );

  return (
    <>
      <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-medium text-neutral-500">Platform directory</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Organizations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
            Search and manage tenant companies with subscription, onboarding and membership context.
          </p>
        </div>
        <div className="rounded-xl border bg-white px-4 py-3 text-sm shadow-sm shadow-neutral-200/30">
          <span className="text-neutral-500">Matching organizations</span>
          <span className="ml-3 font-semibold tabular-nums text-neutral-950">{total}</span>
        </div>
      </header>

      <section className="mt-7 rounded-2xl border bg-white p-4 shadow-sm shadow-neutral-200/30 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-6">
          <label className="relative lg:col-span-2 xl:col-span-2">
            <span className="sr-only">Search organizations</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                resetOffset();
              }}
              placeholder="Search company, slug, creator or email"
              className="h-11 w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-neutral-400"
            />
          </label>

          <select
            value={organizationStatus}
            onChange={(event) => {
              setOrganizationStatus(event.target.value);
              resetOffset();
            }}
            className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none"
          >
            <option value="">All company statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>

          <select
            value={subscriptionStatus}
            onChange={(event) => {
              setSubscriptionStatus(event.target.value);
              resetOffset();
            }}
            className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none"
          >
            <option value="">All subscriptions</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="canceled">Canceled</option>
            <option value="none">No subscription</option>
          </select>

          <select
            value={setupCompleted}
            onChange={(event) => {
              setSetupCompleted(event.target.value);
              resetOffset();
            }}
            className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none"
          >
            <option value="">Any setup state</option>
            <option value="true">Setup complete</option>
            <option value="false">Setup incomplete</option>
          </select>

          <button
            type="button"
            disabled={!filtersActive}
            onClick={clearFilters}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-neutral-200 px-3 text-sm font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FilterX className="size-4" />
            Clear
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:max-w-2xl">
          <select
            value={countryCode}
            onChange={(event) => {
              setCountryCode(event.target.value);
              resetOffset();
            }}
            className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none"
          >
            <option value="">All countries</option>
            {countryCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>

          <select
            value={planCode}
            onChange={(event) => {
              setPlanCode(event.target.value);
              resetOffset();
            }}
            className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none"
          >
            <option value="">All plans</option>
            {planCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
        <div className="flex items-center justify-between border-b px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-semibold">Organization directory</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Showing {showingFrom}–{showingTo} of {total}
            </p>
          </div>
          {loading ? <span className="text-xs text-neutral-400">Refreshing…</span> : null}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1220px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-6 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Created by</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Members</th>
                <th className="px-4 py-3 font-medium">Setup</th>
                <th className="px-4 py-3 font-medium">Plan / subscription</th>
                <th className="px-4 py-3 font-medium">Company status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-6 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => {
                const organization = item.organization;
                const subscription = item.subscription;
                const busy = updatingId === organization.id;
                return (
                  <tr key={organization.id} className="align-top hover:bg-neutral-50/60">
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
                          <Building2 className="size-4 text-neutral-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="max-w-56 truncate font-semibold">{organization.name}</p>
                          <p className="mt-1 max-w-56 truncate text-xs text-neutral-400">{organization.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="max-w-52 truncate font-medium">{item.created_by_name}</p>
                      <p className="mt-1 max-w-52 truncate text-xs text-neutral-400">{item.created_by_email}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p>{organization.country_code}</p>
                      <p className="mt-1 text-xs text-neutral-400">{organization.currency} · {organization.timezone}</p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="inline-flex items-center gap-2">
                        <UsersRound className="size-4 text-neutral-400" />
                        <span className="font-medium tabular-nums">{item.active_member_count}</span>
                        <span className="text-xs text-neutral-400">/ {item.member_count}</span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-400">active / total</p>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                          organization.setup_completed
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {organization.setup_completed ? <CheckCircle2 className="size-3" /> : null}
                        {organization.setup_completed ? "Complete" : "Incomplete"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium capitalize">{subscription?.plan_code ?? "Not assigned"}</p>
                      <select
                        value={subscription?.status ?? "none"}
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.value !== "none") {
                            void changeSubscriptionStatus(item, event.target.value);
                          }
                        }}
                        className="mt-2 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none disabled:opacity-50"
                      >
                        <option value="none" disabled>No subscription</option>
                        <option value="trialing">Trialing</option>
                        <option value="active">Active</option>
                        <option value="past_due">Past due</option>
                        <option value="suspended">Suspended</option>
                        <option value="canceled">Canceled</option>
                      </select>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusClass(organization.status)}`}>
                        {formatStatus(organization.status)}
                      </span>
                      {organization.suspension_reason ? (
                        <p className="mt-2 max-w-48 text-xs leading-5 text-neutral-400">{organization.suspension_reason}</p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-neutral-500">
                      {new Date(item.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleOrganizationStatus(item)}
                        className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {organization.status === "suspended" ? "Reactivate" : "Suspend"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="divide-y md:hidden">
          {items.map((item) => {
            const organization = item.organization;
            const subscription = item.subscription;
            const busy = updatingId === organization.id;
            return (
              <article key={organization.id} className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
                    <Building2 className="size-4 text-neutral-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{organization.name}</p>
                    <p className="mt-1 truncate text-xs text-neutral-400">{organization.slug}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize ${statusClass(organization.status)}`}>
                    {formatStatus(organization.status)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-neutral-400">Created by</p>
                    <p className="mt-1 truncate font-medium">{item.created_by_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-400">Country / currency</p>
                    <p className="mt-1 font-medium">{organization.country_code} · {organization.currency}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-400">Members</p>
                    <p className="mt-1 font-medium tabular-nums">{item.active_member_count} active / {item.member_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-400">Setup</p>
                    <p className="mt-1 font-medium">{organization.setup_completed ? "Complete" : "Incomplete"}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs text-neutral-400">Plan</p>
                    <p className="mt-1 text-sm font-medium capitalize">{subscription?.plan_code ?? "Not assigned"}</p>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={subscription?.status ?? "none"}
                      disabled={busy}
                      onChange={(event) => {
                        if (event.target.value !== "none") {
                          void changeSubscriptionStatus(item, event.target.value);
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-2 text-xs outline-none disabled:opacity-50"
                    >
                      <option value="none" disabled>No subscription</option>
                      <option value="trialing">Trialing</option>
                      <option value="active">Active</option>
                      <option value="past_due">Past due</option>
                      <option value="suspended">Suspended</option>
                      <option value="canceled">Canceled</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleOrganizationStatus(item)}
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      {organization.status === "suspended" ? "Reactivate" : "Suspend"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {!loading && items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Building2 className="mx-auto size-7 text-neutral-300" />
            <p className="mt-3 font-medium text-neutral-600">No organizations found</p>
            <p className="mt-1 text-sm text-neutral-400">Try clearing or changing the current filters.</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-neutral-500">
            Page <span className="font-medium text-neutral-800">{pageNumber}</span> of {pageCount}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="size-3.5" />
              Previous
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
