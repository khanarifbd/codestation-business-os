"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, History, Loader2, Plus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type HistoryRow = {
  id: string;
  base_currency: string;
  quote_currency: string;
  effective_date: string;
  effective_rate: string;
  source: string;
};

type RateBundle = {
  rates: Array<{ base_currency: string; quote_currency: string }>;
  history: HistoryRow[];
};

export function HistoricalFxDrawer() {
  const search = useSearchParams();
  const visible = search.get("tab") === "currencies";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bundle, setBundle] = useState<RateBundle | null>(null);
  const [base, setBase] = useState("USD");
  const [quote, setQuote] = useState("BDT");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const options = useMemo(() => CURRENCY_OPTIONS, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rateResponse, currencyResponse] = await Promise.all([
        fetch("/api/settings/exchange-rates", { cache: "no-store" }),
        fetch("/api/company-settings/currencies", { cache: "no-store" }),
      ]);
      const ratePayload = await rateResponse.json().catch(() => null);
      const currencyPayload = await currencyResponse.json().catch(() => null);
      if (!rateResponse.ok) throw new Error(ratePayload?.detail ?? "Unable to load FX history.");
      if (!currencyResponse.ok) throw new Error(currencyPayload?.detail ?? "Unable to load company currency settings.");
      setBundle(ratePayload as RateBundle);
      setEffectiveDate(currencyPayload.organization_current_date ?? "");
      const accounting = String(currencyPayload.accounting_currency ?? "BDT");
      setQuote(accounting);
      const firstPair = (ratePayload as RateBundle).rates?.find((item) => item.quote_currency === accounting)
        ?? (ratePayload as RateBundle).rates?.[0];
      if (firstPair) {
        setBase(firstPair.base_currency);
        setQuote(firstPair.quote_currency);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load FX history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  async function save() {
    const numeric = Number(rate);
    if (!effectiveDate) {
      setError("Choose the date this accounting rate became effective.");
      return;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Enter a valid positive exchange rate.");
      return;
    }
    if (base === quote) {
      setError("From and To currencies must be different.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/exchange-rates/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_currency: base,
          quote_currency: quote,
          effective_date: effectiveDate,
          effective_rate: numeric,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to record historical rate.");
      setBundle((current) => {
        if (!current) return current;
        const history = current.history.filter((item) => item.id !== payload.id);
        return { ...current, history: [payload, ...history] };
      });
      setRate("");
      setMessage(`Saved: 1 ${base} = ${Number(payload.effective_rate).toLocaleString()} ${quote} from ${effectiveDate}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to record historical rate.");
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white shadow-xl"
    >
      <History className="size-4" /> Historical FX rates
    </button>

    {open ? <div className="fixed inset-0 z-[90]">
      <button type="button" aria-label="Close historical FX rates" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/35" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <div className="flex items-center gap-2"><CalendarClock className="size-5" /><h2 className="text-lg font-semibold">Historical accounting FX</h2></div>
            <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">Record the rate that was effective on a transaction date. Backdated accounting uses the latest saved rate on or before that date; posted journals keep their original rate forever.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="flex size-9 items-center justify-center rounded-lg border"><X className="size-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="size-6 animate-spin" /></div> : <>
            <div className="rounded-2xl border bg-neutral-50 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <SearchableSelect label="From currency" name="history_base" value={base} onValueChange={setBase} options={options} placeholder="From" />
                <SearchableSelect label="To currency" name="history_quote" value={quote} onValueChange={setQuote} options={options} placeholder="To" />
                <label className="block"><span className="text-sm font-semibold">Effective date</span><input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm" /></label>
                <label className="block"><span className="text-sm font-semibold">Rate</span><input type="number" min="0" step="0.00000001" value={rate} onChange={(event) => setRate(event.target.value)} placeholder={`1 ${base} = X ${quote}`} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm" /></label>
              </div>
              <button type="button" disabled={saving} onClick={() => void save()} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Record historical rate</button>
              {error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
              {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
            </div>

            <div className="mt-6">
              <h3 className="font-semibold">Recent effective rates</h3>
              <p className="mt-1 text-sm text-neutral-500">The accounting engine selects the latest row whose effective date is not after the transaction date.</p>
              <div className="mt-4 overflow-hidden rounded-xl border">
                {bundle?.history?.length ? bundle.history.slice(0, 50).map((item) => <div key={item.id} className="grid grid-cols-[1fr_1fr_1fr] gap-3 border-t px-4 py-3 text-sm first:border-t-0">
                  <div><p className="font-semibold">{item.base_currency} → {item.quote_currency}</p><p className="text-xs text-neutral-400">{item.source.replaceAll("_", " ")}</p></div>
                  <div><p className="font-medium">{item.effective_date}</p><p className="text-xs text-neutral-400">Effective date</p></div>
                  <div className="text-right"><p className="font-semibold tabular-nums">{Number(item.effective_rate).toLocaleString(undefined, { maximumFractionDigits: 8 })}</p><p className="text-xs text-neutral-400">1 {item.base_currency}</p></div>
                </div>) : <p className="p-6 text-sm text-neutral-400">No effective-dated FX history yet. Current rates will create daily snapshots when added, updated or synced.</p>}
              </div>
            </div>
          </>}
        </div>
      </aside>
    </div> : null}
  </>;
}
