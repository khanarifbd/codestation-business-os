"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  Eye,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { CursorPager } from "@/components/cursor-pager";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { SearchableSelect } from "@/components/searchable-select";
import { confirmDiscardChanges, useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type Account = {
  id: string;
  name: string;
  account_type: string;
  provider_name: string | null;
  currency: string;
  current_balance: string | number;
  is_active: boolean;
};

type Transfer = {
  id: string;
  transfer_number: string;
  from_account_id: string;
  from_account_name: string;
  to_account_id: string;
  to_account_name: string;
  transfer_date: string;
  source_currency: string;
  destination_currency: string;
  source_amount: string | number;
  fee_amount: string | number;
  net_source_amount: string | number;
  destination_amount: string | number;
  exchange_rate: string | number;
  reference: string | null;
  notes: string | null;
  status: string;
  created_at: string;
};

type TransferPage = { items: Transfer[]; next_cursor: string | null };
type FormState = {
  from_account_id: string;
  to_account_id: string;
  transfer_date: string;
  source_amount: string;
  fee_amount: string;
  destination_amount: string;
  reference: string;
  notes: string;
};

const initialForm: FormState = {
  from_account_id: "",
  to_account_id: "",
  transfer_date: "",
  source_amount: "",
  fee_amount: "0",
  destination_amount: "",
  reference: "",
  notes: "",
};

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fxText(transfer: Transfer) {
  return transfer.source_currency === transfer.destination_currency
    ? "1.00000000"
    : `1 ${transfer.source_currency} = ${Number(transfer.exchange_rate).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${transfer.destination_currency}`;
}

export default function TransfersPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [search, setSearch] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [pageSize, setPageSize] = useState(20);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);

  const page = cursorStack.length;
  const currentCursor = cursorStack[cursorStack.length - 1];

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/finance${path}`, init);
    if (response.status === 401) {
      router.replace("/login");
      throw new Error("Authentication required");
    }
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(getApiErrorMessage(payload, "Finance request failed."));
    return payload;
  }, [router]);

  const loadAccounts = useCallback(async () => {
    setAccounts(await api("/accounts") as Account[]);
  }, [api]);

  const loadPage = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (cursor) params.set("cursor", cursor);
      if (search.trim()) params.set("search", search.trim());
      if (currencyFilter !== "all") params.set("currency", currencyFilter);
      const pageData = await api(`/transfer-page?${params.toString()}`) as TransferPage;
      setTransfers(pageData.items);
      setNextCursor(pageData.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load transfers.");
    } finally {
      setLoading(false);
    }
  }, [api, pageSize, search, currencyFilter]);

  useEffect(() => {
    void loadAccounts().catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load accounts."));
  }, [loadAccounts]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPage(currentCursor), 250);
    return () => window.clearTimeout(timer);
  }, [loadPage, currentCursor]);

  function resetPaging() {
    setCursorStack([null]);
    setNextCursor(null);
  }

  function changeFilter(action: () => void) {
    action();
    resetPaging();
  }

  const source = useMemo(
    () => accounts.find((item) => item.id === form.from_account_id) ?? null,
    [accounts, form.from_account_id],
  );
  const destination = useMemo(
    () => accounts.find((item) => item.id === form.to_account_id) ?? null,
    [accounts, form.to_account_id],
  );
  const sourceAmount = Number(form.source_amount || 0);
  const feeAmount = Number(form.fee_amount || 0);
  const netSource = Math.max(0, sourceAmount - feeAmount);
  const sameCurrency = Boolean(source && destination && source.currency === destination.currency);
  const crossCurrency = Boolean(source && destination && !sameCurrency);
  const receivedAmount = sameCurrency ? netSource : Number(form.destination_amount || 0);
  const effectiveRate = netSource > 0 && receivedAmount > 0 ? receivedAmount / netSource : 0;
  const sourceBalance = Number(source?.current_balance || 0);
  const insufficientBalance = Boolean(source && sourceAmount > sourceBalance);
  const activeAccounts = useMemo(() => accounts.filter((item) => item.is_active), [accounts]);
  const currencies = useMemo(() => Array.from(new Set(accounts.map((item) => item.currency))).sort(), [accounts]);
  const groupedAccounts = useMemo(() => {
    const groups = new Map<string, Account[]>();
    for (const account of accounts) {
      const group = groups.get(account.currency) ?? [];
      group.push(account);
      groups.set(account.currency, group);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [accounts]);
  const isDirty = modalOpen && Boolean(
    form.from_account_id
      || form.to_account_id
      || form.transfer_date
      || form.source_amount
      || form.destination_amount
      || form.reference
      || form.notes
      || Number(form.fee_amount || 0) > 0,
  );

  useUnsavedChanges(isDirty && !saving);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openTransfer(sourceId?: string) {
    const firstSource = sourceId || accounts.find((item) => item.is_active && Number(item.current_balance) > 0)?.id || "";
    setForm({ ...initialForm, from_account_id: firstSource });
    setError(null);
    setMessage(null);
    setConfirmOpen(false);
    setModalOpen(true);
  }

  function closeTransfer() {
    if (!confirmDiscardChanges(isDirty, "Discard this transfer before posting?")) return;
    setConfirmOpen(false);
    setModalOpen(false);
    setForm(initialForm);
  }

  function reviewTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source || !destination) return;
    if (insufficientBalance) {
      setError(`The source account only has ${money(source.current_balance, source.currency)} available. Reduce the total deducted amount before posting.`);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function postTransfer() {
    if (!source || !destination) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api("/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_account_id: source.id,
          to_account_id: destination.id,
          transfer_date: form.transfer_date || null,
          source_amount: form.source_amount,
          fee_amount: form.fee_amount || "0",
          destination_amount: sameCurrency ? null : form.destination_amount,
          reference: form.reference || null,
          notes: form.notes || null,
        }),
      }) as Transfer;

      setAccounts((current) => current.map((account) => account.id === created.from_account_id
        ? { ...account, current_balance: Number(account.current_balance) - Number(created.source_amount) }
        : account.id === created.to_account_id
          ? { ...account, current_balance: Number(account.current_balance) + Number(created.destination_amount) }
          : account));
      setConfirmOpen(false);
      setModalOpen(false);
      setForm(initialForm);
      setMessage(`Transfer ${created.transfer_number} recorded. Account balances and ledgers were updated without creating business income or expense from the transferred principal.`);
      resetPaging();
      await loadPage(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to record transfer.");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const sourceOptions = accounts
    .filter((item) => item.is_active && item.id !== form.to_account_id)
    .map((item) => ({
      value: item.id,
      label: `${item.name} · ${money(item.current_balance, item.currency)}`,
      keywords: `${item.name} ${item.currency} ${item.account_type} ${item.provider_name ?? ""}`,
    }));
  const destinationOptions = accounts
    .filter((item) => item.is_active && item.id !== form.from_account_id)
    .map((item) => ({
      value: item.id,
      label: `${item.name} · ${item.currency}`,
      keywords: `${item.name} ${item.currency} ${item.account_type} ${item.provider_name ?? ""}`,
    }));
  const activeFilters = Boolean(search || currencyFilter !== "all");
  const reviewDisabled = saving
    || !source
    || !destination
    || sourceAmount <= 0
    || feeAmount < 0
    || feeAmount >= sourceAmount
    || insufficientBalance
    || (!sameCurrency && receivedAmount <= 0);

  const confirmationDetails = [
    { label: "From account", value: source?.name || "—" },
    { label: "To account", value: destination?.name || "—" },
    { label: "Total deducted", value: source ? money(sourceAmount, source.currency) : "—", emphasis: true },
    { label: "Transfer fee", value: source ? money(feeAmount, source.currency) : "—" },
    { label: "Net transferred", value: source ? money(netSource, source.currency) : "—" },
    { label: "Actual received", value: destination ? money(receivedAmount, destination.currency) : "—", emphasis: true },
    {
      label: "Effective FX",
      value: source && destination && effectiveRate > 0
        ? (sameCurrency ? "1.00000000" : `1 ${source.currency} = ${effectiveRate.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${destination.currency}`)
        : "—",
    },
    { label: "Date", value: form.transfer_date || "Today / posting date" },
    ...(form.reference ? [{ label: "Reference", value: form.reference }] : []),
  ];

  async function retryLoad() {
    setError(null);
    try {
      await Promise.all([loadAccounts(), loadPage(currentCursor)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load transfers.");
    }
  }

  return (
    <AppPage width="wide">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounts"
          title="Transfers"
          description="Move money between your own financial accounts without treating the transfer principal as business income or expense. Same-currency and FX movements keep their original amounts, fees and conversion details traceable."
          actions={
            <button
              type="button"
              onClick={() => openTransfer()}
              disabled={activeAccounts.length < 2}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-4" /> New transfer
            </button>
          }
          meta={
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1"><ShieldCheck className="size-3.5 text-emerald-600" /> Principal is not revenue or expense</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1"><WalletCards className="size-3.5" /> Source and destination currencies stay explicit</span>
            </>
          }
        />

        {error && !modalOpen ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => void retryLoad()} className="inline-flex items-center gap-2 self-start rounded-xl border border-red-200 bg-white px-3 py-2 font-medium text-red-700 sm:self-auto">
              <RefreshCw className="size-4" /> Retry
            </button>
          </div>
        ) : null}

        {message ? (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Active accounts</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-950">{accounts.length ? activeAccounts.length : "—"}</p>
            <p className="mt-1 text-xs text-neutral-500">Available transfer endpoints</p>
          </Surface>
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Account currencies</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-950">{accounts.length ? currencies.length : "—"}</p>
            <p className="mt-1 text-xs text-neutral-500">Never silently combined</p>
          </Surface>
          <Surface className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">History page</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-950">{loading ? "—" : transfers.length}</p>
            <p className="mt-1 text-xs text-neutral-500">Transfers currently shown</p>
          </Surface>
        </section>

        <Surface className="overflow-hidden">
          <div className="border-b border-neutral-100 p-5 sm:p-6">
            <SectionHeader
              title="Move money from an account"
              description="Balances are shown in each account's own currency. Choose a source account to start a controlled internal transfer."
            />
          </div>

          {!accounts.length && loading ? (
            <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-44 animate-pulse rounded-2xl border border-neutral-100 bg-neutral-50" />
              ))}
            </div>
          ) : !accounts.length ? (
            <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center">
              <WalletCards className="size-7 text-neutral-300" />
              <p className="mt-3 font-semibold text-neutral-950">No financial accounts available</p>
              <p className="mt-1 max-w-md text-sm text-neutral-500">Create at least two accounts before recording an internal transfer.</p>
            </div>
          ) : (
            <div className="space-y-6 p-5 sm:p-6">
              {groupedAccounts.map(([currency, currencyAccounts]) => (
                <div key={currency}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">{currency}</p>
                      <p className="mt-1 text-sm text-neutral-500">{currencyAccounts.length} account{currencyAccounts.length === 1 ? "" : "s"} in this currency</p>
                    </div>
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600">Separate balance group</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {currencyAccounts.map((account) => (
                      <article key={account.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-semibold text-neutral-950">{account.name}</p>
                              {!account.is_active ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">Inactive</span> : null}
                            </div>
                            <p className="mt-1 text-xs text-neutral-400">{pretty(account.account_type)}{account.provider_name ? ` · ${account.provider_name}` : ""}</p>
                          </div>
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500"><Building2 className="size-4" /></div>
                        </div>
                        <p className="mt-5 text-xs text-neutral-400">Current balance</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-950">{money(account.current_balance, account.currency)}</p>
                        <button
                          type="button"
                          disabled={!account.is_active || Number(account.current_balance) <= 0 || activeAccounts.length < 2}
                          onClick={() => openTransfer(account.id)}
                          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowRightLeft className="size-4" /> Transfer from this account
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>

        <Surface className="overflow-hidden">
          <div className="border-b border-neutral-100 p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <SectionHeader
                title="Transfer history"
                description="Search posted transfers while keeping source amount, fees, destination amount and FX visible."
              />
              <span className="text-xs text-neutral-400">{transfers.length} shown on page {page}</span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
              <input
                value={search}
                onChange={(event) => changeFilter(() => setSearch(event.target.value))}
                placeholder="Search transfer, account or reference…"
                className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
              />
              <select
                value={currencyFilter}
                onChange={(event) => changeFilter(() => setCurrencyFilter(event.target.value))}
                className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
              >
                <option value="all">All currencies</option>
                {currencies.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
              {activeFilters ? (
                <button type="button" onClick={() => { setSearch(""); setCurrencyFilter("all"); resetPaging(); }} className="rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Clear filters</button>
              ) : <span />}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3 p-5 sm:p-6">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-2xl bg-neutral-50" />)}
            </div>
          ) : transfers.length ? (
            <>
              <div className="divide-y divide-neutral-100 lg:hidden">
                {transfers.map((item) => (
                  <button key={item.id} type="button" onClick={() => setSelectedTransfer(item)} className="block w-full p-4 text-left transition hover:bg-neutral-50 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-neutral-950">{item.transfer_number}</p>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                          <span className="truncate">{item.from_account_name}</span>
                          <ArrowRight className="size-3 shrink-0 text-neutral-300" />
                          <span className="truncate">{item.to_account_name}</span>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-neutral-400">{item.transfer_date}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-neutral-50 p-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-neutral-400">Deducted</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-neutral-950">{money(item.source_amount, item.source_currency)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wide text-neutral-400">Received</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-neutral-950">{money(item.destination_amount, item.destination_currency)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                      <span>Fee: {money(item.fee_amount, item.source_currency)}</span>
                      <span>{item.source_currency === item.destination_currency ? "Same currency" : fxText(item)}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1180px] text-left text-sm">
                  <thead className="border-b border-neutral-100 bg-neutral-50/70 text-[11px] uppercase tracking-[0.08em] text-neutral-400">
                    <tr>
                      <th className="px-5 py-3.5 font-medium">Transfer</th>
                      <th className="px-3 py-3.5 font-medium">Route</th>
                      <th className="px-3 py-3.5 font-medium">Date</th>
                      <th className="px-3 py-3.5 font-medium">Deducted</th>
                      <th className="px-3 py-3.5 font-medium">Fee</th>
                      <th className="px-3 py-3.5 font-medium">Net source</th>
                      <th className="px-3 py-3.5 font-medium">Received</th>
                      <th className="px-3 py-3.5 font-medium">Effective rate</th>
                      <th className="px-3 py-3.5 font-medium">Reference</th>
                      <th className="px-5 py-3.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {transfers.map((item) => (
                      <tr key={item.id} className="transition hover:bg-neutral-50/70">
                        <td className="px-5 py-4"><button type="button" onClick={() => setSelectedTransfer(item)} className="font-semibold text-neutral-950 hover:underline">{item.transfer_number}</button></td>
                        <td className="px-3 py-4"><div className="flex items-center gap-2"><span>{item.from_account_name}</span><ArrowRight className="size-3.5 text-neutral-300" /><span>{item.to_account_name}</span></div></td>
                        <td className="px-3 py-4 text-neutral-500">{item.transfer_date}</td>
                        <td className="px-3 py-4 tabular-nums">{money(item.source_amount, item.source_currency)}</td>
                        <td className={cn("px-3 py-4 tabular-nums", Number(item.fee_amount) > 0 ? "font-medium text-amber-700" : "text-neutral-400")}>{money(item.fee_amount, item.source_currency)}</td>
                        <td className="px-3 py-4 tabular-nums">{money(item.net_source_amount, item.source_currency)}</td>
                        <td className="px-3 py-4 font-semibold tabular-nums text-neutral-950">{money(item.destination_amount, item.destination_currency)}</td>
                        <td className="px-3 py-4 text-xs text-neutral-600">{fxText(item)}</td>
                        <td className="max-w-44 truncate px-3 py-4 text-neutral-500">{item.reference || "—"}</td>
                        <td className="px-5 py-4 text-right"><button type="button" onClick={() => setSelectedTransfer(item)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium hover:bg-white"><Eye className="size-3.5" /> Open</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center">
              <ReceiptText className="size-7 text-neutral-300" />
              <p className="mt-3 font-semibold text-neutral-950">No matching transfers</p>
              <p className="mt-1 text-sm text-neutral-400">Change the search or filters, or record the first account transfer.</p>
            </div>
          )}

          <CursorPager
            page={page}
            pageSize={pageSize}
            shownCount={transfers.length}
            hasPrevious={cursorStack.length > 1}
            hasNext={Boolean(nextCursor)}
            loading={loading}
            onPrevious={() => setCursorStack((stack) => stack.length > 1 ? stack.slice(0, -1) : stack)}
            onNext={() => { if (nextCursor) setCursorStack((stack) => [...stack, nextCursor]); }}
            onPageSizeChange={(value) => { setPageSize(value); resetPaging(); }}
          />
        </Surface>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-4">
          <form onSubmit={reviewTransfer} className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-neutral-100 bg-white/95 p-5 backdrop-blur sm:p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Internal movement</p>
                <h2 className="mt-1 text-xl font-semibold text-neutral-950">Record account transfer</h2>
                <p className="mt-1 max-w-2xl text-sm text-neutral-500">Enter the exact deducted and received amounts from the bank, wallet or provider statement. The transferred principal never becomes revenue or expense.</p>
              </div>
              <button type="button" onClick={closeTransfer} className="rounded-xl p-2 text-neutral-500 transition hover:bg-neutral-100"><X className="size-5" /></button>
            </div>

            <div className="grid xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6 p-5 sm:p-6">
                {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

                <div>
                  <SectionHeader title="1. Transfer route" description="Choose two different organization-owned financial accounts." />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <SearchableSelect
                        label="From account"
                        required
                        clearable={false}
                        value={form.from_account_id}
                        onValueChange={(value) => updateForm("from_account_id", value)}
                        options={sourceOptions}
                        searchPlaceholder="Search source account..."
                      />
                      {source ? <Hint>Available balance: {money(source.current_balance, source.currency)}</Hint> : null}
                    </div>
                    <div>
                      <SearchableSelect
                        label="To account"
                        required
                        clearable={false}
                        value={form.to_account_id}
                        onValueChange={(value) => updateForm("to_account_id", value)}
                        options={destinationOptions}
                        searchPlaceholder="Search destination account..."
                      />
                      {destination ? <Hint>Destination currency: {destination.currency}</Hint> : null}
                    </div>
                  </div>

                  {source && destination ? (
                    <div className={cn(
                      "mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
                      crossCurrency ? "border-blue-200 bg-blue-50 text-blue-900" : "border-neutral-200 bg-neutral-50 text-neutral-700",
                    )}>
                      <ArrowRightLeft className="mt-0.5 size-4 shrink-0" />
                      <div>
                        <p className="font-semibold">{crossCurrency ? `${source.currency} → ${destination.currency} cross-currency transfer` : `${source.currency} same-currency transfer`}</p>
                        <p className="mt-1 text-xs leading-5 opacity-80">{crossCurrency ? "Enter the exact amount received in the destination currency. Business OS preserves both amounts and the effective FX rate." : "The destination receives the net transferred amount automatically after any transfer fee."}</p>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-neutral-100 pt-6">
                  <SectionHeader title="2. Amounts" description="Source amount includes any transfer fee. Net transferred is the amount left after the fee." />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label={`Total deducted${source ? ` (${source.currency})` : ""}`}>
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={form.source_amount}
                        onChange={(event) => updateForm("source_amount", event.target.value)}
                        className={inputClass(insufficientBalance)}
                      />
                      {insufficientBalance && source ? <Hint tone="danger">Exceeds current source balance of {money(source.current_balance, source.currency)}.</Hint> : null}
                    </Field>
                    <Field label={`Transfer fee${source ? ` (${source.currency})` : ""}`}>
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.fee_amount}
                        onChange={(event) => updateForm("fee_amount", event.target.value)}
                        className={inputClass(false)}
                      />
                      <Hint>Fee stays separately visible from the transferred principal.</Hint>
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label={`Actual received${destination ? ` (${destination.currency})` : ""}`}>
                        <input
                          required={!sameCurrency}
                          readOnly={sameCurrency}
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={sameCurrency ? (netSource > 0 ? netSource.toFixed(2) : "") : form.destination_amount}
                          onChange={(event) => updateForm("destination_amount", event.target.value)}
                          className={cn(inputClass(false), "read-only:bg-neutral-50 read-only:text-neutral-600")}
                        />
                        <Hint>{sameCurrency ? "Calculated automatically as total deducted minus transfer fee." : "Use the exact amount credited to the destination account."}</Hint>
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="border-t border-neutral-100 pt-6">
                  <SectionHeader title="3. Statement details" description="Optional reference and notes make reconciliation and audit review easier." />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Transfer date">
                      <input type="date" value={form.transfer_date} onChange={(event) => updateForm("transfer_date", event.target.value)} className={inputClass(false)} />
                      <Hint>Leave blank to use the posting date.</Hint>
                    </Field>
                    <Field label="Reference">
                      <input value={form.reference} onChange={(event) => updateForm("reference", event.target.value)} placeholder="Provider / bank reference" className={inputClass(false)} />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Internal notes">
                        <textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} rows={3} className={cn(inputClass(false), "h-auto py-2.5")} placeholder="Optional reconciliation or internal context…" />
                      </Field>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="border-t border-neutral-100 bg-neutral-50/70 p-5 sm:p-6 xl:border-l xl:border-t-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Posting preview</p>
                <div className="mt-4 space-y-3">
                  <Preview label="From" value={source?.name || "Select source"} />
                  <Preview label="To" value={destination?.name || "Select destination"} />
                  <Preview label="Total deducted" value={source && sourceAmount > 0 ? money(sourceAmount, source.currency) : "—"} />
                  <Preview label="Fee" value={source ? money(feeAmount, source.currency) : "—"} />
                  <Preview label="Net transferred" value={source && netSource > 0 ? money(netSource, source.currency) : "—"} />
                  <Preview label="Actual received" value={destination && receivedAmount > 0 ? money(receivedAmount, destination.currency) : "—"} />
                  <Preview label="Effective FX" value={source && destination && effectiveRate > 0 ? (sameCurrency ? "1.00000000" : `1 ${source.currency} = ${effectiveRate.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${destination.currency}`) : "—"} />
                  {source && sourceAmount > 0 ? <Preview label="Source balance after" value={money(sourceBalance - sourceAmount, source.currency)} danger={insufficientBalance} /> : null}
                </div>
                <div className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4 text-xs leading-5 text-neutral-600">
                  <p className="font-semibold text-neutral-900">Accounting treatment</p>
                  <p className="mt-1">The transfer principal only moves value between your own accounts. It does not create sales income or operating expense. Fees and FX remain traceable in the posted transaction.</p>
                </div>
              </aside>
            </div>

            <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-neutral-100 bg-white/95 p-4 backdrop-blur sm:flex-row sm:justify-end sm:p-5">
              <button type="button" onClick={closeTransfer} className="rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">Cancel</button>
              <button disabled={reviewDisabled} className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                <ArrowRightLeft className="size-4" /> Review transfer
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {selectedTransfer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-neutral-100 bg-white/95 p-5 backdrop-blur sm:p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Transfer detail</p>
                <h2 className="mt-1 text-2xl font-semibold text-neutral-950">{selectedTransfer.transfer_number}</h2>
                <p className="mt-1 text-sm text-neutral-500">{selectedTransfer.from_account_name} → {selectedTransfer.to_account_name}</p>
              </div>
              <button type="button" onClick={() => setSelectedTransfer(null)} className="rounded-xl p-2 text-neutral-500 transition hover:bg-neutral-100"><X className="size-5" /></button>
            </div>

            <div className="p-5 sm:p-6">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-neutral-400">Total deducted</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-950">{money(selectedTransfer.source_amount, selectedTransfer.source_currency)}</p>
                  </div>
                  <ArrowRight className="size-5 text-neutral-300" />
                  <div className="text-right">
                    <p className="text-xs text-neutral-400">Actual received</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-950">{money(selectedTransfer.destination_amount, selectedTransfer.destination_currency)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Detail label="Status" value={pretty(selectedTransfer.status)} />
                <Detail label="Transfer date" value={selectedTransfer.transfer_date} />
                <Detail label="From account" value={selectedTransfer.from_account_name} />
                <Detail label="To account" value={selectedTransfer.to_account_name} />
                <Detail label="Transfer fee" value={money(selectedTransfer.fee_amount, selectedTransfer.source_currency)} />
                <Detail label="Net source" value={money(selectedTransfer.net_source_amount, selectedTransfer.source_currency)} />
                <Detail label="Effective FX" value={fxText(selectedTransfer)} />
                <Detail label="Reference" value={selectedTransfer.reference || "—"} />
                <Detail label="Created" value={selectedTransfer.created_at || "—"} />
              </div>

              {selectedTransfer.notes ? (
                <div className="mt-4 rounded-2xl bg-neutral-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Notes</p>
                  <p className="mt-2 text-sm leading-6 text-neutral-700">{selectedTransfer.notes}</p>
                </div>
              ) : null}

              <div className="mt-5 rounded-2xl border border-neutral-200 p-4 text-sm text-neutral-500">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <div>
                    <p className="font-medium text-neutral-900">Posted financial record</p>
                    <p className="mt-1 leading-6">This movement is part of the audit trail. Correct mistakes with the controlled reversal/correction flow instead of silently changing posted history.</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button type="button" onClick={() => setSelectedTransfer(null)} className="rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Close</button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <FinancialConfirmationDialog
        open={confirmOpen}
        title="Post account transfer?"
        description="Check both accounts and the exact deducted and received amounts. This action updates both account ledgers without recognizing the transferred principal as business income or expense."
        details={confirmationDetails}
        confirmLabel="Post transfer"
        loading={saving}
        warning="After posting, do not edit financial history silently. Use a reversal/correction if the transfer was entered incorrectly."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={postTransfer}
      />
    </AppPage>
  );
}

function inputClass(danger: boolean) {
  return cn(
    "mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm font-normal outline-none transition focus:ring-2",
    danger
      ? "border-red-300 focus:border-red-400 focus:ring-red-100"
      : "border-neutral-200 focus:border-neutral-400 focus:ring-neutral-100",
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm"><span className="block font-medium text-neutral-700">{label}</span>{children}</label>;
}

function Hint({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "danger" }) {
  return <span className={cn("mt-1.5 block text-xs font-normal", tone === "danger" ? "text-red-600" : "text-neutral-400")}>{children}</span>;
}

function Preview({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold tabular-nums", danger ? "text-red-700" : "text-neutral-900")}>{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-neutral-900">{value}</p>
    </div>
  );
}
