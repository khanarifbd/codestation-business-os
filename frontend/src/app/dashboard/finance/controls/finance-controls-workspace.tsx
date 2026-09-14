"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Repeat2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { AccountingNav } from "@/components/accounting-nav";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { cn } from "@/lib/cn";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type Tab = "recurring" | "automation" | "periods";
type Meta = {
  vendors: { id: string; name: string; is_active: boolean }[];
  categories: { id: string; name: string; cost_type: string; is_active: boolean }[];
  accounts: { id: string; name: string; currency: string; current_balance: string | number; is_active: boolean }[];
  clients: { id: string; name: string; currency: string | null }[];
  projects: { id: string; number: string; name: string; client_id: string; currency: string; status: string }[];
};
type Recurring = {
  id: string;
  name: string;
  description: string;
  vendor_id: string | null;
  vendor_name: string | null;
  category_id: string;
  category_name: string;
  account_id: string;
  account_name: string;
  account_currency: string;
  client_id: string | null;
  client_name: string | null;
  project_id: string | null;
  project_name: string | null;
  expense_currency: string;
  expense_amount: string | number;
  frequency: string;
  interval_count: number;
  next_due_date: string;
  end_date: string | null;
  tax_amount: string | number;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  is_active: boolean;
  last_posted_expense_id: string | null;
  last_posted_at: string | null;
  created_at: string;
  updated_at: string;
};
type AutoPostRow = {
  id: string;
  name: string;
  description: string;
  category_name: string;
  vendor_name: string | null;
  account_name: string;
  account_currency: string;
  expense_currency: string;
  expense_amount: string;
  frequency: string;
  interval_count: number;
  next_due_date: string;
  is_active: boolean;
  auto_post: boolean;
  eligible: boolean;
  eligibility_reason: string | null;
  retryable: boolean;
  last_attempt_at: string | null;
  last_error: string | null;
};
type Period = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  close_notes: string | null;
  closed_by_user_id: string | null;
  closed_at: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  created_at: string;
  updated_at: string;
};
type Form = {
  name: string;
  description: string;
  category_id: string;
  account_id: string;
  vendor_id: string;
  client_id: string;
  project_id: string;
  expense_currency: string;
  expense_amount: string;
  frequency: string;
  interval_count: string;
  next_due_date: string;
  end_date: string;
  tax_amount: string;
  payment_method: string;
  reference: string;
  notes: string;
};
type PostPayload = {
  expense_date: string | null;
  expense_amount: string | null;
  account_amount: string | null;
  profitability_amount: string | null;
  reference: string | null;
  notes: string | null;
};
type PeriodAction = { type: "close" | "reopen"; period: Period } | null;

const blank: Form = {
  name: "",
  description: "",
  category_id: "",
  account_id: "",
  vendor_id: "",
  client_id: "",
  project_id: "",
  expense_currency: "USD",
  expense_amount: "",
  frequency: "monthly",
  interval_count: "1",
  next_due_date: "",
  end_date: "",
  tax_amount: "0",
  payment_method: "bank_transfer",
  reference: "",
  notes: "",
};

const input = "mt-1.5 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500";
const textarea = "mt-1.5 min-h-24 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-neutral-500";

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function FinanceControlsWorkspace() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("recurring");
  const [meta, setMeta] = useState<Meta>({ vendors: [], categories: [], accounts: [], clients: [], projects: [] });
  const [rows, setRows] = useState<Recurring[]>([]);
  const [automationRows, setAutomationRows] = useState<AutoPostRow[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [automationLoaded, setAutomationLoaded] = useState(false);
  const [periodsLoaded, setPeriodsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<"recurring" | "period" | "post" | "period_action" | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [selected, setSelected] = useState<Recurring | null>(null);
  const [postPayload, setPostPayload] = useState<PostPayload | null>(null);
  const [periodAction, setPeriodAction] = useState<PeriodAction>(null);
  const [periodActionNote, setPeriodActionNote] = useState("");

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(`/api/finance-controls/${path}`, init);
      if (response.status === 401) {
        router.replace("/login");
        throw new Error("Authentication required");
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail ?? "Finance controls request failed");
      return body;
    },
    [router],
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [m, recurring] = await Promise.all([api("expense-meta"), api("recurring-expenses")]);
        setMeta(m as Meta);
        setRows(recurring as Recurring[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load finance controls");
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  async function ensureAutomation(force = false) {
    if (automationLoaded && !force) return;
    setTabLoading(true);
    try {
      setAutomationRows((await api("recurring-auto-post")) as AutoPostRow[]);
      setAutomationLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load Auto Post controls");
    } finally {
      setTabLoading(false);
    }
  }

  async function ensurePeriods(force = false) {
    if (periodsLoaded && !force) return;
    setTabLoading(true);
    try {
      setPeriods((await api("accounting-periods")) as Period[]);
      setPeriodsLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load accounting periods");
    } finally {
      setTabLoading(false);
    }
  }

  function changeTab(next: Tab) {
    setTab(next);
    setError(null);
    setMessage(null);
    if (next === "automation") void ensureAutomation();
    if (next === "periods") void ensurePeriods();
  }

  const selectedAccount = useMemo(() => meta.accounts.find((account) => account.id === form.account_id) ?? null, [meta.accounts, form.account_id]);
  const formProfitabilityCurrency = useMemo(() => {
    if (form.project_id) return meta.projects.find((project) => project.id === form.project_id)?.currency ?? form.expense_currency;
    if (form.client_id) return meta.clients.find((client) => client.id === form.client_id)?.currency ?? form.expense_currency;
    return form.expense_currency;
  }, [form.client_id, form.expense_currency, form.project_id, meta.clients, meta.projects]);
  const selectedProfitabilityCurrency = useMemo(() => {
    if (!selected) return null;
    if (selected.project_id) return meta.projects.find((project) => project.id === selected.project_id)?.currency ?? selected.expense_currency;
    if (selected.client_id) return meta.clients.find((client) => client.id === selected.client_id)?.currency ?? selected.expense_currency;
    return selected.expense_currency;
  }, [selected, meta.clients, meta.projects]);

  function openRecurring() {
    const account = meta.accounts.find((item) => item.is_active);
    const category = meta.categories.find((item) => item.is_active);
    setForm({ ...blank, account_id: account?.id ?? "", category_id: category?.id ?? "", expense_currency: account?.currency ?? "USD" });
    setModal("recurring");
    setError(null);
  }

  async function createRecurring(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = (await api("recurring-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          vendor_id: form.vendor_id || null,
          client_id: form.client_id || null,
          project_id: form.project_id || null,
          interval_count: Number(form.interval_count),
          tax_amount: form.tax_amount || "0",
          end_date: form.end_date || null,
          reference: form.reference || null,
          notes: form.notes || null,
        }),
      })) as Recurring;
      setRows((current) => [created, ...current]);
      setAutomationLoaded(false);
      setModal(null);
      setMessage("Recurring expense schedule created. It stays Manual Post until Auto Post is explicitly enabled and eligible.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create recurring expense");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: Recurring) {
    setSavingId(item.id);
    setError(null);
    try {
      const updated = (await api(`recurring-expenses/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !item.is_active }),
      })) as Recurring;
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setAutomationLoaded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update recurring expense");
    } finally {
      setSavingId(null);
    }
  }

  function reviewRecurringPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    setPostPayload({
      expense_date: String(data.get("expense_date") || "") || null,
      expense_amount: String(data.get("expense_amount") || "") || null,
      account_amount: String(data.get("account_amount") || "") || null,
      profitability_amount: String(data.get("profitability_amount") || "") || null,
      reference: String(data.get("reference") || "") || null,
      notes: String(data.get("notes") || "") || null,
    });
  }

  async function postRecurring() {
    if (!selected || !postPayload) return;
    setSaving(true);
    setError(null);
    try {
      const result = (await api(`recurring-expenses/${selected.id}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postPayload),
      })) as { expense_number: string };
      setRows((await api("recurring-expenses")) as Recurring[]);
      setAutomationLoaded(false);
      setPostPayload(null);
      setModal(null);
      setSelected(null);
      setMessage(`Posted as ${result.expense_number}. Account movement and expense record were created through the recurring expense workflow.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to post recurring expense");
      setPostPayload(null);
    } finally {
      setSaving(false);
    }
  }

  async function createPeriod(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const created = (await api("accounting-periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), start_date: data.get("start_date"), end_date: data.get("end_date") }),
      })) as Period;
      setPeriods((current) => [created, ...current]);
      setModal(null);
      setMessage("Accounting period created. Closing it later will lock financial posting inside that date range.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create accounting period");
    } finally {
      setSaving(false);
    }
  }

  function openPeriodAction(type: "close" | "reopen", period: Period) {
    setPeriodAction({ type, period });
    setPeriodActionNote(type === "close" ? period.close_notes ?? "" : "");
    setModal("period_action");
    setError(null);
  }

  async function submitPeriodAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!periodAction) return;
    setSaving(true);
    setError(null);
    try {
      const endpoint = periodAction.type === "close" ? "close" : "reopen";
      const body = periodAction.type === "close" ? { notes: periodActionNote || null } : { reason: periodActionNote };
      const updated = (await api(`accounting-periods/${periodAction.period.id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })) as Period;
      setPeriods((current) => current.map((period) => (period.id === updated.id ? updated : period)));
      setModal(null);
      setPeriodAction(null);
      setPeriodActionNote("");
      setMessage(
        endpoint === "close"
          ? `${updated.name} closed. Financial posting in this period is now locked.`
          : `${updated.name} reopened with the audit reason preserved.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update accounting period");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAutoPost(row: AutoPostRow) {
    setSavingId(row.id);
    setError(null);
    setMessage(null);
    try {
      const updated = (await api(`recurring-auto-post/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !row.auto_post }),
      })) as AutoPostRow;
      setAutomationRows((current) => current.map((item) => (item.id === row.id ? updated : item)));
      setMessage(`Auto Post ${updated.auto_post ? "enabled" : "disabled"} for ${updated.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update Auto Post");
    } finally {
      setSavingId(null);
    }
  }

  async function retryAutoPost(row: AutoPostRow) {
    setSavingId(row.id);
    setError(null);
    setMessage(null);
    try {
      const updated = (await api(`recurring-auto-post/${row.id}/retry`, { method: "POST" })) as AutoPostRow;
      setAutomationRows((current) => current.map((item) => (item.id === row.id ? updated : item)));
      setRows((await api("recurring-expenses")) as Recurring[]);
      setMessage(`Auto Post retry succeeded for ${updated.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto Post retry failed");
      await ensureAutomation(true);
    } finally {
      setSavingId(null);
    }
  }

  const categoryOptions = [{ value: "", label: "Select category..." }, ...meta.categories.filter((item) => item.is_active).map((item) => ({ value: item.id, label: item.name, keywords: item.cost_type }))];
  const accountOptions = [{ value: "", label: "Select account..." }, ...meta.accounts.filter((item) => item.is_active).map((item) => ({ value: item.id, label: `${item.name} · ${item.currency}`, keywords: String(item.current_balance) }))];
  const vendorOptions = [{ value: "", label: "No vendor" }, ...meta.vendors.filter((item) => item.is_active).map((item) => ({ value: item.id, label: item.name }))];
  const clientOptions = [{ value: "", label: "No client" }, ...meta.clients.map((item) => ({ value: item.id, label: item.name, keywords: item.currency ?? "" }))];
  const projectOptions = [{ value: "", label: "No project" }, ...meta.projects.filter((item) => !form.client_id || item.client_id === form.client_id).map((item) => ({ value: item.id, label: `${item.number} · ${item.name}`, keywords: `${item.currency} ${item.status}` }))];
  const paymentMethodOptions = ["bank_transfer", "cash", "card", "payoneer", "wise", "stripe", "paypal", "fiverr", "other"].map((value) => ({ value, label: pretty(value) }));

  const activeRecurring = rows.filter((row) => row.is_active).length;
  const recurringCurrencies = new Set(rows.map((row) => row.expense_currency)).size;
  const autoEnabled = automationRows.filter((row) => row.auto_post).length;
  const autoEligible = automationRows.filter((row) => row.eligible).length;
  const autoFailures = automationRows.filter((row) => row.last_error).length;
  const openPeriods = periods.filter((period) => period.status === "open").length;
  const reopenedPeriods = periods.filter((period) => period.reopened_at).length;

  if (loading) {
    return (
      <AppPage>
        <div className="flex min-h-[65vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <PageHeader
        eyebrow="Finance & Accounts"
        title="Accounting controls"
        description="Manage recurring cost schedules, narrowly scoped Auto Post rules and accounting-period locks. Controls never bypass the normal expense, currency, account-balance or audit rules."
        meta={
          <>
            <span className="rounded-full border bg-white px-2.5 py-1">Auto Post only when backend eligibility passes</span>
            <span className="rounded-full border bg-white px-2.5 py-1">Closed periods block financial posting</span>
            <span className="rounded-full border bg-white px-2.5 py-1">Reopens require an audit reason</span>
          </>
        }
        actions={
          <button
            onClick={() => tab === "automation" ? void ensureAutomation(true) : tab === "periods" ? void ensurePeriods(true) : void api("recurring-expenses").then((data) => setRows(data as Recurring[])).catch((e) => setError(e instanceof Error ? e.message : "Refresh failed"))}
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className="size-4" /> Refresh
          </button>
        }
      />

      <div className="mt-6"><AccountingNav /></div>

      <Surface className="mt-6 p-1.5">
        <div className="flex min-w-max gap-1 overflow-x-auto">
          {([
            ["recurring", "Recurring schedules", Repeat2],
            ["automation", "Auto Post", Zap],
            ["periods", "Accounting periods", LockKeyhole],
          ] as const).map(([value, label, Icon]) => (
            <button key={value} onClick={() => changeTab(value)} className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition", tab === value ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900")}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </Surface>
      {tabLoading ? <div className="mt-2 h-0.5 animate-pulse rounded-full bg-neutral-800" /> : null}

      {error ? <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      {tab === "recurring" ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Active schedules" value={String(activeRecurring)} detail={`${rows.length - activeRecurring} paused`} />
            <SummaryCard label="Expense currencies" value={String(recurringCurrencies)} detail="Amounts remain separate by currency" />
            <SummaryCard label="Total schedules" value={String(rows.length)} detail="Posting creates real expenses only when executed" />
          </div>

          <Surface className="mt-5 overflow-hidden">
            <div className="p-5 sm:p-6">
              <SectionHeader
                title="Recurring expense schedules"
                description="Use schedules for predictable costs. Creating a schedule does not post an expense or change any account balance."
                action={<button onClick={openRecurring} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white"><Plus className="size-4" /> Recurring expense</button>}
              />
            </div>
            <div className="divide-y divide-neutral-100 border-t border-neutral-100">
              {rows.map((row) => (
                <div key={row.id} className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-neutral-900">{row.name}</p>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", row.is_active ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500")}>{row.is_active ? "Active" : "Paused"}</span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">{row.description}</p>
                    <p className="mt-2 text-xs leading-5 text-neutral-400">{row.category_name} · {row.account_name} ({row.account_currency}) · {pretty(row.frequency)} every {row.interval_count} · Next {row.next_due_date}</p>
                    {row.project_name || row.client_name ? <p className="mt-1 text-xs text-neutral-500">Profitability scope: {row.project_name ?? row.client_name}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <div className="mr-auto lg:mr-3 lg:text-right">
                      <p className="font-semibold tabular-nums">{money(row.expense_amount, row.expense_currency)}</p>
                      <p className="text-xs text-neutral-400">{row.vendor_name ?? "No vendor"} · {pretty(row.payment_method)}</p>
                    </div>
                    <button disabled={!row.is_active || savingId === row.id} onClick={() => { setSelected(row); setPostPayload(null); setModal("post"); }} className="rounded-xl border border-neutral-200 px-3.5 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-40">Post now</button>
                    <button disabled={savingId === row.id} onClick={() => void toggle(row)} className="min-w-24 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-40">{savingId === row.id ? <Loader2 className="mx-auto size-4 animate-spin" /> : row.is_active ? "Pause" : "Resume"}</button>
                  </div>
                </div>
              ))}
              {!rows.length ? <div className="px-6 py-14 text-center text-sm text-neutral-400"><Repeat2 className="mx-auto mb-3 size-6" />No recurring expense schedules yet.</div> : null}
            </div>
          </Surface>
        </>
      ) : null}

      {tab === "automation" ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Auto Post enabled" value={String(autoEnabled)} detail="Explicitly enabled schedules" />
            <SummaryCard label="Currently eligible" value={String(autoEligible)} detail="Backend safety rules permit automation" />
            <SummaryCard label="Manual required" value={String(Math.max(automationRows.length - autoEligible, 0))} detail="Variable or unsafe schedules stay manual" />
            <SummaryCard label="Needs attention" value={String(autoFailures)} detail="Schedules with a recorded Auto Post error" />
          </div>

          <Surface className="mt-5 overflow-hidden">
            <div className="p-5 sm:p-6">
              <SectionHeader title="Auto Post guardrails" description="Auto Post is intentionally narrow. Backend eligibility decides whether a schedule can run automatically; cross-currency or variable financial decisions remain manual." />
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-xs leading-5 text-blue-800">The scheduler may post only eligible fixed recurring expenses. Turning Auto Post on does not weaken account balance, closed-period, tenant, currency or audit controls.</div>
            </div>
            <div className="divide-y divide-neutral-100 border-t border-neutral-100">
              {automationRows.map((row) => (
                <div key={row.id} className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-neutral-900">{row.name}</p>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", row.auto_post ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500")}>{row.auto_post ? "Auto Post ON" : "Manual Post"}</span>
                      {!row.eligible ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><AlertTriangle className="size-3" /> Manual required</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">{row.description}</p>
                    <p className="mt-2 text-xs leading-5 text-neutral-400">{row.category_name} · {row.account_name} ({row.account_currency}) · {pretty(row.frequency)} every {row.interval_count} · Next {row.next_due_date}</p>
                    {row.eligibility_reason ? <p className="mt-2 text-xs text-amber-700">{row.eligibility_reason}</p> : null}
                    {row.last_error ? <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">Last Auto Post failed: {row.last_error}</div> : null}
                    {row.last_attempt_at ? <p className="mt-1 text-xs text-neutral-400">Last attempt: {new Date(row.last_attempt_at).toLocaleString()}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <div className="mr-auto lg:mr-3 lg:text-right"><p className="font-semibold tabular-nums">{money(row.expense_amount, row.expense_currency)}</p><p className="text-xs text-neutral-400">{row.vendor_name ?? "No vendor"}</p></div>
                    {row.retryable ? <button disabled={savingId === row.id} onClick={() => void retryAutoPost(row)} className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm font-semibold disabled:opacity-40">{savingId === row.id ? <Loader2 className="mx-auto size-4 animate-spin" /> : <><RotateCcw className="mr-1 inline size-4" /> Retry</>}</button> : null}
                    <button disabled={savingId === row.id || (!row.eligible && !row.auto_post) || !row.is_active} onClick={() => void toggleAutoPost(row)} className={cn("min-w-28 rounded-xl px-3.5 py-2.5 text-sm font-semibold disabled:opacity-40", row.auto_post ? "border border-neutral-200 bg-white text-neutral-700" : "bg-neutral-950 text-white")}>{savingId === row.id ? <Loader2 className="mx-auto size-4 animate-spin" /> : row.auto_post ? "Turn off" : <><Zap className="mr-1 inline size-4" /> Enable</>}</button>
                  </div>
                </div>
              ))}
              {automationLoaded && !automationRows.length ? <div className="px-6 py-14 text-center text-sm text-neutral-400"><Sparkles className="mx-auto mb-3 size-6" />Create a recurring schedule first.</div> : null}
            </div>
          </Surface>
        </>
      ) : null}

      {tab === "periods" ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Open periods" value={String(openPeriods)} detail="Posting remains allowed subject to other controls" />
            <SummaryCard label="Closed periods" value={String(periods.length - openPeriods)} detail="Financial posting inside these dates is locked" />
            <SummaryCard label="Reopened history" value={String(reopenedPeriods)} detail="Every reopen keeps an audit reason" />
          </div>

          <Surface className="mt-5 overflow-hidden">
            <div className="p-5 sm:p-6">
              <SectionHeader
                title="Accounting periods"
                description="Create non-overlapping control periods. Closing a completed period protects historical accounting from later posting; reopening is explicit and audited."
                action={<button onClick={() => setModal("period")} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white"><Plus className="size-4" /> Accounting period</button>}
              />
            </div>
            <div className="divide-y divide-neutral-100 border-t border-neutral-100">
              {periods.map((period) => (
                <div key={period.id} className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-neutral-900">{period.name}</p>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", period.status === "closed" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>{pretty(period.status)}</span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">{period.start_date} → {period.end_date}</p>
                    {period.status === "closed" && period.close_notes ? <p className="mt-2 text-xs text-neutral-500">Close note: {period.close_notes}</p> : null}
                    {period.reopened_at && period.reopen_reason ? <p className="mt-1 text-xs text-amber-700">Last reopened: {period.reopen_reason}</p> : null}
                  </div>
                  {period.status === "open" ? (
                    <button disabled={saving} onClick={() => openPeriodAction("close", period)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><LockKeyhole className="size-4" /> Close period</button>
                  ) : (
                    <button disabled={saving} onClick={() => openPeriodAction("reopen", period)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-40"><RotateCcw className="size-4" /> Reopen</button>
                  )}
                </div>
              ))}
              {periodsLoaded && !periods.length ? <div className="px-6 py-14 text-center text-sm text-neutral-400"><LockKeyhole className="mx-auto mb-3 size-6" />No accounting periods yet.</div> : null}
            </div>
          </Surface>
        </>
      ) : null}

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Accounting control</p>
                <h2 className="mt-1 text-xl font-semibold text-neutral-950">{modal === "recurring" ? "New recurring expense" : modal === "period" ? "New accounting period" : modal === "post" ? "Post recurring expense" : periodAction?.type === "close" ? "Close accounting period" : "Reopen accounting period"}</h2>
              </div>
              <button onClick={() => { setModal(null); setSelected(null); setPeriodAction(null); setPostPayload(null); }} disabled={saving} className="rounded-lg p-2 hover:bg-neutral-100 disabled:opacity-40" aria-label="Close"><X className="size-5" /></button>
            </div>

            {modal === "recurring" ? (
              <form onSubmit={createRecurring} className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Schedule name"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={input} /></Field>
                <Field label="Description"><input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={input} /></Field>
                <SearchableSelect label="Category" name="category" value={form.category_id} onValueChange={(value) => setForm({ ...form, category_id: value })} options={categoryOptions} required />
                <SearchableSelect label="Paid from account" name="account" value={form.account_id} onValueChange={(value) => { const account = meta.accounts.find((item) => item.id === value); setForm({ ...form, account_id: value, expense_currency: account?.currency ?? form.expense_currency }); }} options={accountOptions} required />
                <SearchableSelect label="Vendor" name="vendor" value={form.vendor_id} onValueChange={(value) => setForm({ ...form, vendor_id: value })} options={vendorOptions} />
                <SearchableSelect label="Payment method" name="payment_method" value={form.payment_method} onValueChange={(value) => setForm({ ...form, payment_method: value })} options={paymentMethodOptions} required />
                <SearchableSelect label="Client" name="client" value={form.client_id} onValueChange={(value) => setForm({ ...form, client_id: value, project_id: form.project_id && meta.projects.find((project) => project.id === form.project_id)?.client_id === value ? form.project_id : "" })} options={clientOptions} />
                <SearchableSelect label="Project" name="project" value={form.project_id} onValueChange={(value) => { const project = meta.projects.find((item) => item.id === value); setForm({ ...form, project_id: value, client_id: project?.client_id ?? form.client_id, expense_currency: project?.currency ?? form.expense_currency }); }} options={projectOptions} />
                <SearchableSelect label="Expense currency" name="currency" value={form.expense_currency} onValueChange={(value) => setForm({ ...form, expense_currency: value })} options={CURRENCY_OPTIONS} required />
                <Field label="Expense amount"><input required type="number" min="0.01" step="0.01" value={form.expense_amount} onChange={(event) => setForm({ ...form, expense_amount: event.target.value })} className={input} /></Field>
                <SearchableSelect label="Frequency" name="frequency" value={form.frequency} onValueChange={(value) => setForm({ ...form, frequency: value })} options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "yearly", label: "Yearly" }]} required />
                <Field label="Every N periods"><input required type="number" min="1" max="120" value={form.interval_count} onChange={(event) => setForm({ ...form, interval_count: event.target.value })} className={input} /></Field>
                <Field label="Next due date"><input required type="date" value={form.next_due_date} onChange={(event) => setForm({ ...form, next_due_date: event.target.value })} className={input} /></Field>
                <Field label="End date"><input type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} className={input} /></Field>
                <Field label={`Tax amount (${form.expense_currency})`}><input type="number" min="0" step="0.01" value={form.tax_amount} onChange={(event) => setForm({ ...form, tax_amount: event.target.value })} className={input} /></Field>
                <Field label="Reference"><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} className={input} /></Field>
                <label className="text-sm font-medium text-neutral-600 md:col-span-2">Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={textarea} /></label>
                {selectedAccount && selectedAccount.currency !== form.expense_currency ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 md:col-span-2">Account currency is {selectedAccount.currency} while expense currency is {form.expense_currency}. Actual account deduction must be supplied when the expense is posted.</p> : null}
                {formProfitabilityCurrency !== form.expense_currency ? <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 md:col-span-2">Project/client profitability is reported in {formProfitabilityCurrency}. The actual profitability amount must be supplied when posting this {form.expense_currency} cost.</p> : null}
                <div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setModal(null)} className="rounded-xl border px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={saving} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Creating…" : "Create schedule"}</button></div>
              </form>
            ) : null}

            {modal === "period" ? (
              <form onSubmit={createPeriod} className="mt-5 space-y-4">
                <Field label="Period name"><input name="name" required className={input} placeholder="September 2026" /></Field>
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Start date"><input name="start_date" type="date" required className={input} /></Field><Field label="End date"><input name="end_date" type="date" required className={input} /></Field></div>
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-500">Accounting periods cannot overlap. Creating a period does not lock it; only the explicit Close action blocks financial posting for that date range.</div>
                <button disabled={saving} className="w-full rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Create period</button>
              </form>
            ) : null}

            {modal === "post" && selected ? (
              <form onSubmit={reviewRecurringPost} className="mt-5 space-y-4">
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"><p className="font-semibold text-neutral-900">{selected.name}</p><p className="mt-1 text-sm text-neutral-500">Scheduled {money(selected.expense_amount, selected.expense_currency)} · paid from {selected.account_name} ({selected.account_currency})</p></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Expense date"><input name="expense_date" type="date" defaultValue={selected.next_due_date} className={input} /></Field>
                  <Field label={`Expense amount (${selected.expense_currency})`}><input name="expense_amount" type="number" min="0.01" step="0.01" defaultValue={String(selected.expense_amount)} className={input} /></Field>
                  {selected.account_currency !== selected.expense_currency ? <Field label={`Actual account deduction (${selected.account_currency})`}><input name="account_amount" required type="number" min="0.01" step="0.01" className={input} placeholder="Actual amount deducted" /></Field> : <input type="hidden" name="account_amount" value="" />}
                  {selectedProfitabilityCurrency && selectedProfitabilityCurrency !== selected.expense_currency ? <Field label={`Profitability amount (${selectedProfitabilityCurrency})`}><input name="profitability_amount" required type="number" min="0.01" step="0.01" className={input} placeholder="Cost in project/client currency" /></Field> : <input type="hidden" name="profitability_amount" value="" />}
                  <Field label="Reference"><input name="reference" defaultValue={selected.reference ?? ""} className={input} /></Field>
                </div>
                <Field label="Notes"><textarea name="notes" defaultValue={selected.notes ?? ""} className={textarea} /></Field>
                {(selected.account_currency !== selected.expense_currency || selectedProfitabilityCurrency !== selected.expense_currency) ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">Cross-currency values are captured separately. Business OS will not silently treat different currencies as equal.</div> : null}
                <button disabled={saving} className="w-full rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Review expense posting</button>
              </form>
            ) : null}

            {modal === "period_action" && periodAction ? (
              <form onSubmit={submitPeriodAction} className="mt-5 space-y-4">
                <div className={cn("rounded-xl border p-4", periodAction.type === "close" ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50")}>
                  <p className="font-semibold">{periodAction.period.name}</p>
                  <p className="mt-1 text-sm">{periodAction.period.start_date} → {periodAction.period.end_date}</p>
                  <p className="mt-2 text-xs leading-5">{periodAction.type === "close" ? "Closing locks manual journals and financial workflows from posting into this date range." : "Reopening permits financial posting into a previously locked historical period. The reason is mandatory and retained in the audit trail."}</p>
                </div>
                <Field label={periodAction.type === "close" ? "Closing note (optional)" : "Reopen reason (required)"}><textarea required={periodAction.type === "reopen"} minLength={periodAction.type === "reopen" ? 5 : undefined} value={periodActionNote} onChange={(event) => setPeriodActionNote(event.target.value)} className={textarea} placeholder={periodAction.type === "close" ? "Month-end checks completed" : "Explain why historical posting must be reopened"} /></Field>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setModal(null); setPeriodAction(null); }} className="rounded-xl border px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={saving || (periodAction.type === "reopen" && periodActionNote.trim().length < 5)} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Saving…" : periodAction.type === "close" ? "Close period" : "Reopen period"}</button></div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      <FinancialConfirmationDialog
        open={Boolean(postPayload && selected)}
        title="Post this recurring expense?"
        description="This creates a real posted expense and deducts the selected financial account through the existing accounting workflow."
        details={selected && postPayload ? [
          { label: "Schedule", value: selected.name },
          { label: "Expense date", value: postPayload.expense_date ?? selected.next_due_date },
          { label: "Expense", value: money(postPayload.expense_amount ?? selected.expense_amount, selected.expense_currency), emphasis: true },
          ...(selected.account_currency !== selected.expense_currency ? [{ label: "Account deduction", value: money(postPayload.account_amount ?? 0, selected.account_currency), emphasis: true }] : []),
          ...(selectedProfitabilityCurrency && selectedProfitabilityCurrency !== selected.expense_currency ? [{ label: "Profitability cost", value: money(postPayload.profitability_amount ?? 0, selectedProfitabilityCurrency) }] : []),
          { label: "Paid from", value: `${selected.account_name} · ${selected.account_currency}` },
        ] : []}
        confirmLabel="Post expense"
        loading={saving}
        warning="Posted financial records are auditable. If the expense is wrong later, correct it through the financial correction workflow rather than silently editing historical accounting."
        onCancel={() => setPostPayload(null)}
        onConfirm={postRecurring}
      />
    </AppPage>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Surface className="p-4"><p className="text-xs font-medium text-neutral-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">{value}</p><p className="mt-1 text-xs leading-5 text-neutral-400">{detail}</p></Surface>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm font-medium text-neutral-600">{label}{children}</label>;
}
