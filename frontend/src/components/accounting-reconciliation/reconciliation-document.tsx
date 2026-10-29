"use client";

import { useState } from "react";
import { ArrowRight, Check, CheckCircle2, LockKeyhole, RefreshCw, Search, Trash2 } from "lucide-react";
import { RelationshipNotice } from "@/components/relationships/relationship-ui";
import { useReconciliationDocument } from "@/hooks/use-reconciliation-document";
import { reconciliationMoney, reconciliationZero, RECONCILIATION_TRANSACTION_CAP } from "./reconciliation-model";
import type { ReconciliationDetail, ReconciliationTransaction } from "./reconciliation-types";
import {
  ReconciliationBack, ReconciliationConfirmation, ReconciliationDatum, ReconciliationHeading,
  ReconciliationPager, reconciliationPretty, ReconciliationSectionHeading, ReconciliationState, ReconciliationStatus,
} from "./reconciliation-ui";

type DocumentState = ReturnType<typeof useReconciliationDocument>;

export function ReconciliationDocument({ reconciliationId, matching, returnHref }: {
  reconciliationId: string; matching: boolean; returnHref: string;
}) {
  const vm = useReconciliationDocument(reconciliationId, matching, returnHref);
  const document = vm.document;
  if (!vm.canView) return <ReconciliationState title="Statement information is restricted">
    Finance viewing permission is required to read this account statement and its transactions.
  </ReconciliationState>;

  return <>
    <ReconciliationBack onClick={vm.back} disabled={vm.busy} matching={matching && vm.phase !== "discarded"}
      context={vm.phase === "discarded" ? "Discarded draft" : matching ? "Matching workspace" : "Read-only statement"}/>
    <OperationRecovery vm={vm}/>
    {vm.error ? <RelationshipNotice tone="error">{vm.error}</RelationshipNotice> : null}
    {vm.message ? <RelationshipNotice tone="success">{vm.message}</RelationshipNotice> : null}
    {vm.phase === "discarded" ? <ReconciliationState title="Draft discard acknowledged"
      action={<button type="button" className="aa-primary" onClick={vm.back}>Return to register</button>}>
      The reconciliation draft and its matching records were discarded. The account’s financial transactions were not deleted.
    </ReconciliationState> : vm.resource.loading ? <ReconciliationState loading title="Reading the exact statement…"/>
      : vm.resource.error || !document ? <ReconciliationState title="Statement unavailable"
        action={<button type="button" className="aa-secondary" disabled={vm.busy} onClick={() => void vm.recheck()}>Retry statement read</button>}>
        {vm.resource.error || "The requested statement could not be verified."} No first or unrelated reconciliation is substituted.
      </ReconciliationState> : <>
        <StatementHeader vm={vm} document={document}/>
        <StatementPosition document={document}/>
        <StatementContext document={document}/>
        {matching ? <MatchingGuidance vm={vm} document={document}/> : <div className="rc-context-note">
          <strong>Read-only statement review</strong>
          <p>Viewing or filtering transactions does not change selections. {document.status === "draft" && vm.canManage
            ? "Open Match transactions to work on this draft." : "No transaction-selection controls are enabled here."}</p>
        </div>}
        <TransactionRegister vm={vm} document={document}/>
        {matching && document.status === "draft" && vm.canManage ? <StatementActions vm={vm} document={document}/> : null}
        <StatementConfirmation vm={vm} document={document}/>
      </>}
  </>;
}

function OperationRecovery({ vm }: { vm: DocumentState }) {
  if (vm.phase === "idle" || vm.phase === "discarded") return null;
  return <section className="rc-recovery" role={vm.phase === "uncertain" ? "alert" : "status"}>
    <div><p className="aa-eyebrow">{vm.phase === "uncertain" ? "Outcome requires verification" : "Write acknowledged"}</p>
      <h2>{vm.phase === "uncertain" ? "Check the saved state before another action." : "Read the updated statement before continuing."}</h2>
      <p>{vm.phase === "uncertain"
        ? "The last response did not establish the outcome. Do not repeat the action or assume an opposite selection is safe."
        : "A successful write response is retained even when parsing or readback fails. A read failure is not a reason to write again."}</p>
      {vm.operation ? <p className="rc-operation-context">{reconciliationPretty(vm.operation.kind)} · {vm.operation.account} · statement through {vm.operation.statementEnd}
        {vm.operation.transactionId ? ` · transaction ${vm.operation.transactionId}` : ""}</p> : null}
      {vm.operation?.kind === "match" || vm.operation?.kind === "unmatch" ? <p>
        The detail response contains at most {RECONCILIATION_TRANSACTION_CAP.toLocaleString()} eligible transactions. A transaction missing from that slice does not prove whether it was matched.
      </p> : null}
    </div>
    <button type="button" className="aa-secondary" disabled={vm.busy} onClick={() => void vm.recheck()}>
      <RefreshCw aria-hidden="true"/>Recheck saved state only
    </button>
  </section>;
}

function StatementHeader({ vm, document }: { vm: DocumentState; document: ReconciliationDetail }) {
  return <ReconciliationHeading eyebrow={`Finance / ${vm.matching ? "Match statement" : "Statement review"}`}
    title={document.account_name} description={`Statement through ${document.statement_end_date} · ${document.currency}`}
    actions={<>
      <ReconciliationStatus status={document.status}/>
      <button type="button" className="aa-icon-button" aria-label="Refresh reconciliation statement" disabled={vm.busy || Boolean(vm.confirmKind)}
        onClick={() => void vm.refresh()}><RefreshCw aria-hidden="true"/></button>
      {!vm.matching && document.status === "draft" && vm.canManage ? <a className="aa-primary" href={vm.matchingHref}>
        Match transactions<ArrowRight aria-hidden="true"/>
      </a> : vm.matching ? <button type="button" className="aa-secondary" disabled={vm.busy} onClick={vm.back}>Finish matching</button> : null}
    </>}/>;
}

function StatementPosition({ document }: { document: ReconciliationDetail }) {
  const zero = reconciliationZero(document.difference);
  return <section className="rc-position" aria-label="Statement comparison at this read">
    <dl className="rc-equation">
      <div><dt>Statement ending balance</dt><dd>{reconciliationMoney(document.statement_ending_balance, document.currency)}</dd><small>Amount supplied for this statement</small></div>
      <div><dt>Cleared book balance</dt><dd>{reconciliationMoney(document.cleared_book_balance, document.currency)}</dd><small>Recalculated from recorded selections</small></div>
      <div className="rc-difference" data-zero={zero || undefined}><dt>Difference at this read</dt><dd>{reconciliationMoney(document.difference, document.currency)}</dd>
        <small>{zero ? "Statement and cleared balance agree at this read" : "Statement balance minus cleared book balance"}</small>
      </div>
    </dl>
    <p>Cleared balance uses the account opening balance and eligible selected credits/debits from this statement and finalized reconciliations, through the statement end. It is not the current account balance or a sum of the visible rows.</p>
  </section>;
}

function StatementContext({ document }: { document: ReconciliationDetail }) {
  return <section className="rc-statement-context">
    <dl>
      <ReconciliationDatum label="Statement start">{document.statement_start_date || "Not supplied"}</ReconciliationDatum>
      <ReconciliationDatum label="Statement end">{document.statement_end_date}</ReconciliationDatum>
      <ReconciliationDatum label="Selected in this statement">{document.matched_transactions} transaction{document.matched_transactions === 1 ? "" : "s"}</ReconciliationDatum>
      <ReconciliationDatum label="Statement identity"><span className="rc-record-id">{document.id}</span></ReconciliationDatum>
    </dl>
    {document.notes ? <div className="rc-notes"><strong>Statement notes</strong><p>{document.notes}</p></div> : null}
    {document.status === "finalized" ? <div className="rc-finalized-note"><LockKeyhole aria-hidden="true"/><p>
      Selections are locked. Totals are not a frozen snapshot: a later statement matching an older transaction can change a historical recalculated balance.
      {document.finalized_at ? ` Finalized at ${document.finalized_at}.` : ""}
    </p></div> : null}
  </section>;
}

function MatchingGuidance({ vm, document }: { vm: DocumentState; document: ReconciliationDetail }) {
  if (document.status === "finalized") return <div className="rc-context-note">
    <strong>This statement’s selections are locked.</strong><p>Finalized reconciliations cannot be matched, unmatched or discarded. You can still inspect the returned transactions.</p>
  </div>;
  if (!vm.canManage) return <RelationshipNotice>Finance management permission is required to change selections. This matching route is read-only for your current role.</RelationshipNotice>;
  return <div className="rc-context-note rc-immediate-note"><strong>Each selection saves immediately.</strong>
    <p>Match only transactions shown on the account statement. There is no Save all or unsaved checkbox draft; leaving this workspace does not undo confirmed selections.</p>
  </div>;
}

function TransactionRegister({ vm, document }: { vm: DocumentState; document: ReconciliationDetail }) {
  return <section className="aa-register rc-transactions">
    <ReconciliationSectionHeading title="Eligible recorded transactions">
      {document.transactions.length} returned · {document.unmatched_count} unmatched in this slice. The oldest eligible transactions are returned, up to {RECONCILIATION_TRANSACTION_CAP.toLocaleString()}.
    </ReconciliationSectionHeading>
    <p className="rc-transaction-scope">Search and filters apply to this response only. Older unmatched transactions may precede the statement start; already-used transactions from other statements are excluded.</p>
    <TransactionFilters key={`${vm.selection.search}|${vm.selection.filter}`} vm={vm}/>
    {vm.page.rows.length ? <>
      <div className="rc-transaction-columns" aria-hidden="true"><span>Selection</span><span>Transaction / reference</span><span>Date / source</span><span>Account movement</span></div>
      {vm.page.rows.map(row => <TransactionRow key={row.id} row={row} matching={vm.matching} editable={vm.editable}
        onToggle={() => void vm.toggle(row.id)}/>)}
      <ReconciliationPager page={vm.page.page} pages={vm.page.pages} count={vm.page.filteredCount}
        busy={vm.busy || vm.phase !== "idle"} onPage={page => vm.changeSelection({ page })}/>
    </> : <ReconciliationState title={document.transactions.length ? "No loaded transactions match" : "No eligible transactions returned"}>
      {document.transactions.length ? "Adjust the loaded-slice filters. This search does not fetch older or additional transactions."
        : "No selection is inferred from an empty response. Recheck the statement and its account context before finalizing."}
    </ReconciliationState>}
  </section>;
}

function TransactionFilters({ vm }: { vm: DocumentState }) {
  const [search, setSearch] = useState(vm.selection.search), [filter, setFilter] = useState(vm.selection.filter);
  const disabled = vm.busy || vm.phase !== "idle";
  return <form className="rc-filters rc-transaction-filters" onSubmit={event => { event.preventDefault(); vm.changeSelection({ search, filter, page: 1 }); }}>
    <label className="rc-search"><span>Find a loaded transaction</span><Search aria-hidden="true"/>
      <input value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} placeholder="Reference, description, date or source"/>
    </label>
    <label><span>Selection</span><select value={filter} disabled={disabled} onChange={event => setFilter(event.target.value as typeof filter)}>
      <option value="all">All returned</option><option value="matched">Matched</option><option value="unmatched">Unmatched</option>
    </select></label>
    <div><button type="submit" className="aa-primary" disabled={disabled}>Apply filters</button>
      <button type="button" className="aa-secondary" disabled={disabled} onClick={() => vm.changeSelection({ search: "", filter: "all", page: 1 })}>Reset</button></div>
  </form>;
}

function TransactionRow({ row, matching, editable, onToggle }: {
  row: ReconciliationTransaction; matching: boolean; editable: boolean; onToggle: () => void;
}) {
  return <article className="rc-transaction-row" data-selected={row.selected || undefined} id={`reconciliation-transaction-${row.id}`}>
    <div className="rc-transaction-selection">{matching ? <label className="rc-selection-control">
      <input type="checkbox" checked={row.selected} disabled={!editable} onChange={onToggle}
        aria-label={`${row.selected ? "Unmatch" : "Match"} transaction ${row.reference || row.description || row.id} (${row.id})`}/>
      <span>{row.selected ? "Matched" : "Unmatched"}</span>
    </label> : <span className="rc-selection-state">{row.selected ? <Check aria-hidden="true"/> : null}{row.selected ? "Matched" : "Unmatched"}</span>}</div>
    <div className="rc-transaction-identity"><strong>{row.description || row.reference || reconciliationPretty(row.source_type)}</strong>
      <small>{row.reference || "No reference"}</small><small className="rc-record-id">{row.id}</small></div>
    <div><span className="rc-cell-label">Date / source</span><strong>{row.transaction_date}</strong><small>{reconciliationPretty(row.source_type)}</small></div>
    <div className="rc-money-cell"><span className="rc-cell-label">Account movement</span><b>{reconciliationMoney(row.amount, row.currency)}</b>
      <small>{row.direction === "credit" ? "Credit to account" : "Debit from account"}</small></div>
  </article>;
}

function StatementActions({ vm, document }: { vm: DocumentState; document: ReconciliationDetail }) {
  const zero = reconciliationZero(document.difference);
  return <>
    <section className="rc-finalize-bar">
      <div><h2>{zero ? "Review the statement before finalizing." : "A difference remains at this read."}</h2>
        <p>{zero ? "A zero difference permits a finalization request; the server rechecks the saved selections and statement chronology."
          : "Finalization requires an exact zero difference. Matching changes are already saved individually."}</p></div>
      <button type="button" className="aa-primary" disabled={!vm.editable || !zero} onClick={() => vm.reviewAction("finalize")}>
        <CheckCircle2 aria-hidden="true"/>Review finalization
      </button>
    </section>
    <section className="rc-discard-zone"><div><h2>Discard this draft</h2><p>Remove this statement draft and its matching records, not the account’s financial transactions.</p></div>
      <button type="button" className="rc-danger" disabled={!vm.editable} onClick={() => vm.reviewAction("discard")}><Trash2 aria-hidden="true"/>Discard draft</button>
    </section>
  </>;
}

function StatementConfirmation({ vm, document }: { vm: DocumentState; document: ReconciliationDetail }) {
  const discard = vm.confirmKind === "discard";
  return <ReconciliationConfirmation open={Boolean(vm.confirmKind)} loading={vm.busy}
    title={discard ? "Discard this reconciliation draft?" : "Finalize this statement’s selections?"}
    description={discard ? "The draft and its matching records will be removed. Account transactions and balances are not deleted."
      : "The server verifies the current difference and period ordering before locking transaction selections."}
    warning={discard ? "This cannot be undone from this workspace. If the response is uncertain, check the saved statement state before any repeat."
      : "Finalized selections cannot be changed or discarded. Historical displayed totals may still recalculate when later statements match older transactions."}
    confirmLabel={discard ? "Discard draft" : "Finalize reconciliation"} onCancel={vm.cancelReview} onConfirm={vm.confirmAction}
    details={[
      { label: "Account", value: document.account_name },
      { label: "Statement end", value: document.statement_end_date },
      { label: "Statement balance", value: reconciliationMoney(document.statement_ending_balance, document.currency) },
      { label: "Difference at read", value: reconciliationMoney(document.difference, document.currency), emphasis: true },
      { label: "Selected transactions", value: String(document.matched_transactions) },
    ]}/>;
}
