"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { getApiErrorMessage } from "@/lib/api-error";

export type FinancialAccountEditData = {
  id: string; name: string; account_type: string; provider_name: string | null;
  account_holder_name: string | null; account_reference: string | null;
  currency: string; opening_balance: string | number; current_balance: string | number;
  gateway_connection_id: string | null; notes: string | null; is_active: boolean;
  payment_url: string | null; payment_instructions: string | null;
};
type Gateway = { id: string | null; mode: "test" | "live"; provider: string; connected: boolean; stripe_account_id: string | null; account_label: string | null };

export function FinancialAccountEditPanel({
  account, onSaved, onCancel,
}: {
  account: FinancialAccountEditData;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [form, setForm] = useState({
    name: account.name,
    provider_name: account.provider_name || "",
    account_holder_name: account.account_holder_name || "",
    account_reference: account.account_reference || "",
    gateway_connection_id: account.gateway_connection_id || "",
    payment_url: account.payment_url || "",
    payment_instructions: account.payment_instructions || "",
    notes: account.notes || "",
    is_active: account.is_active,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/finance/payment-gateways/stripe", { cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (active) setGateways((data?.connections || []).filter((row: Gateway) => row.id && row.connected)); })
      .catch(() => { if (active) setGateways([]); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const body = {
        ...form,
        gateway_connection_id: account.account_type === "payment_gateway" ? (form.gateway_connection_id || null) : null,
        provider_name: form.provider_name.trim() || null,
        account_holder_name: form.account_holder_name.trim() || null,
        account_reference: form.account_reference.trim() || null,
        payment_url: form.payment_url.trim() || null,
        payment_instructions: form.payment_instructions.trim() || null,
        notes: form.notes.trim() || null,
      };
      const response = await fetch(`/api/finance/accounts/${encodeURIComponent(account.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiErrorMessage(result, "Could not update financial account"));
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Financial account update failed");
    } finally { setBusy(false); }
  }
  const labelClass = "block text-xs font-semibold text-neutral-600";
  const inputClass = "mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm";
  const set = (key: keyof typeof form, value: string | boolean) => setForm(previous => ({ ...previous, [key]: value }));

  return <section className="rounded-2xl border bg-white p-5">
    <h2 className="text-lg font-semibold">Edit financial account</h2>
    <p className="mt-1 text-xs text-neutral-500">Account currency and opening balance are ledger history and cannot be edited here. Changes to gateway links do not move money.</p>
    <form onSubmit={(event) => void save(event)} className="mt-4 space-y-4">
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Account name<input required maxLength={180} className={inputClass} value={form.name} onChange={event => set("name", event.target.value)} /></label>
        <label className={labelClass}>Provider<input maxLength={120} className={inputClass} value={form.provider_name} onChange={event => set("provider_name", event.target.value)} /></label>
        <label className={labelClass}>Account holder<input maxLength={180} className={inputClass} value={form.account_holder_name} onChange={event => set("account_holder_name", event.target.value)} /></label>
        <label className={labelClass}>Reference / account identifier<input maxLength={180} className={inputClass} value={form.account_reference} onChange={event => set("account_reference", event.target.value)} /></label>
        {account.account_type === "payment_gateway" && <div className="sm:col-span-2">
          <label className={labelClass}>Connected payment gateway
            <select className={inputClass} value={form.gateway_connection_id} onChange={event => { const id=event.target.value; setForm(previous => ({ ...previous, gateway_connection_id:id, provider_name: gateways.some(gateway => gateway.id===id) ? "Stripe" : previous.provider_name })); }}>
              <option value="">No connected gateway (manual account)</option>
              {gateways.map(gateway => <option key={gateway.id} value={gateway.id || ""}>Stripe {gateway.mode==="test" ? "Sandbox" : "Live"} · {gateway.account_label || gateway.stripe_account_id}</option>)}
              {form.gateway_connection_id && !gateways.some(gateway => gateway.id === form.gateway_connection_id) ? <option value={form.gateway_connection_id}>Previously linked connection (inactive)</option> : null}
            </select>
          </label>
          {form.gateway_connection_id && gateways.find(g => g.id===form.gateway_connection_id)?.mode === "test" && account.currency !== "USD" ? <p className="mt-1 text-xs text-amber-700">Stripe Sandbox currently requires USD accounts.</p> : null}
          <p className="mt-2 text-xs text-neutral-500">No gateway connected yet? <Link href="/dashboard/company?tab=payments" className="underline">Manage Payment Gateways</Link>.</p>
        </div>}
        <label className={labelClass}>Default payment URL<input type="url" maxLength={1000} className={inputClass} value={form.payment_url} onChange={event => set("payment_url", event.target.value)} /></label>
        <label className={labelClass}>Internal notes<input className={inputClass} value={form.notes} onChange={event => set("notes", event.target.value)} /></label>
        <label className={`${labelClass} sm:col-span-2`}>Client payment instructions<textarea maxLength={5000} className={`${inputClass} min-h-20`} value={form.payment_instructions} onChange={event => set("payment_instructions", event.target.value)} /></label>
      </div>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.is_active} onChange={event => set("is_active", event.target.checked)}/>Account active</label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border px-4 py-2.5 text-sm">Cancel</button>
        <button type="submit" disabled={busy || !form.name.trim()} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy && <LoaderCircle className="size-4 animate-spin" />}Save account</button>
      </div>
    </form>
  </section>;
}
