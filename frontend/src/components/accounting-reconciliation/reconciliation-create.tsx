"use client";

import { ArrowRight, RefreshCw } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { RelationshipNotice } from "@/components/relationships/relationship-ui";
import { useReconciliationCreate } from "@/hooks/use-reconciliation-create";
import { reconciliationMoney } from "./reconciliation-model";
import {
  ReconciliationBack, ReconciliationConfirmation, ReconciliationDatum, ReconciliationField,
  ReconciliationHeading, ReconciliationSectionHeading, ReconciliationState,
} from "./reconciliation-ui";

type CreateState = ReturnType<typeof useReconciliationCreate>;

export function ReconciliationCreate({ returnHref }: { returnHref: string }) {
  const vm = useReconciliationCreate(returnHref);
  if (!vm.canView) return <ReconciliationState title="Reconciliation setup is restricted">
    Finance viewing permission is required to verify the account and statement context.
  </ReconciliationState>;

  return <>
    <ReconciliationBack onClick={vm.back} disabled={vm.saving} context="New reconciliation"/>
    <ReconciliationHeading eyebrow="Finance / New reconciliation" title="Start with the statement."
      description="Create a draft for one account and statement end date. Matching happens next, in a separate workspace."
      actions={<button type="button" className="aa-secondary" onClick={() => void vm.refreshMeta()}
        disabled={vm.locked || vm.meta.loading}><RefreshCw aria-hidden="true"/>Refresh accounts</button>}/>
    {vm.error ? <RelationshipNotice tone="error">{vm.error}</RelationshipNotice> : null}
    {vm.phase === "confirmed" ? <CreateAcknowledgment vm={vm}/> : !vm.canManage ? <ReconciliationState title="Creating a reconciliation is restricted">
      Finance management permission is required. You can review existing statements from the register.
    </ReconciliationState> : <>
      {vm.phase === "uncertain" ? <RelationshipNotice tone="error">
        This draft may already have been created. The request has no replay key and will not be repeated from this page.
        Review the company’s current register before creating any replacement; absence from its latest-200 slice is not proof of failure.
        {" "}<a href={returnHref} target="_blank" rel="noopener noreferrer">Open the register separately</a>.
      </RelationshipNotice> : null}
      {vm.meta.loading ? <ReconciliationState loading title="Loading verified account setup…"/> : null}
      {vm.meta.error ? <ReconciliationState title="Account setup unavailable"
        action={<button type="button" className="aa-secondary" disabled={vm.locked} onClick={() => void vm.refreshMeta()}>Retry account read</button>}>
        {vm.meta.error} Existing inputs are retained; no account is guessed.
      </ReconciliationState> : null}
      {!vm.meta.loading && vm.meta.value?.accounts.length === 0 ? <ReconciliationState title="No eligible accounts returned">
        Reconciliation setup returns active financial accounts. Review account setup before starting a statement; this is not a zero balance.
      </ReconciliationState> : null}
      <form className="rc-create-layout" onSubmit={event => { event.preventDefault(); vm.review(); }}>
        <section className="rc-panel">
          <ReconciliationSectionHeading title="Statement details">
            Use the account’s own currency and the ending balance shown on the statement.
          </ReconciliationSectionHeading>
          <fieldset className="rc-fields" disabled={vm.locked || vm.meta.loading}>
            <div className="rc-wide rc-account-select">
              <SearchableSelect label="Financial account" name="account_id" required value={vm.values.account_id}
                onValueChange={value => vm.change("account_id", value)} disabled={vm.locked || vm.meta.loading}
                placeholder="Choose the statement account" options={(vm.meta.value?.accounts || []).map(account => ({
                  value: account.id, label: `${account.name} · ${account.currency}`,
                  description: account.last_reconciled_date ? `Last finalized statement: ${account.last_reconciled_date}` : "No previous finalized statement reported",
                }))}/>
            </div>
            <ReconciliationField label="Statement end date" hint="Use the date printed on the statement, not today’s account balance date.">
              <input type="date" required value={vm.values.statement_end_date}
                onChange={event => vm.change("statement_end_date", event.target.value)}/>
            </ReconciliationField>
            <ReconciliationField label={`Statement ending balance${vm.preview.account ? ` (${vm.preview.account.currency})` : ""}`}
              hint="Signed balances are supported, including zero and negative amounts. Rounded to 2 decimal places.">
              <input inputMode="decimal" autoComplete="off" required placeholder="0.00"
                value={vm.values.statement_ending_balance} onChange={event => vm.change("statement_ending_balance", event.target.value)}/>
            </ReconciliationField>
            <ReconciliationField label="Notes (optional)" wide hint="Context for this statement. These notes do not change account transactions.">
              <textarea rows={4} value={vm.values.notes} onChange={event => vm.change("notes", event.target.value)}/>
            </ReconciliationField>
          </fieldset>
          <div className="rc-start-context">
            <strong>Statement start is determined by the server.</strong>
            <p>{vm.preview.account?.last_reconciled_date
              ? `The previous finalized statement ends ${vm.preview.account.last_reconciled_date}. The server derives the next start date and checks for an existing open draft.`
              : "When a previous finalized statement exists, the server starts the next period on the following day. Otherwise no start date is assumed."}</p>
          </div>
        </section>
        <CreateSummary vm={vm}/>
      </form>
    </>}
    <ReconciliationConfirmation open={vm.confirmOpen} loading={vm.saving} title="Create this reconciliation draft?"
      description="This opens a statement-matching workspace. It does not move money or create an account transaction."
      warning="Only one open draft is permitted per account. The server rechecks account access and statement chronology before creating it."
      confirmLabel="Create reconciliation" onCancel={vm.cancelReview} onConfirm={vm.create}
      details={[
        { label: "Account", value: vm.preview.account?.name || "Not verified" },
        { label: "Statement end", value: vm.values.statement_end_date || "Not supplied" },
        { label: "Statement balance", value: vm.preview.account && vm.preview.roundedBalance !== null
          ? reconciliationMoney(vm.preview.roundedBalance, vm.preview.account.currency) : "Not verified", emphasis: true },
      ]}/>
  </>;
}

function CreateSummary({ vm }: { vm: CreateState }) {
  return <aside className="rc-create-summary">
    <p className="aa-eyebrow">New statement draft</p>
    <h2>{vm.preview.account && vm.preview.roundedBalance !== null
      ? reconciliationMoney(vm.preview.roundedBalance, vm.preview.account.currency) : "Review the statement"}</h2>
    <dl>
      <ReconciliationDatum label="Account">{vm.preview.account?.name || "Choose an account"}</ReconciliationDatum>
      <ReconciliationDatum label="Statement end">{vm.values.statement_end_date || "Choose a date"}</ReconciliationDatum>
      <ReconciliationDatum label="Next step">Match recorded transactions</ReconciliationDatum>
    </dl>
    <p>No balance difference is estimated before the server reads the account’s recorded activity.</p>
    {vm.preview.error ? <p className="rc-validation">{vm.preview.error}</p> : null}
    <button type="submit" className="aa-primary" disabled={vm.locked || vm.meta.loading || Boolean(vm.preview.error)}>
      Review reconciliation<ArrowRight aria-hidden="true"/>
    </button>
    <button type="button" className="aa-secondary" disabled={vm.saving} onClick={vm.back}>Cancel</button>
    <small>Creating a draft does not post a payment, bank transfer or journal entry.</small>
  </aside>;
}

function CreateAcknowledgment({ vm }: { vm: CreateState }) {
  return <section className="rc-panel rc-ack">
    <ReconciliationSectionHeading title="Draft creation acknowledged">
      Do not create the same statement again because a read or navigation failed.
    </ReconciliationSectionHeading>
    {vm.document ? <>
      <strong>{vm.document.account_name}</strong>
      <p>Statement through {vm.document.statement_end_date}</p>
      <dl><ReconciliationDatum label="Statement balance">{reconciliationMoney(vm.document.statement_ending_balance, vm.document.currency)}</ReconciliationDatum></dl>
      <div className="rc-inline-actions">
        {vm.document.status === "draft" && vm.canManage ? <button type="button" className="aa-primary" onClick={() => vm.openDocument(true)}>
          Start matching<ArrowRight aria-hidden="true"/>
        </button> : null}
        <button type="button" className="aa-secondary" onClick={() => vm.openDocument(false)}>View statement</button>
      </div>
    </> : <p>{vm.candidateId ? `Returned statement ID (not yet verified): ${vm.candidateId}`
      : "No verifiable statement identity was returned. Inspect the company register before creating a replacement."}</p>}
    {vm.recoveryError ? <RelationshipNotice tone="error">{vm.recoveryError}</RelationshipNotice> : null}
    {vm.candidateId ? <button type="button" className="aa-secondary" disabled={vm.recovering || vm.saving} onClick={() => void vm.verifyCandidate()}>
      {vm.recovering ? "Verifying statement…" : "Retry statement read only"}
    </button> : null}
    <button type="button" className="aa-back" disabled={vm.saving} onClick={vm.back}>Return to reconciliation register</button>
  </section>;
}
