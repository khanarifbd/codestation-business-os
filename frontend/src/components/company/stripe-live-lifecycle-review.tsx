"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { useAdministrationReadOwner } from "@/hooks/use-administration-read-owner";

type ReviewEvent = {
  id: string; event_id: string; event_type: string;
  result: string; received_at: string;
};

export function StripeLiveLifecycleReview() {
  const owner = useAdministrationReadOwner(), current = owner.current, epoch = useRef(0);
  const [verified, setVerified] = useState(false);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!current()) return;
    const request=++epoch.current, active=()=>current()&&request===epoch.current;
    setBusy(true); setError(null); setVerified(false);
    try {
      const response = await fetch("/api/finance/stripe-lifecycle/events", { cache: "no-store" });
      if (!active()) return;
      const data: unknown = await response.json().catch(() => null);
      if (!active()) return;
      if (!response.ok || !Array.isArray(data) || !data.every(row=>row && typeof row === "object" && ["id","event_id","event_type","result","received_at"].every(key=>typeof row[key] === "string"))) throw new Error("Stripe lifecycle events could not be verified. Retry reading current events.");
      setEvents(data as ReviewEvent[]); setVerified(true);
    } catch (reason) {
      if (active()) { setEvents([]); setError(reason instanceof Error ? reason.message : "Could not read Stripe Live events"); }
    } finally { if (active()) setBusy(false); }
  }, [current]);

  useEffect(() => { let alive=true; queueMicrotask(()=>{if(alive)void load();});return()=>{alive=false;}; }, [load]);

  return <div className="mt-4 rounded-xl border bg-neutral-50 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h5 className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4" />Live Payment Lifecycle Reviews</h5>
        <p className="mt-1 text-xs text-neutral-500">Signed Refund, Dispute, Chargeback and Payout events are retained for review. No automatic financial adjustment is made.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={busy} className="rounded-lg border bg-white px-3 py-2 text-xs disabled:opacity-40"><RefreshCw className="inline size-3" /> Refresh</button>
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
    {!busy && verified && !error && events.length === 0 && <p className="mt-3 text-xs text-neutral-500">No Live lifecycle events received yet.</p>}
    {verified && !error && events.length > 0 && <div className="mt-3 max-h-72 divide-y overflow-auto rounded-lg border bg-white">
      {events.slice(0, 20).map(event => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
        <div><p className="font-medium">{event.event_type}</p><p className="mt-1 break-all text-neutral-500">{event.event_id}</p></div>
        <span className={["review_required", "reversed_fee_review"].includes(event.result) ? "font-medium text-amber-700" : event.result === "live_paid_posted" || event.result === "full_payment_reversed" ? "font-medium text-emerald-700" : "text-neutral-500"}>{({
          review_required: "Review Required",
          reversed_fee_review: "Reversed · Dispute Fee Review",
          live_paid_posted: "Payment Posted",
          full_payment_reversed: "Full Refund Reversed",
          already_reversed: "Already Reversed",
          pending_payment: "Pending Payment",
          ignored: "Ignored",
        } as Record<string, string>)[event.result] ?? event.result.replaceAll("_", " ")}</span>
      </div>)}
    </div>}
  </div>;
}
