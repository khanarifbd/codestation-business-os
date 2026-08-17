"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";

import { SearchableSelect, type SearchOption } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type FunctionalCurrencyPeriod = {
  id: string;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  previous_currency: string | null;
  transition_rate: string | null;
  reason: string | null;
  transition_journal_entry_id: string | null;
};

type CurrencySettings = {
  accounting_currency: string;
  reporting_currency: string;
  default_client_currency: string | null;
  accounting_currency_locked: boolean;
  accounting_currency_lock_reason: string | null;
  accounting_currency_change_earliest_date: string | null;
  organization_current_date: string;
  organization_timezone: string;
  functional_currency_periods: FunctionalCurrencyPeriod[];
};

type RatePolicy = {
  mode: "automatic" | "manual" | "automatic_adjusted";
  provider: string;
  adjustment_percent: string;
  sync_frequency: "manual" | "daily";
  last_synced_at: string | null;
};

type Rate = {
  id: string;
  base_currency: string;
  quote_currency: string;
  reference_rate: string | null;
  manual_rate: string | null;
  effective_rate: string;
  source: string;
  synced_at: string | null;
};

type RateBundle = { policy: RatePolicy; rates: Rate[] };

const MODE_OPTIONS: SearchOption[] = [
  { value: "automatic", label: "Automatic — live reference rate" },
  { value: "manual", label: "Manual — admin controlled" },
  { value: "automatic_adjusted", label: "Automatic + adjustment" },
];

function rateNumber(value: string | null) {
  if (value == null) return "—";
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function rateSentence(rate: Rate) {
  return `1 ${rate.base_currency} = ${rateNumber(rate.effective_rate)} ${rate.quote_currency}`;
}

function localDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CurrencySettingsPanel({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const [settings, setSettings] = useState<CurrencySettings | null>(null);
  const [rates, setRates] = useState<RateBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<Rate[] | null>(null);
  const [base, setBase] = useState("USD");
  const [quote, setQuote] = useState("BDT");
  const [manualRate, setManualRate] = useState("");

  const [showAccountingChange, setShowAccountingChange] = useState(false);
  const [nextAccountingCurrency, setNextAccountingCurrency] = useState("");
  const [accountingEffectiveDate, setAccountingEffectiveDate] = useState("");
  const [accountingTransitionRate, setAccountingTransitionRate] = useState("");
  const [accountingChangeReason, setAccountingChangeReason] = useState("");
  const [accountingChangeConfirmed, setAccountingChangeConfirmed] = useState(false);
  const [accountingChangeError, setAccountingChangeError] = useState<string | null>(null);

  const currencyOptions = useMemo(() => CURRENCY_OPTIONS, []);
  const today = settings?.organization_current_date ?? "";

  function resetAccountingChange(next: CurrencySettings) {
    const alternate = currencyOptions.find((item) => item.value !== next.accounting_currency)?.value ?? "USD";
    setNextAccountingCurrency(alternate);
    setAccountingEffectiveDate(next.accounting_currency_change_earliest_date ?? next.organization_current_date);
    setAccountingTransitionRate("");
    setAccountingChangeReason("");
    setAccountingChangeConfirmed(false);
    setAccountingChangeError(null);
  }

  async function load() {
    setLoading(true);
    setError(null);
    setAccountingChangeError(null);
    try {
      const [currencyResponse, rateResponse] = await Promise.all([
        fetch("/api/company-settings/currencies", { cache: "no-store" }),
        fetch("/api/settings/exchange-rates", { cache: "no-store" }),
      ]);
      const currencyPayload = await currencyResponse.json().catch(() => null);
      if (!currencyResponse.ok) throw new Error(currencyPayload?.detail ?? "Unable to load currency settings.");
      const ratePayload = await rateResponse.json().catch(() => null);
      if (!rateResponse.ok) throw new Error(ratePayload?.detail ?? "Unable to load exchange rates.");

      const nextSettings = currencyPayload as CurrencySettings;
      setSettings(nextSettings);
      setRates(ratePayload as RateBundle);
      resetAccountingChange(nextSettings);
      const suggestedFrom = nextSettings.default_client_currency && nextSettings.default_client_currency !== nextSettings.accounting_currency
        ? nextSettings.default_client_currency
        : nextSettings.accounting_currency === "USD" ? "EUR" : "USD";
      setBase(suggestedFrom);
      setQuote(nextSettings.accounting_currency);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load currency settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function saveCurrencies() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/company-settings/currencies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounting_currency: settings.accounting_currency,
          reporting_currency: settings.reporting_currency,
          default_client_currency: settings.default_client_currency || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to save currency settings.");
      const next = payload as CurrencySettings;
      setSettings(next);
      setQuote(next.accounting_currency);
      setMessage("Currency roles saved. Reporting and client currencies remain independent from the accounting ledger.");
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save currency settings.");
    } finally {
      setSaving(false);
    }
  }

  async function changeAccountingCurrency() {
    if (!settings) return;
    if (nextAccountingCurrency === settings.accounting_currency) {
      setAccountingChangeError("Choose a different accounting / functional currency.");
      return;
    }
    if (!accountingEffectiveDate) {
      setAccountingChangeError("Choose an effective date for the accounting currency change.");
      return;
    }
    if (accountingEffectiveDate > settings.organization_current_date) {
      setAccountingChangeError(
        `Effective date cannot be after ${localDate(settings.organization_current_date)} (${settings.organization_timezone}).`,
      );
      return;
    }
    if (accountingChangeReason.trim().length < 3) {
      setAccountingChangeError("Enter a reason for the accounting currency change.");
      return;
    }
    if (!accountingChangeConfirmed) {
      setAccountingChangeError("Confirm that you understand the prior functional-currency period will be sealed.");
      return;
    }

    setSaving(true);
    setError(null);
    setAccountingChangeError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/company-settings/currencies/change-accounting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_currency: nextAccountingCurrency,
          effective_date: accountingEffectiveDate,
          transition_rate: accountingTransitionRate.trim() ? Number(accountingTransitionRate) : null,
          reason: accountingChangeReason.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to change accounting currency.");

      const next = payload as CurrencySettings;
      setSettings(next);
      setQuote(next.accounting_currency);
      resetAccountingChange(next);
      setShowAccountingChange(false);
      setMessage(
        `Accounting currency changed to ${next.accounting_currency}. Historical journals remain in their original functional currency and a new effective-dated ledger period is active.`,
      );
      await onChanged?.();
    } catch (reason) {
      setAccountingChangeError(reason instanceof Error ? reason.message : "Unable to change accounting currency.");
    } finally {
      setSaving(false);
    }
  }

  async function savePolicy() {
    if (!rates) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    setSyncResult(null);
    try {
      const response = await fetch("/api/settings/exchange-rates/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rates.policy),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to save exchange-rate policy.");
      setRates({ ...rates, policy: payload });
      setMessage("Exchange-rate policy saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save exchange-rate policy.");
    } finally {
      setSaving(false);
    }
  }

  async function addPair() {
    if (!rates) return;
    if (base === quote) {
      setError("From and To currencies must be different.");
      return;
    }
    setError(null);
    setMessage(null);
    setSyncResult(null);
    try {
      const response = await fetch("/api/settings/exchange-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_currency: base,
          quote_currency: quote,
          manual_rate: rates.policy.mode === "manual" ? Number(manualRate) : null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to add currency pair.");
      setRates({ ...rates, rates: [...rates.rates, payload] });
      setManualRate("");
      setSyncResult([payload]);
      setMessage(`Currency pair added. ${rateSentence(payload)}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add currency pair.");
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    setSyncResult(null);
    try {
      const response = await fetch("/api/settings/exchange-rates/sync", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to sync rates.");
      setRates(payload as RateBundle);
      setSyncResult((payload as RateBundle).rates);
      setMessage(`Synced ${(payload as RateBundle).rates.length} currency pair${(payload as RateBundle).rates.length === 1 ? "" : "s"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sync rates.");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div>;
  if (!settings || !rates) return <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error ?? "Currency settings unavailable."}</div>;

  const changeAvailableToday = !settings.accounting_currency_change_earliest_date
    || settings.accounting_currency_change_earliest_date <= today;

  return <div className="space-y-6">
    <section className="rounded-2xl border bg-neutral-50 p-5">
      <div>
        <h3 className="font-semibold">Currency roles</h3>
        <p className="mt-1 text-sm text-neutral-500">Accounting truth, report presentation and client defaults are configured independently.</p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div>
          <SearchableSelect
            label="Reporting currency"
            name="reporting_currency"
            value={settings.reporting_currency}
            onValueChange={(value) => setSettings({ ...settings, reporting_currency: value })}
            options={currencyOptions}
            placeholder="Select reporting currency"
          />
          <p className="mt-2 text-xs leading-5 text-neutral-500">Used to present financial reports. You can change it at any time without rewriting journal entries.</p>
          {settings.reporting_currency !== settings.accounting_currency ? <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">Reports will use {settings.reporting_currency} when an {settings.accounting_currency} → {settings.reporting_currency} FX pair is available. Ledger amounts stay in their own functional-currency period.</p> : null}
        </div>

        <div>
          <SearchableSelect
            label="Accounting / functional currency"
            name="accounting_currency"
            value={settings.accounting_currency}
            onValueChange={(value) => setSettings({ ...settings, accounting_currency: value })}
            options={currencyOptions}
            placeholder="Select accounting currency"
            disabled={settings.accounting_currency_locked}
          />
          <p className="mt-2 text-xs leading-5 text-neutral-500">The double-entry journal, Trial Balance and ledger base amounts are stored in this currency for the active functional-currency period.</p>
          {settings.accounting_currency_locked ? <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>{settings.accounting_currency_lock_reason}</p><button type="button" disabled={!changeAvailableToday} onClick={() => { setAccountingChangeError(null); setShowAccountingChange((value) => !value); }} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-amber-900 px-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"><CalendarClock className="size-3.5" />{showAccountingChange ? "Close change form" : "Change accounting currency"}</button>{!changeAvailableToday && settings.accounting_currency_change_earliest_date ? <p className="mt-2 font-medium">The earliest safe change date is {localDate(settings.accounting_currency_change_earliest_date)} because journals already exist through the previous day.</p> : null}</div> : null}
        </div>

        <div>
          <SearchableSelect
            label="Default client currency"
            name="default_client_currency"
            value={settings.default_client_currency}
            onValueChange={(value) => setSettings({ ...settings, default_client_currency: value || null })}
            options={currencyOptions}
            placeholder="No default"
          />
          <p className="mt-2 text-xs leading-5 text-neutral-500">Used as the starting currency for new clients and commercial documents. It may differ from both accounting and reporting currencies.</p>
        </div>
      </div>

      {showAccountingChange && settings.accounting_currency_locked ? <div className="mt-6 rounded-2xl border border-amber-300 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-900"><AlertTriangle className="size-4" /></div>
          <div><h4 className="font-semibold">Start a new functional-currency period</h4><p className="mt-1 text-sm leading-6 text-neutral-600">This is an accounting transition, not a relabel. Business OS seals the prior {settings.accounting_currency} ledger period, preserves every historical journal, converts closing balance-sheet balances at the transition rate, and creates a balanced opening journal in the new functional currency.</p></div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <SearchableSelect label="New accounting / functional currency" name="new_accounting_currency" value={nextAccountingCurrency} onValueChange={(value) => { setNextAccountingCurrency(value); setAccountingChangeError(null); }} options={currencyOptions.filter((item) => item.value !== settings.accounting_currency)} placeholder="Select new accounting currency" />
          <label className="block"><span className="text-sm font-semibold">Effective date</span><input type="date" min={settings.accounting_currency_change_earliest_date ?? undefined} max={today} value={accountingEffectiveDate} onChange={(event) => { setAccountingEffectiveDate(event.target.value); setAccountingChangeError(null); }} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm" /><span className="mt-1 block text-xs leading-5 text-neutral-400">Must be after the latest posted journal and cannot be after {localDate(today)} ({settings.organization_timezone}).</span></label>
          <label className="block"><span className="text-sm font-semibold">Transition rate <span className="font-normal text-neutral-400">(optional)</span></span><input type="number" min="0" step="0.00000001" value={accountingTransitionRate} onChange={(event) => { setAccountingTransitionRate(event.target.value); setAccountingChangeError(null); }} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm" placeholder="Use configured FX pair when blank" /><span className="mt-1 block text-xs leading-5 text-neutral-400">Rate means 1 {settings.accounting_currency} = X {nextAccountingCurrency || "new currency"}. Leave blank to use the configured organization FX pair.</span></label>
          <label className="block"><span className="text-sm font-semibold">Reason</span><input value={accountingChangeReason} onChange={(event) => { setAccountingChangeReason(event.target.value); setAccountingChangeError(null); }} maxLength={500} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm" placeholder="Example: Primary operations moved to Australia" /></label>
        </div>

        <label className="mt-5 flex items-start gap-3 rounded-xl border bg-neutral-50 p-4 text-sm leading-6 text-neutral-700"><input type="checkbox" checked={accountingChangeConfirmed} onChange={(event) => { setAccountingChangeConfirmed(event.target.checked); setAccountingChangeError(null); }} className="mt-1" /><span>I understand that the previous functional-currency period becomes sealed, historical ledger values stay unchanged, and corrections to that history must be posted in the current period instead of rewriting old journals.</span></label>

        {accountingChangeError ? <div role="alert" aria-live="polite" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{accountingChangeError}</span></div> : null}

        <div className="mt-5 flex justify-end"><button type="button" disabled={saving || !accountingChangeConfirmed || nextAccountingCurrency === settings.accounting_currency || !accountingEffectiveDate} onClick={() => void changeAccountingCurrency()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-amber-900 px-5 text-sm font-semibold text-white disabled:opacity-45">{saving ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />} Apply accounting transition</button></div>
      </div> : null}

      <div className="mt-5 flex justify-end border-t pt-5">
        <button type="button" disabled={saving} onClick={() => void saveCurrencies()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save currencies
        </button>
      </div>
    </section>

    <section className="rounded-2xl border bg-white p-5">
      <div className="flex items-center gap-2"><History className="size-5" /><h3 className="font-semibold">Functional currency history</h3></div>
      <p className="mt-1 text-sm text-neutral-500">Each posted journal belongs permanently to the functional currency active for its accounting period.</p>
      <div className="mt-4 overflow-hidden rounded-xl border">
        {settings.functional_currency_periods.map((period, index) => <div key={period.id} className={`grid gap-2 px-4 py-4 text-sm sm:grid-cols-[0.7fr_1.25fr_1.4fr] ${index ? "border-t" : ""}`}>
          <div><p className="font-semibold">{period.currency}</p><p className="mt-0.5 text-xs text-neutral-400">{period.effective_to ? "Closed period" : "Current period"}</p></div>
          <div><p className="font-medium">{period.effective_from === "1900-01-01" ? "Initial" : localDate(period.effective_from)} → {period.effective_to ? localDate(period.effective_to) : "Current"}</p>{period.previous_currency && period.transition_rate ? <p className="mt-1 text-xs text-neutral-500">1 {period.previous_currency} = {rateNumber(period.transition_rate)} {period.currency}</p> : null}</div>
          <div><p className="text-neutral-600">{period.reason || "Functional currency period"}</p>{period.transition_journal_entry_id ? <p className="mt-1 text-xs text-neutral-400">Opening transition journal recorded</p> : null}</div>
        </div>)}
      </div>
    </section>

    <section className="rounded-2xl border p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><ArrowRightLeft className="size-5" /><h3 className="font-semibold">Exchange rates</h3></div>
          <p className="mt-1 text-sm text-neutral-500">Reference/current FX policy. Historical transaction, journal and functional-currency transition rates remain locked.</p>
        </div>
        {rates.policy.mode !== "manual" ? <button type="button" onClick={() => void sync()} disabled={syncing || !rates.rates.length} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing…" : "Sync now"}</button> : null}
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <SearchableSelect label="Rate mode" name="fx_mode" value={rates.policy.mode} onValueChange={(value) => setRates({ ...rates, policy: { ...rates.policy, mode: value as RatePolicy["mode"] } })} options={MODE_OPTIONS} placeholder="Select mode" />
        <SearchableSelect label="Provider" name="provider" value={rates.policy.provider} onValueChange={(value) => setRates({ ...rates, policy: { ...rates.policy, provider: value } })} options={[{ value: "frankfurter", label: "Frankfurter — reference rates" }]} placeholder="Select provider" />
        {rates.policy.mode === "automatic_adjusted" ? <label className="block"><span className="text-sm font-semibold">Operational adjustment %</span><input type="number" step="0.01" min={-50} max={50} value={rates.policy.adjustment_percent} onChange={(event) => setRates({ ...rates, policy: { ...rates.policy, adjustment_percent: event.target.value } })} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm" /><span className="mt-1 block text-xs text-neutral-400">Example: -1.00% models a bank/provider rate below the reference rate.</span></label> : null}
        <SearchableSelect label="Sync frequency" name="sync_frequency" value={rates.policy.sync_frequency} onValueChange={(value) => setRates({ ...rates, policy: { ...rates.policy, sync_frequency: value as RatePolicy["sync_frequency"] } })} options={[{ value: "daily", label: "Daily" }, { value: "manual", label: "Only when Sync now is pressed" }]} placeholder="Select frequency" />
      </div>
      <div className="mt-5 flex justify-end"><button type="button" disabled={saving} onClick={() => void savePolicy()} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save FX policy</button></div>

      <div className="mt-6 border-t pt-6">
        <h4 className="font-semibold">Currency pairs</h4>
        <p className="mt-1 text-sm text-neutral-500">Add conversion pairs used for transactions, reporting and functional-currency transitions. Accounting postings always preserve their historical rate.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr_1fr_auto]">
          <SearchableSelect label="From" name="fx_base" value={base} onValueChange={setBase} options={currencyOptions} placeholder="From" />
          <div className="hidden pt-9 text-neutral-300 sm:block">→</div>
          <SearchableSelect label="To" name="fx_quote" value={quote} onValueChange={setQuote} options={currencyOptions} placeholder="To" />
          {rates.policy.mode === "manual" ? <label><span className="text-sm font-semibold">Manual rate</span><input value={manualRate} onChange={(event) => setManualRate(event.target.value)} type="number" step="0.000001" className="mt-2 h-11 w-full rounded-xl border px-3 text-sm" /></label> : <div />}
          <button type="button" onClick={() => void addPair()} className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold"><Plus className="size-4" />Add</button>
        </div>

        {syncResult?.length ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-2 text-emerald-800"><CheckCircle2 className="size-5" /><h4 className="font-semibold">Latest rate result</h4></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{syncResult.map((rate) => <div key={rate.id} className="rounded-xl border border-emerald-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{rate.base_currency} → {rate.quote_currency}</p><p className="mt-1 text-xl font-semibold tabular-nums">{rateSentence(rate)}</p><div className="mt-2 space-y-1 text-xs text-neutral-500"><p>Reference: {rate.reference_rate ? `${rateNumber(rate.reference_rate)} ${rate.quote_currency}` : "Manual rate"}</p><p>Source: <span className="capitalize">{rate.source}</span></p><p className="flex items-center gap-1"><Clock3 className="size-3" />{rate.synced_at ? new Date(rate.synced_at).toLocaleString() : "Manual value"}</p></div></div>)}</div></div> : null}

        <div className="mt-5 overflow-hidden rounded-xl border"><div className="grid grid-cols-[1.2fr_1fr_1fr_auto] bg-neutral-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400"><span>Pair</span><span>Reference</span><span>Effective</span><span>Source</span></div>{rates.rates.length ? rates.rates.map((rate) => <div key={rate.id} className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-center border-t px-4 py-3 text-sm"><div><p className="font-semibold">{rate.base_currency} → {rate.quote_currency}</p><p className="mt-0.5 text-xs text-neutral-400">{rateSentence(rate)}</p></div><span>{rate.reference_rate ? rateNumber(rate.reference_rate) : "—"}</span><span className="font-semibold">{rateNumber(rate.effective_rate)}</span><span className="text-xs capitalize text-neutral-400">{rate.source}</span></div>) : <p className="p-5 text-sm text-neutral-400">No currency pairs configured yet. Add a pair above before using Sync now.</p>}</div>
        <p className="mt-3 text-xs text-neutral-400">Last live sync: {rates.policy.last_synced_at ? new Date(rates.policy.last_synced_at).toLocaleString() : "Never"}. Current/reference rates never rewrite historical transactions.</p>
      </div>
    </section>

    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
  </div>;
}