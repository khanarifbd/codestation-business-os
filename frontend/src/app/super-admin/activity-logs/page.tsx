"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, ShieldCheck } from "lucide-react";

type ActivityItem = {
  id: string;
  organization_id: string | null;
  actor_user_id: string | null;
  actor_type: string;
  scope: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  outcome: string;
  message: string | null;
  request_id: string | null;
  created_at: string;
};

type ActivityPage = {
  items: ActivityItem[];
  next_cursor: string | null;
};

export default function PlatformActivityLogsPage() {
  const router = useRouter();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(cursor?: string, append = false) {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/platform/activity-logs?${query.toString()}`, {
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
    if (!response.ok) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    const page = (await response.json()) as ActivityPage;
    setItems((current) => (append ? [...current, ...page.items] : page.items));
    setNextCursor(page.next_cursor);
    setLoading(false);
    setLoadingMore(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="min-h-screen bg-neutral-100 px-5 py-8 text-neutral-950 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <Link
              href="/super-admin"
              className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-950"
            >
              <ArrowLeft className="size-4" />
              Platform overview
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Activity Logs</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Immutable platform and tenant audit trail. Newest activity appears first.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm text-neutral-600">
            <ShieldCheck className="size-4" />
            Append-only audit
          </div>
        </header>

        <section className="mt-7 overflow-hidden rounded-2xl border bg-white shadow-sm shadow-neutral-200/30">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Scope</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-6 py-3 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="whitespace-nowrap px-6 py-4 text-xs text-neutral-500">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 font-medium">{item.action}</td>
                    <td className="px-4 py-4 capitalize text-neutral-600">{item.scope}</td>
                    <td className="px-4 py-4 text-neutral-600">
                      {item.entity_type ?? "—"}
                      {item.entity_id ? (
                        <p className="mt-1 max-w-44 truncate text-xs text-neutral-400">{item.entity_id}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 text-neutral-600">
                      {item.actor_type}
                      {item.actor_user_id ? (
                        <p className="mt-1 max-w-44 truncate text-xs text-neutral-400">{item.actor_user_id}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize">
                        {item.outcome}
                      </span>
                    </td>
                    <td className="max-w-sm px-6 py-4 text-neutral-600">{item.message ?? "—"}</td>
                  </tr>
                ))}
                {!loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-neutral-400">
                      No activity logs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {nextCursor ? (
            <div className="flex justify-center border-t px-6 py-4">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  void load(nextCursor, true);
                }}
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
              >
                <ChevronDown className="size-4" />
                {loadingMore ? "Loading…" : "Load older activity"}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
