"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Loader2, MessageSquareText, Pencil, Plus, Star } from "lucide-react";

import { FinancialConfirmationDialog } from "@/components/financial-confirmation-dialog";

type ReviewRow = {
  id: string;
  rating: number | null;
  review_text: string | null;
  source: string | null;
  reviewer_name: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type TipRow = {
  id: string;
  entry_date: string;
  currency: string;
  amount: string | number;
  financial_account_id: string;
  financial_account_name: string;
  category_ledger_account_id: string;
  category_ledger_account_name: string;
  description: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

type TipTotal = { currency: string; amount: string | number };

type Feedback = {
  project_status: string;
  project_currency: string;
  review: ReviewRow | null;
  tips: TipRow[];
  tip_totals: TipTotal[];
  can_manage_review: boolean;
  can_view_tips: boolean;
  can_record_tip: boolean;
};

type FinancialAccount = {
  id: string;
  name: string;
  account_type: string;
  currency: string;
  current_balance: string | number;
  is_active: boolean;
};

type FinanceMeta = { accounts: FinancialAccount[] };
type LedgerAccount = { id: string; name: string; category: string; is_active: boolean };

type ReviewForm = {
  rating: number;
  review_text: string;
  source: string;
  reviewer_name: string;
  received_at: string;
  notes: string;
};

type TipForm = {
  entry_date: string;
  financial_account_id: string;
  category_ledger_account_id: string;
  amount: string;
  reference: string;
  notes: string;
};

const REVIEW_SOURCES = ["Fiverr", "Upwork", "Google", "Website", "Email", "Direct", "Other"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function errorDetail(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const message = detail.find((item) => item && typeof item === "object" && "msg" in item) as { msg?: unknown } | undefined;
    if (typeof message?.msg === "string") return message.msg;
  }
  return fallback;
}

function blankReview(review: ReviewRow | null): ReviewForm {
  return {
    rating: review?.rating ?? 0,
    review_text: review?.review_text ?? "",
    source: review?.source ?? "",
    reviewer_name: review?.reviewer_name ?? "",
    received_at: review?.received_at ?? today(),
    notes: review?.notes ?? "",
  };
}

function blankTip(): TipForm {
  return {
    entry_date: today(),
    financial_account_id: "",
    category_ledger_account_id: "",
    amount: "",
    reference: "",
    notes: "",
  };
}

export function ProjectReviewTips({
  projectId,
  projectNumber,
  projectStatus,
  projectCurrency,
}: {
  projectId: string;
  projectNumber: string;
  projectStatus: string;
  projectCurrency: string;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<LedgerAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [tipSaving, setTipSaving] = useState(false);
  const [tipConfirmOpen, setTipConfirmOpen] = useState(false);
  const [reviewForm, setReviewForm] = useState<ReviewForm>(() => blankReview(null));
  const [tipForm, setTipForm] = useState<TipForm>(() => blankTip());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/feedback`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorDetail(payload, "Unable to load project review and tips."));
      const next = payload as Feedback;
      setFeedback(next);
      setReviewForm(blankReview(next.review));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load project review and tips.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback, projectStatus]);

  useEffect(() => {
    if (!feedback?.can_record_tip) return;
    let active = true;
    void (async () => {
      setOptionsLoading(true);
      try {
        const [metaResponse, coaResponse] = await Promise.all([
          fetch("/api/finance/meta", { cache: "no-store" }),
          fetch("/api/accounting/chart-of-accounts", { cache: "no-store" }),
        ]);
        const [metaPayload, coaPayload] = await Promise.all([
          metaResponse.json().catch(() => null),
          coaResponse.json().catch(() => null),
        ]);
        if (!metaResponse.ok) throw new Error(errorDetail(metaPayload, "Unable to load financial accounts."));
        if (!coaResponse.ok) throw new Error(errorDetail(coaPayload, "Unable to load income categories."));
        if (!active) return;
        const meta = metaPayload as FinanceMeta;
        const matchingAccounts = (meta.accounts ?? []).filter(
          (account) =>
            account.is_active &&
            account.account_type !== "credit_card" &&
            account.currency === projectCurrency,
        );
        const incomeCategories = (Array.isArray(coaPayload) ? coaPayload : []).filter(
          (account: LedgerAccount) => account.category === "income" && account.is_active,
        ) as LedgerAccount[];
        setAccounts(matchingAccounts);
        setCategories(incomeCategories);
        setTipForm((current) => ({
          ...current,
          financial_account_id:
            current.financial_account_id && matchingAccounts.some((item) => item.id === current.financial_account_id)
              ? current.financial_account_id
              : matchingAccounts.length === 1
                ? matchingAccounts[0].id
                : "",
          category_ledger_account_id:
            current.category_ledger_account_id && incomeCategories.some((item) => item.id === current.category_ledger_account_id)
              ? current.category_ledger_account_id
              : "",
        }));
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load tip options.");
      } finally {
        if (active) setOptionsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [feedback?.can_record_tip, projectCurrency]);

  const selectedAccount = accounts.find((item) => item.id === tipForm.financial_account_id) ?? null;
  const selectedCategory = categories.find((item) => item.id === tipForm.category_ledger_account_id) ?? null;
  const validTip = Boolean(
    Number(tipForm.amount) > 0 &&
      selectedAccount &&
      selectedAccount.currency === projectCurrency &&
      selectedCategory,
  );

  const confirmationDetails = useMemo(
    () => [
      { label: "Project", value: projectNumber },
      { label: "Tip amount", value: money(tipForm.amount || 0, projectCurrency), emphasis: true },
      { label: "Received into", value: selectedAccount?.name ?? "—" },
      { label: "Income category", value: selectedCategory?.name ?? "—" },
      { label: "Date", value: tipForm.entry_date || "—" },
      { label: "Reference", value: tipForm.reference || "—" },
    ],
    [projectNumber, projectCurrency, selectedAccount, selectedCategory, tipForm],
  );

  function startReviewEdit() {
    setReviewForm(blankReview(feedback?.review ?? null));
    setReviewEditing(true);
    setError(null);
    setMessage(null);
  }

  async function saveReview(event: FormEvent) {
    event.preventDefault();
    if (!reviewForm.rating && !reviewForm.review_text.trim()) {
      setError("Add a rating or review text.");
      return;
    }
    setReviewSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: reviewForm.rating || null,
          review_text: reviewForm.review_text.trim() || null,
          source: reviewForm.source || null,
          reviewer_name: reviewForm.reviewer_name.trim() || null,
          received_at: reviewForm.received_at || null,
          notes: reviewForm.notes.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorDetail(payload, "Unable to save client review."));
      setReviewEditing(false);
      setMessage(feedback?.review ? "Client review updated." : "Client review added.");
      await loadFeedback();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save client review.");
    } finally {
      setReviewSaving(false);
    }
  }

  function reviewTip(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!validTip) {
      setError(`Choose a ${projectCurrency} financial account, income category and valid tip amount.`);
      return;
    }
    setTipConfirmOpen(true);
  }

  async function postTip() {
    if (!validTip || !selectedAccount || !selectedCategory) return;
    setTipSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/accounting/money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "income",
          entry_date: tipForm.entry_date,
          financial_account_id: selectedAccount.id,
          category_ledger_account_id: selectedCategory.id,
          amount: Number(tipForm.amount),
          description: `Project tip · ${projectNumber}`,
          reference: tipForm.reference.trim() || null,
          notes: tipForm.notes.trim() || null,
          source_type: "project",
          source_id: projectId,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorDetail(payload, "Unable to record project tip."));
      setTipConfirmOpen(false);
      setTipForm(blankTip());
      setMessage("Tip recorded. Financial account and accounting ledger were updated.");
      await loadFeedback();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to record project tip.");
      setTipConfirmOpen(false);
    } finally {
      setTipSaving(false);
    }
  }

  if (loading && !feedback) {
    return (
      <section className="flex min-h-56 items-center justify-center rounded-2xl border bg-white shadow-sm">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </section>
    );
  }

  const completed = projectStatus === "completed";
  const review = feedback?.review ?? null;
  const tips = feedback?.tips ?? [];

  return (
    <div className="space-y-5">
      {!completed ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <p className="font-semibold">Review & Tips unlock after project completion</p>
          <p className="mt-1 leading-6">
            Complete the project first. A client review or tip can then be recorded immediately or added later at any time.
          </p>
        </div>
      ) : null}

      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText className="size-5 text-neutral-400" />
              <h2 className="font-semibold">Client review</h2>
            </div>
            <p className="mt-1 text-sm text-neutral-500">Keep the client feedback connected to the completed delivery.</p>
          </div>
          {completed && feedback?.can_manage_review && !reviewEditing ? (
            <button type="button" onClick={startReviewEdit} className="inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-neutral-50">
              {review ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
              {review ? "Edit review" : "Add review"}
            </button>
          ) : null}
        </div>

        {reviewEditing ? (
          <form onSubmit={saveReview} className="mt-5 border-t pt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium sm:col-span-2">
                Rating
                <div className="mt-2 flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      aria-label={`${rating} star rating`}
                      onClick={() => setReviewForm((current) => ({ ...current, rating }))}
                      className={`flex size-10 items-center justify-center rounded-lg border ${reviewForm.rating >= rating ? "border-amber-300 bg-amber-50 text-amber-500" : "border-neutral-200 text-neutral-300"}`}
                    >
                      <Star className="size-4" fill={reviewForm.rating >= rating ? "currentColor" : "none"} />
                    </button>
                  ))}
                  {reviewForm.rating ? (
                    <button type="button" onClick={() => setReviewForm((current) => ({ ...current, rating: 0 }))} className="ml-2 px-2 text-xs font-medium text-neutral-400 hover:text-neutral-700">Clear</button>
                  ) : null}
                </div>
              </label>
              <label className="text-sm font-medium">
                Reviewer name
                <input value={reviewForm.reviewer_name} maxLength={180} onChange={(event) => setReviewForm((current) => ({ ...current, reviewer_name: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-neutral-400" placeholder="Client or reviewer name" />
              </label>
              <label className="text-sm font-medium">
                Review source
                <select value={reviewForm.source} onChange={(event) => setReviewForm((current) => ({ ...current, source: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none">
                  <option value="">Not specified</option>
                  {REVIEW_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                Received date
                <input type="date" value={reviewForm.received_at} onChange={(event) => setReviewForm((current) => ({ ...current, received_at: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none" />
              </label>
              <label className="text-sm font-medium sm:col-span-2">
                Review
                <textarea value={reviewForm.review_text} maxLength={10000} onChange={(event) => setReviewForm((current) => ({ ...current, review_text: event.target.value }))} className="mt-2 min-h-32 w-full rounded-xl border p-3 text-sm outline-none focus:border-neutral-400" placeholder="What did the client say about the project?" />
              </label>
              <label className="text-sm font-medium sm:col-span-2">
                Internal notes
                <textarea value={reviewForm.notes} maxLength={5000} onChange={(event) => setReviewForm((current) => ({ ...current, notes: event.target.value }))} className="mt-2 min-h-24 w-full rounded-xl border p-3 text-sm outline-none focus:border-neutral-400" placeholder="Optional internal context" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t pt-5">
              <button type="button" disabled={reviewSaving} onClick={() => setReviewEditing(false)} className="h-10 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={reviewSaving || (!reviewForm.rating && !reviewForm.review_text.trim())} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">
                {reviewSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                {reviewSaving ? "Saving…" : "Save review"}
              </button>
            </div>
          </form>
        ) : review ? (
          <div className="mt-5 rounded-2xl border bg-neutral-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 text-amber-500">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <Star key={rating} className="size-4" fill={review.rating && review.rating >= rating ? "currentColor" : "none"} />
                ))}
                <span className="ml-2 text-xs font-medium text-neutral-500">{review.rating ? `${review.rating}/5` : "No rating"}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-neutral-400">
                {review.source ? <span>{review.source}</span> : null}
                {review.received_at ? <span>· {new Date(`${review.received_at}T00:00:00`).toLocaleDateString()}</span> : null}
              </div>
            </div>
            {review.reviewer_name ? <p className="mt-4 text-sm font-semibold">{review.reviewer_name}</p> : null}
            {review.review_text ? <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-neutral-700">{review.review_text}</p> : null}
            {review.notes ? <div className="mt-4 border-t pt-4 text-xs leading-5 text-neutral-500"><span className="font-semibold text-neutral-600">Internal note:</span> {review.notes}</div> : null}
            <p className="mt-4 text-[11px] text-neutral-400">Last updated {new Date(review.updated_at).toLocaleString()}</p>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed p-8 text-center">
            <Star className="mx-auto size-6 text-neutral-300" />
            <p className="mt-3 text-sm font-medium text-neutral-600">No client review recorded</p>
            <p className="mt-1 text-xs text-neutral-400">You can add it when the project is completed or anytime later.</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <Gift className="size-5 text-neutral-400" />
              <h2 className="font-semibold">Tips & additional income</h2>
            </div>
            <p className="mt-1 text-sm text-neutral-500">Financial income linked directly to this project. Invoice payments remain in the normal invoice/payment flow.</p>
          </div>
          {feedback?.can_view_tips && feedback.tip_totals.length ? (
            <div className="flex flex-wrap gap-2">
              {feedback.tip_totals.map((total) => (
                <span key={total.currency} className="rounded-full border bg-neutral-50 px-3 py-1.5 text-xs font-semibold tabular-nums">{money(total.amount, total.currency)}</span>
              ))}
            </div>
          ) : null}
        </div>

        {!feedback?.can_view_tips ? (
          <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
            Tip amounts are financial data. Finance View permission is required to see them.
          </div>
        ) : (
          <>
            {completed && feedback.can_record_tip ? (
              <form onSubmit={reviewTip} className="mt-5 rounded-2xl border bg-neutral-50 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Record a tip</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-500">Posts real income to the selected financial account and accounting ledger.</p>
                  </div>
                  {optionsLoading ? <Loader2 className="size-4 animate-spin text-neutral-400" /> : null}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="text-sm font-medium">
                    Date
                    <input type="date" value={tipForm.entry_date} onChange={(event) => setTipForm((current) => ({ ...current, entry_date: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none" required />
                  </label>
                  <label className="text-sm font-medium">
                    Amount ({projectCurrency})
                    <input type="number" min="0.01" step="0.01" value={tipForm.amount} onChange={(event) => setTipForm((current) => ({ ...current, amount: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none" placeholder="0.00" required />
                  </label>
                  <label className="text-sm font-medium">
                    Received into
                    <select value={tipForm.financial_account_id} onChange={(event) => setTipForm((current) => ({ ...current, financial_account_id: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none" required>
                      <option value="">Select {projectCurrency} account</option>
                      {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.current_balance, account.currency)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    Income category
                    <select value={tipForm.category_ledger_account_id} onChange={(event) => setTipForm((current) => ({ ...current, category_ledger_account_id: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none" required>
                      <option value="">Select income category</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    Reference
                    <input value={tipForm.reference} maxLength={180} onChange={(event) => setTipForm((current) => ({ ...current, reference: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none" placeholder="Fiverr / bank / transaction reference" />
                  </label>
                  <label className="text-sm font-medium md:col-span-2 xl:col-span-3">
                    Notes
                    <textarea value={tipForm.notes} onChange={(event) => setTipForm((current) => ({ ...current, notes: event.target.value }))} className="mt-2 min-h-20 w-full rounded-xl border bg-white p-3 text-sm outline-none" placeholder="Optional context about this tip" />
                  </label>
                </div>
                {!optionsLoading && !accounts.length ? (
                  <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">No active {projectCurrency} receiving account is available. Add a matching financial account first; cross-currency conversion is not performed silently here.</p>
                ) : null}
                <div className="mt-5 flex justify-end">
                  <button type="submit" disabled={!validTip || tipSaving || optionsLoading} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">
                    <Plus className="size-4" />
                    Review tip posting
                  </button>
                </div>
              </form>
            ) : completed ? (
              <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">Finance Manage permission is required to record a new tip.</div>
            ) : null}

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="pb-3 font-medium">Date</th>
                    <th className="pb-3 font-medium">Amount</th>
                    <th className="pb-3 font-medium">Received into</th>
                    <th className="pb-3 font-medium">Income category</th>
                    <th className="pb-3 font-medium">Reference</th>
                    <th className="pb-3 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tips.map((tip) => (
                    <tr key={tip.id}>
                      <td className="py-4 pr-4 whitespace-nowrap">{tip.entry_date}</td>
                      <td className="py-4 pr-4 whitespace-nowrap font-semibold tabular-nums">{money(tip.amount, tip.currency)}</td>
                      <td className="py-4 pr-4">{tip.financial_account_name}</td>
                      <td className="py-4 pr-4">{tip.category_ledger_account_name}</td>
                      <td className="py-4 pr-4">{tip.reference || "—"}</td>
                      <td className="py-4 text-neutral-500">{tip.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!tips.length ? <div className="py-10 text-center text-sm text-neutral-400">No tips or additional project income recorded.</div> : null}
            </div>
            {tips.length ? <p className="mt-3 text-xs leading-5 text-neutral-400">These are posted financial records. Edit/delete is intentionally unavailable here; financial corrections must use the accounting correction workflow.</p> : null}
          </>
        )}
      </section>

      <FinancialConfirmationDialog
        open={tipConfirmOpen}
        title="Record project tip"
        description="This will post income to the selected account and general ledger, linked to this project."
        details={confirmationDetails}
        confirmLabel="Post tip"
        loading={tipSaving}
        warning={`This action creates an accounting record in ${projectCurrency}. It is not an invoice payment and cannot be edited from the project page.`}
        onCancel={() => setTipConfirmOpen(false)}
        onConfirm={postTip}
      />
    </div>
  );
}
