"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Landmark,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";

import { AccountingNav } from "@/components/accounting-nav";
import { CurrencySelect } from "@/components/currency-select";
import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { AppPage, PageHeader, SectionHeader, Surface } from "@/components/ui/app-page";
import { confirmDiscardChanges, useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
type Bill = {
  id: string;
  bill_number: string;
  supplier_name: string;
  bill_date: string;
  due_date: string | null;
  currency: string;
  subtotal_amount: string | number;
  tax_code_id: string | null;
  tax_rate_snapshot: string | number | null;
  input_tax_amount: string | number;
  recoverable_tax_amount: string | number;
  withholding_tax_code_id: string | null;
  withholding_rate_snapshot: string | number | null;
  withholding_tax_amount: string | number;
  original_amount: string | number;
  net_payable_amount: string | number;
  amount_paid: string | number;
  balance_due: string | number;
  expense_ledger_account_id: string;
  expense_ledger_account_name: string;
  description: string;
  reference: string | null;
  notes: string | null;
  status: string;
  created_at: string;
};
type Payment = {
  id: string;
  bill_id: string;
  financial_account_id: string;
  financial_account_name: string;
  payment_date: string;
  currency: string;
  amount: string | number;
  reference: string | null;
  notes: string | null;
};
type LedgerAccount = { id: string; name: string; category: string; is_active: boolean };
type Account = {
  id: string;
  name: string;
  account_type: string;
  currency: string;
  current_balance: string | number;
  is_active: boolean;
};
type Vendor = { id: string; name: string; is_active: boolean };
type ExpenseMeta = { vendors?: Vendor[] };
type TaxCode = {
  id: string;
  code: string;
  name: string;
  tax_kind: "sales" | "purchase" | "withholding";
  rate: string | number;
  recoverable_percent: string | number;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
};
type CurrencyAmount = { currency: string; amount: string | number };
type AgingTotal = { bucket: AgingBucket; currency: string; amount: string | number };
type WorkspacePayload = {
  items: Bill[];
  next_cursor: string | null;
  business_date: string;
  open_bill_count: number;
  overdue_count: number;
  filtered_count: number;
  outstanding_by_currency: CurrencyAmount[];
  aging: AgingTotal[];
};
type WorkspaceSummary = Pick<
  WorkspacePayload,
  "business_date" | "open_bill_count" | "overdue_count" | "filtered_count" | "outstanding_by_currency" | "aging"
>;
type TenantPayload = { organization?: { currency?: string } };
type ConfirmMode = "bill" | "payment" | null;
type BillForm = {
  supplier_name: string;
  bill_date: string;
  due_date: string;
  currency: string;
  amount: string;
  tax_code_id: string;
  withholding_tax_code_id: string;
  expense_ledger_account_id: string;
  description: string;
  reference: string;
  notes: string;
};
type PaymentForm = {
  financial_account_id: string;
  payment_date: string;
  amount: string;
  reference: string;
  notes: string;
};

const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];
const EMPTY_SUMMARY: WorkspaceSummary = {
  business_date: new Date().toISOString().slice(0, 10),
  open_bill_count: 0,
  overdue_count: 0,
  filtered_count: 0,
  outstanding_by_currency: [],
  aging: [],
};

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function blankBill(currency: string, businessDate: string): BillForm {
  return {
    supplier_name: "",
    bill_date: businessDate,
    due_date: "",
    currency,
    amount: "",
    tax_code_id: "",
    withholding_tax_code_id: "",
    expense_ledger_account_id: "",
    description: "",
    reference: "",
    notes: "",
  };
}

function blankPayment(businessDate: string): PaymentForm {
  return { financial_account_id: "", payment_date: businessDate, amount: "", reference: "", notes: "" };
}

function isTaxEffective(code: TaxCode | undefined, billDate: string) {
  if (!code || !billDate) return false;
  if (code.effective_from && billDate < code.effective_from) return false;
  if (code.effective_to && billDate > code.effective_to) return false;
  return code.is_active;
}

function isOverdue(bill: Bill, businessDate: string) {
  return Boolean(bill.due_date && Number(bill.balance_due) > 0 && bill.due_date < businessDate);
}

function agingLabel(bucket: AgingBucket) {
  return bucket === "current" ? "Current" : `${bucket} days`;
}

export default function PayablesPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [summary, setSummary] = useState<WorkspaceSummary>(EMPTY_SUMMARY);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [categories, setCategories] = useState<LedgerAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [defaultCurrency, setDefaultCurrency] = useState("");
  const [loading, setLoading] = useState(true);
  const [metaLoading, setMetaLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"bill" | "pay" | null>(null);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [selected, setSelected] = useState<Bill | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "overdue" | "partial" | "paid">("open");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [billForm, setBillForm] = useState<BillForm>(() => blankBill("", EMPTY_SUMMARY.business_date));
  const [payForm, setPayForm] = useState<PaymentForm>(() => blankPayment(EMPTY_SUMMARY.business_date));

  const loadPayables = useCallback(
    async (cursor?: string, append = false, signal?: AbortSignal) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "50", status: statusFilter });
        if (query.trim()) params.set("search", query.trim());
        if (currencyFilter !== "all") params.set("currency", currencyFilter);
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/accounting/payables/workspace?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const payload = (await response.json()) as WorkspacePayload;
        if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load payables"));
        setBills((current) => (append ? [...current, ...payload.items] : payload.items));
        setNextCursor(payload.next_cursor);
        setSummary({
          business_date: payload.business_date,
          open_bill_count: payload.open_bill_count,
          overdue_count: payload.overdue_count,
          filtered_count: payload.filtered_count,
          outstanding_by_currency: payload.outstanding_by_currency,
          aging: payload.aging,
        });
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Could not load payables");
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [currencyFilter, query, statusFilter],
  );

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const [categoryResponse, accountResponse, metaResponse, taxResponse, tenantResponse] = await Promise.all([
        fetch("/api/accounting/chart-of-accounts", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
        fetch("/api/finance/expense-meta", { cache: "no-store" }),
        fetch("/api/accounting/tax/codes", { cache: "no-store" }),
        fetch("/api/tenant/context", { cache: "no-store" }),
      ]);
      const [categoryPayload, accountPayload, metaPayload, taxPayload, tenantPayload] = await Promise.all([
        categoryResponse.json(),
        accountResponse.json(),
        metaResponse.json(),
        taxResponse.json(),
        tenantResponse.json(),
      ]);
      if (!categoryResponse.ok) throw new Error(getApiErrorMessage(categoryPayload, "Could not load expense categories"));
      if (!accountResponse.ok) throw new Error(getApiErrorMessage(accountPayload, "Could not load financial accounts"));
      if (!taxResponse.ok) throw new Error(getApiErrorMessage(taxPayload, "Could not load tax codes"));
      setCategories((categoryPayload as LedgerAccount[]).filter((item) => item.category === "expense" && item.is_active));
      setAccounts(accountPayload as Account[]);
      setVendors(metaResponse.ok ? ((metaPayload as ExpenseMeta).vendors ?? []) : []);
      setTaxCodes((taxPayload as TaxCode[]).filter((item) => item.is_active));
      if (tenantResponse.ok) {
        const code = (tenantPayload as TenantPayload).organization?.currency?.toUpperCase() ?? "";
        setDefaultCurrency(code);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load payable setup data");
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadPayables(undefined, false, controller.signal),
      query.trim() ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadPayables]);

  const loadPayments = useCallback(async (billId: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/accounting/payables/${billId}/payments`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load payment history"));
      setPayments(payload as Payment[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load payment history");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const refreshBillDetail = useCallback(async (billId: string) => {
    const response = await fetch(`/api/accounting/payables/${billId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not refresh payable bill"));
    setSelected(payload as Bill);
  }, []);

  useEffect(() => {
    if (selected) void loadPayments(selected.id);
    else setPayments([]);
  }, [selected?.id, loadPayments]);

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ value: category.id, label: category.name })),
    [categories],
  );
  const vendorOptions = useMemo(
    () => vendors.filter((vendor) => vendor.is_active).map((vendor) => ({ value: vendor.name, label: vendor.name })),
    [vendors],
  );
  const purchaseTaxes = useMemo(
    () => taxCodes.filter((code) => code.tax_kind === "purchase" && isTaxEffective(code, billForm.bill_date)),
    [billForm.bill_date, taxCodes],
  );
  const withholdingTaxes = useMemo(
    () => taxCodes.filter((code) => code.tax_kind === "withholding" && isTaxEffective(code, billForm.bill_date)),
    [billForm.bill_date, taxCodes],
  );
  const purchaseTaxOptions = useMemo(
    () =>
      purchaseTaxes.map((code) => ({
        value: code.id,
        label: `${code.code} · ${code.name} (${Number(code.rate)}%)`,
        keywords: `${code.code} ${code.name} ${code.rate}`,
      })),
    [purchaseTaxes],
  );
  const withholdingOptions = useMemo(
    () =>
      withholdingTaxes.map((code) => ({
        value: code.id,
        label: `${code.code} · ${code.name} (${Number(code.rate)}%)`,
        keywords: `${code.code} ${code.name} ${code.rate}`,
      })),
    [withholdingTaxes],
  );
  const selectedCategory = categories.find((item) => item.id === billForm.expense_ledger_account_id) ?? null;
  const selectedPurchaseTax = taxCodes.find((item) => item.id === billForm.tax_code_id) ?? null;
  const selectedWithholdingTax = taxCodes.find((item) => item.id === billForm.withholding_tax_code_id) ?? null;
  const compatibleAccounts = useMemo(
    () =>
      selected
        ? accounts.filter((account) => account.is_active && account.currency === selected.currency)
        : [],
    [accounts, selected],
  );
  const paymentAccountOptions = useMemo(
    () =>
      compatibleAccounts.map((account) => ({
        value: account.id,
        label:
          account.account_type === "credit_card"
            ? `${account.name} · card liability ${money(account.current_balance, account.currency)}`
            : `${account.name} · available ${money(account.current_balance, account.currency)}`,
        keywords: `${account.name} ${account.currency} ${account.account_type}`,
      })),
    [compatibleAccounts],
  );
  const selectedPaymentAccount = accounts.find((item) => item.id === payForm.financial_account_id) ?? null;
  const currencies = useMemo(
    () =>
      [
        ...new Set([
          ...summary.outstanding_by_currency.map((item) => item.currency),
          ...bills.map((bill) => bill.currency),
        ]),
      ].sort(),
    [bills, summary.outstanding_by_currency],
  );
  const agingSummary = useMemo(() => {
    const map = new Map<AgingBucket, CurrencyAmount[]>();
    for (const bucket of AGING_BUCKETS) map.set(bucket, []);
    for (const item of summary.aging) map.get(item.bucket)?.push({ currency: item.currency, amount: item.amount });
    return map;
  }, [summary.aging]);

  const subtotal = roundMoney(Number(billForm.amount || 0));
  const inputTax = roundMoney(subtotal * (Number(selectedPurchaseTax?.rate || 0) / 100));
  const recoverableTax = roundMoney(inputTax * (Number(selectedPurchaseTax?.recoverable_percent || 0) / 100));
  const nonRecoverableTax = roundMoney(inputTax - recoverableTax);
  const grossBill = roundMoney(subtotal + inputTax);
  const withholdingTax = roundMoney(subtotal * (Number(selectedWithholdingTax?.rate || 0) / 100));
  const netPayable = roundMoney(grossBill - withholdingTax);
  const expenseRecognized = roundMoney(subtotal + nonRecoverableTax);

  const billDirty =
    mode === "bill" &&
    Boolean(
      billForm.supplier_name ||
        billForm.amount ||
        billForm.tax_code_id ||
        billForm.withholding_tax_code_id ||
        billForm.expense_ledger_account_id ||
        billForm.description ||
        billForm.reference ||
        billForm.notes ||
        billForm.due_date,
    );
  const paymentDirty =
    mode === "pay" &&
    Boolean(payForm.financial_account_id || payForm.amount || payForm.reference || payForm.notes);
  useUnsavedChanges((billDirty || paymentDirty) && !saving);

  function openBillForm() {
    if (mode && !confirmDiscardChanges(billDirty || paymentDirty, "Discard this unposted financial form?")) return;
    setBillForm(blankBill(defaultCurrency, summary.business_date));
    setSelected(null);
    setPayments([]);
    setMessage(null);
    setConfirmMode(null);
    setMode("bill");
  }

  function closeMode() {
    const dirty = mode === "bill" ? billDirty : paymentDirty;
    if (!confirmDiscardChanges(dirty, "Discard this unposted financial form?")) return;
    setMode(null);
    setConfirmMode(null);
    if (mode === "bill") setBillForm(blankBill(defaultCurrency, summary.business_date));
    else setPayForm(blankPayment(summary.business_date));
  }

  function changeBillDate(value: string) {
    setBillForm((current) => {
      const purchase = taxCodes.find((item) => item.id === current.tax_code_id);
      const withholding = taxCodes.find((item) => item.id === current.withholding_tax_code_id);
      return {
        ...current,
        bill_date: value,
        due_date: current.due_date && current.due_date < value ? "" : current.due_date,
        tax_code_id: isTaxEffective(purchase, value) ? current.tax_code_id : "",
        withholding_tax_code_id: isTaxEffective(withholding, value) ? current.withholding_tax_code_id : "",
      };
    });
  }

  function reviewBill(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!billForm.currency) {
      setError("Choose a currency before posting this vendor bill.");
      return;
    }
    if (netPayable <= 0) {
      setError("Withholding tax leaves no supplier payable. Review the selected tax codes.");
      return;
    }
    setConfirmMode("bill");
  }

  async function postBill() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/accounting/payables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_name: billForm.supplier_name,
          bill_date: billForm.bill_date,
          due_date: billForm.due_date || null,
          currency: billForm.currency,
          amount: Number(billForm.amount),
          tax_code_id: billForm.tax_code_id || null,
          withholding_tax_code_id: billForm.withholding_tax_code_id || null,
          expense_ledger_account_id: billForm.expense_ledger_account_id,
          description: billForm.description,
          reference: billForm.reference || null,
          notes: billForm.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record vendor bill"));
      const created = payload as Bill;
      setBillForm(blankBill(defaultCurrency, summary.business_date));
      setConfirmMode(null);
      setMode(null);
      setSelected(created);
      setMessage(
        `${created.bill_number} posted. Expense and Accounts Payable were recognized; no bank or cash balance moved.`,
      );
      await loadPayables();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record vendor bill");
      setConfirmMode(null);
    } finally {
      setSaving(false);
    }
  }

  function openBillDetail(bill: Bill) {
    if (mode && !confirmDiscardChanges(billDirty || paymentDirty, "Discard this unposted financial form?")) return;
    setMode(null);
    setConfirmMode(null);
    setSelected(bill);
  }

  function openPayment(bill: Bill) {
    if (mode && !confirmDiscardChanges(billDirty || paymentDirty, "Discard this unposted financial form?")) return;
    setSelected(bill);
    setPayForm({
      financial_account_id: "",
      payment_date: summary.business_date,
      amount: String(bill.balance_due),
      reference: "",
      notes: "",
    });
    setMessage(null);
    setConfirmMode(null);
    setMode("pay");
  }

  function closeDetail() {
    if (mode && !confirmDiscardChanges(paymentDirty, "Discard this unposted supplier payment?")) return;
    setSelected(null);
    setMode(null);
    setConfirmMode(null);
  }

  function reviewPayment(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selectedPaymentAccount) return;
    setError(null);
    const amount = Number(payForm.amount || 0);
    if (amount <= 0 || amount > Number(selected.balance_due)) {
      setError("Payment amount must be greater than zero and cannot exceed the remaining payable.");
      return;
    }
    if (
      selectedPaymentAccount.account_type !== "credit_card" &&
      Number(selectedPaymentAccount.current_balance) < amount
    ) {
      setError(`Selected account has only ${money(selectedPaymentAccount.current_balance, selected.currency)} available.`);
      return;
    }
    setConfirmMode("payment");
  }

  async function postPayment() {
    if (!selected) return;
    const billId = selected.id;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/accounting/payables/${billId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financial_account_id: payForm.financial_account_id,
          payment_date: payForm.payment_date,
          amount: Number(payForm.amount),
          reference: payForm.reference || null,
          notes: payForm.notes || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not record vendor payment"));
      const paymentAmount = money(payForm.amount || 0, selected.currency);
      setPayForm(blankPayment(summary.business_date));
      setConfirmMode(null);
      setMode(null);
      setMessage(`${paymentAmount} supplier payment posted against ${selected.bill_number}.`);
      await Promise.all([loadPayables(), loadPayments(billId), loadMeta(), refreshBillDetail(billId)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record vendor payment");
      setConfirmMode(null);
    } finally {
      setSaving(false);
    }
  }

  const billConfirmation = [
    { label: "Supplier", value: billForm.supplier_name || "—" },
    { label: "Expense category", value: selectedCategory?.name || "—" },
    { label: "Expense recognized", value: money(expenseRecognized, billForm.currency), emphasis: true },
    { label: "Gross vendor bill", value: money(grossBill, billForm.currency) },
    { label: "Recoverable input tax", value: money(recoverableTax, billForm.currency) },
    { label: "Withholding liability", value: money(withholdingTax, billForm.currency) },
    { label: "Accounts Payable created", value: money(netPayable, billForm.currency), emphasis: true },
    { label: "Cash / bank movement", value: "None until payment" },
    { label: "Bill date", value: billForm.bill_date },
    { label: "Due date", value: billForm.due_date || "No due date" },
  ];
  const paymentConfirmation = selected
    ? [
        { label: "Bill", value: `${selected.bill_number} · ${selected.supplier_name}` },
        { label: "Outstanding before payment", value: money(selected.balance_due, selected.currency) },
        { label: "Accounts Payable reduction", value: money(payForm.amount || 0, selected.currency), emphasis: true },
        { label: "Pay / charge", value: money(payForm.amount || 0, selected.currency), emphasis: true },
        { label: "Financial account", value: selectedPaymentAccount?.name || "—" },
        {
          label: selectedPaymentAccount?.account_type === "credit_card" ? "Account effect" : "Available before payment",
          value:
            selectedPaymentAccount?.account_type === "credit_card"
              ? "Credit card liability increases"
              : selectedPaymentAccount
                ? money(selectedPaymentAccount.current_balance, selectedPaymentAccount.currency)
                : "—",
        },
        { label: "Payment date", value: payForm.payment_date },
      ]
    : [];

  const hasFilters = Boolean(query || statusFilter !== "open" || currencyFilter !== "all");

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Finance & Accounting"
          title="Supplier payables"
          description="Recognize vendor bills when incurred, manage due dates and settle Accounts Payable without recording the expense twice."
          meta={
            <>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Server-side totals & aging</span>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Currencies stay separate</span>
              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">Tax-aware posting</span>
            </>
          }
          actions={
            <button
              type="button"
              onClick={openBillForm}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
            >
              <Plus className="size-4" />
              Record vendor bill
            </button>
          }
        />

        <AccountingNav />

        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => void loadPayables()} className="font-medium underline underline-offset-2">
              Retry
            </button>
          </div>
        ) : null}
        {message ? (
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricSurface
            label="Open bills"
            value={String(summary.open_bill_count)}
            help={`${summary.overdue_count} overdue`}
            icon={<ReceiptText className="size-4" />}
          />
          <MetricSurface
            label="You owe suppliers"
            values={summary.outstanding_by_currency}
            help="Accounts Payable, currencies separate"
            icon={<WalletCards className="size-4" />}
          />
          <MetricSurface
            label="Overdue bills"
            value={String(summary.overdue_count)}
            help={`Business date ${summary.business_date}`}
            icon={<AlertTriangle className="size-4" />}
          />
          <MetricSurface
            label="Posting model"
            value="Bill → Payable → Payment"
            help="Payment settles liability; it is not a second expense"
            icon={<ShieldCheck className="size-4" />}
            compact
          />
        </section>

        <Surface className="p-5 sm:p-6">
          <SectionHeader
            title="Payable aging"
            description="Aging is calculated on the backend from every open supplier bill using the organization business date."
            action={<span className="text-xs text-neutral-400">{summary.open_bill_count} open bills</span>}
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {AGING_BUCKETS.map((bucket) => {
              const values = agingSummary.get(bucket) ?? [];
              const active =
                (bucket === "current" && statusFilter === "open") ||
                (bucket !== "current" && statusFilter === "overdue");
              return (
                <div
                  key={bucket}
                  className={cn(
                    "rounded-2xl border p-4",
                    bucket !== "current" && values.length ? "border-amber-200 bg-amber-50/40" : "border-neutral-200 bg-white",
                    active && "ring-1 ring-neutral-300",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">{agingLabel(bucket)}</p>
                    {bucket === "current" ? <Clock3 className="size-4 text-neutral-400" /> : <AlertTriangle className="size-4 text-amber-500" />}
                  </div>
                  <div className="mt-3 space-y-1">
                    {values.length ? (
                      values.map((item) => (
                        <p key={item.currency} className="font-semibold tabular-nums text-neutral-950">
                          {money(item.amount, item.currency)}
                        </p>
                      ))
                    ) : (
                      <p className="font-semibold text-neutral-300">0.00</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Surface>

        {mode === "bill" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Surface className="p-5 sm:p-6">
              <SectionHeader
                title="Record a vendor bill"
                description="Recognize the expense and Accounts Payable now. Bank, cash or card changes only when the bill is paid."
                action={
                  <button type="button" onClick={closeMode} className="rounded-xl border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50">
                    <X className="size-4" />
                  </button>
                }
              />
              <form onSubmit={reviewBill} className="mt-6 space-y-7">
                <FormSection title="Supplier & bill" description="Identify the vendor, bill date, due date and transaction currency.">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <SearchableSelect
                      label="Supplier"
                      required
                      clearable={false}
                      allowCustom
                      value={billForm.supplier_name}
                      onValueChange={(value) => setBillForm((current) => ({ ...current, supplier_name: value }))}
                      options={vendorOptions}
                      placeholder="Select or type supplier"
                      searchPlaceholder="Search supplier or type a new name..."
                    />
                    <Field label="Bill date">
                      <input
                        required
                        type="date"
                        value={billForm.bill_date}
                        onChange={(event) => changeBillDate(event.target.value)}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Due date" hint="Optional. Cannot be before the bill date.">
                      <input
                        type="date"
                        min={billForm.bill_date}
                        value={billForm.due_date}
                        onChange={(event) => setBillForm((current) => ({ ...current, due_date: event.target.value }))}
                        className={inputClass}
                      />
                    </Field>
                    <CurrencySelect
                      required
                      clearable={false}
                      value={billForm.currency}
                      onValueChange={(value) => setBillForm((current) => ({ ...current, currency: value }))}
                    />
                    <MoneyInput
                      label="Subtotal before tax"
                      currency={billForm.currency || defaultCurrency || "—"}
                      required
                      min={0.01}
                      value={billForm.amount}
                      onValueChange={(value) => setBillForm((current) => ({ ...current, amount: value }))}
                    />
                    <Field label="Supplier reference" hint="Invoice/reference number from the vendor.">
                      <input
                        value={billForm.reference}
                        onChange={(event) => setBillForm((current) => ({ ...current, reference: event.target.value }))}
                        className={inputClass}
                        placeholder="Vendor invoice #"
                      />
                    </Field>
                  </div>
                </FormSection>

                <FormSection title="Accounting & tax" description="Use the existing Chart of Accounts and Tax Center rules; no manual debit/credit entry is required here.">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <SearchableSelect
                      label="Expense category"
                      required
                      clearable={false}
                      value={billForm.expense_ledger_account_id}
                      onValueChange={(value) => setBillForm((current) => ({ ...current, expense_ledger_account_id: value }))}
                      options={categoryOptions}
                      placeholder="Select expense category"
                      searchPlaceholder="Search Chart of Accounts..."
                    />
                    <SearchableSelect
                      label="Purchase tax"
                      clearable
                      value={billForm.tax_code_id}
                      onValueChange={(value) => setBillForm((current) => ({ ...current, tax_code_id: value }))}
                      options={purchaseTaxOptions}
                      placeholder="No purchase tax"
                      searchPlaceholder="Search purchase tax code..."
                    />
                    <SearchableSelect
                      label="Withholding tax"
                      clearable
                      value={billForm.withholding_tax_code_id}
                      onValueChange={(value) => setBillForm((current) => ({ ...current, withholding_tax_code_id: value }))}
                      options={withholdingOptions}
                      placeholder="No withholding tax"
                      searchPlaceholder="Search withholding tax code..."
                    />
                  </div>
                  {!metaLoading && !taxCodes.length ? (
                    <p className="mt-3 text-xs text-neutral-400">No active tax codes are configured. The bill can still be posted without tax.</p>
                  ) : null}
                </FormSection>

                <FormSection title="Description & internal notes" description="Keep the business purpose clear for reports, audit review and future corrections.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="What is this bill for?">
                      <input
                        required
                        value={billForm.description}
                        onChange={(event) => setBillForm((current) => ({ ...current, description: event.target.value }))}
                        className={inputClass}
                        placeholder="Office rent for September"
                      />
                    </Field>
                    <Field label="Internal notes">
                      <textarea
                        value={billForm.notes}
                        onChange={(event) => setBillForm((current) => ({ ...current, notes: event.target.value }))}
                        className={cn(inputClass, "min-h-24 resize-y py-3")}
                        placeholder="Optional context for accounting/admin users"
                      />
                    </Field>
                  </div>
                </FormSection>

                <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-5 sm:flex-row sm:justify-end">
                  <button type="button" onClick={closeMode} className="rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                    Cancel
                  </button>
                  <button
                    disabled={saving || metaLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Review bill
                  </button>
                </div>
              </form>
            </Surface>

            <div className="xl:sticky xl:top-6 xl:self-start">
              <Surface className="p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700">
                    <ReceiptText className="size-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-neutral-950">Posting preview</p>
                    <p className="text-xs text-neutral-400">Nothing posts until final confirmation.</p>
                  </div>
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  <PreviewRow label="Expense" value={money(expenseRecognized, billForm.currency || defaultCurrency || "—")} />
                  <PreviewRow label="Recoverable input tax" value={money(recoverableTax, billForm.currency || defaultCurrency || "—")} />
                  <PreviewRow label="Gross bill" value={money(grossBill, billForm.currency || defaultCurrency || "—")} />
                  <PreviewRow label="Withholding payable" value={money(withholdingTax, billForm.currency || defaultCurrency || "—")} />
                  <div className="border-t border-neutral-100 pt-3">
                    <PreviewRow label="Supplier payable" value={money(netPayable, billForm.currency || defaultCurrency || "—")} strong />
                  </div>
                </div>
                <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-500">
                  <p className="font-medium text-neutral-800">Journal effect</p>
                  <p className="mt-1">Debit expense / recoverable input tax as applicable. Credit Accounts Payable and withholding liability as applicable. Cash remains unchanged.</p>
                </div>
              </Surface>
            </div>
          </div>
        ) : null}

        {selected ? (
          <Surface className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight text-neutral-950">{selected.bill_number}</h2>
                  <StatusBadge bill={selected} businessDate={summary.business_date} />
                </div>
                <p className="mt-1 text-sm text-neutral-500">{selected.supplier_name} · {selected.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {Number(selected.balance_due) > 0 ? (
                  <button
                    type="button"
                    onClick={() => openPayment(selected)}
                    className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
                  >
                    <CircleDollarSign className="size-4" /> Pay bill
                  </button>
                ) : null}
                <button type="button" onClick={closeDetail} className="rounded-xl border border-neutral-200 p-2.5 text-neutral-500 hover:bg-neutral-50">
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Subtotal" value={money(selected.subtotal_amount, selected.currency)} />
              <Stat label="Gross bill" value={money(selected.original_amount, selected.currency)} />
              <Stat label="Net supplier payable" value={money(selected.net_payable_amount, selected.currency)} />
              <Stat label="Still due" value={money(selected.balance_due, selected.currency)} emphasis={Number(selected.balance_due) > 0} />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Info label="Expense category" value={selected.expense_ledger_account_name} />
              <Info label="Bill / due date" value={`${selected.bill_date} · ${selected.due_date || "No due date"}`} />
              <Info label="Input tax" value={`${money(selected.input_tax_amount, selected.currency)} · ${selected.tax_rate_snapshot ?? 0}%`} />
              <Info label="Recoverable input tax" value={money(selected.recoverable_tax_amount, selected.currency)} />
              <Info label="Withholding" value={`${money(selected.withholding_tax_amount, selected.currency)} · ${selected.withholding_rate_snapshot ?? 0}%`} />
              <Info label="Paid" value={money(selected.amount_paid, selected.currency)} />
              <Info label="Reference" value={selected.reference || "—"} />
              <Info label="Internal notes" value={selected.notes || "—"} />
            </div>

            <div className="mt-6 border-t border-neutral-100 pt-5">
              <SectionHeader
                title="Payment history"
                description="Every partial or full settlement stays attached to this bill and reduces Accounts Payable."
              />
              {detailLoading ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-neutral-400"><Loader2 className="size-4 animate-spin" /> Loading payments…</div>
              ) : payments.length ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {payments.map((payment) => (
                    <div key={payment.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold tabular-nums text-neutral-950">{money(payment.amount, payment.currency)}</p>
                          <p className="mt-1 text-sm text-neutral-500">{payment.financial_account_name}</p>
                        </div>
                        <span className="text-xs text-neutral-400">{payment.payment_date}</span>
                      </div>
                      {payment.reference ? <p className="mt-3 text-xs text-neutral-400">Reference: {payment.reference}</p> : null}
                      {payment.notes ? <p className="mt-2 text-sm text-neutral-500">{payment.notes}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 p-7 text-center text-sm text-neutral-400">No supplier payments recorded yet.</div>
              )}
            </div>

            <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
              <p className="font-medium text-neutral-900">Posted financial history</p>
              <p className="mt-1">Do not recreate this bill in Money Out when paying it. Use the payable payment action so Accounts Payable is reduced instead of recognizing a duplicate expense.</p>
            </div>
          </Surface>
        ) : null}

        {mode === "pay" && selected ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Surface className="p-5 sm:p-6">
              <SectionHeader
                title={`Pay ${selected.supplier_name}`}
                description={`${selected.bill_number} has ${money(selected.balance_due, selected.currency)} remaining. Simple payable settlement uses an account in the same currency.`}
                action={
                  <button type="button" onClick={closeMode} className="rounded-xl border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50">
                    <X className="size-4" />
                  </button>
                }
              />
              <form onSubmit={reviewPayment} className="mt-6 space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <SearchableSelect
                    label="Pay from / charge to"
                    required
                    clearable={false}
                    value={payForm.financial_account_id}
                    onValueChange={(value) => setPayForm((current) => ({ ...current, financial_account_id: value }))}
                    options={paymentAccountOptions}
                    placeholder={`Select ${selected.currency} account`}
                    searchPlaceholder="Search bank, cash, wallet or credit card..."
                  />
                  <MoneyInput
                    label="Payment amount"
                    currency={selected.currency}
                    required
                    min={0.01}
                    max={Number(selected.balance_due)}
                    value={payForm.amount}
                    onValueChange={(value) => setPayForm((current) => ({ ...current, amount: value }))}
                    hint={`Maximum outstanding: ${money(selected.balance_due, selected.currency)}`}
                  />
                  <Field label="Payment date">
                    <input
                      required
                      type="date"
                      value={payForm.payment_date}
                      onChange={(event) => setPayForm((current) => ({ ...current, payment_date: event.target.value }))}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Payment reference">
                    <input
                      value={payForm.reference}
                      onChange={(event) => setPayForm((current) => ({ ...current, reference: event.target.value }))}
                      className={inputClass}
                      placeholder="Bank ref / cheque / card ref"
                    />
                  </Field>
                  <Field label="Internal notes">
                    <textarea
                      value={payForm.notes}
                      onChange={(event) => setPayForm((current) => ({ ...current, notes: event.target.value }))}
                      className={cn(inputClass, "min-h-24 resize-y py-3")}
                      placeholder="Optional payment context"
                    />
                  </Field>
                </div>
                {!compatibleAccounts.length && !metaLoading ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    No active {selected.currency} financial account is available. Add the matching-currency account before settling this bill.
                  </div>
                ) : null}
                <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-5 sm:flex-row sm:justify-end">
                  <button type="button" onClick={closeMode} className="rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Cancel</button>
                  <button disabled={saving || !compatibleAccounts.length} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">Review payment</button>
                </div>
              </form>
            </Surface>

            <div className="xl:sticky xl:top-6 xl:self-start">
              <Surface className="p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100">
                    {selectedPaymentAccount?.account_type === "credit_card" ? <CreditCard className="size-5" /> : <Landmark className="size-5" />}
                  </div>
                  <div>
                    <p className="font-semibold">Settlement preview</p>
                    <p className="text-xs text-neutral-400">No second expense is created.</p>
                  </div>
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  <PreviewRow label="Accounts Payable ↓" value={money(payForm.amount || 0, selected.currency)} strong />
                  <PreviewRow
                    label={selectedPaymentAccount?.account_type === "credit_card" ? "Card liability ↑" : "Financial account ↓"}
                    value={money(payForm.amount || 0, selected.currency)}
                  />
                  <PreviewRow label="Expense" value="No new expense" />
                  <PreviewRow label="Currency" value={`${selected.currency} only`} />
                </div>
                <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-500">
                  A realized FX gain/loss may be posted in the organization&apos;s functional currency when the payable carrying value and settlement-date conversion differ.
                </div>
              </Surface>
            </div>
          </div>
        ) : null}

        <Surface className="overflow-hidden">
          <div className="p-5 sm:p-6">
            <SectionHeader
              title="Supplier bills"
              description="Search and filter server-side. Open a bill to inspect tax, payable balance and settlement history."
              action={<span className="text-xs text-neutral-400">{summary.filtered_count} matching bills</span>}
            />
            <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_170px_auto]">
              <label className="relative">
                <Search className="absolute left-3 top-3.5 size-4 text-neutral-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search bill, supplier, description or reference…"
                  className={cn(inputClass, "pl-9")}
                />
              </label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className={inputClass}>
                <option value="open">Open</option>
                <option value="overdue">Overdue</option>
                <option value="partial">Partially paid</option>
                <option value="paid">Paid</option>
                <option value="all">All bills</option>
              </select>
              <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} className={inputClass}>
                <option value="all">All currencies</option>
                {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={() => { setQuery(""); setStatusFilter("open"); setCurrencyFilter("all"); }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                >
                  <X className="size-3.5" /> Clear
                </button>
              ) : <span />}
            </div>
          </div>

          {loading && !bills.length ? (
            <div className="grid gap-3 border-t border-neutral-100 p-5 md:grid-cols-2 xl:grid-cols-3 sm:p-6">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-neutral-100" />)}
            </div>
          ) : bills.length ? (
            <>
              <div className="grid gap-3 border-t border-neutral-100 p-4 md:hidden">
                {bills.map((bill) => (
                  <BillCard key={bill.id} bill={bill} businessDate={summary.business_date} onOpen={() => openBillDetail(bill)} onPay={() => openPayment(bill)} />
                ))}
              </div>
              <div className="hidden overflow-x-auto border-t border-neutral-100 md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-50/80">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                      <th className="px-5 py-3">Bill</th>
                      <th className="px-4 py-3">Supplier</th>
                      <th className="px-4 py-3">Due</th>
                      <th className="px-4 py-3">Expense</th>
                      <th className="px-4 py-3">Gross</th>
                      <th className="px-4 py-3">Net payable</th>
                      <th className="px-4 py-3">Still due</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((bill) => (
                      <tr key={bill.id} className="border-t border-neutral-100 align-top hover:bg-neutral-50/50">
                        <td className="px-5 py-4">
                          <button type="button" onClick={() => openBillDetail(bill)} className="font-semibold text-neutral-950 hover:underline">{bill.bill_number}</button>
                          <p className="mt-1 text-xs text-neutral-400">{bill.reference || "No supplier reference"}</p>
                        </td>
                        <td className="px-4 py-4 text-neutral-700">{bill.supplier_name}</td>
                        <td className="px-4 py-4"><StatusDue bill={bill} businessDate={summary.business_date} /></td>
                        <td className="px-4 py-4 text-neutral-600">{bill.expense_ledger_account_name}</td>
                        <td className="px-4 py-4 tabular-nums text-neutral-600">{money(bill.original_amount, bill.currency)}</td>
                        <td className="px-4 py-4 tabular-nums text-neutral-600">{money(bill.net_payable_amount, bill.currency)}</td>
                        <td className="px-4 py-4 font-semibold tabular-nums text-neutral-950">{money(bill.balance_due, bill.currency)}</td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => openBillDetail(bill)} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-white">Open</button>
                            {Number(bill.balance_due) > 0 ? (
                              <button type="button" onClick={() => openPayment(bill)} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-800">Pay</button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="border-t border-neutral-100 px-5 py-14 text-center">
              <Building2 className="mx-auto size-9 text-neutral-300" />
              <p className="mt-3 font-medium text-neutral-800">{hasFilters ? "No supplier bills match these filters" : "No supplier bills yet"}</p>
              <p className="mt-1 text-sm text-neutral-400">{hasFilters ? "Change or clear the filters to see other bills." : "Record the first vendor bill when an expense is incurred but not yet paid."}</p>
            </div>
          )}

          {nextCursor ? (
            <div className="flex justify-center border-t border-neutral-100 p-4">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadPayables(nextCursor, true)}
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
                Load more
              </button>
            </div>
          ) : null}
        </Surface>
      </div>

      <FinancialConfirmationDialog
        open={confirmMode === "bill"}
        title="Post this vendor bill?"
        description="This recognizes the expense and creates supplier Accounts Payable. Cash, bank and card balances do not change until settlement."
        details={billConfirmation}
        confirmLabel="Post vendor bill"
        loading={saving}
        warning="Record the bill only once. Later settlement must be posted against this payable, not again as a new Money Out expense."
        onCancel={() => setConfirmMode(null)}
        onConfirm={postBill}
      />
      <FinancialConfirmationDialog
        open={confirmMode === "payment"}
        title="Post this supplier payment?"
        description="This reduces Accounts Payable and updates the selected financial account. It does not recognize the vendor expense again."
        details={paymentConfirmation}
        confirmLabel="Post supplier payment"
        loading={saving}
        warning="Check the bill, account, amount and date carefully. Posted supplier payments should be corrected through controlled reversal/correction rather than silent edits."
        onCancel={() => setConfirmMode(null)}
        onConfirm={postPayment}
      />
    </AppPage>
  );
}

const inputClass = "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100";

function MetricSurface({
  label,
  value,
  values,
  help,
  icon,
  compact = false,
}: {
  label: string;
  value?: string;
  values?: CurrencyAmount[];
  help: string;
  icon: ReactNode;
  compact?: boolean;
}) {
  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-neutral-500">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">{icon}</span>
      </div>
      <div className="mt-3 space-y-1">
        {values ? (
          values.length ? values.map((item) => <p key={item.currency} className="text-xl font-semibold tracking-tight tabular-nums">{money(item.amount, item.currency)}</p>) : <p className="text-xl font-semibold text-neutral-300">0.00</p>
        ) : (
          <p className={cn("font-semibold tracking-tight text-neutral-950", compact ? "text-base" : "text-3xl")}>{value}</p>
        )}
      </div>
      <p className="mt-2 text-xs leading-5 text-neutral-400">{help}</p>
    </Surface>
  );
}

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1.5 block font-medium text-neutral-700">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs text-neutral-400">{hint}</span> : null}
    </label>
  );
}

function PreviewRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-neutral-500">{label}</span>
      <span className={cn("text-right tabular-nums text-neutral-800", strong && "font-semibold text-neutral-950")}>{value}</span>
    </div>
  );
}

function Stat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={cn("rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4", emphasis && "border-amber-200 bg-amber-50/50")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-neutral-950">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-400">{label}</p>
      <p className="mt-1 text-sm leading-6 text-neutral-700">{value}</p>
    </div>
  );
}

function StatusBadge({ bill, businessDate }: { bill: Bill; businessDate: string }) {
  const overdue = isOverdue(bill, businessDate);
  const paid = Number(bill.balance_due) <= 0;
  const partial = Number(bill.amount_paid) > 0 && Number(bill.balance_due) > 0;
  const label = paid ? "Paid" : overdue ? "Overdue" : partial ? "Partially paid" : "Open";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        paid && "bg-emerald-50 text-emerald-700",
        overdue && "bg-red-50 text-red-700",
        !paid && !overdue && partial && "bg-amber-50 text-amber-700",
        !paid && !overdue && !partial && "bg-neutral-100 text-neutral-600",
      )}
    >
      {label}
    </span>
  );
}

function StatusDue({ bill, businessDate }: { bill: Bill; businessDate: string }) {
  if (!bill.due_date) return <span className="text-neutral-400">No due date</span>;
  if (isOverdue(bill, businessDate)) {
    return <div><p className="font-medium text-red-600">{bill.due_date}</p><p className="mt-1 text-xs text-red-500">Overdue</p></div>;
  }
  return <span className="text-neutral-600">{bill.due_date}</span>;
}

function BillCard({ bill, businessDate, onOpen, onPay }: { bill: Bill; businessDate: string; onOpen: () => void; onPay: () => void }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onOpen} className="font-semibold text-neutral-950">{bill.bill_number}</button>
          <p className="mt-1 text-sm text-neutral-500">{bill.supplier_name}</p>
        </div>
        <StatusBadge bill={bill} businessDate={businessDate} />
      </div>
      <p className="mt-3 text-sm text-neutral-600">{bill.description}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-neutral-50 p-3">
        <div><p className="text-xs text-neutral-400">Net payable</p><p className="mt-1 font-medium tabular-nums">{money(bill.net_payable_amount, bill.currency)}</p></div>
        <div><p className="text-xs text-neutral-400">Still due</p><p className="mt-1 font-semibold tabular-nums">{money(bill.balance_due, bill.currency)}</p></div>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onOpen} className="flex-1 rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-medium text-neutral-700">Open</button>
        {Number(bill.balance_due) > 0 ? <button type="button" onClick={onPay} className="flex-1 rounded-xl bg-neutral-950 px-3 py-2.5 text-sm font-medium text-white">Pay</button> : null}
      </div>
    </div>
  );
}
