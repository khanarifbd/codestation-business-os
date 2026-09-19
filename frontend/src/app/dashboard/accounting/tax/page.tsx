"use client";

import { FormEvent, useEffect, useState } from "react";

import { AccountingNav } from "@/components/accounting-nav";

type TaxCode = {
  id: string;
  code: string;
  name: string;
  tax_kind: "sales" | "purchase" | "withholding";
  rate: string;
  recoverable_percent: string;
  country_code?: string | null;
  jurisdiction?: string | null;
  is_active: boolean;
};

type ReportRow = {
  currency: string;
  output_tax: string;
  input_tax: string;
  recoverable_input_tax: string;
  withholding_tax: string;
  net_indirect_tax_payable: string;
};

type SettlementMeta = {
  currency: string;
  accounts: { id: string; name: string; balance: string }[];
};

type TaxSettlement = {
  id: string;
  settlement_type: "indirect_tax_payment" | "withholding_tax_payment" | "input_tax_refund" | "input_tax_offset";
  settlement_date: string;
  currency: string;
  amount: string;
  account_id?: string | null;
  reference?: string | null;
};

const settlementLabel: Record<TaxSettlement["settlement_type"], string> = {
  indirect_tax_payment: "Indirect tax payment",
  withholding_tax_payment: "Withholding tax payment",
  input_tax_refund: "Input tax refund",
  input_tax_offset: "Input tax offset",
};

export default function TaxPage() {
  const [codes, setCodes] = useState<TaxCode[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [settlements, setSettlements] = useState<TaxSettlement[]>([]);
  const [settlementMeta, setSettlementMeta] = useState<SettlementMeta>({ currency: "BDT", accounts: [] });
  const [error, setError] = useState("");
  const [settlementError, setSettlementError] = useState("");
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [form, setForm] = useState({
    code: "",
    name: "",
    tax_kind: "sales",
    rate: "0",
    recoverable_percent: "100",
    country_code: "",
    jurisdiction: "",
  });
  const [settlementForm, setSettlementForm] = useState({
    settlement_type: "indirect_tax_payment" as TaxSettlement["settlement_type"],
    settlement_date: today,
    amount: "",
    account_id: "",
    reference: "",
  });

  async function load() {
    const [codesResponse, reportResponse, metaResponse, settlementsResponse] = await Promise.all([
      fetch("/api/accounting/tax/codes", { cache: "no-store" }),
      fetch(`/api/accounting/tax/report?date_from=${from}&date_to=${to}`, { cache: "no-store" }),
      fetch(`/api/accounting/tax/settlement-meta?settlement_date=${settlementForm.settlement_date || today}`, { cache: "no-store" }),
      fetch("/api/accounting/tax/settlements?limit=50", { cache: "no-store" }),
    ]);

    if (codesResponse.ok) setCodes(await codesResponse.json());
    if (reportResponse.ok) setRows((await reportResponse.json()).rows ?? []);
    if (metaResponse.ok) {
      const meta = (await metaResponse.json()) as SettlementMeta;
      setSettlementMeta(meta);
      setSettlementForm((current) => ({
        ...current,
        account_id: current.account_id && meta.accounts.some((item) => item.id === current.account_id)
          ? current.account_id
          : meta.accounts[0]?.id ?? "",
      }));
    }
    if (settlementsResponse.ok) setSettlements(await settlementsResponse.json());
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, settlementForm.settlement_date]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const response = await fetch("/api/accounting/tax/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        rate: Number(form.rate),
        recoverable_percent: Number(form.recoverable_percent),
        country_code: form.country_code || null,
        jurisdiction: form.jurisdiction || null,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.detail ?? "Could not create tax code");
      return;
    }
    setForm({
      code: "",
      name: "",
      tax_kind: "sales",
      rate: "0",
      recoverable_percent: "100",
      country_code: "",
      jurisdiction: "",
    });
    await load();
  }

  async function submitSettlement(e: FormEvent) {
    e.preventDefault();
    setSettlementError("");
    setBusy(true);
    try {
      const nonCash = settlementForm.settlement_type === "input_tax_offset";
      const response = await fetch("/api/accounting/tax/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settlement_type: settlementForm.settlement_type,
          settlement_date: settlementForm.settlement_date,
          amount: Number(settlementForm.amount),
          account_id: nonCash ? null : settlementForm.account_id || null,
          reference: settlementForm.reference || null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? "Could not post tax settlement");
      }
      setSettlementForm((current) => ({ ...current, amount: "", reference: "" }));
      await load();
    } catch (reason) {
      setSettlementError(reason instanceof Error ? reason.message : "Could not post tax settlement");
    } finally {
      setBusy(false);
    }
  }

  const nonCashSettlement = settlementForm.settlement_type === "input_tax_offset";

  return (
    <div className="space-y-6">
      <AccountingNav />
      <div>
        <h1 className="text-2xl font-semibold">Tax Center</h1>
        <p className="text-sm text-neutral-500">Country-agnostic VAT, GST, sales-tax and withholding controls.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-white p-5">
          <h2 className="font-semibold">Add tax code</h2>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <input className="rounded-xl border px-3 py-2" placeholder="Code e.g. VAT15" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <input className="rounded-xl border px-3 py-2" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select className="rounded-xl border px-3 py-2" value={form.tax_kind} onChange={(e) => setForm({ ...form, tax_kind: e.target.value })}>
              <option value="sales">Sales / Output</option>
              <option value="purchase">Purchase / Input</option>
              <option value="withholding">Withholding</option>
            </select>
            <input className="rounded-xl border px-3 py-2" type="number" step="0.0001" min="0" placeholder="Rate %" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          </div>
          {form.tax_kind === "purchase" ? (
            <input className="w-full rounded-xl border px-3 py-2" type="number" step="0.01" min="0" max="100" placeholder="Recoverable %" value={form.recoverable_percent} onChange={(e) => setForm({ ...form, recoverable_percent: e.target.value })} />
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <input className="rounded-xl border px-3 py-2" placeholder="Country code (BD)" maxLength={2} value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })} />
            <input className="rounded-xl border px-3 py-2" placeholder="Jurisdiction" value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} />
          </div>
          <button className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-medium text-white">Create tax code</button>
        </form>

        <div className="rounded-2xl border bg-white p-5">
          <h2 className="mb-3 font-semibold">Configured codes</h2>
          <div className="space-y-2">
            {codes.length === 0 ? <p className="text-sm text-neutral-500">No tax codes yet.</p> : codes.map((code) => (
              <div key={code.id} className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <div className="font-medium">{code.code} · {code.name}</div>
                  <div className="text-xs text-neutral-500">{code.tax_kind} · {code.country_code || "Global"}{code.jurisdiction ? ` · ${code.jurisdiction}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{Number(code.rate).toFixed(2)}%</div>
                  {code.tax_kind === "purchase" ? <div className="text-xs text-neutral-500">{Number(code.recoverable_percent).toFixed(0)}% recoverable</div> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Tax position</h2>
            <p className="text-sm text-neutral-500">Output tax from issued invoices; input and withholding tax from vendor bills.</p>
          </div>
          <div className="flex gap-2">
            <input type="date" className="rounded-xl border px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="rounded-xl border px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2">Currency</th><th>Output tax</th><th>Input tax</th><th>Recoverable</th><th>Withholding</th><th>Net indirect tax</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.currency} className="border-b last:border-0">
                  <td className="py-3 font-medium">{row.currency}</td>
                  <td>{Number(row.output_tax).toFixed(2)}</td>
                  <td>{Number(row.input_tax).toFixed(2)}</td>
                  <td>{Number(row.recoverable_input_tax).toFixed(2)}</td>
                  <td>{Number(row.withholding_tax).toFixed(2)}</td>
                  <td className="font-semibold">{Number(row.net_indirect_tax_payable).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <form onSubmit={submitSettlement} className="space-y-3 rounded-2xl border bg-white p-5">
          <div>
            <h2 className="font-semibold">Post tax settlement</h2>
            <p className="mt-1 text-sm text-neutral-500">Settlements use the organization functional currency ({settlementMeta.currency}) and clear the corresponding tax GL balance.</p>
          </div>
          {settlementError ? <p className="text-sm text-red-600">{settlementError}</p> : null}
          <select
            className="w-full rounded-xl border px-3 py-2"
            value={settlementForm.settlement_type}
            onChange={(e) => setSettlementForm({ ...settlementForm, settlement_type: e.target.value as TaxSettlement["settlement_type"] })}
          >
            {Object.entries(settlementLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input type="date" className="rounded-xl border px-3 py-2" value={settlementForm.settlement_date} onChange={(e) => setSettlementForm({ ...settlementForm, settlement_date: e.target.value })} required />
            <input type="number" step="0.01" min="0.01" className="rounded-xl border px-3 py-2" placeholder={`Amount (${settlementMeta.currency})`} value={settlementForm.amount} onChange={(e) => setSettlementForm({ ...settlementForm, amount: e.target.value })} required />
          </div>
          {!nonCashSettlement ? (
            <select className="w-full rounded-xl border px-3 py-2" value={settlementForm.account_id} onChange={(e) => setSettlementForm({ ...settlementForm, account_id: e.target.value })} required>
              <option value="">Select {settlementMeta.currency} account</option>
              {settlementMeta.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {settlementMeta.currency} {Number(account.balance).toFixed(2)}</option>)}
            </select>
          ) : (
            <p className="rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500">Input-tax offset is non-cash: it debits tax payable and credits input-tax receivable.</p>
          )}
          <input className="w-full rounded-xl border px-3 py-2" placeholder="Reference (optional)" value={settlementForm.reference} onChange={(e) => setSettlementForm({ ...settlementForm, reference: e.target.value })} />
          <button disabled={busy} className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Posting…" : "Post settlement"}</button>
        </form>

        <div className="rounded-2xl border bg-white p-5">
          <h2 className="font-semibold">Settlement history</h2>
          <p className="mt-1 text-sm text-neutral-500">Auditable tax payments, refunds and non-cash input-tax offsets.</p>
          <div className="mt-4 space-y-2">
            {settlements.length === 0 ? <p className="text-sm text-neutral-500">No tax settlements yet.</p> : settlements.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                <div>
                  <p className="font-medium">{settlementLabel[item.settlement_type]}</p>
                  <p className="text-xs text-neutral-500">{item.settlement_date}{item.reference ? ` · ${item.reference}` : ""}</p>
                </div>
                <p className="font-semibold tabular-nums">{item.currency} {Number(item.amount).toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
