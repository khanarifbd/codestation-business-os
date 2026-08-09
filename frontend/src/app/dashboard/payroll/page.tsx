"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, Edit3, FileText, Loader2, Play, Plus, Trash2, Users, X } from "lucide-react";

import { SearchableSelect } from "@/components/searchable-select";

type Employee = { id: string; employee_code: string; full_name: string };
type Account = { id: string; name: string; currency: string; is_active: boolean };
type Meta = { employees: Employee[]; accounts: Account[]; currencies: string[] };
type ComponentItem = { name: string; amount: string };
type Profile = { id: string; employee_id: string; employee_code: string; employee_name: string; currency: string; pay_frequency: string; base_salary: string; effective_from: string; is_active: boolean };
type Period = { id: string; name: string; period_start: string; period_end: string; pay_date: string; status: string };
type Entry = { id: string; employee_id: string; employee_code: string; employee_name: string; currency: string; base_salary: string; allowances: ComponentItem[]; deductions: ComponentItem[]; allowance_total: string; deduction_total: string; tax_amount: string; gross_pay: string; net_pay: string; notes?: string | null };
type Run = { id: string; run_number: string; period_id: string; period_name: string; currency: string; status: string; employee_count: number; gross_total: string; allowance_total: string; deduction_total: string; tax_total: string; net_total: string; paid_account_id: string | null; entries: Entry[] };
type Tab = "runs" | "profiles" | "periods";

type EntryDraft = { allowances: ComponentItem[]; deductions: ComponentItem[]; tax_amount: string; notes: string };

function money(value: string | number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || `Request failed (${response.status})`);
  return body as T;
}

export default function PayrollPage() {
  const [tab, setTab] = useState<Tab>("runs");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);
  async function bootstrap() {
    setLoading(true); setError(null);
    try {
      const [m, p, periodsData, runsData] = await Promise.all([
        api<Meta>("/api/payroll/meta"), api<Profile[]>("/api/payroll/salary-profiles"),
        api<Period[]>("/api/payroll/periods"), api<Run[]>("/api/payroll/runs"),
      ]);
      setMeta(m); setProfiles(p); setPeriods(periodsData); setRuns(runsData);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load payroll"); }
    finally { setLoading(false); }
  }
  async function openRun(id: string) {
    setBusy(true); setError(null);
    try { setSelectedRun(await api<Run>(`/api/payroll/runs/${id}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load payroll run"); }
    finally { setBusy(false); }
  }
  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await api<Profile>("/api/payroll/salary-profiles", { method: "POST", body: JSON.stringify({
        employee_id: form.get("employee_id"), currency: form.get("currency"), pay_frequency: form.get("pay_frequency"),
        base_salary: form.get("base_salary"), effective_from: form.get("effective_from"), default_allowances: [], default_deductions: [],
      }) });
      setProfiles((current) => [created, ...current.map((item) => item.employee_id === created.employee_id ? { ...item, is_active: false } : item)]);
      formElement.reset(); setSuccess("Salary profile saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save salary profile"); }
    finally { setBusy(false); }
  }
  async function createPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await api<Period>("/api/payroll/periods", { method: "POST", body: JSON.stringify({ name: form.get("name"), period_start: form.get("period_start"), period_end: form.get("period_end"), pay_date: form.get("pay_date") }) });
      setPeriods((current) => [created, ...current]); formElement.reset(); setSuccess("Payroll period created.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create payroll period"); }
    finally { setBusy(false); }
  }
  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(null);
    const form = new FormData(event.currentTarget);
    try {
      const created = await api<Run>("/api/payroll/runs", { method: "POST", body: JSON.stringify({ period_id: form.get("period_id"), currency: form.get("currency") }) });
      setRuns((current) => [{ ...created, entries: [] }, ...current]); setSelectedRun(created); setSuccess("Draft payroll generated from salary profiles. Review employee adjustments before approval.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to generate payroll"); }
    finally { setBusy(false); }
  }
  async function saveEntry(entryId: string, draft: EntryDraft) {
    if (!selectedRun) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const updated = await api<Run>(`/api/payroll/runs/${selectedRun.id}/entries/${entryId}`, {
        method: "PATCH",
        body: JSON.stringify({
          allowances: draft.allowances.filter((item) => item.name.trim()).map((item) => ({ name: item.name.trim(), amount: Number(item.amount || 0) })),
          deductions: draft.deductions.filter((item) => item.name.trim()).map((item) => ({ name: item.name.trim(), amount: Number(item.amount || 0) })),
          tax_amount: Number(draft.tax_amount || 0), notes: draft.notes.trim() || null,
        }),
      });
      setSelectedRun(updated);
      setRuns((current) => current.map((item) => item.id === updated.id ? { ...updated, entries: [] } : item));
      setEditingEntry(null); setSuccess("Employee payroll adjustment saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save payroll adjustment"); }
    finally { setBusy(false); }
  }
  async function runAction(action: "approve" | "pay", accountId?: string) {
    if (!selectedRun) return; setBusy(true); setError(null); setSuccess(null);
    try {
      const updated = await api<Run>(`/api/payroll/runs/${selectedRun.id}/${action}`, { method: "POST", body: action === "pay" ? JSON.stringify({ account_id: accountId }) : undefined });
      setSelectedRun(updated); setRuns((current) => current.map((item) => item.id === updated.id ? { ...updated, entries: [] } : item));
      setSuccess(action === "approve" ? "Payroll approved and locked." : "Payroll paid and Finance ledger updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update payroll"); }
    finally { setBusy(false); }
  }

  const activePeriods = periods.filter((item) => item.status === "open");
  const employeeOptions = useMemo(() => (meta?.employees ?? []).map((e) => ({ value: e.id, label: `${e.employee_code} · ${e.full_name}` })), [meta]);
  const currencyOptions = useMemo(() => (meta?.currencies ?? []).map((c) => ({ value: c, label: c })), [meta]);
  const periodOptions = useMemo(() => activePeriods.map((p) => ({ value: p.id, label: `${p.name} · ${p.period_start} — ${p.period_end}` })), [activePeriods]);

  if (loading) return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1500px]">
    <header><p className="text-sm text-neutral-500">People & compensation</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Payroll</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Create salary profiles, review employee adjustments, approve payroll, issue payslips and post net cash payments to Finance.</p></header>
    {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {success ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

    <div className="mt-6 flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">{(["runs", "profiles", "periods"] as Tab[]).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${tab === item ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}>{item === "runs" ? "Payroll Runs" : item === "profiles" ? "Salary Profiles" : "Payroll Periods"}</button>)}</div>

    {tab === "profiles" ? <section className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={createProfile} className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">New salary profile</h2><div className="mt-4 space-y-4"><SearchableSelect label="Employee" name="employee_id" required options={employeeOptions} placeholder="Select employee"/><SearchableSelect label="Currency" name="currency" required options={currencyOptions} placeholder="Select currency"/><label className="block text-sm font-medium">Pay frequency<select name="pay_frequency" className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="monthly">Monthly</option><option value="biweekly">Biweekly</option><option value="weekly">Weekly</option></select></label><label className="block text-sm font-medium">Base salary<input name="base_salary" type="number" min="0.01" step="0.01" required className="mt-2 h-11 w-full rounded-xl border px-3"/></label><label className="block text-sm font-medium">Effective from<input name="effective_from" type="date" required className="mt-2 h-11 w-full rounded-xl border px-3"/></label><button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 text-sm font-semibold text-white disabled:opacity-50"><Plus className="size-4"/>Save profile</button></div></form>
      <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Salary profiles</h2><div className="mt-4 space-y-3">{profiles.length ? profiles.map((p) => <div key={p.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{p.employee_code} · {p.employee_name}</p><p className="mt-1 text-xs text-neutral-400">{p.pay_frequency} · effective {p.effective_from}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs ${p.is_active ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>{p.is_active ? "Active" : "Historical"}</span><span className="font-semibold">{money(p.base_salary, p.currency)}</span></div></div>) : <Empty text="No salary profiles yet."/>}</div></div>
    </section> : null}

    {tab === "periods" ? <section className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={createPeriod} className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">New payroll period</h2><div className="mt-4 space-y-4"><label className="block text-sm font-medium">Period name<input name="name" required placeholder="August 2026" className="mt-2 h-11 w-full rounded-xl border px-3"/></label><label className="block text-sm font-medium">Start date<input name="period_start" type="date" required className="mt-2 h-11 w-full rounded-xl border px-3"/></label><label className="block text-sm font-medium">End date<input name="period_end" type="date" required className="mt-2 h-11 w-full rounded-xl border px-3"/></label><label className="block text-sm font-medium">Pay date<input name="pay_date" type="date" required className="mt-2 h-11 w-full rounded-xl border px-3"/></label><button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 text-sm font-semibold text-white disabled:opacity-50"><Plus className="size-4"/>Create period</button></div></form>
      <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Payroll periods</h2><div className="mt-4 space-y-3">{periods.length ? periods.map((p) => <div key={p.id} className="flex items-center justify-between rounded-xl border p-4"><div><p className="font-medium">{p.name}</p><p className="mt-1 text-xs text-neutral-400">{p.period_start} — {p.period_end} · Pay {p.pay_date}</p></div><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize">{p.status}</span></div>) : <Empty text="No payroll periods yet."/>}</div></div>
    </section> : null}

    {tab === "runs" ? <section className="mt-5 space-y-5"><div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <form onSubmit={createRun} className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Generate payroll</h2><p className="mt-1 text-sm text-neutral-500">Drafts can be adjusted employee-by-employee before approval.</p><div className="mt-4 space-y-4"><SearchableSelect label="Payroll period" name="period_id" required options={periodOptions} placeholder="Select open period"/><SearchableSelect label="Currency" name="currency" required options={currencyOptions} placeholder="Select currency"/><button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 text-sm font-semibold text-white disabled:opacity-50"><Play className="size-4"/>Generate draft</button></div></form>
      <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Payroll runs</h2><div className="mt-4 space-y-3">{runs.length ? runs.map((r) => <button key={r.id} onClick={() => void openRun(r.id)} className="flex w-full items-center justify-between rounded-xl border p-4 text-left hover:bg-neutral-50"><div><p className="font-medium">{r.run_number} · {r.period_name}</p><p className="mt-1 text-xs text-neutral-400">{r.employee_count} employees · {r.currency}</p></div><div className="text-right"><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize">{r.status}</span><p className="mt-2 font-semibold">{money(r.net_total, r.currency)}</p></div></button>) : <Empty text="No payroll runs yet."/>}</div></div></div>
      {selectedRun ? <RunDetail run={selectedRun} accounts={meta?.accounts ?? []} busy={busy} onEdit={setEditingEntry} onApprove={() => void runAction("approve")} onPay={(id) => void runAction("pay", id)} /> : null}
    </section> : null}
  </div>
  {editingEntry && selectedRun ? <EntryEditor entry={editingEntry} busy={busy} onClose={() => setEditingEntry(null)} onSave={(draft) => void saveEntry(editingEntry.id, draft)} /> : null}
  </main>;
}

function RunDetail({ run, accounts, busy, onEdit, onApprove, onPay }: { run: Run; accounts: Account[]; busy: boolean; onEdit: (entry: Entry) => void; onApprove: () => void; onPay: (id: string) => void }) {
  const [accountId, setAccountId] = useState("");
  const compatible = accounts.filter((a) => a.is_active && a.currency === run.currency).map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }));
  return <div className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{run.run_number}</p><h2 className="mt-1 text-xl font-semibold">{run.period_name}</h2><p className="mt-1 text-sm text-neutral-500">{run.employee_count} employees · {run.currency} · <span className="capitalize">{run.status}</span></p>{run.status === "draft" ? <p className="mt-2 text-xs text-amber-700">Review adjustments before approving. Approval locks employee amounts.</p> : null}</div><div className="flex flex-col gap-2 sm:flex-row">{run.status === "draft" ? <button disabled={busy} onClick={onApprove} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="size-4"/>Approve payroll</button> : null}{run.status === "approved" ? <><div className="min-w-64"><SearchableSelect value={accountId} onValueChange={setAccountId} options={compatible} placeholder={`Select ${run.currency} account`} /></div><button disabled={busy || !accountId} onClick={() => onPay(accountId)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Banknote className="size-4"/>Pay payroll</button></> : null}</div></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Mini label="Gross" value={money(run.gross_total, run.currency)}/><Mini label="Allowances" value={money(run.allowance_total, run.currency)}/><Mini label="Deductions" value={money(run.deduction_total, run.currency)}/><Mini label="Tax" value={money(run.tax_total, run.currency)}/><Mini label="Net payroll" value={money(run.net_total, run.currency)}/></div>
    <div className="mt-5 overflow-x-auto rounded-xl border"><table className="min-w-full text-sm"><thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Base</th><th className="px-4 py-3">Allowance</th><th className="px-4 py-3">Deduction</th><th className="px-4 py-3">Tax</th><th className="px-4 py-3">Net</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y">{run.entries.map((e) => <tr key={e.id}><td className="px-4 py-3"><p className="font-medium">{e.employee_name}</p><p className="text-xs text-neutral-400">{e.employee_code}</p></td><td className="px-4 py-3">{money(e.base_salary, e.currency)}</td><td className="px-4 py-3">{money(e.allowance_total, e.currency)}</td><td className="px-4 py-3">{money(e.deduction_total, e.currency)}</td><td className="px-4 py-3">{money(e.tax_amount, e.currency)}</td><td className="px-4 py-3 font-semibold">{money(e.net_pay, e.currency)}</td><td className="px-4 py-3"><div className="flex gap-2">{run.status === "draft" ? <button onClick={() => onEdit(e)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50"><Edit3 className="size-3.5"/>Adjust</button> : null}<Link href={`/dashboard/payroll/runs/${run.id}/payslip/${e.id}`} target="_blank" className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50"><FileText className="size-3.5"/>Payslip</Link></div></td></tr>)}</tbody></table></div>
  </div>;
}

function EntryEditor({ entry, busy, onClose, onSave }: { entry: Entry; busy: boolean; onClose: () => void; onSave: (draft: EntryDraft) => void }) {
  const [allowances, setAllowances] = useState<ComponentItem[]>(entry.allowances?.length ? entry.allowances.map((item) => ({ ...item, amount: String(item.amount) })) : []);
  const [deductions, setDeductions] = useState<ComponentItem[]>(entry.deductions?.length ? entry.deductions.map((item) => ({ ...item, amount: String(item.amount) })) : []);
  const [tax, setTax] = useState(String(entry.tax_amount || "0"));
  const [notes, setNotes] = useState(entry.notes || "");
  const sum = (items: ComponentItem[]) => items.reduce((total, item) => total + Number(item.amount || 0), 0);
  const previewGross = Number(entry.base_salary || 0) + sum(allowances);
  const previewNet = previewGross - sum(deductions) - Number(tax || 0);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Payroll adjustment</p><h3 className="mt-1 text-xl font-semibold">{entry.employee_code} · {entry.employee_name}</h3><p className="mt-1 text-sm text-neutral-500">Base salary {money(entry.base_salary, entry.currency)}</p></div><button onClick={onClose} className="rounded-full p-2 hover:bg-neutral-100"><X className="size-5"/></button></div>
    <div className="mt-6 grid gap-6 lg:grid-cols-2"><ComponentEditor title="Allowances" items={allowances} onChange={setAllowances}/><ComponentEditor title="Deductions" items={deductions} onChange={setDeductions}/></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Tax / withholding<input value={tax} onChange={(e) => setTax(e.target.value)} type="number" min="0" step="0.01" className="mt-2 h-11 w-full rounded-xl border px-3"/></label><label className="text-sm font-medium">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bonus, unpaid leave, adjustment note…" className="mt-2 h-11 w-full rounded-xl border px-3"/></label></div>
    <div className="mt-6 grid gap-3 rounded-2xl bg-neutral-50 p-4 sm:grid-cols-3"><Mini label="Gross preview" value={money(previewGross, entry.currency)}/><Mini label="Deductions + tax" value={money(sum(deductions) + Number(tax || 0), entry.currency)}/><Mini label="Net preview" value={money(previewNet, entry.currency)}/></div>
    {previewNet < 0 ? <p className="mt-3 text-sm text-red-600">Net pay cannot be negative.</p> : null}
    <div className="mt-6 flex justify-end gap-3"><button onClick={onClose} className="h-11 rounded-xl border px-4 text-sm font-medium">Cancel</button><button disabled={busy || previewNet < 0} onClick={() => onSave({ allowances, deductions, tax_amount: tax, notes })} className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save adjustment"}</button></div>
  </div></div>;
}

function ComponentEditor({ title, items, onChange }: { title: string; items: ComponentItem[]; onChange: (items: ComponentItem[]) => void }) {
  function patch(index: number, key: keyof ComponentItem, value: string) { onChange(items.map((item, i) => i === index ? { ...item, [key]: value } : item)); }
  return <div><div className="flex items-center justify-between"><h4 className="font-semibold">{title}</h4><button onClick={() => onChange([...items, { name: "", amount: "0" }])} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium"><Plus className="size-3.5"/>Add</button></div><div className="mt-3 space-y-2">{items.length ? items.map((item, index) => <div key={`${title}-${index}`} className="grid grid-cols-[1fr_120px_36px] gap-2"><input value={item.name} onChange={(e) => patch(index, "name", e.target.value)} placeholder={title === "Allowances" ? "Bonus / transport / housing" : "Advance / unpaid leave / other"} className="h-10 rounded-lg border px-3 text-sm"/><input value={item.amount} onChange={(e) => patch(index, "amount", e.target.value)} type="number" min="0" step="0.01" className="h-10 rounded-lg border px-3 text-sm"/><button onClick={() => onChange(items.filter((_, i) => i !== index))} className="grid size-10 place-items-center rounded-lg border text-neutral-500 hover:bg-neutral-50"><Trash2 className="size-4"/></button></div>) : <p className="rounded-xl border border-dashed p-4 text-sm text-neutral-400">No {title.toLowerCase()}.</p>}</div></div>;
}

function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-neutral-50 p-4"><p className="text-xs text-neutral-400">{label}</p><p className="mt-2 font-semibold">{value}</p></div>; }
function Empty({ text }: { text: string }) { return <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed text-center text-sm text-neutral-400"><Users className="mb-2 size-5"/><p>{text}</p></div>; }
