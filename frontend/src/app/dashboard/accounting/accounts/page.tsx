"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  CircleAlert,
  CreditCard,
  Landmark,
  Link2,
  LoaderCircle,
  Plus,
  Smartphone,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";

import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { CURRENCY_OPTIONS } from "@/lib/company-options";
import { cn } from "@/lib/cn";

type Account = {
  id: string;
  name: string;
  account_type: string;
  provider_name: string | null;
  account_holder_name: string | null;
  account_reference: string | null;
  currency: string;
  opening_balance: string;
  current_balance: string;
  is_active: boolean;
  notes: string | null;
};

type AccountType = "bank" | "cash" | "mobile_wallet" | "credit_card" | "payment_gateway" | "petty_cash" | "other";

type AccountTypeOption = {
  value: AccountType;
  label: string;
  help: string;
  icon: LucideIcon;
};

const accountTypes: AccountTypeOption[] = [
  { value: "bank", label: "Bank account", help: "Business current, savings or settlement account", icon: Landmark },
  { value: "cash", label: "Cash", help: "Physical cash held by the business", icon: WalletCards },
  { value: "mobile_wallet", label: "Mobile wallet", help: "bKash, Nagad, Rocket or similar wallet", icon: Smartphone },
  { value: "credit_card", label: "Credit card", help: "Company credit card. Opening balance means the amount currently owed.", icon: CreditCard },
  { value: "payment_gateway", label: "Payment gateway", help: "Stripe, PayPal, Payoneer, Wise or gateway balance", icon: Building2 },
  { value: "petty_cash", label: "Petty cash", help: "Small day-to-day expense cash", icon: WalletCards },
  { value: "other", label: "Other", help: "Any other business financial account", icon: WalletCards },
];

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-4 focus:ring-neutral-100";

const blankForm = () => ({
  name: "",
  account_type: "bank" as AccountType,
  provider_name: "",
  account_holder_name: "",
  account_reference: "",
  currency: "BDT",
  opening_balance: "0",
  notes: "",
  payment_url: "",
  payment_instructions: "",
});

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function accountType(value: string) {
  return accountTypes.find((item) => item.value === value);
}

function typeLabel(value: string) {
  return accountType(value)?.label ?? value.replaceAll("_", " ");
}

function AccountTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = accountType(type)?.icon ?? WalletCards;
  return <Icon className={className} />;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/finance/accounts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Could not load accounts");
      setAccounts(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAccounts = useMemo(() => accounts.filter((account) => account.is_active), [accounts]);

  const availableTotals = useMemo(() => {
    const result = new Map<string, number>();
    for (const account of activeAccounts.filter((item) => item.account_type !== "credit_card")) {
      result.set(account.currency, (result.get(account.currency) ?? 0) + Number(account.current_balance));
    }
    return [...result.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [activeAccounts]);

  const cardLiabilities = useMemo(() => {
    const result = new Map<string, number>();
    for (const account of activeAccounts.filter((item) => item.account_type === "credit_card")) {
      result.set(account.currency, (result.get(account.currency) ?? 0) + Number(account.current_balance));
    }
    return [...result.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [activeAccounts]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/accounting/financial-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          opening_balance: Number(form.opening_balance || 0),
          provider_name: form.provider_name || null,
          account_holder_name: form.account_holder_name || null,
          account_reference: form.account_reference || null,
          notes: form.notes || null,
          payment_url: form.payment_url || null,
          payment_instructions: form.payment_instructions || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Could not create account");
      setForm(blankForm());
      setShowForm(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create account");
    } finally {
      setSaving(false);
    }
  }

  function closeForm() {
    if (saving) return;
    setShowForm(false);
  }

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounts"
          title="Financial accounts"
          description="Manage the real places where your business keeps money or carries a financial balance. Each account has its own currency and ledger."
          actions={
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className={cn(
                "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition",
                showForm
                  ? "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                  : "bg-neutral-950 text-white shadow-sm hover:bg-neutral-800",
              )}
            >
              {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
              {showForm ? "Close form" : "Add account"}
            </button>
          }
        />


        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">{error}</div>
            <button type="button" onClick={() => void load()} className="shrink-0 font-semibold text-red-800 hover:underline">
              Retry
            </button>
          </div>
        ) : null}

        <section className="grid gap-3 lg:grid-cols-[0.8fr_1.6fr_1.2fr]">
          <Surface className="p-5">
            <p className="text-[13px] font-medium text-neutral-500">Active accounts</p>
            <div className="mt-4 flex items-end justify-between gap-4">
              <p className="text-3xl font-semibold tracking-tight text-neutral-950">{loading ? "—" : activeAccounts.length}</p>
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500">
                {loading ? "Loading" : `${accounts.length} total`}
              </span>
            </div>
          </Surface>

          <Surface className="p-5">
            <p className="text-[13px] font-medium text-neutral-500">Available money</p>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
              {loading ? (
                <div className="h-8 w-36 animate-pulse rounded-lg bg-neutral-100" />
              ) : availableTotals.length ? (
                availableTotals.map(([currency, value]) => (
                  <p key={currency} className="text-2xl font-semibold tracking-tight text-neutral-950 tabular-nums">
                    {money(value, currency)}
                  </p>
                ))
              ) : (
                <p className="text-2xl font-semibold text-neutral-950">No cash balance</p>
              )}
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-400">Currencies stay separate. Credit card liabilities are excluded from available money.</p>
          </Surface>

          <Surface className="p-5">
            <p className="text-[13px] font-medium text-neutral-500">Credit card liabilities</p>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
              {loading ? (
                <div className="h-8 w-32 animate-pulse rounded-lg bg-neutral-100" />
              ) : cardLiabilities.length ? (
                cardLiabilities.map(([currency, value]) => (
                  <p key={currency} className="text-2xl font-semibold tracking-tight text-neutral-950 tabular-nums">
                    {money(value, currency)}
                  </p>
                ))
              ) : (
                <p className="text-2xl font-semibold text-neutral-950">None</p>
              )}
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-400">Shown separately because card balances represent amounts owed, not available cash.</p>
          </Surface>
        </section>

        {showForm ? (
          <Surface className="overflow-hidden">
            <div className="border-b border-neutral-100 px-5 py-5 sm:px-6">
              <SectionHeader
                title="Add a financial account"
                description="Tell Business OS what this account is in real life. The backend will create the correct ledger mapping and opening-balance journal."
                action={
                  <button type="button" onClick={closeForm} disabled={saving} className="text-sm font-medium text-neutral-500 hover:text-neutral-950 disabled:opacity-50">
                    Cancel
                  </button>
                }
              />
            </div>

            <form onSubmit={submit} className="divide-y divide-neutral-100">
              <FormSection
                title="Account identity"
                description="Choose the account type, name and currency exactly as you use them in the business."
              >
                <Field label="Account type" hint={accountTypes.find((item) => item.value === form.account_type)?.help}>
                  <select
                    value={form.account_type}
                    onChange={(event) => setForm((value) => ({ ...value, account_type: event.target.value as AccountType }))}
                    className={inputClass}
                  >
                    {accountTypes.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Account name">
                  <input
                    required
                    value={form.name}
                    onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                    className={inputClass}
                    placeholder="City Bank Business Account"
                  />
                </Field>

                <SearchableSelect
                  label="Currency"
                  value={form.currency}
                  onValueChange={(currency) => setForm((value) => ({ ...value, currency }))}
                  options={CURRENCY_OPTIONS}
                  placeholder="Select currency"
                  searchPlaceholder="Search currency..."
                  required
                  clearable={false}
                />
              </FormSection>

              <FormSection
                title="Provider & ownership"
                description="Optional account identifiers help your team recognize the real-world account without storing private credentials."
              >
                <Field label="Bank / provider name">
                  <input
                    value={form.provider_name}
                    onChange={(event) => setForm((value) => ({ ...value, provider_name: event.target.value }))}
                    className={inputClass}
                    placeholder="City Bank / Payoneer / Stripe"
                  />
                </Field>

                <Field label="Account holder">
                  <input
                    value={form.account_holder_name}
                    onChange={(event) => setForm((value) => ({ ...value, account_holder_name: event.target.value }))}
                    className={inputClass}
                    placeholder="CodeStation AI"
                  />
                </Field>

                <Field label="Account / reference number">
                  <input
                    value={form.account_reference}
                    onChange={(event) => setForm((value) => ({ ...value, account_reference: event.target.value }))}
                    className={inputClass}
                    placeholder="Account number, email or wallet ID"
                  />
                </Field>
              </FormSection>

              <FormSection
                title="Opening position"
                description="Set the balance that already exists when this account starts being tracked in Business OS."
              >
                <Field
                  label={form.account_type === "credit_card" ? "Amount currently owed" : "Opening balance"}
                  hint={
                    form.account_type === "credit_card"
                      ? "Enter the amount already owed on the card."
                      : "Enter money already held in this account before Business OS starts tracking it."
                  }
                >
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-2.5 text-sm font-medium text-neutral-400">{form.currency}</span>
                    <input
                      type="number"
                      min={form.account_type === "credit_card" ? "0" : undefined}
                      step="0.01"
                      value={form.opening_balance}
                      onChange={(event) => setForm((value) => ({ ...value, opening_balance: event.target.value }))}
                      className={cn(inputClass, "pl-14 tabular-nums")}
                    />
                  </div>
                </Field>

                <Field label="Internal notes" hint="Visible to your team. Avoid passwords, PINs, API keys or card secrets.">
                  <input
                    value={form.notes}
                    onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))}
                    className={inputClass}
                    placeholder="Optional internal note"
                  />
                </Field>
              </FormSection>

              <FormSection
                title="Client payment details"
                description="Optional defaults for invoice payment instructions. These do not change the account ledger balance."
                columns="two"
              >
                <Field label="Default payment URL" hint="Can be prefilled on invoice payment instructions and converted to a QR code.">
                  <div className="relative">
                    <Link2 className="pointer-events-none absolute left-3 top-3 size-4 text-neutral-400" />
                    <input
                      type="url"
                      value={form.payment_url}
                      onChange={(event) => setForm((value) => ({ ...value, payment_url: event.target.value }))}
                      className={cn(inputClass, "pl-9")}
                      placeholder="https://pay.example.com/..."
                    />
                  </div>
                </Field>

                <Field label="Default client payment instructions" hint="Client-facing only. Never store private banking credentials here.">
                  <textarea
                    value={form.payment_instructions}
                    onChange={(event) => setForm((value) => ({ ...value, payment_instructions: event.target.value }))}
                    className={cn(inputClass, "min-h-24 resize-y")}
                    placeholder="Example: Use the invoice number as the payment reference."
                  />
                </Field>
              </FormSection>

              <div className="flex flex-col-reverse gap-3 bg-neutral-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  disabled={saving}
                  className="inline-flex h-10 min-w-40 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {saving ? "Creating…" : "Create account"}
                </button>
              </div>
            </form>
          </Surface>
        ) : null}

        <div className="space-y-4">
          <SectionHeader
            title="Your financial accounts"
            description="Open any account to review its ledger, opening balance and transaction history."
          />

          {loading ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Surface key={index} className="animate-pulse p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="size-11 rounded-xl bg-neutral-100" />
                    <div className="h-6 w-20 rounded-full bg-neutral-100" />
                  </div>
                  <div className="mt-5 h-4 w-40 rounded bg-neutral-100" />
                  <div className="mt-2 h-3 w-28 rounded bg-neutral-100" />
                  <div className="mt-6 h-8 w-44 rounded bg-neutral-100" />
                  <div className="mt-5 h-px bg-neutral-100" />
                  <div className="mt-4 h-4 w-full rounded bg-neutral-100" />
                </Surface>
              ))}
            </section>
          ) : accounts.length ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {accounts.map((account) => (
                <AccountCard key={account.id} account={account} />
              ))}
            </section>
          ) : (
            <Surface className="border-dashed px-6 py-12 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500">
                <WalletCards className="size-5" />
              </div>
              <p className="mt-4 font-semibold text-neutral-950">No financial account yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-neutral-500">
                Add your bank, cash, wallet, gateway or credit-card account to start tracking money through the ledger.
              </p>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-neutral-800"
              >
                <Plus className="size-4" />
                Add first account
              </button>
            </Surface>
          )}
        </div>
      </div>
    </AppPage>
  );
}

function AccountCard({ account }: { account: Account }) {
  const isLiability = account.account_type === "credit_card";

  return (
    <Link
      href={`/dashboard/accounting/accounts/${account.id}`}
      className={cn(
        "group rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]",
        !account.is_active && "bg-neutral-50/70 opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex size-11 items-center justify-center rounded-xl border border-neutral-100 bg-neutral-50 text-neutral-700">
          <AccountTypeIcon type={account.account_type} className="size-5" />
        </div>
        <div className="flex items-center gap-2">
          {!account.is_active ? <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-500">Inactive</span> : null}
          <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-500">{typeLabel(account.account_type)}</span>
        </div>
      </div>

      <div className="mt-5 min-w-0">
        <h3 className="truncate text-[15px] font-semibold text-neutral-950">{account.name}</h3>
        <p className="mt-1 truncate text-xs text-neutral-400">{account.provider_name || account.account_reference || "No provider or reference"}</p>
      </div>

      <div className="mt-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">{isLiability ? "Amount owed" : "Current balance"}</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-neutral-950 tabular-nums">{money(account.current_balance, account.currency)}</p>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-neutral-100 pt-4 text-xs text-neutral-400">
        <span className="truncate">
          {isLiability ? "Opening owed" : "Opening balance"}: <span className="font-medium text-neutral-600 tabular-nums">{money(account.opening_balance, account.currency)}</span>
        </span>
        <span className="shrink-0 font-medium text-neutral-500">{account.currency}</span>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm font-semibold text-neutral-700">
        <span>View ledger</span>
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function FormSection({
  title,
  description,
  children,
  columns = "three",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  columns?: "two" | "three";
}) {
  return (
    <section className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8 lg:py-6">
      <div>
        <h3 className="text-sm font-semibold text-neutral-950">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p>
      </div>
      <div className={cn("grid gap-4", columns === "two" ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3")}>{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1.5 block font-medium text-neutral-700">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-neutral-400">{hint}</span> : null}
    </label>
  );
}
