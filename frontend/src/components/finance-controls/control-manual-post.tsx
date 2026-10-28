"use client";
import type { FormEvent } from "react";
import { MoneyOutConfirmation as FinancialConfirmationDialog } from "@/components/accounting-money-out/money-out-ui";
import { useControlManualPost } from "@/hooks/use-control-manual-post";
import { controlMoney } from "./control-model";
import { ControlBack, ControlField, ControlHeading, ControlNotice, ControlState } from "./control-ui";
export function ControlManualPost({ id, returnTo, scope }: {
  id: string;
  returnTo: string;
  scope: string;
}) {
  const vm = useControlManualPost(id, returnTo, scope),
    p = vm.posting,
    s = p.target,
    payload = p.payload,
    currency = p.phase === "idle" ? vm.profitability?.currency : vm.reviewCurrency,
    reviewCurrency = vm.reviewCurrency;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget); vm.review({
      expense_date: String(data.get("expense_date") || "") || null,
      expense_amount: String(data.get("expense_amount") || "") || null,
      account_amount: String(data.get("account_amount") || "") || null,
      profitability_amount: String(data.get("profitability_amount") || "") || null,
      reference: String(data.get("reference") || "") || null,
      notes: String(data.get("notes") || "") || null
    });
  }
  return <div className="ct-workspace ct-editor">

    <ControlBack onClick={vm.cancel} disabled={p.saving} context="One keyed operation" />

    <ControlHeading
      eyebrow="Controls / Manual post"
      title="Post one recurring expense"
      description="Review the date and amounts for this occurrence. A retry preserves the exact original payload and operation key." />


    {vm.formError ? <ControlNotice tone="error">

      {vm.formError}

    </ControlNotice> : null}

    {p.error ? <ControlNotice tone="error">

      {p.error}

    </ControlNotice> : null}

    {vm.readbackError ? <ControlNotice tone="error">

      {vm.readbackError}

    </ControlNotice> : null}


    {p.phase === "uncertain" ? <section className="ct-outcome" role="status">

      <strong>Posting outcome needs verification</strong>

      <p>The original six-field body and retry key are retained. Inspect saved expense records before explicitly retrying this same operation. A later rejection does not prove the first request failed. Do not create a replacement.</p>

      <div className="ct-form-actions">

        <button type="button" className="aa-secondary" disabled={p.saving || !p.canPost} onClick={p.retryReview}>Review same-operation retry</button>

        <a href="/dashboard/expenses" target="_blank" rel="noopener noreferrer" className="aa-secondary">Inspect expense register in new tab</a>

      </div>

    </section> : null}


    {p.phase === "confirmed" ? <section className="ct-outcome" data-confirmed="true" role="status">

      <strong>Expense posting acknowledged</strong>

      <p>

        {p.receipt ? `${p.receipt.expense_number} · ${p.receipt.posted_date}. Current schedule next due: ${p.receipt.next_due_date}.` : "The write was acknowledged but its receipt could not be verified. Do not post again."}

      </p>

      <p>Returned schedule values are current, not a frozen expense receipt. This workspace cannot begin another occurrence, even if a later read fails.</p>

      <button
        type="button"
        className="aa-secondary"
        onClick={p.receipt ? p.navigateToReceipt : p.navigateToExpenses}>

        {p.receipt ? "View acknowledged expense" : "Inspect expense register"}

      </button>

    </section> : null}


    {!vm.canView ? <ControlState title="Finance read access required" /> : !s ? vm.resource.loading ? <ControlState title="Loading exact schedule" loading /> : vm.resource.error ? <ControlState
      title="Schedule unavailable"
      action={<button type="button" className="aa-secondary" onClick={vm.refresh}>Retry read</button>}>

      {vm.resource.error}

    </ControlState> : <ControlState
      title={!vm.canManage ? "Finance management access required" : vm.source && !vm.source.is_active ? "This schedule is paused" : "Schedule unavailable"}>Return to the register and inspect the current schedule.</ControlState> : <form onSubmit={submit} onChange={() => p.edit()} className="ct-section">


      <div className="ct-post-context">

        <h2>

          {s.name}

        </h2>

        <p>Scheduled {controlMoney(s.expense_amount, s.expense_currency)} · {s.account_name} ({s.account_currency})</p>

      </div>


      {p.phase === "idle" && !vm.ready ? <ControlNotice>

        {vm.meta.error || vm.accounts.error || vm.account?.warning || vm.profitability?.warning || "Verifying payment account and relationship currencies…"}

        <button
          type="button"
          className="ct-text-button"
          onClick={() => { void vm.meta.refresh(); void vm.accounts.refresh(); }}>Reload posting context</button>

      </ControlNotice> : null}


      <fieldset disabled={p.locked || !p.canPost} className="ct-form-grid">

        <ControlField label="Expense date">

          <input name="expense_date" type="date" defaultValue={s.next_due_date} />

        </ControlField>

        <ControlField label={`Expense amount (${s.expense_currency})`}>

          <input name="expense_amount" type="number" min="0.01" step="0.01" defaultValue={String(s.expense_amount)} />

        </ControlField>

        {s.account_currency !== s.expense_currency ? <ControlField label={`Actual account deduction (${s.account_currency})`}>

          <input name="account_amount" required type="number" min="0.01" step="0.01" />

        </ControlField> : <input type="hidden" name="account_amount" value="" />}

        {currency && currency !== s.expense_currency ? <ControlField label={`Profitability amount (${currency})`}>

          <input name="profitability_amount" required type="number" min="0.01" step="0.01" />

        </ControlField> : <input type="hidden" name="profitability_amount" value="" />}

        <ControlField label="Reference">

          <input name="reference" defaultValue={s.reference ?? ""} />

        </ControlField>

        <ControlField label="Notes" wide>

          <textarea name="notes" defaultValue={s.notes ?? ""} />

        </ControlField>

      </fieldset>


      <p className="ct-footnote">Cross-currency amounts remain separate. The schedule advances from its current saved next due date; this action is not catch-up posting.</p>

      <div className="ct-form-actions">

        <button type="button" className="aa-secondary" aria-label="Close" disabled={p.saving} onClick={vm.cancel}>Back to register</button>

        <button className="aa-primary" disabled={!vm.ready || !p.canPost || p.locked}>Review expense posting</button>

      </div>

    </form>}


    <FinancialConfirmationDialog
      open={p.confirmOpen && Boolean(payload && s)}
      title={p.phase === "uncertain" ? "Retry this same recurring posting?" : "Post this recurring expense?"}
      description={p.phase === "uncertain" ? "This sends the retained original body and key, not a replacement or the next occurrence." : "Creates a real posted expense through the existing accounting workflow."}
      details={s && payload ? [
        { label: "Schedule", value: s.name },
        { label: "Expense date", value: payload.expense_date ?? s.next_due_date },
        {
          label: "Expense",
          value: controlMoney(payload.expense_amount ?? s.expense_amount, s.expense_currency),
          emphasis: true
        },
        ...(s.account_currency !== s.expense_currency ? [{ label: "Account deduction", value: controlMoney(payload.account_amount ?? 0, s.account_currency), emphasis: true }] : []),
        ...(reviewCurrency && reviewCurrency !== s.expense_currency ? [{ label: "Profitability cost", value: controlMoney(payload.profitability_amount ?? 0, reviewCurrency) }] : []),
        { label: "Paid from", value: `${s.account_name} · ${s.account_currency}` }
      ] : []}
      confirmLabel={p.phase === "uncertain" ? "Retry same operation" : "Post expense"}
      loading={p.saving}
      warning="Posted financial records are auditable. Correct an erroneous expense through the existing correction workflow; do not silently rewrite historical accounting."
      onCancel={p.cancelReview}
      onConfirm={vm.confirm} />


  </div>;
}
