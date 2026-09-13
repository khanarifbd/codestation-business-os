"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  FileText,
  FolderKanban,
  Loader2,
  ReceiptText,
  ShieldCheck,
  UserRoundCog,
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

type Organization = {
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

type Member = {
  membership_id: string;
  user_id: string;
  full_name: string;
  email: string;
  username: string | null;
  role_id: string;
  role_name: string;
  role_slug: string;
  membership_status: string;
  is_owner: boolean;
  user_is_active: boolean;
  user_is_verified: boolean;
  joined_at: string;
};

type Usage = {
  employees: number;
  active_employees: number;
  clients: number;
  active_clients: number;
  leads: number;
  quotations: number;
  orders: number;
  open_orders: number;
  projects: number;
  active_projects: number;
  invoices: number;
  open_invoices: number;
};

type ActivityItem = {
  id: string;
  action: string;
  outcome: string;
  message: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
};

type OrganizationDetail = {
  organization: Organization;
  subscription: Subscription | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  created_by_name: string;
  created_by_email: string;
  members: Member[];
  usage: Usage;
  recent_activity: ActivityItem[];
};

function statusClass(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "trialing") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "past_due") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "suspended" || status === "canceled") return "border-red-200 bg-red-50 text-red-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function monthName(month: number) {
  return new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2026, month - 1, 1));
}

function errorDetail(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail : fallback;
}

function MetricCard({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof UsersRound }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm shadow-neutral-200/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-neutral-400">{detail}</p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-xl bg-neutral-100">
          <Icon className="size-4 text-neutral-500" />
        </div>
      </div>
    </div>
  );
}

export default function SuperAdminOrganizationDetailPage() {
  const router = useRouter();
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;
  const [data, setData] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/platform/organizations/${organizationId}`, { cache: "no-store" });
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
        if (active) {
          setData(null);
          setError(errorDetail(payload, "Unable to load organization details."));
          setLoading(false);
        }
        return;
      }
      if (active) {
        setData(payload as OrganizationDetail);
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [organizationId, refreshKey, router]);

  const owners = useMemo(() => data?.members.filter((member) => member.is_owner) ?? [], [data]);
  const admins = useMemo(
    () => data?.members.filter((member) => !member.is_owner && member.role_slug === "admin") ?? [],
    [data],
  );
  const otherMembers = useMemo(
    () => data?.members.filter((member) => !member.is_owner && member.role_slug !== "admin") ?? [],
    [data],
  );

  async function toggleOrganizationStatus() {
    if (!data) return;
    const nextStatus = data.organization.status === "suspended" ? "active" : "suspended";
    const reason = nextStatus === "suspended"
      ? window.prompt("Reason for suspension", "Suspended by platform administrator")
      : null;
    if (nextStatus === "suspended" && reason === null) return;

    setUpdating(true);
    setError(null);
    const response = await fetch(`/api/platform/organizations/${organizationId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus, reason }),
    });
    const payload = await response.json().catch(() => null);
    setUpdating(false);
    if (!response.ok) {
      setError(errorDetail(payload, "Unable to update organization status."));
      return;
    }
    setRefreshKey((value) => value + 1);
  }

  async function changeSubscriptionStatus(status: string) {
    setUpdating(true);
    setError(null);
    const response = await fetch(`/api/platform/organizations/${organizationId}/subscription`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json().catch(() => null);
    setUpdating(false);
    if (!response.ok) {
      setError(errorDetail(payload, "Unable to update subscription status."));
      return;
    }
    setRefreshKey((value) => value + 1);
  }

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <Loader2 className="size-5 animate-spin" />
          Loading organization workspace…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
        <Building2 className="mx-auto size-8 text-neutral-300" />
        <h1 className="mt-4 text-lg font-semibold">Organization unavailable</h1>
        <p className="mt-2 text-sm text-neutral-500">{error ?? "This organization could not be loaded."}</p>
        <Link href="/super-admin/organizations" className="mt-5 inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">
          <ArrowLeft className="size-4" /> Back to organizations
        </Link>
      </div>
    );
  }

  const organization = data.organization;
  const subscription = data.subscription;
  const usage = data.usage;

  return (
    <>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <Link href="/super-admin/organizations" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-950">
            <ArrowLeft className="size-4" /> Organizations
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{organization.name}</h1>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusClass(organization.status)}`}>
              {formatStatus(organization.status)}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${organization.setup_completed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              {organization.setup_completed ? "Setup complete" : "Setup incomplete"}
            </span>
          </div>
          <p className="mt-2 text-sm text-neutral-500">{organization.slug} · Created {formatDate(data.created_at)}</p>
          {organization.suspension_reason ? (
            <p className="mt-3 max-w-3xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Suspension reason: {organization.suspension_reason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={updating}
            onClick={() => void toggleOrganizationStatus()}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${organization.status === "suspended" ? "bg-neutral-950 text-white hover:bg-neutral-800" : "border border-red-200 bg-white text-red-700 hover:bg-red-50"}`}
          >
            {updating ? "Updating…" : organization.status === "suspended" ? "Reactivate company" : "Suspend company"}
          </button>
        </div>
      </div>

      {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Members" value={data.members.length} detail={`${data.members.filter((member) => member.membership_status === "active").length} active`} icon={UsersRound} />
        <MetricCard label="Employees" value={usage.employees} detail={`${usage.active_employees} active`} icon={CircleUserRound} />
        <MetricCard label="Clients" value={usage.clients} detail={`${usage.active_clients} active`} icon={UsersRound} />
        <MetricCard label="Open orders" value={usage.open_orders} detail={`${usage.orders} total`} icon={ReceiptText} />
        <MetricCard label="Active projects" value={usage.active_projects} detail={`${usage.projects} total`} icon={FolderKanban} />
        <MetricCard label="Open invoices" value={usage.open_invoices} detail={`${usage.invoices} total`} icon={FileText} />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl border bg-white p-5 shadow-sm shadow-neutral-200/30 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><Building2 className="size-4" /></div>
            <div>
              <h2 className="font-semibold">Organization profile</h2>
              <p className="mt-1 text-xs text-neutral-500">Tenant metadata and onboarding context</p>
            </div>
          </div>

          <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Business type", organization.business_type ?? "—"],
              ["Team size", organization.team_size ?? "—"],
              ["Country", organization.country_code],
              ["Timezone", organization.timezone],
              ["Accounting currency", organization.currency],
              ["Financial year starts", monthName(organization.financial_year_start_month)],
              ["Created by", data.created_by_name],
              ["Creator email", data.created_by_email],
              ["Last updated", formatDateTime(data.updated_at)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
                <p className="mt-1.5 break-words text-sm font-medium text-neutral-800">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm shadow-neutral-200/30 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100"><ShieldCheck className="size-4" /></div>
            <div>
              <h2 className="font-semibold">Subscription</h2>
              <p className="mt-1 text-xs text-neutral-500">Platform access and billing state</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-neutral-400">Plan</p><p className="mt-1 font-semibold capitalize">{subscription?.plan_code ?? "Not assigned"}</p></div>
            <div><p className="text-xs text-neutral-400">Billing cycle</p><p className="mt-1 font-semibold capitalize">{subscription?.billing_cycle ?? "—"}</p></div>
            <div><p className="text-xs text-neutral-400">Trial ends</p><p className="mt-1 font-medium">{formatDate(subscription?.trial_ends_at ?? null)}</p></div>
            <div><p className="text-xs text-neutral-400">Period ends</p><p className="mt-1 font-medium">{formatDate(subscription?.current_period_end ?? null)}</p></div>
          </div>

          <label className="mt-5 block text-xs font-medium text-neutral-500">
            Subscription status
            <select
              value={subscription?.status ?? "none"}
              disabled={updating}
              onChange={(event) => {
                if (event.target.value !== "none") void changeSubscriptionStatus(event.target.value);
              }}
              className="mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm font-medium outline-none disabled:opacity-50"
            >
              <option value="none" disabled>No subscription</option>
              <option value="trialing">Trialing</option>
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              <option value="suspended">Suspended</option>
              <option value="canceled">Canceled</option>
            </select>
          </label>

          <div className="mt-4 flex items-center gap-2 text-xs text-neutral-400">
            <CalendarClock className="size-3.5" />
            Status changes are written to the platform audit log.
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
        <div className="flex flex-col gap-2 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="font-semibold">People & access</h2>
            <p className="mt-1 text-xs text-neutral-500">Owners, admins and organization members</p>
          </div>
          <div className="flex gap-2 text-xs text-neutral-500">
            <span>{owners.length} owner{owners.length === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{admins.length} admin{admins.length === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{otherMembers.length} other</span>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-6 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 font-medium">Membership</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-6 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.members.map((member) => (
                <tr key={member.membership_id}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-xl bg-neutral-100"><UserRoundCog className="size-4 text-neutral-500" /></div>
                      <div><p className="font-semibold">{member.full_name}</p><p className="mt-1 text-xs text-neutral-400">{member.email}{member.username ? ` · @${member.username}` : ""}</p></div>
                    </div>
                  </td>
                  <td className="px-4 py-4"><span className="font-medium">{member.is_owner ? "Owner" : member.role_name}</span>{member.is_owner ? <p className="mt-1 text-xs text-neutral-400">{member.role_name}</p> : null}</td>
                  <td className="px-4 py-4"><span className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusClass(member.membership_status)}`}>{formatStatus(member.membership_status)}</span></td>
                  <td className="px-4 py-4"><p className={member.user_is_active ? "text-emerald-700" : "text-red-700"}>{member.user_is_active ? "Active" : "Suspended"}</p><p className="mt-1 text-xs text-neutral-400">{member.user_is_verified ? "Verified" : "Unverified"}</p></td>
                  <td className="whitespace-nowrap px-6 py-4 text-neutral-500">{formatDate(member.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y md:hidden">
          {data.members.map((member) => (
            <article key={member.membership_id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate font-semibold">{member.full_name}</p><p className="mt-1 truncate text-xs text-neutral-400">{member.email}</p></div>
                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium">{member.is_owner ? "Owner" : member.role_name}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-neutral-400">Membership</p><p className="mt-1 font-medium capitalize">{formatStatus(member.membership_status)}</p></div>
                <div><p className="text-xs text-neutral-400">Account</p><p className="mt-1 font-medium">{member.user_is_active ? "Active" : "Suspended"}</p></div>
                <div><p className="text-xs text-neutral-400">Verified</p><p className="mt-1 font-medium">{member.user_is_verified ? "Yes" : "No"}</p></div>
                <div><p className="text-xs text-neutral-400">Joined</p><p className="mt-1 font-medium">{formatDate(member.joined_at)}</p></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-2xl border bg-white p-5 shadow-sm shadow-neutral-200/30 sm:p-6">
          <h2 className="font-semibold">Workspace usage</h2>
          <p className="mt-1 text-xs text-neutral-500">Operational record counts only; no tenant financial totals are exposed here.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              ["Leads", usage.leads],
              ["Quotations", usage.quotations],
              ["Orders", usage.orders],
              ["Projects", usage.projects],
              ["Invoices", usage.invoices],
              ["Employees", usage.employees],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border bg-neutral-50/50 p-4">
                <p className="text-xs text-neutral-400">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
          <div className="flex items-center justify-between border-b px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-semibold">Recent activity</h2>
              <p className="mt-1 text-xs text-neutral-500">Latest organization-scoped audit events</p>
            </div>
            <Link href={`/super-admin/activity-logs?organization_id=${encodeURIComponent(organization.id)}`} className="text-xs font-semibold text-neutral-600 hover:text-neutral-950">
              View all
            </Link>
          </div>
          <div className="divide-y">
            {data.recent_activity.map((item) => (
              <div key={item.id} className="flex gap-3 px-5 py-4 sm:px-6">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100"><Activity className="size-3.5 text-neutral-500" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-all text-sm font-medium">{item.action}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${statusClass(item.outcome)}`}>{item.outcome}</span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-500">{item.message ?? "Activity recorded"}</p>
                  <p className="mt-2 text-xs text-neutral-400">{item.actor_name ?? item.actor_email ?? "System"} · {formatDateTime(item.created_at)}</p>
                </div>
              </div>
            ))}
            {!data.recent_activity.length ? (
              <div className="px-6 py-12 text-center text-sm text-neutral-400">No organization activity recorded yet.</div>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
